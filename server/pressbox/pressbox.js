// Pressbox: headless Chromium spectator for the Frag Fridays WASM CS 1.6
// server. Loads the same URL players use, presses F3 to enter spectator team
// (jointeam 6, bound in userconfig.cfg), screenshots the game canvas on an
// interval, and serves the latest frame over HTTP at :27060.
//
// Everything is in-process CommonJS with no npm deps beyond playwright itself,
// which is pre-installed in the Playwright base image - no `npm install` at
// build time.

const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const GAME_URL = process.env.GAME_URL || "http://host.docker.internal:27016";
const OUT_DIR = process.env.OUT_DIR || "/out";
const HTTP_PORT = Number(process.env.HTTP_PORT || 27060);
const VIEWPORT_W = Number(process.env.VIEWPORT_W || 1280);
const VIEWPORT_H = Number(process.env.VIEWPORT_H || 720);
// WASM game takes ~30-60s to init in a browser tab on this stack; wait
// generously before firing the spec bind. If the game is still on the splash
// after this, the F3 keystroke is dropped harmlessly and the next reload
// (RELOAD_ON_STALL_MS) picks it up.
const JOIN_DELAY_MS = Number(process.env.JOIN_DELAY_MS || 60_000);
const SHOT_INTERVAL_MS = Number(process.env.SHOT_INTERVAL_MS || 5_000);
// If N consecutive screenshots come back the same, the tab is probably stuck
// on the loading splash (upstream UI_DrawString "remainder by zero" bug, see
// docs/backlog.md item 2). Force a page reload to recover.
const STALL_RELOAD_AFTER = Number(process.env.STALL_RELOAD_AFTER || 24);
const SPEC_KEY = process.env.SPEC_KEY || "F3";

function log(msg) {
  process.stdout.write(`[pressbox] ${msg}\n`);
}

// atomic-write: readers of /out/latest.png never see a half-written file
function atomicWrite(dest, buf) {
  const tmp = dest + ".tmp";
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
}

function hash(buf) {
  let h = 0;
  for (let i = 0; i < buf.length; i += 1024) h = (h * 31 + buf[i]) | 0;
  return h;
}

async function joinSpectate(page) {
  await page.waitForSelector("canvas", { timeout: 60_000 });
  await new Promise((r) => setTimeout(r, JOIN_DELAY_MS));
  // click canvas so keystrokes route to the WASM engine, not the page chrome
  await page.locator("canvas").first().click();
  log(`sending ${SPEC_KEY} (jointeam 6 via userconfig.cfg bind)`);
  await page.keyboard.press(SPEC_KEY);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const latest = path.join(OUT_DIR, "latest.png");

  const state = {
    startedAt: Date.now(),
    lastShotAt: 0,
    shotCount: 0,
    stallCount: 0,
    reloadCount: 0,
    lastHash: 0,
    error: null,
    ready: false,
  };

  // start the viewer BEFORE launching chromium so "is pressbox up?" is
  // answerable during the (slow) game boot
  http
    .createServer((req, res) => {
      if (req.url === "/health") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(state));
        return;
      }
      if (req.url && req.url.startsWith("/latest.png")) {
        try {
          const buf = fs.readFileSync(latest);
          res.setHeader("content-type", "image/png");
          res.setHeader("cache-control", "no-store");
          res.end(buf);
        } catch (_e) {
          res.statusCode = 503;
          res.end("no frame yet");
        }
        return;
      }
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><meta charset=utf-8><title>pressbox</title>
<style>html,body{margin:0;background:#111;color:#eee;font:14px system-ui}
img{display:block;max-width:100vw;max-height:calc(100vh - 34px);margin:auto}
.bar{padding:8px 12px;display:flex;gap:12px;align-items:center}
a{color:#8cf}</style>
<div class=bar><b>pressbox</b><span id=t>...</span><a href=/health>/health</a></div>
<img id=f src="/latest.png?t=${Date.now()}">
<script>
const img=document.getElementById('f'),t=document.getElementById('t');
async function tick(){
  img.src='/latest.png?t='+Date.now();
  try{const h=await(await fetch('/health')).json();
    t.textContent='shots '+h.shotCount+(h.ready?'':' (loading)')+(h.error?' err: '+h.error:'');
  }catch(_){}
}
setInterval(tick, ${SHOT_INTERVAL_MS});
</script>`);
    })
    .listen(HTTP_PORT, () => log(`viewer on :${HTTP_PORT}`));

  log(`launching chromium, target=${GAME_URL}`);
  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream", // auto-accept mic prompt (splash-stall fix)
      "--autoplay-policy=no-user-gesture-required",
      "--no-sandbox",
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    permissions: ["microphone"],
  });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    const t = m.text();
    if (t && t.length < 300) log(`game: ${t}`);
  });
  page.on("pageerror", (e) => log(`game-error: ${e.message}`));

  async function reload(reason) {
    state.reloadCount += 1;
    state.ready = false;
    log(`reload (${reason}) [#${state.reloadCount}]`);
    await page.goto(GAME_URL, { waitUntil: "load", timeout: 60_000 });
    await joinSpectate(page);
    state.ready = true;
    state.stallCount = 0;
  }

  await page.goto(GAME_URL, { waitUntil: "load", timeout: 60_000 });
  log(`page loaded, waiting ${JOIN_DELAY_MS / 1000}s for WASM game init`);
  await joinSpectate(page);
  state.ready = true;

  // screenshot loop
  setInterval(async () => {
    try {
      const el = await page.$("canvas");
      const buf = el
        ? await el.screenshot({ type: "png" })
        : await page.screenshot({ type: "png" });
      atomicWrite(latest, buf);
      const h = hash(buf);
      if (h === state.lastHash) {
        state.stallCount += 1;
        if (state.stallCount >= STALL_RELOAD_AFTER) {
          reload(`${state.stallCount} identical frames`).catch((e) =>
            log(`reload failed: ${e.message}`)
          );
        }
      } else {
        state.stallCount = 0;
        state.lastHash = h;
      }
      state.lastShotAt = Date.now();
      state.shotCount += 1;
      state.error = null;
    } catch (e) {
      state.error = String(e && e.message ? e.message : e);
      log(`screenshot failed: ${state.error}`);
    }
  }, SHOT_INTERVAL_MS);
}

main().catch((e) => {
  log(`fatal: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
