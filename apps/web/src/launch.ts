import JSZip from "jszip";
import filesystemURL from "xash3d-fwgs/filesystem_stdio.wasm?url";
import xashURL from "xash3d-fwgs/xash.wasm?url";
import gles3URL from "xash3d-fwgs/libref_gles3compat.wasm?url";
import menuURL from "cs16-client/cl_dll/menu_emscripten_wasm32.wasm?url";
import clientURL from "cs16-client/cl_dll/client_emscripten_wasm32.wasm?url";
import serverURL from "cs16-client/dlls/cs_emscripten_wasm32.wasm?url";
import extrasURL from "cs16-client/extras.pk3?url";
import { DropKind, Xash3DWebRTC } from "./webrtc";

export type DownloadProgress = { received: number; total: number | null };

const ZIP_URL = "/valve.zip";
const ZIP_CACHE = "ff-valve-v1";

async function readBody(
  res: Response,
  onProgress: (p: DownloadProgress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const total = Number(res.headers.get("content-length")) || null;
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress({ received, total });
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function downloadValveZip(
  onProgress: (p: DownloadProgress) => void,
): Promise<Uint8Array> {
  // The zip is far bigger than Chrome's per-entry HTTP cache cap (~1/8 of the
  // disk cache), so the regular browser cache never stores it and every visit
  // re-downloads ~330MB. Instead we keep it in Cache Storage (https origin
  // only) and revalidate by Last-Modified each boot: unchanged zip -> 304 and
  // a local read; changed zip (new maps) -> fresh bytes, cache updated. A
  // stale zip missing a map would make the engine request it from the game
  // server mid-connect, so never skip the revalidation.
  const cache =
    "caches" in globalThis
      ? await caches.open(ZIP_CACHE).catch(() => null)
      : null;
  const cached = (cache && (await cache.match(ZIP_URL))) || null;
  const lastModified = cached?.headers.get("last-modified");

  const res = await fetch(ZIP_URL, {
    cache: "no-store",
    headers: lastModified ? { "If-Modified-Since": lastModified } : {},
  });
  if (res.status === 304 && cached) {
    return readBody(cached, onProgress);
  }
  if (!res.ok || !res.body) {
    throw new Error(`valve.zip download failed (HTTP ${res.status})`);
  }
  const out = await readBody(res, onProgress);
  const freshModified = res.headers.get("last-modified");
  if (cache && freshModified) {
    // best-effort: a quota refusal just means a re-download next visit
    await cache
      .put(
        ZIP_URL,
        new Response(out, {
          headers: {
            "content-type": "application/zip",
            "content-length": String(out.length),
            "last-modified": freshModified,
          },
        }),
      )
      .catch(() => {});
  }
  return out;
}

// Mic capture kill-switch. The engine wasm prompts for the microphone at
// boot: OpenAL's capture-device init and SDL's audio-capture probe both call
// navigator.mediaDevices.getUserMedia({audio:true}). Voice is disabled
// server-side and mic-off is deliberate - players were broadcasting without
// realising (same rationale as webrtc.ts). With getUserMedia undefined,
// SDL's capability probe reports no capture support and OpenAL's .catch
// takes its handled alcErr path, so no prompt ever appears. Audio OUTPUT
// (AudioContext playback, the hidden media elements for remote WebRTC
// tracks in webrtc.ts) is untouched - only capture entry points are shadowed.
function disableMicCapture() {
  const nav = navigator as Navigator & Record<string, unknown>;
  try {
    if (nav.mediaDevices) {
      // shadow the prototype method with an own undefined property
      Object.defineProperty(nav.mediaDevices, "getUserMedia", {
        value: undefined,
        configurable: true,
      });
    }
  } catch {
    /* defineProperty refused - legacy shims below still starve SDL's probe */
  }
  for (const key of ["getUserMedia", "webkitGetUserMedia", "mozGetUserMedia"]) {
    try {
      if (key in nav) {
        Object.defineProperty(nav, key, { value: undefined, configurable: true });
      }
    } catch {
      /* ignore - property absent or locked down */
    }
  }
}

// The engine's fatal path is a native `alert()`: Sys_Error hands its message
// box to `alert(title + "\n\n" + body)` in the wasm glue, so a crash freezes
// the tab behind a modal that dismisses into a dead canvas - "no dead tabs",
// broken by the one dialog we don't own. Crashes just after a server drop are
// a known hazard in this build (the engine's own message-box path is fragile -
// see backlog item 2), and the drop overlay is useless while a modal blocks
// the page. Shadow alert, hand the text to the app, let it offer a reload.
// Set before the engine boots: init() can die too.
let engineDead = false;
// set once main() is running, so the error listener below cannot mistake a
// React or download failure for an engine fault
let engineRunning = false;
// The lobby only ever shows the crash's last line, trimmed to fit a status
// strip, and a crash is the one moment where the rest of the text is the
// whole diagnosis: the engine's Mem_Free carries its own `__FILE__:__LINE__`
// ("free at ../engine/common/cmd.c:604"), which is what tells us WHICH free
// site died. Dump everything we have to the console the instant we show the
// crash card, and park a copy on `window.__ffCrash` so it can be pulled out
// of a session that has already scrolled its console.
function reportFatal(source: string, text: string, stack: string) {
  const detail = {
    source,
    text,
    stack: stack || new Error("engine fatal").stack || "",
    // where the player was when it died - a crash while connecting is a
    // different bug from a crash mid-game
    engineRunning,
    url: location.href,
    userAgent: navigator.userAgent,
    at: new Date().toISOString(),
  };
  (window as unknown as { __ffCrash?: unknown }).__ffCrash = detail;
  // one group, so the whole thing copies out of devtools in one go
  console.group("[engine fatal]");
  console.error(text);
  for (const [k, v] of Object.entries(detail)) {
    if (k !== "text") console.error(`${k}:`, v);
  }
  console.groupEnd();
}

function captureEngineFatals(onFatal: (message: string) => void) {
  const fatal = (detail: string) => {
    engineDead = true;
    onFatal(detail.slice(0, 120) || "the engine stopped");
  };

  window.alert = (message?: unknown) => {
    const text = String(message ?? "");
    reportFatal("Sys_Error alert", text, "");
    // "Xash Error\n\nMem_FreeBlock: not allocated or double freed pool 0"
    fatal(text.split("\n").filter((l) => l.trim()).pop() ?? "");
  };

  // Not every engine death is polite enough to call Sys_Error. A wasm trap
  // just throws out of the rAF callback and the render loop stops - the tab
  // freezes, the client goes silent, and the drop watchdog then blames the
  // network for what was a local crash ("you were dropped from the server",
  // reported 2026-08-28 after the engine's own menu was opened). Catch the
  // trap and say what actually happened.
  window.addEventListener(
    "error",
    (e) => {
      if (!engineRunning || engineDead) return;
      const err: unknown = e.error;
      const text = err instanceof Error ? `${err.name}: ${err.message}` : String(e.message ?? "");
      const stack = err instanceof Error ? (err.stack ?? "") : "";
      // wasm traps surface as WebAssembly.RuntimeError, and emscripten frames
      // carry wasm:// URLs - anything else is the page's own problem
      const fromEngine =
        (typeof WebAssembly !== "undefined" && err instanceof WebAssembly.RuntimeError) ||
        stack.includes("wasm://") ||
        /RuntimeError/.test(text);
      if (!fromEngine) return;
      reportFatal("wasm trap", text, stack);
      fatal(text);
    },
    true,
  );
}

// Escape must never reach the engine: this build cannot draw its own menus,
// and the attempt throws RuntimeError: remainder by zero in UI_DrawString and
// takes the render loop with it (backlog item 2). The tab freezes, the client
// goes silent, and the drop watchdog reports a disconnect ~10s later.
//
// Registered BEFORE the engine initialises, and that ordering is the whole
// point: capture-phase listeners on one target fire in registration order, so
// a handler added later (say, when play starts) loses the race to SDL's own
// and the menu opens anyway - exactly what happened on the first attempt at
// this fix (2026-08-28). Registered first on window+capture it beats SDL
// wherever SDL listens, since capture runs window -> document -> canvas
// before any bubble handler.
//
// Deliberately no preventDefault: leaving the default alone keeps the
// browser's fullscreen and pointer-lock exit on Escape, both handled above
// the page and uncancellable by it anyway.
export type LaunchStatus =
  | { phase: "engine" }
  | { phase: "unpacking"; done: number; total: number };

// In-game settings (sensitivity, volume, crosshair, binds...) live in cfg
// files the engine writes into the in-memory FS, which dies with the page.
// We snapshot the player's DELIBERATE changes to localStorage while playing
// and replay them line-by-line after the next boot (the engine's `exec` is
// a no-op in this wasm build - see troubleshooting).
//
// Only the diff against a boot-time baseline is saved: host_writeconfig
// archives every cvar (~300), and a full snapshot pinned stale copies of
// shipped userconfig.cfg defaults over any update shipped later - returning
// players never received cl_bob 0 or the xhair crosshair (2026-08-03).
const SETTINGS_KEY = "ff-settings-v2"; // v1 was a full cfg archive - see above
const LEGACY_SETTINGS_KEY = "ff-settings";
const SETTINGS_FILES = ["config.cfg", "video.cfg", "opengl.cfg", "touch.cfg"];
const SETTINGS_DIR = "/rodir/cstrike/";

// Diff key for a cfg line: binds by key name, cvar sets by cvar name.
// Anything else (comments, unbindall, blank) keys to null and never persists.
function cfgKey(line: string): string | null {
  const t = line.trim();
  if (!t || t.startsWith("//")) return null;
  const bind = t.match(/^bind\s+("?)(\S+?)\1\s+/i);
  if (bind) return "bind " + bind[2].toUpperCase();
  const cvar = t.match(/^(\w+)\s+\S/);
  return cvar ? cvar[1].toLowerCase() : null;
}

function cfgMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const key = cfgKey(line);
    if (key) map.set(key, line.trim());
  }
  return map;
}

// The saved diff is also the model behind the lobby's settings panel: every
// line in it is a deliberate override of a shipped default, which is exactly
// what that panel lists. Editing only touches localStorage - the panel lives
// in the lobby overlay, which is gone by the time there is an engine to talk
// to, and the next boot replays whatever survived (see launchGame below).
export type SavedSetting = { key: string; line: string; cvar: string; value: string };

// Where a panel-written cvar goes. Same bucket the engine archives its own
// cvars to, so a value set in the panel and a value set in-game are the same
// kind of thing, and the next persistSettings diff carries it forward.
const CVAR_FILE = "config.cfg";

// cfgKey collapses every `unbind "K"` line onto one key - the unbind form has
// no second token, so it falls through to the cvar branch. Harmless for
// diffing, but the panel would show one chip for all of them and delete the
// lot at once, so unbinds get keyed by their key name here.
function settingKey(line: string): string | null {
  const unbind = line.trim().match(/^unbind\s+("?)(\S+?)\1\s*$/i);
  return unbind ? "unbind " + unbind[2].toUpperCase() : cfgKey(line);
}

function loadSaved(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {}; /* corrupt snapshot - shipped defaults it is */
  }
}

function storeSaved(files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) if (!text.trim()) delete files[name];
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(files));
}

// Every override currently saved, one entry per setting. The engine writes
// each cvar into exactly one cfg file, so a later file wins only if it really
// does re-set the same key.
export function savedSettings(): SavedSetting[] {
  const out = new Map<string, SavedSetting>();
  for (const text of Object.values(loadSaved())) {
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      const key = settingKey(line);
      if (!key) continue;
      const [, head, rest] = line.match(/^(\S+)\s*(.*)$/)!;
      out.set(key, { key, line, cvar: head.toLowerCase(), value: rest.trim() });
    }
  }
  return [...out.values()];
}

export function removeSavedSetting(key: string) {
  const files = loadSaved();
  for (const [name, text] of Object.entries(files)) {
    files[name] = text
      .split("\n")
      .filter((line) => settingKey(line) !== key)
      .join("\n");
  }
  storeSaved(files);
}

export function clearSavedSettings() {
  localStorage.removeItem(SETTINGS_KEY);
}

// Set one cvar, or clear the override when value is null. Clearing drops the
// line rather than writing a default back: the panel never sees the engine,
// so "default" can only mean whatever userconfig.cfg ships on the next boot.
export function setSavedCvar(cvar: string, value: string | null) {
  removeSavedSetting(cvar.toLowerCase());
  if (value === null) return;
  const files = loadSaved();
  const line = `${cvar} ${value}`;
  files[CVAR_FILE] = files[CVAR_FILE] ? `${files[CVAR_FILE]}\n${line}` : line;
  storeSaved(files);
}

// Shipped defaults as of this boot, captured after main() (userconfig.cfg
// has applied by then) and before the saved diff replays. Set by launchGame;
// persistSettings refuses to run without it.
let baseline: Record<string, Map<string, string>> | null = null;

function readCfgFiles(x: Xash3DWebRTC): Record<string, string> {
  // Cmd_ExecuteString runs the command immediately (it's not queued), so
  // the files are fresh by the time we read them
  x.Cmd_ExecuteString("host_writeconfig");
  const out: Record<string, string> = {};
  for (const name of SETTINGS_FILES) {
    try {
      out[name] = x.em!.FS.readFile(SETTINGS_DIR + name, { encoding: "utf8" }) as string;
    } catch {
      /* engine hasn't written this one - skip it */
    }
  }
  return out;
}

// Every console command we send lands in `Cmd_ExecuteString`, which tokenizes
// into the engine's shared argv and frees the previous tokens out of the cmd
// memory pool. That pool does not outlive the connection: once the client host
// tears down - a drop, or a connect that never completes because the server
// sim is dead - the next command frees tokens whose pool is already gone and
// the engine aborts with
//
//   Mem_FreeBlock: not allocated or double freed (free at ../engine/common/cmd.c:604)
//
// which is a native alert(), i.e. the crash card and the end of the session.
// Nothing was poking that console except us: `persistSettings` on its 30s
// timer and `leaveServer` on pagehide. A player who could not connect sat on
// the splash until the first persist tick killed the tab (reported 2026-08-29,
// while the gg sim was dead from the MAX_MODELS leak - no packet ever arrived,
// so the silence watchdog never even armed and the drop card never showed);
// the same tick is the likeliest trigger for the post-drop crash of
// 2026-08-28. We cannot fix the engine's pool handling, so we stop talking to
// a console that no longer has a connection behind it: both entry points below
// require `x.live` (server traffic seen, no drop fired). The boot-time
// commands in launchGame stay ungated - they run on a freshly booted engine,
// before any traffic can exist, and the pool is certainly alive there.
//
// Cost: settings changed since the last 30s snapshot are lost on a drop. There
// is no snapshot-on-the-way-out either - `host_writeconfig` is itself a
// console command, so by the time a drop is known it is already unsafe.
export function persistSettings(x: Xash3DWebRTC) {
  // a dead engine still answers ccall, and host_writeconfig on it re-enters
  // the crashed heap - the snapshot is lost either way, so skip it
  if (!x.em?.FS || x.exited || engineDead || !x.live || !baseline) return;
  const out: Record<string, string> = {};
  for (const [name, text] of Object.entries(readCfgFiles(x))) {
    const base = baseline[name] ?? new Map<string, string>();
    const live = cfgMap(text);
    const lines: string[] = [];
    for (const [key, line] of live) {
      // the lobby name field is authoritative, never the snapshot
      if (key === "name") continue;
      if (base.get(key) !== line) lines.push(line);
    }
    // a key bound at boot but unbound since must be actively unbound on replay
    for (const key of base.keys()) {
      if (key.startsWith("bind ") && !live.has(key)) lines.push(`unbind "${key.slice(5)}"`);
    }
    if (lines.length) out[name] = lines.join("\n");
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(out));
}

// Tell the server we are going, so it frees the slot now instead of holding
// it for sv_timeout (600s). Without this a reload leaves a ghost: the old
// session stays in the sim, keeps a slot on a 16-player server, and can be
// handed objectives - on 2026-08-28 a reloading player's ghost was given the
// bomb and carried it for nearly seven minutes. The engine sends the
// disconnect over the still-open data channel before the page tears it down;
// a hard kill (crash, force-quit) still falls back to the timeout.
export function leaveServer(x: Xash3DWebRTC) {
  // nothing to hand back once the server is already gone, and the console is
  // no longer safe to poke - see the note above persistSettings
  if (!x.em || x.exited || engineDead || !x.live) return;
  try {
    x.Cmd_ExecuteString("disconnect");
  } catch {
    /* engine already gone - the timeout will reap the slot */
  }
}

export async function launchGame(
  canvas: HTMLCanvasElement,
  zipBytes: Uint8Array,
  playerName: string,
  onStatus: (s: LaunchStatus) => void,
  onDrop: (kind: DropKind) => void,
  onFatal: (message: string) => void,
): Promise<Xash3DWebRTC> {
  disableMicCapture(); // must run before the engine probes for audio capture
  captureEngineFatals(onFatal); // ...and before it can Sys_Error
  const x = new Xash3DWebRTC({
    canvas,
    arguments: ["-windowed", "-game", "cstrike"],
    libraries: {
      filesystem: filesystemURL,
      xash: xashURL,
      menu: menuURL,
      server: serverURL,
      client: clientURL,
      render: {
        gles3compat: gles3URL,
      },
    },
    dynamicLibraries: ["dlls/cs_emscripten_wasm32.wasm", "/rodir/filesystem_stdio.wasm"],
    filesMap: {
      "dlls/cs_emscripten_wasm32.wasm": serverURL,
      "/rodir/filesystem_stdio.wasm": filesystemURL,
    },
  });

  // hook before init so drops during the handshake are caught too
  x.onDrop = onDrop;

  onStatus({ phase: "engine" });
  // init() boots the wasm runtime and completes the WebRTC handshake; the zip
  // parse and extras fetch overlap with it.
  const [zip, extras] = await Promise.all([
    JSZip.loadAsync(zipBytes),
    fetch(extrasURL).then((r) => r.arrayBuffer()),
    x.init(),
  ]);

  if (x.exited) throw new Error("engine exited during init");
  const fs = x.em!.FS;

  const entries = Object.entries(zip.files).filter(([, file]) => !file.dir);
  let done = 0;
  onStatus({ phase: "unpacking", done, total: entries.length });
  await Promise.all(
    entries.map(async ([filename, file]) => {
      const path = "/rodir/" + filename;
      const dir = path.split("/").slice(0, -1).join("/");
      fs.mkdirTree(dir);
      fs.writeFile(path, await file.async("uint8array"));
      done += 1;
      if (done % 200 === 0 || done === entries.length) {
        onStatus({ phase: "unpacking", done, total: entries.length });
      }
    }),
  );

  const extrasBytes = new Uint8Array(extras);
  fs.writeFile("/rodir/cstrike/extras.pk3", extrasBytes);
  fs.writeFile("/rodir/extras.pk3", extrasBytes);
  fs.writeFile("/extras.pk3", extrasBytes);

  fs.chdir("/rodir");
  engineRunning = true;
  x.main();
  // debug handle for poking the live engine from devtools
  (window as unknown as { __xash?: Xash3DWebRTC }).__xash = x;
  x.Cmd_ExecuteString("_vgui_menus 0");
  x.Cmd_ExecuteString("gl_max_size 128");
  // baseline BEFORE the saved diff replays: userconfig.cfg has already
  // applied inside main() (verified - replayed values are never overwritten
  // afterwards), so this is the shipped defaults for this valve.zip build
  baseline = Object.fromEntries(
    Object.entries(readCfgFiles(x)).map(([name, text]) => [name, cfgMap(text)]),
  );
  // v1 full archives pinned stale shipped defaults - drop them for good
  localStorage.removeItem(LEGACY_SETTINGS_KEY);
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (saved) {
    try {
      for (const text of Object.values(JSON.parse(saved) as Record<string, string>)) {
        for (const line of text.split("\n")) {
          const cmd = line.trim();
          if (!cmd || cmd.startsWith("//") || cmd.startsWith("name ")) continue;
          x.Cmd_ExecuteString(cmd);
        }
      }
    } catch {
      /* corrupt snapshot - shipped defaults it is */
    }
  }
  if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
    x.Cmd_ExecuteString("touch_enable 1");
  }
  if (playerName) {
    x.Cmd_ExecuteString(`name "${playerName}"`);
  }
  // the WebRTC data channels surface as a fake UDP peer at 127.0.0.1:8080
  x.Cmd_ExecuteString("connect 127.0.0.1:8080");
  return x;
}
