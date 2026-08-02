import { FC, useEffect, useRef, useState } from 'react'
import { downloadValveZip, launchGame } from './launch'
import './App.css'

type Stage =
  | { id: 'downloading'; received: number; total: number | null }
  | { id: 'ready' }
  | { id: 'engine' }
  | { id: 'unpacking'; done: number; total: number }
  | { id: 'playing' }
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

const mb = (bytes: number) => Math.round(bytes / 1048576)

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
    case 'error':
      return stage.message
  }
}

const App: FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const zipRef = useRef<Uint8Array | null>(null)
  const startedRef = useRef(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [stage, setStage] = useState<Stage>({ id: 'downloading', received: 0, total: null })
  const [videoStart] = useState(() => Math.floor(Math.random() * VIDEO_MAX_START))
  const [videoDead, setVideoDead] = useState(false)
  const [soundOn, setSoundOn] = useState(false)
  const [name, setName] = useState(() => localStorage.getItem('ff-name') ?? '')

  // YouTube refuses embeds from some origins (error 150/153 - e.g. IP-literal
  // http origins since late 2025). Detect via the widget API and drop the
  // iframe so players get the plain gradient instead of YouTube's error box.
  // The widget only reports errors after a 'listening' handshake.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return
      try {
        const d = JSON.parse(e.data)
        if (d.event === 'onError' || d.info?.playerErrorCode) setVideoDead(true)
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
    return () => {
      window.removeEventListener('message', onMsg)
      clearInterval(handshake)
    }
  }, [])

  const ytCommand = (func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      '*',
    )
  }

  const toggleSound = () => {
    if (soundOn) {
      ytCommand('mute')
    } else {
      // unmuting needs a user gesture, which this click is
      ytCommand('unMute')
      ytCommand('setVolume', [65])
    }
    setSoundOn(!soundOn)
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
    // quotes/semicolons would escape the `name "..."` console command
    const playerName = name.replace(/["';\\]/g, '').trim().slice(0, 31)
    localStorage.setItem('ff-name', playerName)
    try {
      await launchGame(canvasRef.current, zipRef.current, playerName, (s) =>
        setStage(s.phase === 'engine' ? { id: 'engine' } : { id: 'unpacking', done: s.done, total: s.total }),
      )
      zipRef.current = null
      setStage({ id: 'playing' })
    } catch (err) {
      setStage({ id: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const progress = stageProgress(stage)
  const filled = progress === null ? 0 : Math.round(progress * SEGMENTS)

  return (
    <>
      <canvas id="canvas" ref={canvasRef} />
      <div className={`overlay${stage.id === 'playing' ? ' overlay--hidden' : ''}`}>
        {stage.id !== 'playing' && !videoDead && (
          <iframe
            ref={iframeRef}
            className="bgvid"
            src={`${VIDEO_SHIM}/?v=${VIDEO_ID}&start=${videoStart}`}
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            tabIndex={-1}
            title="background video"
          />
        )}
        <div className="tint" />
        <div className="loader">
          <p className="eyebrow">Counter-Strike 1.6 &middot; in your browser</p>
          <h1 className="title">
            Frag<span> Friday</span>
          </h1>

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
        {stage.id !== 'playing' && !videoDead && (
          <button
            className="sound"
            onClick={toggleSound}
            aria-label={soundOn ? 'Mute music' : 'Play music'}
          >
            {soundOn ? '\u{1F50A}' : '\u{1F507}'}
          </button>
        )}
      </div>
    </>
  )
}

export default App
