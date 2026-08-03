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

export async function downloadValveZip(
  onProgress: (p: DownloadProgress) => void,
): Promise<Uint8Array> {
  const res = await fetch("/valve.zip");
  if (!res.ok || !res.body) {
    throw new Error(`valve.zip download failed (HTTP ${res.status})`);
  }
  const total = Number(res.headers.get("content-length")) || null;
  const reader = res.body.getReader();
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

export function persistSettings(x: Xash3DWebRTC) {
  if (!x.em?.FS || x.exited || !baseline) return;
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

export async function launchGame(
  canvas: HTMLCanvasElement,
  zipBytes: Uint8Array,
  playerName: string,
  onStatus: (s: LaunchStatus) => void,
  onDrop: (kind: DropKind) => void,
): Promise<Xash3DWebRTC> {
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
