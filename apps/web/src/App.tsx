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
            className="bgvid"
            src={`${VIDEO_SHIM}/?v=${VIDEO_ID}&start=${videoStart}`}
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            tabIndex={-1}
            title="background video"
          />
        )}
        <div className="tint" />
        {stage.id !== 'playing' && !videoDead && (
          <div className="pip">
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
      </div>
    </>
  )
}

export default App
