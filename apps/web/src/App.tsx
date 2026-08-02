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
  const [stage, setStage] = useState<Stage>({ id: 'downloading', received: 0, total: null })

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
    try {
      await launchGame(canvasRef.current, zipRef.current, (s) =>
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
        <div className="loader">
          <p className="eyebrow">Counter-Strike 1.6 &middot; in your browser</p>
          <h1 className="title">
            Frag<span> Friday</span>
          </h1>

          {stage.id === 'error' ? (
            <>
              <p className="status status--error">{stageLabel(stage)}</p>
              <button className="play" onClick={() => location.reload()}>
                Retry
              </button>
            </>
          ) : stage.id === 'ready' ? (
            <>
              <button className="play" onClick={play} autoFocus>
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
      </div>
    </>
  )
}

export default App
