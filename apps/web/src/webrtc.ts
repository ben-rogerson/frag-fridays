import { Packet, Xash3D, Xash3DOptions, Net } from 'xash3d-fwgs'

// WebRTC networking for the Xash3D engine, matching the signalling protocol
// of the goxash3d-fwgs server embedded in our yohimik/cs-web-server image
// (ported from the image's stock client, not the upstream example - the
// example on git main targets a newer server that double-encodes `data`;
// ours sends plain objects. We accept both).
//
// Flow: ws connects -> peer + local tracks created on open -> server sends
// offer -> we answer -> server-created 'read'/'write' data channels open ->
// game packets flow over the channels. Remote audio tracks (in-game sound)
// play through a hidden media element.
export class Xash3DWebRTC extends Xash3D {
  private channel?: RTCDataChannel
  private resolve?: () => void
  private ws?: WebSocket
  private peer?: RTCPeerConnection
  private stream?: MediaStream
  private remoteDescription?: RTCSessionDescriptionInit
  private candidates: RTCIceCandidateInit[] = []
  private wasRemote = false

  constructor(opts?: Xash3DOptions) {
    super(opts)
    this.net = new Net(this)
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
    this.stream?.getTracks()?.forEach((t) => {
      this.peer!.addTrack(t, this.stream!)
    })
    let channelsCount = 0
    this.peer.ondatachannel = (e) => {
      if (e.channel.label === 'write') {
        e.channel.onmessage = (ee) => {
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

  private async connect() {
    // Mic feeds in-game voice. getUserMedia only exists in secure contexts
    // (the player URL is plain http), and players may deny it - both are fine.
    this.stream = await navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .catch(() => undefined)
    return new Promise<void>((resolve) => {
      this.resolve = resolve
      this.connectWs()
    })
  }

  sendto(packet: Packet) {
    if (!this.channel) return
    this.channel.send(packet.data as Int8Array<ArrayBuffer>)
  }
}
