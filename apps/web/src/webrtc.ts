import { Packet, Xash3D, Xash3DOptions, Net } from 'xash3d-fwgs'

// WebRTC networking for the Xash3D engine, matching the signalling protocol
// of the goxash3d-fwgs server embedded in our yohimik/cs-web-server image
// (ported from the image's stock client, not the upstream example - the
// example on git main targets a newer server that double-encodes `data`;
// ours sends plain objects. We accept both).
//
// Flow: ws connects -> peer created on open -> server sends offer -> we
// answer -> server-created 'read'/'write' data channels open -> game
// packets flow over the channels. Remote audio tracks (in-game sound)
// play through a hidden media element.
//
// Mic capture (in-game voice) is deliberately disabled: it was always-on
// with no mute UI, so players were broadcasting without realising. To
// re-enable, restore the getUserMedia call in connect() and the addTrack
// loop in startConnection() (see git history).

// 'transport' = the WebRTC session itself died (server restart, network
// gone); 'silence' = transport still up but the game server stopped talking
// (kicked, timed out, sv shutdown)
export type DropKind = 'transport' | 'silence'

export class Xash3DWebRTC extends Xash3D {
  // fires once when the connection to the server is lost, however detected
  onDrop?: (kind: DropKind) => void

  private channel?: RTCDataChannel
  private resolve?: () => void
  private ws?: WebSocket
  private peer?: RTCPeerConnection
  private remoteDescription?: RTCSessionDescriptionInit
  private candidates: RTCIceCandidateInit[] = []
  private wasRemote = false
  private silenceTimer?: number
  private droppedFired = false
  private sawTraffic = false

  // Server traffic is continuous while connected, so this much silence after
  // packets have started flowing means we were dropped at the game level.
  // Generous enough to ride out map-change hitches.
  private static readonly SILENCE_MS = 10_000

  constructor(opts?: Xash3DOptions) {
    super(opts)
    this.net = new Net(this)
    // A hidden tab stops rAF, freezing the engine loop - we stop sending and
    // the server stops answering within a second or two (mutual silence)
    // while still holding the slot for sv_timeout. That is not a drop, so
    // the watchdog only runs while the tab is visible; returning re-arms it
    // with a fresh window, so a genuine kick still surfaces ~10s after
    // tab return (the resumed client gets no reply).
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.sawTraffic && !this.droppedFired) this.armSilence()
    })
  }

  async init() {
    await Promise.all([super.init(), this.connect()])
  }

  private wsSend(event: string, data: unknown) {
    this.ws?.send(JSON.stringify({ event, data }))
  }

  private startConnection() {
    if (this.peer) return

    this.peer = new RTCPeerConnection()
    this.peer.onicecandidate = (e) => {
      if (e.candidate) this.wsSend('candidate', e.candidate.toJSON())
    }
    // 'disconnected' is often transient, so it's left to the silence
    // watchdog; these two are terminal
    this.peer.onconnectionstatechange = () => {
      const s = this.peer?.connectionState
      if (s === 'failed' || s === 'closed') this.fireDrop('transport')
    }
    this.peer.ontrack = (e) => {
      const el = document.createElement(e.track.kind) as HTMLMediaElement
      el.srcObject = e.streams[0]
      el.autoplay = true
      el.style.display = 'none'
      document.body.appendChild(el)
      e.track.onmute = () => {
        el.play().catch(() => {})
      }
      e.streams[0].onremovetrack = () => {
        el.remove()
      }
    }
    let channelsCount = 0
    this.peer.ondatachannel = (e) => {
      e.channel.onclose = () => this.fireDrop('transport')
      if (e.channel.label === 'write') {
        e.channel.onmessage = (ee) => {
          this.bumpSilence()
          const packet: Packet = {
            ip: [127, 0, 0, 1],
            port: 8080,
            data: ee.data,
          }
          if (ee.data.arrayBuffer) {
            ee.data.arrayBuffer().then((data: Int8Array) => {
              packet.data = data
              ;(this.net as Net).incoming.enqueue(packet)
            })
          } else {
            ;(this.net as Net).incoming.enqueue(packet)
          }
        }
      }
      e.channel.onopen = () => {
        channelsCount += 1
        if (e.channel.label === 'read') {
          this.channel = e.channel
        }
        if (channelsCount === 2 && this.resolve) {
          const r = this.resolve
          this.resolve = undefined
          r()
        }
      }
    }
  }

  private async handleDescription() {
    if (!this.remoteDescription || !this.peer) return
    await this.peer.setRemoteDescription(this.remoteDescription)
    this.remoteDescription = undefined
    const answer = await this.peer.createAnswer()
    await this.peer.setLocalDescription(answer)
    this.wsSend('answer', answer)
    this.wasRemote = true
    this.handleCandidates()
  }

  private handleCandidates() {
    if (!this.candidates.length || !this.peer) return
    const pending = this.candidates
    this.candidates = []
    pending.forEach((c) => {
      this.peer!.addIceCandidate(c).catch(() => {
        this.candidates.push(c)
      })
    })
  }

  private connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    this.ws = new WebSocket(`${proto}://${location.host}/websocket`)
    this.ws.addEventListener('message', async (e: MessageEvent) => {
      const msg = JSON.parse(e.data)
      const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data
      switch (msg.event) {
        case 'offer':
          this.remoteDescription = data
          await this.handleDescription()
          break
        case 'candidate':
          this.candidates.push(data)
          if (this.wasRemote) this.handleCandidates()
          break
      }
    })
    this.ws.onopen = () => this.startConnection()
  }

  private connect() {
    return new Promise<void>((resolve) => {
      this.resolve = resolve
      this.connectWs()
    })
  }

  sendto(packet: Packet) {
    if (!this.channel) return
    this.channel.send(packet.data as Int8Array<ArrayBuffer>)
  }

  // armed by the first incoming packet, re-armed by every one after
  private bumpSilence() {
    if (this.droppedFired) return
    this.sawTraffic = true
    this.armSilence()
  }

  private armSilence() {
    clearTimeout(this.silenceTimer)
    // the hidden check happens at fire time, not arm time, so a transient
    // visibility flap can never cancel detection outright - at worst it
    // skips one firing and the visibilitychange handler re-arms
    this.silenceTimer = window.setTimeout(() => {
      if (document.hidden) return
      this.fireDrop('silence')
    }, Xash3DWebRTC.SILENCE_MS)
  }

  private fireDrop(kind: DropKind) {
    if (this.droppedFired) return
    this.droppedFired = true
    clearTimeout(this.silenceTimer)
    this.onDrop?.(kind)
  }

  // Reconnect in-engine after a game-level drop. Returns false when the
  // transport itself is dead - a full page reload is the only way back then.
  retryConnect(): boolean {
    if (this.channel?.readyState !== 'open' || this.peer?.connectionState !== 'connected') {
      return false
    }
    this.droppedFired = false
    this.bumpSilence()
    this.Cmd_ExecuteString('retry')
    return true
  }
}
