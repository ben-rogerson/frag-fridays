import { FC, Fragment, useEffect, useRef, useState } from 'react'
import { downloadValveZip, launchGame, persistSettings } from './launch'
import { Xash3DWebRTC } from './webrtc'
import '@fontsource/black-ops-one'
import './App.css'

type Stage =
  | { id: 'downloading'; received: number; total: number | null; rate: number | null }
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

const mb = (bytes: number) => Math.round(bytes / 1048576)

// each mod's compose mounts its own /info.json next to the client
type ModeInfo = { mode: string; tagline?: string; bullets?: string[] }

// written every 5s by the statusjson.amxx plugin into the served public/ dir
type ServerStatus = {
  map: string
  maxplayers: number
  humans: number
  bots: number
  mapTimeLeft: number // seconds; 0 = no timelimit
  roundTimeLeft: number // seconds; -1 = no round timer seen yet
  players: { name: string; frags: number; bot: boolean }[]
}

// season standings, aggregated from the box's kill logs by
// scripts/standings.sh after each session. Ships in the build and is
// refreshed in place on the box, so one fetch is enough.
type Standings = {
  generated: string
  season: { name: string; sessions: number; kills: number; deaths: number; kd: number }[]
  weeks: { date: string; mvp: string; kills: number }[]
  // warm-up frags since the last session; kickoff resets the table.
  // Optional so a stale standings.json from before the field existed parses.
  practice?: { name: string; kills: number; deaths: number; kd: number }[]
  practiceSince?: string | null
}

// "2026-08-07" -> "fri 7 aug", the kickoffLabel grammar
const sessionDateLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`)
    .toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(',', '')
    .toLowerCase()

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const pad2 = (n: number) => String(n).padStart(2, '0')

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Rolls a live number up from 0 on first mount - the broadcast scoreboard
// filling in when the strip flips to LIVE. Later feed updates snap.
const CountUp: FC<{ value: number }> = ({ value }) => {
  const [shown, setShown] = useState(REDUCED_MOTION ? value : 0)
  const animatedRef = useRef(false)
  useEffect(() => {
    if (REDUCED_MOTION || animatedRef.current) {
      animatedRef.current = true
      setShown(value)
      return
    }
    animatedRef.current = true
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 700)
      setShown(Math.round(value * (1 - (1 - p) ** 3)))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{shown}</>
}

// One scoreboard counter cell. When its digit changes, the reel remounts
// (key) carrying both glyphs: the old one rolls out of the sunken window and
// the incoming one flashes hot, then decays back to acid - a phosphor tick.
// Reduced-motion kills both animations in CSS; the reel then just shows the
// current glyph.
function ClockDigit({ d }: { d: string }) {
  const prevRef = useRef(d)
  const prev = prevRef.current
  useEffect(() => {
    prevRef.current = d
  })
  const changed = prev !== d
  return (
    <span className="clock__digit">
      <span className="clock__reel" key={changed ? prev + d : d}>
        <span className={`clock__glyph${changed ? ' clock__glyph--in' : ''}`}>{d}</span>
        {changed && <span className="clock__glyph clock__glyph--out">{prev}</span>}
      </span>
    </span>
  )
}

// A row of counter-cell groups joined by blinking scoreboard colons.
// Shared by the pre-kickoff countdown and the live map-time clock.
const ClockRow: FC<{ groups: [number, string][] }> = ({ groups }) => (
  <>
    {groups.map(([value, unit], gi) => (
      <Fragment key={unit}>
        {gi > 0 && (
          <span className="clock__sep" aria-hidden="true">
            :
          </span>
        )}
        <span className="clock__group">
          <span className="clock__cells" aria-hidden="true">
            {pad2(value)
              .split('')
              .map((d, i) => (
                <ClockDigit d={d} key={i} />
              ))}
          </span>
          <span className="clock__unit">{unit}</span>
        </span>
      </Fragment>
    ))}
  </>
)

// --- session clock ------------------------------------------------------
// Sessions kick off Friday 2:30pm Sydney; the strip reads LIVE for the two
// hours after kickoff, then the countdown rolls to next week.
const SESSION_DAY = 5 // Friday
const SESSION_HOUR = 14
const SESSION_MINUTE = 30
const SESSION_LIVE_MS = 2 * 3_600_000

type SessionClock =
  | { id: 'live' }
  | {
      id: 'countdown'
      msLeft: number
      days: number
      hours: number
      mins: number
      secs: number
      isToday: boolean
      kickoffLabel: string // e.g. "fri 7 aug"
    }

// The page's energy tracks the countdown: calm midweek, charged on matchday,
// climbing through the final hour, held breath in the last minute, then the
// on-air flip. Applied as data-tier on the overlay; CSS does the rest.
type Tier = 'idle' | 'matchday' | 'finalhour' | 'final60' | 'live'

const clockTier = (c: SessionClock): Tier => {
  if (c.id === 'live') return 'live'
  if (c.msLeft < 60_000) return 'final60'
  if (c.msLeft < 3_600_000) return 'finalhour'
  if (c.isToday) return 'matchday'
  return 'idle'
}

// QA override: ?t-minus=90 opens the page 90 seconds before kickoff (0 or
// negative lands on the live state) so every escalation tier can be checked
// on any day of the week. Absent in normal use.
const DEBUG_KICKOFF = (() => {
  const v = new URLSearchParams(window.location.search).get('t-minus')
  return v === null ? null : Date.now() + Number(v) * 1000
})()

// QA override: ?mode=dm previews that mode's signal colours on any week.
// Theme only - the card still reads real content from info.json.
const DEBUG_MODE = new URLSearchParams(window.location.search).get('mode')

// A Date whose local fields mimic Sydney wall time. Fine for a countdown:
// it's recomputed from scratch every tick, so DST edges self-correct.
const sydneyNow = () =>
  new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }))

const countdownFrom = (ms: number, isToday: boolean, kickoffLabel: string): SessionClock => ({
  id: 'countdown',
  msLeft: ms,
  days: Math.floor(ms / 86_400_000),
  hours: Math.floor(ms / 3_600_000) % 24,
  mins: Math.floor(ms / 60_000) % 60,
  secs: Math.floor(ms / 1_000) % 60,
  isToday,
  kickoffLabel,
})

function sessionClock(): SessionClock {
  if (DEBUG_KICKOFF !== null) {
    const ms = DEBUG_KICKOFF - Date.now()
    return ms <= 0 ? { id: 'live' } : countdownFrom(ms, true, 'today')
  }
  const now = sydneyNow()
  const kickoff = new Date(now)
  kickoff.setDate(kickoff.getDate() + ((SESSION_DAY - now.getDay() + 7) % 7))
  kickoff.setHours(SESSION_HOUR, SESSION_MINUTE, 0, 0)
  if (kickoff.getTime() <= now.getTime()) {
    if (now.getTime() - kickoff.getTime() < SESSION_LIVE_MS) return { id: 'live' }
    kickoff.setDate(kickoff.getDate() + 7)
  }
  const ms = kickoff.getTime() - now.getTime()
  return countdownFrom(
    ms,
    ms < 86_400_000 && kickoff.getDay() === now.getDay(),
    kickoff
      .toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
      .replace(',', '')
      .toLowerCase(),
  )
}

// --- map imagery --------------------------------------------------------
// Sourced 1.6-era screenshots (160x120, the classic server-browser thumb
// size), bundled at build time and keyed by lowercase map name. Maps with
// no shot on hand (kz_summercliff2) get the flat "no map image" tile.
const MAP_SHOTS = import.meta.glob('./assets/maps/*.jpg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const mapShot = (map: string): string | null =>
  MAP_SHOTS[`./assets/maps/${map.toLowerCase()}.jpg`] ?? null

// thumb in a sunken well; the well inset has to be painted over the img
const MapShot: FC<{ map: string }> = ({ map }) => {
  const shot = mapShot(map)
  return (
    <span className="mapshot">
      {shot ? (
        <img src={shot} alt="" width={160} height={120} loading="lazy" />
      ) : (
        <span className="mapshot__none">no map image</span>
      )}
    </span>
  )
}

// --- mode roster --------------------------------------------------------
// One mod runs at a time; /info.json announces the live one. The roster is
// static because the offering changes rarely - blurbs and rules are taken
// from each mod's real info.json copy (server/<mod>/info.json), map pools
// from its mapcycle.txt (vanilla's lives in server/vanilla/mapcycle.txt).
type ModeEmblem = FC
type ModeEntry = {
  key: string
  match: RegExp // matches the live info.json mode string
  name: string
  blurb: string
  rules: string[]
  emblem: ModeEmblem
  pool?: string[]
  bots?: boolean // the mod fills empty slots with bots
}

// emblems: one 2.5px-stroke linework family, coloured via currentColor
const GunGameEmblem: ModeEmblem = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M3 35h8v-8h8v-8h8v-8h8" />
    <path d="M29 5h7v7" />
  </svg>
)

const DeathmatchEmblem: ModeEmblem = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    <circle cx="20" cy="20" r="11" />
    <path d="M20 3v7M20 30v7M3 20h7M30 20h7" />
    <circle cx="20" cy="20" r="1.6" fill="currentColor" stroke="none" />
  </svg>
)

const ClassicEmblem: ModeEmblem = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M20 3l14 5v10c0 9-6 15-14 19-8-4-14-10-14-19V8z" />
    <path d="M9 24l22-10" />
  </svg>
)

const KzEmblem: ModeEmblem = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M2 35l12-17 7 10 8-12 9 19" />
    <path d="M29 14V4M29 4h7v5h-7" />
  </svg>
)

const MODES: ModeEntry[] = [
  {
    key: 'gungame',
    match: /gun\s*game/i,
    name: 'GunGame',
    blurb: 'every kill levels you up - 23 weapons to the top',
    rules: ['knife kills steal a level', 'instant respawn', '7 bots roaming', '20 minute maps'],
    emblem: GunGameEmblem,
    bots: true,
    pool: [
      'aim_map',
      'de_dust2',
      'cs_assault',
      'de_dust',
      'cs_italy',
      'de_inferno',
      'cs_office',
      'de_aztec',
      'de_cbble',
      'fy_iceworld',
      'fy_pool_day',
      'scoutzknivez',
      '35hp_2',
      'de_rats',
      'de_train',
      'awp_india',
      'cs_deagle5',
    ],
  },
  {
    key: 'dm',
    match: /death\s*match/i,
    name: 'Deathmatch',
    blurb: 'free-for-all frags, instant respawn',
    rules: ['pick your guns with !guns', 'instant respawn', '7 bots roaming', '15 minute maps'],
    emblem: DeathmatchEmblem,
    bots: true,
    pool: [
      'fy_pool_day',
      'de_dust2',
      'de_dust',
      'cs_assault',
      'de_prodigy',
      'de_nuke',
      'de_cbble',
      'cs_office',
      'fy_iceworld',
      'aim_map',
      'scoutzknivez',
      '35hp_2',
      'de_rats',
      'de_train',
      'awp_india',
      'cs_deagle5',
    ],
  },
  {
    key: 'classic',
    match: /classic|vanilla/i,
    name: 'Classic',
    blurb: 'stock 1.6 - buy your kit, win the round',
    rules: ['classic round rules', '13 map rotation', '30 minute maps'],
    emblem: ClassicEmblem,
    pool: [
      'de_dust2',
      'de_dust',
      'cs_italy',
      'cs_assault',
      'cs_office',
      'de_inferno',
      'de_aztec',
      'de_cbble',
      'de_nuke',
      'de_prodigy',
      'de_train',
      'awp_india',
      'cs_deagle5',
    ],
  },
  {
    key: 'kz',
    match: /kz|climb/i,
    name: 'KZ / Climb',
    blurb: 'checkpoint climbs against the clock',
    rules: [
      '/cp saves a checkpoint, /tp returns to it',
      'press the start button, race to the stop button',
      'deaths cost nothing - you respawn on your checkpoint',
      'no bots, no guns, no excuses',
    ],
    emblem: KzEmblem,
    pool: ['kz_giantbean_b15', 'kz_summercliff2', 'kz_cellblock'],
  },
]

// the Vultr box (update if the VPS is ever resized)
const SERVER_SPECS: [string, string][] = [
  ['vCPUs', '1 vCPU'],
  ['RAM', '2048.00 MB'],
  ['Storage', '25 GB NVMe'],
  ['Location', 'Sydney, AU'],
]

// crest above the heading (supplied artwork, recoloured via currentColor)
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

// icons drawn inline, one 2px stroke family
const SpeakerIcon: FC<{ muted: boolean }> = ({ muted }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none">
    <path
      d="M4 9v6h4l5 4V5L8 9H4z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    {muted ? (
      <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    ) : (
      <path
        d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    )}
  </svg>
)

const FullscreenIcon: FC<{ active: boolean }> = ({ active }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none">
    {active ? (
      <path
        d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : (
      <path
        d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )}
  </svg>
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
    // the period download-dialog readout: real transfer rate and a flat
    // time estimate, straight off the byte stream
    case 'downloading': {
      const rate = stage.rate === null ? '' : ` - ${(stage.rate / 1048576).toFixed(1)} MB/s`
      if (!stage.total) return `valve.zip - ${mb(stage.received)} MB${rate}`
      const secsLeft =
        stage.rate !== null && stage.rate > 0
          ? Math.max(1, Math.round((stage.total - stage.received) / stage.rate))
          : null
      const est =
        secsLeft === null
          ? ''
          : secsLeft > 90
            ? ` - est. ${Math.round(secsLeft / 60)} min left`
            : // 5s steps past 10s so the estimate reads steady, not twitchy
              ` - est. ${secsLeft > 10 ? Math.round(secsLeft / 5) * 5 : secsLeft} sec left`
      return `valve.zip - ${mb(stage.received)} / ${mb(stage.total)} MB${rate}${est}`
    }
    case 'ready':
      return 'download complete - no install, no Steam.'
    case 'engine':
      return 'starting engine, connecting to server…'
    case 'unpacking':
      return `unpacking files - ${stage.done} / ${stage.total}`
    case 'playing':
      return ''
    case 'dropped':
      return stage.kind === 'transport'
        ? 'connection to the server was lost'
        : 'you were dropped from the server'
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
  const [stage, setStage] = useState<Stage>({
    id: 'downloading',
    received: 0,
    total: null,
    rate: null,
  })
  const [videoStart] = useState(() => Math.floor(Math.random() * VIDEO_MAX_START))
  const [videoDead, setVideoDead] = useState(false)
  // Sound starts muted and only unmutes via the sound toggle (which is a
  // user gesture, so the browser allows it). The icon reflects the PLAYER's
  // actual muted state (reported via infoDelivery), not our wish - otherwise
  // it shows sound-on while the browser still has it muted, and the first
  // toggle press mutes instead of unmuting.
  const [playerMuted, setPlayerMuted] = useState(true)
  const playerMutedRef = useRef(true)
  const fadeRef = useRef<number | null>(null)
  const [name, setName] = useState(() => localStorage.getItem('ff-name') ?? '')
  const [musicOver, setMusicOver] = useState(false)
  const [modeInfo, setModeInfo] = useState<ModeInfo | null>(null)
  // which roster row is unfolded in "more game modes"; one at a time so the
  // card stays a card, not a scroll
  const [openMode, setOpenMode] = useState<string | null>(null)
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null)
  const [standings, setStandings] = useState<Standings | null>(null)
  // measured round-trip of the last successful status poll; pollTick remounts
  // the masthead livedot so it blips once per real answer from the box
  const [ping, setPing] = useState<number | null>(null)
  const [pollTick, setPollTick] = useState(0)
  const [clock, setClock] = useState<SessionClock>(sessionClock)
  // true only when the countdown hit zero on-screen - gates the one-shot
  // on-air sting (radar burst, LIVE NOW flicker); a page merely loaded
  // mid-session gets the calm live state
  const [wentLive, setWentLive] = useState(false)
  const prevClockIdRef = useRef(clock.id)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const t = window.setInterval(() => setClock(sessionClock()), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (prevClockIdRef.current === 'countdown' && clock.id === 'live') setWentLive(true)
    prevClockIdRef.current = clock.id
  }, [clock.id])

  // While LIVE the scoreboard cells count the map's remaining time instead:
  // resynced to the feed on every poll, ticked down locally between polls.
  // null = the mod runs no map timelimit, and the cells sit out.
  const [mapClock, setMapClock] = useState<number | null>(null)
  useEffect(() => {
    setMapClock(serverStatus && serverStatus.mapTimeLeft > 0 ? serverStatus.mapTimeLeft : null)
  }, [serverStatus])
  useEffect(() => {
    if (clock.id !== 'live') return
    const t = window.setInterval(
      () => setMapClock((m) => (m === null ? null : Math.max(0, m - 1))),
      1000,
    )
    return () => window.clearInterval(t)
  }, [clock.id])

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

  // live server snapshot while waiting - stops once in-game. info.json rides
  // the same poll so a mod swap updates the match panel on an already-open
  // page. Parse failures (mid-write reads, plugin absent) just skip the tick.
  const playing = stage.id === 'playing'
  useEffect(() => {
    if (playing) return
    let cancelled = false
    const poll = () => {
      const t0 = performance.now()
      fetch('/status.json', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((s: ServerStatus | null) => {
          if (!cancelled && s?.map) {
            setServerStatus(s)
            setPing(Math.round(performance.now() - t0))
            setPollTick((n) => n + 1)
          }
        })
        .catch(() => {})
      fetch('/info.json', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((info: ModeInfo | null) => {
          if (!cancelled && info?.mode) setModeInfo(info)
        })
        .catch(() => {})
    }
    poll()
    const t = window.setInterval(poll, 5000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [playing])

  // the standings file is weekly data - one fetch, no poll. Absent file
  // (fresh box, script never run) just leaves the panel unrendered.
  useEffect(() => {
    fetch('/assets/standings.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Standings | null) => {
        if (s?.season) setStandings(s)
      })
      .catch(() => {})
  }, [])

  // tab title carries tonight's mode, e.g. "Classic Mode | Frag Fridays";
  // plain "Frag Fridays" (from index.html) until info.json answers
  useEffect(() => {
    if (!modeInfo) return
    const name = MODES.find((m) => m.match.test(modeInfo.mode))?.name ?? modeInfo.mode
    document.title = `${name} Mode | Frag Fridays`
  }, [modeInfo])

  // YouTube refuses embeds from some origins (error 150/153 - e.g. IP-literal
  // http origins since late 2025). Detect via the widget API and drop the
  // iframe so players get the offline notice instead of YouTube's error box.
  // The widget only reports errors after a 'listening' handshake.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return
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
    return () => {
      window.removeEventListener('message', onMsg)
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
      startSound()
    } else {
      stopFade()
      ytCommand('mute')
    }
  }

  useEffect(() => {
    let cancelled = false
    // transfer rate over a sliding ~3s window of progress samples; needs
    // ~0.8s of history before it reads as a rate rather than a spike
    const samples: { t: number; received: number }[] = []
    downloadValveZip((p) => {
      if (cancelled) return
      const now = performance.now()
      samples.push({ t: now, received: p.received })
      while (samples.length > 1 && now - samples[0].t > 3000) samples.shift()
      const span = now - samples[0].t
      const rate = span > 800 ? ((p.received - samples[0].received) / span) * 1000 : null
      setStage({ id: 'downloading', ...p, rate })
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
      // snapshot in-game settings every 30s, plus when the tab hides or the
      // page unloads, so they survive reloads. play() runs once, so these
      // never stack.
      const persist = () => {
        if (xashRef.current) persistSettings(xashRef.current)
      }
      window.setInterval(persist, 30_000)
      window.addEventListener('pagehide', persist)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') persist()
      })
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
  // humans only - a bot topping the board isn't news, and bots never rank;
  // fragless leaders stay hidden (no "top frag: X (0)")
  const humans = serverStatus?.players.filter((p) => !p.bot) ?? []
  const best =
    humans.length > 0 ? humans.reduce((a, b) => (b.frags > a.frags ? b : a)) : null
  const topFrag = best && best.frags > 0 ? best : null
  // which roster entry is live; unmatched modes (a future mod) still render
  // from info.json with the fallback emblem
  const liveMode = modeInfo ? (MODES.find((m) => m.match.test(modeInfo.mode)) ?? null) : null
  const HeroEmblem = liveMode?.emblem ?? ClassicEmblem
  const tier = clockTier(clock)
  // each mode broadcasts in its own signal colour; classic acid until the
  // live mode is known (or an unmatched future mod runs)
  const themeMode = DEBUG_MODE ?? liveMode?.key ?? 'classic'

  return (
    <>
      <canvas id="canvas" ref={canvasRef} />
      <div
        className={`overlay${playing ? ' overlay--hidden' : ''}`}
        data-tier={tier}
        data-mode={themeMode}
      >
        <div className={`radar${wentLive ? ' radar--burst' : ''}`} aria-hidden="true" />
        <div className="streaks" aria-hidden="true" />
        <div className="page">
          <header className="masthead">
            <CrestLogo />
            <div className="masthead__id">
              <h1 className="masthead__logo">
                FRAG<span>FRIDAYS</span>
              </h1>
              <p className="masthead__tag">
                counter-strike 1.6 &middot; every friday 2:30 pm &middot; sydney server
              </p>
            </div>
            {/* only claimed once a status poll has actually answered - the
                page never says "online" about a box it hasn't heard from */}
            {serverStatus && (
              <p className="masthead__online">
                <span className="livedot livedot--blip" key={pollTick} aria-hidden="true" />
                server online
              </p>
            )}
          </header>

          <section
            id="session"
            className={`event${clock.id === 'live' ? ' event--live' : ''}${
              tier === 'final60' ? ' event--imminent' : ''
            }${wentLive ? ' event--onair' : ''}`}
            aria-label="next session"
          >
            {clock.id === 'live' ? (
              <>
                <p className="event__label">
                  <span className="event__livetitle">
                    <span className="livedot" aria-hidden="true" />
                    live now
                  </span>
                  {serverStatus ? (
                    <span className="event__meta">
                      <span className="event__map">{serverStatus.map}</span> &middot;{' '}
                      <CountUp value={serverStatus.humans} />{' '}
                      {serverStatus.humans === 1 ? 'player' : 'players'} in &middot;{' '}
                      <CountUp value={serverStatus.bots} /> bots
                    </span>
                  ) : (
                    <span className="event__when">session in progress</span>
                  )}
                </p>
                {mapClock !== null && (
                  <p
                    className="event__clock"
                    role="timer"
                    aria-label={`map time remaining ${mmss(mapClock)}`}
                  >
                    <span className="event__clocklabel" aria-hidden="true">
                      map
                      <br />
                      time
                    </span>
                    <ClockRow
                      groups={[
                        [Math.min(99, Math.floor(mapClock / 60)), 'min'],
                        [mapClock % 60, 'sec'],
                      ]}
                    />
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="event__label">
                  <span className="event__title">
                    {clock.isToday ? 'matchday' : 'next session'}
                  </span>
                  <span className="event__when">
                    {clock.isToday ? 'today' : clock.kickoffLabel} &middot; 2:30 pm sydney
                  </span>
                  {/* the box runs all week - joining before kickoff is warm-up,
                      not the event. only claimed once a poll has answered. */}
                  {serverStatus && (
                    <span className="event__practice">
                      <span className="livedot" aria-hidden="true" />
                      practice open now - warm up before kickoff
                    </span>
                  )}
                </p>
                <p
                  className="event__clock"
                  role="timer"
                  aria-label={`time until next session: ${clock.days} days ${clock.hours} hours ${clock.mins} minutes`}
                >
                  <ClockRow
                    groups={(
                      [
                        [clock.days, 'days'],
                        [clock.hours, 'hrs'],
                        [clock.mins, 'min'],
                        [clock.secs, 'sec'],
                      ] as [number, string][]
                      // the days group drops off on matchday for a tighter clock
                    ).filter(([value, unit]) => !(unit === 'days' && value === 0))}
                  />
                </p>
              </>
            )}
          </section>

          <main className="front">
            <section id="card" className="panel front__card" aria-label="Current Mode">
              <h2 className="panel__bar">
                Current Mode
                {clock.id === 'countdown' && (
                  <span className="panel__barnote">{clock.kickoffLabel}</span>
                )}
              </h2>
              <div className="panel__body">
                {modeInfo ? (
                  <div className="card__mode">
                    <div className="card__hero">
                      <span className="card__emblem" aria-hidden="true">
                        <HeroEmblem />
                      </span>
                      <div className="card__herotext">
                        <p className="card__name">
                          {liveMode?.name ?? modeInfo.mode}
                          {liveMode?.bots && <span className="botbadge">bots</span>}
                        </p>
                        {modeInfo.tagline && (
                          <p className="card__tagline">{modeInfo.tagline}</p>
                        )}
                      </div>
                    </div>
                    {modeInfo.bullets && modeInfo.bullets.length > 0 && (
                      <div className="card__rules">
                        <p className="card__ruleslabel">rules</p>
                        <ul className="card__rulelist">
                          {modeInfo.bullets.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="card__pending">reading the card from the server…</p>
                )}
              </div>
              {liveMode?.pool && (
                <>
                  <h3 className="card__subbar">
                    the map pool
                    <span className="card__subnote">
                      tonight&apos;s cycle - {liveMode.pool.length} maps
                    </span>
                  </h3>
                  <ul className="pool">
                    {liveMode.pool.map((m) => {
                      const isOn = serverStatus?.map.toLowerCase() === m
                      return (
                        <li className={`pool__tile${isOn ? ' pool__tile--live' : ''}`} key={m}>
                          <MapShot map={m} />
                          <span className="pool__name">
                            {isOn && <span className="livedot" aria-hidden="true" />}
                            {m}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
              <h3 className="card__subbar">
                more game modes
                <span className="card__subnote">one mod runs at a time - swaps between weeks</span>
              </h3>
              {/* the live mode already headlines the card, so its row sits out.
                  Each row unfolds into that mode's setup sheet - rules and map
                  pool in the same grammar as tonight's card above. */}
              <ul className="rotation">
                {MODES.filter((m) => m.key !== liveMode?.key).map((m) => {
                  const Emblem = m.emblem
                  const open = openMode === m.key
                  return (
                    <li
                      className={`rotation__item${open ? ' rotation__item--open' : ''}`}
                      data-mode={m.key}
                      key={m.key}
                    >
                      <button
                        type="button"
                        className="rotation__row"
                        aria-expanded={open}
                        aria-controls={`mode-preview-${m.key}`}
                        onClick={() => setOpenMode(open ? null : m.key)}
                      >
                        <span className="rotation__emblem" aria-hidden="true">
                          <Emblem />
                        </span>
                        <span className="rotation__name">
                          {m.name}
                          {m.bots && <span className="botbadge">bots</span>}
                        </span>
                        <span className="rotation__blurb">{m.blurb}</span>
                        <span className="rotation__caret" aria-hidden="true">
                          <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M15 11l10 9-10 9" />
                          </svg>
                        </span>
                      </button>
                      <div
                        className={`rotation__panel${open ? ' rotation__panel--open' : ''}`}
                        id={`mode-preview-${m.key}`}
                        aria-hidden={!open}
                      >
                        <div className="rotation__clip">
                          <div className="rotation__preview">
                            <p className="card__ruleslabel">rules</p>
                            <ul className="card__rulelist">
                              {m.rules.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                            {m.pool && (
                              <>
                                <p className="card__ruleslabel rotation__poollabel">
                                  the map pool - {m.pool.length} maps
                                </p>
                                <ul className="pool pool--preview">
                                  {m.pool.map((map) => (
                                    <li className="pool__tile" key={map}>
                                      <MapShot map={map} />
                                      <span className="pool__name">{map}</span>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section id="servers" className="panel front__servers" aria-label="server browser">
              <h2 className="panel__bar">
                server browser
                {clock.id === 'countdown' && serverStatus && (
                  <span className="panel__barnote">open for practice</span>
                )}
              </h2>
              <div className="panel__body panel__body--flush">
                {(stage.id === 'downloading' || stage.id === 'ready') && (
                  <div className="browser__toolbar">
                    <label className="browser__aliaslabel" htmlFor="alias">
                      your alias:
                    </label>
                    <input
                      id="alias"
                      className="alias"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && stage.id === 'ready') play()
                      }}
                      placeholder="Player"
                      maxLength={31}
                      spellCheck={false}
                    />
                  </div>
                )}
                <table className="servers">
                  <thead>
                    <tr>
                      <th>server</th>
                      <th>map</th>
                      <th>players</th>
                      <th>round</th>
                      <th>map time</th>
                      <th>ping</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serverStatus ? (
                      <tr
                        className="servers__row"
                        onDoubleClick={() => {
                          if (stage.id === 'ready') play()
                        }}
                      >
                        <td className="servers__name">
                          <span className="livedot" aria-hidden="true" />
                          Frag Fridays #1 - Sydney &middot;{' '}
                          {clock.id === 'live' ? 'LIVE' : 'PRACTICE'}
                        </td>
                        <td className="servers__map">{serverStatus.map}</td>
                        <td>
                          {serverStatus.humans}+{serverStatus.bots} bots / {serverStatus.maxplayers}
                        </td>
                        <td>
                          {serverStatus.roundTimeLeft >= 0 ? mmss(serverStatus.roundTimeLeft) : '-'}
                        </td>
                        <td>
                          {serverStatus.mapTimeLeft > 0 ? mmss(serverStatus.mapTimeLeft) : '-'}
                        </td>
                        <td>{ping !== null ? `${ping} ms` : '-'}</td>
                      </tr>
                    ) : (
                      <tr>
                        <td className="servers__scanning" colSpan={6}>
                          scanning for servers…
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                <div className="browser__lower">
                  <div className="browser__action">
                    {stage.id === 'error' ? (
                      <>
                        <p className="status status--error">{stageLabel(stage)}</p>
                        <button className="join" onClick={() => location.reload()}>
                          retry download
                        </button>
                      </>
                    ) : stage.id === 'dropped' ? (
                      <>
                        <p className="status status--error">{stageLabel(stage)}</p>
                        <button className="join" onClick={reconnect}>
                          reconnect
                        </button>
                      </>
                    ) : stage.id === 'ready' ? (
                      <>
                        {/* ignites once, when the download lands; retry and
                            reconnect above stay flat - recovery isn't a show */}
                        <button className="join join--ignite" onClick={play}>
                          » {clock.id === 'live' ? 'join live' : 'warm up'} «
                        </button>
                        <p className="status">{stageLabel(stage)}</p>
                      </>
                    ) : (
                      <>
                        <div
                          className={`bar${progress === null ? ' bar--indeterminate' : ''}`}
                          role="progressbar"
                          aria-label="downloading valve.zip"
                          aria-valuenow={
                            progress === null ? undefined : Math.round(progress * 100)
                          }
                        >
                          {Array.from({ length: SEGMENTS }, (_, i) => (
                            <span key={i} className={i < filled ? 'seg seg--on' : 'seg'} />
                          ))}
                        </div>
                        <p className="status">{stageLabel(stage)}</p>
                      </>
                    )}
                  </div>

                </div>

                {topFrag && (
                  <p className="servers__foot">
                    {clock.id === 'live' ? 'top frag right now' : 'top frag in warm-up'}:{' '}
                    <strong>{topFrag.name}</strong> ({topFrag.frags})
                  </p>
                )}
              </div>
            </section>

            {/* the league table only exists once standings.json has answered -
                the page never invents results */}
            {standings && (
              <section
                id="standings"
                className="panel front__standings"
                aria-label="season standings"
              >
                <h2 className="panel__bar">
                  season standings
                  <span className="panel__barnote">humans only - bots never rank</span>
                </h2>
                <div className="panel__body panel__body--flush">
                  {standings.season.length > 0 ? (
                    <>
                      <table className="standings standings--season">
                        <thead>
                          <tr>
                            <th className="standings__num">#</th>
                            <th>player</th>
                            <th className="standings__num">sessions</th>
                            <th className="standings__num">kills</th>
                            <th className="standings__num">deaths</th>
                            <th className="standings__num">k/d</th>
                            <th className="standings__num">mvps</th>
                          </tr>
                        </thead>
                        <tbody>
                          {standings.season.map((p, i) => {
                            const mvps = standings.weeks.filter((w) => w.mvp === p.name).length
                            return (
                              <tr key={p.name}>
                                <td className="standings__num standings__rank">{i + 1}</td>
                                <td className="standings__player">{p.name}</td>
                                <td className="standings__num">{p.sessions}</td>
                                <td className="standings__num">{p.kills}</td>
                                <td className="standings__num">{p.deaths}</td>
                                <td className="standings__num">{p.kd.toFixed(2)}</td>
                                <td className="standings__num">{mvps > 0 ? mvps : '-'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      {standings.weeks.length > 0 && (
                        <p className="standings__foot">
                          {standings.weeks.length}{' '}
                          {standings.weeks.length === 1 ? 'session' : 'sessions'} played &middot;
                          last mvp:{' '}
                          <strong>{standings.weeks[standings.weeks.length - 1].mvp}</strong> (
                          {standings.weeks[standings.weeks.length - 1].kills} kills,{' '}
                          {sessionDateLabel(standings.weeks[standings.weeks.length - 1].date)})
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="standings__none">
                      no ranked results yet - the table publishes after the first friday session
                    </p>
                  )}
                  {/* warm-up frags since the last session. Practice period
                      only - the section sits out while the strip reads LIVE,
                      and kickoff resets the table */}
                  {clock.id !== 'live' &&
                    standings.practice &&
                    standings.practice.length > 0 && (
                      <>
                        <h3 className="card__subbar">
                          practice standings
                          <span className="card__subnote">
                            warm-up frags
                            {standings.practiceSince
                              ? ` since ${sessionDateLabel(standings.practiceSince)}`
                              : ''}{' '}
                            - reset at kickoff
                          </span>
                        </h3>
                        <table className="standings">
                          <thead>
                            <tr>
                              <th className="standings__num">#</th>
                              <th>player</th>
                              <th className="standings__num">kills</th>
                              <th className="standings__num">deaths</th>
                              <th className="standings__num">k/d</th>
                            </tr>
                          </thead>
                          <tbody>
                            {standings.practice.map((p, i) => (
                              <tr key={p.name}>
                                <td className="standings__num standings__rank">{i + 1}</td>
                                <td className="standings__player">{p.name}</td>
                                <td className="standings__num">{p.kills}</td>
                                <td className="standings__num">{p.deaths}</td>
                                <td className="standings__num">{p.kd.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                </div>
              </section>
            )}

            <aside className="front__aside">
              <section id="demos" className="panel" aria-label="now streaming">
                <h2 className="panel__bar panel__bar--player">
                  <span className="panel__file">annihilation_2.wmv</span>
                  {!videoDead && (
                    <button
                      className="sound"
                      onClick={toggleSound}
                      aria-label={playerMuted ? 'Play music' : 'Mute music'}
                    >
                      <SpeakerIcon muted={playerMuted} />
                      {playerMuted ? 'sound off' : 'sound on'}
                    </button>
                  )}
                </h2>
                {!videoDead && (stage.id !== 'playing' || !musicOver) ? (
                  <div className="player">
                    <iframe
                      ref={iframeRef}
                      className="player__vid"
                      src={`${VIDEO_SHIM}/?v=${VIDEO_ID}&start=${videoStart}`}
                      allow="autoplay; encrypted-media"
                      referrerPolicy="strict-origin-when-cross-origin"
                      tabIndex={-1}
                      title="frag movie"
                    />
                  </div>
                ) : (
                  <div className="player player--dead">
                    <p>stream offline.</p>
                  </div>
                )}
              </section>

              <section className="panel" aria-label="server hardware">
                <h2 className="panel__bar">server hardware</h2>
                <div className="panel__body">
                  <dl className="specs">
                    {SERVER_SPECS.map(([k, v]) => (
                      <div className="specs__row" key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </section>

            </aside>
          </main>

          <footer className="footer">
            <p>© 2026 frag fridays &middot; best viewed at 1024×768</p>
            <p className="footer__counter" aria-hidden="true">
              you are visitor{' '}
              {['0', '0', '1', '3', '3', '7'].map((d, i) => (
                <span className="footer__digit" key={i}>
                  {d}
                </span>
              ))}
            </p>
          </footer>
        </div>
      </div>
      {/* outside the overlay so it stays clickable in-game */}
      <button
        className="fs"
        onClick={toggleFullscreen}
        aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        <FullscreenIcon active={fullscreen} />
      </button>
    </>
  )
}

export default App
