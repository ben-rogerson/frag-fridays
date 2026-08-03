import { FC, useEffect, useRef, useState } from 'react'
import { downloadValveZip, launchGame } from './launch'
import { Xash3DWebRTC } from './webrtc'
import './App.css'

type Stage =
  | { id: 'downloading'; received: number; total: number | null }
  | { id: 'ready' }
  | { id: 'engine' }
  | { id: 'unpacking'; done: number; total: number }
  | { id: 'playing' }
  | { id: 'dropped'; kind: 'transport' | 'silence' }
  | { id: 'error'; message: string }

const SEGMENTS = 24

// Background: Counter Strike 1.6 ANNIHILATION 2 HQ (7:36). Random start so
// the music differs each load; capped at 400s to leave a stretch before the
// loop wraps to 0.
//
// The embed goes through a relay page (apps/web/shim, a Cloudflare Worker):
// YouTube refuses embeds from IP-literal http origins like the game server
// (widget onError 150), but accepts them from the shim's workers.dev domain.
// The shim relays widget postMessage traffic both ways, so the sound toggle
// and error fallback below work exactly as if the player were embedded here.
const VIDEO_ID = 'Y6gcmbioqiE'
const VIDEO_MAX_START = 400
const VIDEO_SHIM = 'https://frag-friday-bg.floral-math-a059.workers.dev'

const NEWS = [
  'BREAKING: Bomb has been planted. Authorities urge residents to gather directly on top of it',
  'de_dust2 voted best holiday destination for 26th consecutive year',
  'Local CT spotted defusing with a kit he never bought. Investigation ongoing',
  'Study finds 9 out of 10 knife-round losses caused by "lag"',
  'Chicken population on cs_italy reaches critical low. Scientists baffled, Ts blamed',
  'Man who bought AWP on pistol round says he is "confident in the strategy"',
  'Friendly fire incident ruled "definitely an accident" for the 14th consecutive time',
  'Rush B strategy peer-reviewed, found to be "no worse than anything else we tried"',
  'Hostages develop Stockholm syndrome: "at least the Ts never made us rush long A"',
  'Door on de_nuke opened loudly for 4 billionth time, neighbours furious',
  'Economy in shambles: player saves for full armour, dies to headshot anyway',
  'Bot difficulty raised by one. Server population mysteriously halves',
  'Flashbang sales soar as teammates report finally "seeing the light"',
  'AFK player commended for "anchoring the site", awarded MVP',
  'Weather forecast for de_aztec: rain. Tomorrow: rain. Forever: rain',
]
const NEWS_TEXT = NEWS.join('  •••  ') + '  •••  '

const mb = (bytes: number) => Math.round(bytes / 1048576)

// each mod's compose mounts its own /info.json next to the client
type ModeInfo = { mode: string; tagline?: string; bullets?: string[] }

// the Vultr box (update if the VPS is ever resized)
const SERVER_SPECS: [string, string][] = [
  ['vCPUs', '1 vCPU'],
  ['RAM', '2048.00 MB'],
  ['Storage', '25 GB NVMe'],
  ['Location', '\u{1F1E6}\u{1F1FA} Sydney'],
]

// fullscreen muzzle-flash flicker: soft amber bursts (occasionally a
// whole-screen wash) composited over the page. Low alpha so nothing
// underneath loses readability; skipped under prefers-reduced-motion.
const FlashCanvas: FC = () => {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!

    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * devicePixelRatio)
      canvas.height = Math.floor(window.innerHeight * devicePixelRatio)
    }
    resize()
    window.addEventListener('resize', resize)

    type Flash = { x: number; y: number; r: number; born: number; span: number; full: boolean }
    let flashes: Flash[] = []
    let nextAt = performance.now() + 900
    let raf = 0

    const tick = (t: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (t >= nextAt) {
        flashes.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: (0.18 + Math.random() * 0.3) * Math.min(canvas.width, canvas.height),
          born: t,
          span: 180 + Math.random() * 260,
          full: Math.random() < 0.18,
        })
        nextAt = t + 500 + Math.random() * 2400
      }
      ctx.globalCompositeOperation = 'lighter'
      flashes = flashes.filter((f) => {
        const life = (t - f.born) / f.span
        if (life >= 1) return false
        const a = Math.sin(Math.PI * life)
        if (f.full) {
          ctx.fillStyle = `rgba(255, 205, 130, ${(a * 0.05).toFixed(3)})`
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        } else {
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r)
          g.addColorStop(0, `rgba(255, 214, 150, ${(a * 0.16).toFixed(3)})`)
          g.addColorStop(1, 'rgba(255, 214, 150, 0)')
          ctx.fillStyle = g
          ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2)
        }
        return true
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas className="flashfx" ref={ref} aria-hidden="true" />
}

// crest above the heading (supplied artwork, recoloured white via currentColor)
const CrestLogo: FC = () => (
  <svg viewBox="0 0 48 48" className="crest" aria-hidden="true">
    <path
      fill="currentColor"
      d="M43,10.077c-0.506-0.001-1.216-0.054-1.717,0.024c-0.746,0.132-1.506-0.086-2.258-0.109 c-0.011-0.184,0.129-0.513,0.122-0.696c-0.141-0.018-0.281-0.028-0.417-0.06c-0.127-0.457-0.078-0.939-0.093-1.408 c-0.072-0.001-0.217-0.004-0.289-0.006c-0.023,0.534-0.021,1.068-0.027,1.602c-0.185-0.151-0.314-0.444-0.583-0.423L30.392,9 c-0.388,0.042-0.691-0.223-1.004-0.41c-0.03-0.246-0.069-0.49-0.117-0.732c-0.22,0.303-0.24,0.691-0.321,1.048 c-0.584,0.116-1.161,0.443-1.756,0.495c-0.052-0.344-0.107-0.687-0.145-1.034c0.315-0.152,0.669-0.254,0.93-0.502 c0.307-0.898-0.048-1.832-0.251-2.71C27.099,4.697,26.402,4.292,25.677,4h-1.042v0c-0.716,0.234-1.429,0.617-1.836,1.291 c-0.63,0.989-0.717,2.259-0.321,3.357c-0.056,0.038-0.168,0.116-0.224,0.156c-0.682-0.54-1.625-0.273-2.278,0.18 c-0.948,0.719-1.454,1.895-1.664,3.055c-0.217,0.983-0.12,1.992-0.004,2.98c-0.392,0.097-0.794,0.116-1.193,0.146 c-0.167,0.007-0.378,0.074-0.396,0.273c-0.12,0.782-0.031,1.586-0.192,2.363c-0.104,0.498-0.171,1.004-0.154,1.514 c0.437,0.099,0.877,0.194,1.316,0.287c-0.3,0.138-0.645,0.236-0.859,0.509c-0.188,1.261,0.26,2.504,0.22,3.769 c-0.22,0.192-0.495,0.365-0.567,0.673c-0.135,0.363,0.08,0.732,0.027,1.103c-0.051,0.404,0.04,0.806,0.169,1.184 c0.121,0.317,0.02,0.657-0.028,0.98c-0.142,0.836-0.305,1.674-0.34,2.523c-0.028,0.448,0.127,0.91-0.016,1.345 c-0.466,1.068-1.249,1.959-1.663,3.054c-0.183,0.504-0.09,1.08-0.353,1.558c-0.281,0.538-0.669,1.069-0.634,1.714 c-0.031,0.437,0.317,0.829,0.17,1.266c-0.218,0.891-0.437,1.783-0.679,2.669c-0.164,0.589-0.195,1.234-0.012,1.822 c0.245,0.129,0.521,0.172,0.789,0.23h1.031c0.333-0.031,0.663-0.087,0.996-0.134c0.096-0.462-0.017-0.913-0.173-1.343 c-0.194-1.084-0.021-2.236,0.52-3.192c0.187-0.248,0.527-0.344,0.66-0.64c0.199-0.423,0.294-0.886,0.476-1.316 c0.256-0.612,0.606-1.187,0.766-1.838c0.089-0.356-0.013-0.721,0.019-1.081c0.097-0.399,0.276-0.79,0.57-1.078 c0.394-0.369,0.548-0.934,0.979-1.269c0.294-0.22,0.308-0.614,0.37-0.951c0.058-0.446,0.203-0.873,0.364-1.29 c0.229-0.577,0.387-1.21,0.828-1.665c0.28-0.293,0.42-0.683,0.522-1.071c0.175,0.339,0.315,0.715,0.596,0.981 c0.315,0.158,0.774,0.073,0.965,0.434c0.549,0.836,0.59,1.312,1.141,2.148c0.263,0.519,0.897,0.392,1.366,0.406 c0.27,0.371,0.571,0.478,0.481,0.928c-0.017,0.507-0.445,0.898-0.385,1.417c0.047,1.056,0.125,2.121,0.399,3.144 c0.096,0.477,0.344,0.915,0.352,1.411c0.012,0.574-0.097,1.514-0.212,2.081c-0.28,0.759-0.471,1.553-0.507,2.366 c0.662,0.39,1.426-0.006,2.118,0.225c0.759,0.251,1.555,0.341,2.35,0.326c0.489-0.009,0.979-0.057,1.46-0.132 c0.003-0.277,0.093-0.578-0.033-0.837c-0.4-0.473-1.069-0.475-1.555-0.802c-0.393-0.354-0.714-0.786-1.042-1.201 c-0.277-0.326,0.094-0.777,0.083-1.188c0.004-0.624,0.001-1.267,0.231-1.855c0.17-0.468,0.113-0.974,0.021-1.451 c-0.124-0.587,0.086-1.166,0.14-1.747c0.078-0.792,0.134-1.586,0.184-2.38c0.036-0.453-0.119-0.885-0.229-1.316 c-0.065-0.406-0.451-0.635-0.564-1.02c-0.662-1.826-1.268-3.329-2.572-4.785c-0.501-0.499-0.754-1.333-0.45-2.004 c0.282,0.077,0.562,0.162,0.848,0.234c0.305-0.411,0.603-0.865,0.652-1.393c0.05-0.544,0.065-1.091,0.113-1.635 c0.022-0.593,0.15-1.204-0.003-1.786c-0.1-0.398-0.493-0.57-0.797-0.772c0.073-0.277,0.147-0.552,0.212-0.831 c1.003,0.489,1.933,1.198,3.056,1.372c0.301,0.046,0.623,0.19,0.922,0.052c0.412-0.198,0.73-0.544,1.09-0.822 c0.652-0.513,0.562-1.449,0.789-2.181c0.222-0.086,0.448-0.165,0.673-0.249c-0.148-0.649-0.406-1.305-0.318-1.982 c0.27-0.369,0.611-0.59,0.892-0.951c0.201-0.274,0.549-0.345,0.866-0.337c0.955-0.005,1.911,0.012,2.867,0.001 c0.031-0.139-0.082,0.139-0.048,0c0.994,0.057,1.989-0.159,2.985-0.035c0.621,0.107,1.455,0.063,2.079,0.017 C43.024,10.8,43.008,10.26,43,10.077z M30.703,13.574c-0.189-0.338-0.472-0.656-0.528-1.046c0.03-0.041,0.092-0.12,0.122-0.16h0 c0.406-0.043,0.815-0.016,1.222,0.004C31.256,12.778,30.978,13.176,30.703,13.574z M30.644,12.266 c0.27-0.138,0.357-0.423,0.392-0.71c0.217-0.011,0.435-0.018,0.655-0.023c0.008,0.211,0.015,0.42,0.023,0.631 C31.362,12.243,31.001,12.242,30.644,12.266z"
    />
    <path
      fill="currentColor"
      d="M43 23h-7v-2h9c-.131-.793-.66-1.501-1.395-1.808-.493-.226-1.044-.19-1.57-.19L36 19c-1 0-2 1-2 2v2c.055.998 1 2 2 2h7v2h-9c.134.637.47 1.237 1.018 1.593.48.346 1.083.424 1.657.407H43c1 0 2-1 2-2v-2C45 24 44.12 23.019 43 23zM5 21h8c0-1.105-.895-2-2-2H5c-1.105 0-2 .895-2 2v6c0 1.105.895 2 2 2h6c1.105 0 2-.895 2-2H5V21z"
    />
  </svg>
)

// stylised sponsor marks, drawn inline so the page stays self-contained
const SWS_COLOURS = [
  '#2ecc71', '#71e0d6', '#2394df', '#5d3fd3',
  '#e64c4c', '#f5a623', '#f7d154', '#9acd32',
]

const SimplyWallStLogo: FC = () => (
  <span className="sponsor">
    <svg viewBox="0 0 40 40" className="sponsor__mark" aria-hidden="true">
      {SWS_COLOURS.map((c, i) => (
        <ellipse
          key={c}
          cx="20"
          cy="9"
          rx="3.2"
          ry="9"
          fill={c}
          transform={`rotate(${i * 45} 20 20)`}
        />
      ))}
    </svg>
    <span className="sponsor__name">Simply Wall St</span>
  </span>
)

const MonsterUltraLogo: FC = () => (
  <span className="sponsor">
    <svg viewBox="0 0 100 100" className="sponsor__mark sponsor__mark--claw" aria-hidden="true">
      <path d="M28 8 L40 8 L42 46 L36 74 L30 46 Z" />
      <path d="M46 4 L60 4 L57 52 L51 92 L46 52 Z" />
      <path d="M66 8 L78 8 L72 46 L62 74 L64 46 Z" />
    </svg>
    <span className="sponsor__name sponsor__name--monster">
      Monster <em>Ultra</em>
    </span>
  </span>
)

function stageProgress(stage: Stage): number | null {
  switch (stage.id) {
    case 'downloading':
      return stage.total ? stage.received / stage.total : null
    case 'unpacking':
      return stage.total ? stage.done / stage.total : null
    case 'ready':
    case 'engine':
    case 'playing':
      return 1
    case 'dropped':
    case 'error':
      return 0
  }
}

function stageLabel(stage: Stage): string {
  switch (stage.id) {
    case 'downloading':
      return stage.total
        ? `Downloading game files - ${mb(stage.received)} / ${mb(stage.total)} MB`
        : `Downloading game files - ${mb(stage.received)} MB`
    case 'ready':
      return 'Game files loaded'
    case 'engine':
      return 'Starting engine, connecting to server…'
    case 'unpacking':
      return `Unpacking files - ${stage.done} / ${stage.total}`
    case 'playing':
      return ''
    case 'dropped':
      return stage.kind === 'transport'
        ? 'Connection to the server was lost'
        : 'You were dropped from the server'
    case 'error':
      return stage.message
  }
}

const App: FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const zipRef = useRef<Uint8Array | null>(null)
  const xashRef = useRef<Xash3DWebRTC | null>(null)
  const startedRef = useRef(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [stage, setStage] = useState<Stage>({ id: 'downloading', received: 0, total: null })
  const [videoStart] = useState(() => Math.floor(Math.random() * VIDEO_MAX_START))
  const [videoDead, setVideoDead] = useState(false)
  // Sound is wanted by default, but browsers refuse unmuted playback with
  // no user gesture (and unmuting early PAUSES the video), so it applies on
  // the first click/keypress. The icon reflects the PLAYER's actual muted
  // state (reported via infoDelivery), not our wish - otherwise it shows
  // sound-on while the browser still has it muted, and the first toggle
  // press mutes instead of unmuting.
  const [playerMuted, setPlayerMuted] = useState(true)
  const playerMutedRef = useRef(true)
  const wantSoundRef = useRef(true)
  const fadeRef = useRef<number | null>(null)
  const [name, setName] = useState(() => localStorage.getItem('ff-name') ?? '')
  const [musicOver, setMusicOver] = useState(false)
  const [pipOpen, setPipOpen] = useState(false)
  const [modeInfo, setModeInfo] = useState<ModeInfo | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const enterFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else enterFullscreen()
  }

  useEffect(() => {
    // no-store so a mod swap shows fresh info without a hard refresh
    fetch('/info.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((info: ModeInfo | null) => {
        if (info?.mode) setModeInfo(info)
      })
      .catch(() => {})
  }, [])

  // YouTube refuses embeds from some origins (error 150/153 - e.g. IP-literal
  // http origins since late 2025). Detect via the widget API and drop the
  // iframe so players get the plain gradient instead of YouTube's error box.
  // The widget only reports errors after a 'listening' handshake.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return
      // only trust the pip iframe (the audible one) - the background iframe
      // is the same shim relaying its own permanently-muted widget, and its
      // muted:true reports would clobber the real sound state
      if (e.source !== iframeRef.current?.contentWindow) return
      try {
        const d = JSON.parse(e.data)
        if (d.event === 'onError' || d.info?.playerErrorCode) setVideoDead(true)
        if (d.info && typeof d.info.muted === 'boolean') {
          playerMutedRef.current = d.info.muted
          setPlayerMuted(d.info.muted)
        }
      } catch {
        /* not a widget message */
      }
    }
    window.addEventListener('message', onMsg)
    const handshake = setInterval(() => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 'ff', channel: 'widget' }),
        '*',
      )
    }, 1000)
    // Gestures apply the wanted-by-default sound: any click, or Enter
    // (typing a name shouldn't kick the music off early - Enter commits).
    // Skipped when the gesture is the toggle itself, so a mute press is
    // not immediately overridden.
    const onPointer = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('.sound')) return
      if (wantSoundRef.current) startSound()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && wantSoundRef.current) startSound()
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('message', onMsg)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
      clearInterval(handshake)
      stopFade()
    }
  }, [])

  const ytCommand = (func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      '*',
    )
  }

  const stopFade = () => {
    if (fadeRef.current !== null) {
      clearInterval(fadeRef.current)
      fadeRef.current = null
    }
  }

  // unmute at volume 0 and ramp to 65 over ~0.6s; no-op while already
  // fading or already audible
  const startSound = () => {
    if (fadeRef.current !== null || !playerMutedRef.current) return
    // mark unmuted straight away so clicks arriving before the widget's
    // muted:false report can't restart the fade; a muted:true report will
    // correct this if the browser actually refused the unmute
    playerMutedRef.current = false
    ytCommand('setVolume', [0])
    ytCommand('unMute')
    ytCommand('playVideo')
    let volume = 0
    fadeRef.current = window.setInterval(() => {
      volume = Math.min(65, volume + 8)
      ytCommand('setVolume', [volume])
      if (volume >= 65) stopFade()
    }, 65)
  }

  // let the track ride for 15s once in-game, then ramp down and drop the iframe
  const endMusicSoon = () => {
    window.setTimeout(() => {
      stopFade()
      if (playerMutedRef.current) {
        setMusicOver(true)
        return
      }
      let volume = 65
      fadeRef.current = window.setInterval(() => {
        volume = Math.max(0, volume - 8)
        ytCommand('setVolume', [volume])
        if (volume <= 0) {
          stopFade()
          ytCommand('mute')
          setMusicOver(true)
        }
      }, 65)
    }, 15000)
  }

  const toggleSound = () => {
    if (playerMuted) {
      // unmuting needs a user gesture, which this click is
      wantSoundRef.current = true
      startSound()
    } else {
      wantSoundRef.current = false
      stopFade()
      ytCommand('mute')
    }
  }

  useEffect(() => {
    let cancelled = false
    downloadValveZip((p) => {
      if (!cancelled) setStage({ id: 'downloading', ...p })
    })
      .then((bytes) => {
        if (cancelled) return
        zipRef.current = bytes
        setStage({ id: 'ready' })
      })
      .catch((err: Error) => {
        if (!cancelled) setStage({ id: 'error', message: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const play = async () => {
    if (startedRef.current || !zipRef.current || !canvasRef.current) return
    startedRef.current = true
    // Play is itself a gesture: kick the music off if it hasn't started yet,
    // then drop the wish so in-game clicks can't restart it once it ends
    if (wantSoundRef.current) startSound()
    wantSoundRef.current = false
    // the Play gesture also covers the fullscreen request
    enterFullscreen()
    // quotes/semicolons would escape the `name "..."` console command
    const playerName = name.replace(/["';\\]/g, '').trim().slice(0, 31)
    localStorage.setItem('ff-name', playerName)
    try {
      xashRef.current = await launchGame(
        canvasRef.current,
        zipRef.current,
        playerName,
        (s) =>
          setStage(s.phase === 'engine' ? { id: 'engine' } : { id: 'unpacking', done: s.done, total: s.total }),
        (kind) => {
          // the engine may still hold the pointer when the server vanishes
          document.exitPointerLock?.()
          setStage({ id: 'dropped', kind })
        },
      )
      zipRef.current = null
      // a drop during launch must not be clobbered by the launch resolving
      setStage((s) => (s.id === 'dropped' ? s : { id: 'playing' }))
      // music rides into the game briefly, then fades out
      endMusicSoon()
    } catch (err) {
      setStage({ id: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  // in-engine `retry` when only the game link dropped; full reload when the
  // WebRTC transport itself is gone (the engine can't rebuild it mid-flight)
  const reconnect = () => {
    if (xashRef.current?.retryConnect()) setStage({ id: 'playing' })
    else location.reload()
  }

  const progress = stageProgress(stage)
  const filled = progress === null ? 0 : Math.round(progress * SEGMENTS)

  return (
    <>
      <canvas id="canvas" ref={canvasRef} />
      <div className={`overlay${stage.id === 'playing' ? ' overlay--hidden' : ''}`}>
        {stage.id !== 'playing' && !videoDead && (
          <iframe
            className="bgvid"
            src={`${VIDEO_SHIM}/?v=${VIDEO_ID}&start=${videoStart}`}
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            tabIndex={-1}
            title="background video"
          />
        )}
        <div className="tint" />
        <div className="specs">
          <p className="specs__label">Server</p>
          <dl className="specs__list">
            {SERVER_SPECS.map(([k, v]) => (
              <div className="specs__row" key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="sponsors">
          <p className="sponsors__label">Supported by</p>
          <div className="sponsors__logos">
            <SimplyWallStLogo />
            <MonsterUltraLogo />
          </div>
        </div>
        {(stage.id !== 'playing' || !musicOver) && !videoDead && (
          <div
            className={`pip${pipOpen ? ' pip--open' : ''}`}
            onClick={() => setPipOpen((o) => !o)}
            role="button"
            aria-label={pipOpen ? 'Tuck the frag movie away' : 'Slide the frag movie in'}
          >
            <iframe
              ref={iframeRef}
              className="pipvid"
              src={`${VIDEO_SHIM}/?v=${VIDEO_ID}&start=${videoStart}`}
              allow="autoplay; encrypted-media"
              referrerPolicy="strict-origin-when-cross-origin"
              tabIndex={-1}
              title="frag movie"
            />
          </div>
        )}
        <div className="loader">
          <CrestLogo />
          <p className="eyebrow">Counter-Strike 1.6 &middot; in your browser</p>
          <h1 className={`title${!playerMuted ? ' title--dancing' : ''}`}>
            Frag<span> Friday</span>
          </h1>

          {modeInfo && (
            <div className="mode">
              <p className="mode__row">
                <span className="mode__label">Tonight&apos;s mode</span>
                <span className="mode__chip">{modeInfo.mode}</span>
              </p>
              {modeInfo.tagline && <p className="mode__tagline">{modeInfo.tagline}</p>}
              {modeInfo.bullets && modeInfo.bullets.length > 0 && (
                <p className="mode__bullets">{modeInfo.bullets.join('  ·  ')}</p>
              )}
            </div>
          )}

          {(stage.id === 'downloading' || stage.id === 'ready') && (
            <input
              className="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && stage.id === 'ready') play()
              }}
              placeholder="Player name"
              maxLength={31}
              spellCheck={false}
            />
          )}

          {stage.id === 'error' ? (
            <>
              <p className="status status--error">{stageLabel(stage)}</p>
              <button className="play" onClick={() => location.reload()}>
                Retry
              </button>
            </>
          ) : stage.id === 'dropped' ? (
            <>
              <p className="status status--error">{stageLabel(stage)}</p>
              <button className="play" onClick={reconnect}>
                Reconnect
              </button>
            </>
          ) : stage.id === 'ready' ? (
            <>
              <button className="play" onClick={play}>
                Play
              </button>
              <p className="status">{stageLabel(stage)}</p>
            </>
          ) : (
            <>
              <div
                className={`bar${progress === null ? ' bar--indeterminate' : ''}`}
                role="progressbar"
                aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
              >
                {Array.from({ length: SEGMENTS }, (_, i) => (
                  <span key={i} className={i < filled ? 'seg seg--on' : 'seg'} />
                ))}
              </div>
              <p className="status">{stageLabel(stage)}</p>
            </>
          )}

          <p className="hint">Tip: hit F1 on the team screen to jump straight into the action</p>
        </div>
        <div className="ticker" aria-hidden="true">
          <span className="ticker__badge">FF NEWS</span>
          <div className="ticker__viewport">
            {/* two copies so the -50% translate loops seamlessly */}
            <div className="ticker__track">
              <span>{NEWS_TEXT}</span>
              <span>{NEWS_TEXT}</span>
            </div>
          </div>
        </div>
        {stage.id !== 'playing' && !videoDead && (
          <button
            className="sound"
            onClick={toggleSound}
            aria-label={playerMuted ? 'Play music' : 'Mute music'}
          >
            {playerMuted ? '\u{1F507}' : '\u{1F50A}'}
          </button>
        )}
        {stage.id !== 'playing' && <FlashCanvas />}
      </div>
      {/* outside the overlay so it stays clickable in-game */}
      <button
        className="fs"
        onClick={toggleFullscreen}
        aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        {fullscreen ? '⤡' : '⤢'}
      </button>
    </>
  )
}

export default App
