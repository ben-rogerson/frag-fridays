# Server setup from scratch

How the VPS was built, so it can be rebuilt from nothing. The player URL is
`http://149.28.172.74:27016`.

## 1. Provision the VPS

- **Provider/region:** Vultr Cloud Compute, **Sydney**. Chosen for latency
  (~20-30ms expected from AU). Hetzner was ~3x cheaper but has no AU
  datacentre, which would add ~250ms.
- **OS:** Ubuntu 24.04 LTS. 26.04 was available but deliberately skipped -
  with a WASM engine, an emulated 32-bit container and an untested mod
  pipeline in play, a four-month-old distro added risk for zero upside.
- **Cost:** ~$5-6/month.
- **Automatic Backups: turn OFF.** Vultr pre-toggles it at $5.60/mo, nearly
  doubling the bill for a box holding nothing unrecoverable. A single manual
  snapshot is used instead (see below).

## 2. Access and firewall

- **SSH keys only** - no password auth.
- Firewall rules:

| Port  | Protocol  | Purpose                              |
| ----- | --------- | ------------------------------------ |
| 22    | tcp       | SSH - restrict to admin IP only      |
| 27016 | tcp       | Player URL / game server             |
| 27017 | tcp       | MCP control plane (`server/mcp`)     |
| 27018 | tcp + udp | Game networking                      |

This table is the **Vultr cloud firewall** (dashboard). The box's own ufw
allows only 22/tcp - the game ports work anyway because Docker-published
ports bypass ufw entirely (Docker inserts its own iptables chains ahead of
ufw's). Two consequences: opening a new containerised service means a Vultr
rule plus a compose `ports:` entry, no ufw change; and anything run with
`network_mode: host` or outside Docker WOULD be blocked by ufw. Trap noted
here because it looks exactly like a misconfigured firewall from the outside.

## 3. Docker and the 32-bit image check

The game server image is 32-bit (`linux/386`). The host runs it correctly,
but verifying that has a trap:

- **False alarm:** `uname -m` inside a `--platform linux/386` container
  reports `x86_64`. That looks like missing 32-bit support - it is not.
  `uname` reports the _kernel_ architecture, and the container has already
  run a 32-bit binary successfully by that point.
- **Correct check:**

  ```bash
  docker image inspect i386/alpine --format '{{.Architecture}}'
  # -> 386
  ```

## 4. Game files via SteamCMD

Install the CS 1.6 game files with SteamCMD to `/opt/cs16/cs`. This is the
source of truth for game files - it is NOT in the repo (copyrighted, ~1GB).

**Steam verification gotcha:** logging in with SteamCMD from a new datacentre
IP triggers Steam's verification flow, and a wrong answer locks sign-in
entirely. The recovery questionnaire is built around scam pretexts ("collect
a free skin", "assist a Valve employee") - none describe downloading files
you own. Correct answers:

- "What were you using?" -> **"Steam client"** (SteamCMD _is_ the Steam client)
- Purpose -> **"Other"**

## 5. Directory layout

As verified on the live box (2026-08-02) - note `/opt/cs16` doubles as the
SteamCMD install dir, so SteamCMD internals sit alongside the project files:

```
/opt/cs16/
├── cs/                      # SteamCMD game install (source of truth for game files)
│   ├── valve/
│   └── cstrike/
│       └── userconfig.cfg   # shared client config, ships to all players
├── .env                     # PUBLIC_IP for the root compose (not in repo)
├── docker-compose.yml       # profile-based: --profile vanilla runs stock CS
├── valve.zip                # ~300MB trimmed client archive (rebuild: update-clientcfg.sh)
├── web/                     # custom web client build (from repo apps/web via deploy.sh)
├── update-clientcfg.sh      # rebuilds valve.zip from cs/, restarts running mod
├── mods/                    # bind-mount targets for the root compose (empty)
├── src/                     # downloaded mod archives (not in repo)
│   ├── gg-src/
│   └── dm-src/
├── gg/                      # GunGame - working; own image built from addons/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── addons/              # mounts ../valve.zip (the canonical one)
├── dm/                      # Deathmatch - frag_dm.sma (ours; CSDM was incompatible)
├── zp/                      # Zombie Plague - abandoned template
└── linux32/, linux64/, package/, public/, siteserverui/, steamcmd.sh
                             # SteamCMD internals - leave alone
```

`update-clientcfg.sh` (the script the handover doc claimed existed) was
written 2026-08-02: it builds ONE canonical `valve.zip` from
`cs/{valve,cstrike}` and installs it to both the root and `gg/` compose mount
points, so the two can never drift. Run it via `pnpm run clientcfg` from the
laptop. Working mods are each their own image and directory. Everything binds
port 27016, so only one runs at a time and the player URL never changes.

## 6. Snapshot as rollback point

A manual Vultr snapshot was taken after GunGame was confirmed working. That
snapshot is the rollback point - restore it if the box gets into an
unrecoverable state. Take a new snapshot after any major working milestone.
Automatic Backups stay off (see step 1).

## 7. Software stack

Built on [yohimik/webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs) -
CS 1.6 compiled to WebAssembly, networked over WebRTC, played in-browser.
MIT licensed, actively maintained.

Image: `yohimik/cs-web-server-metpamx:latest`

**Critical constraint:** the stack is **Xash3D-FWGS + Metamod-P + AMX Mod X
1.9**. It is NOT ReHLDS/ReGameDLL/ReAPI - see
[troubleshooting.md](troubleshooting.md) before choosing any mod or plugin.

## 8. Custom web client (apps/web)

The image ships a stock browser client in `/xashds/public/`. We replace it
with our own (Frag Fridays loading screen, download progress bar) built from
`apps/web` - a Vite + React port of the upstream
`examples/react-typescript-cs16-webrtc`, pinned to `xash3d-fwgs@1.2.2` +
`cs16-client@0.1.2` npm packages (their `xash.wasm` is byte-identical to the
image's, so client and server engine versions match).

- `deploy.sh` builds `apps/web` into `server/web/` (gitignored) and rsyncs it
  to `/opt/cs16/web/`; every compose mounts `web/index.html` and `web/assets/`
  over the stock client. The image's `public/cstrike/` (wasm dlls for the
  stock client) stays untouched underneath.
- `index.html` is a file bind-mount: like valve.zip, a redeploy changes the
  inode, so the container must restart to serve the new build (deploy with a
  mod arg does this).
- **webrtc.ts is ported from the image's stock client, NOT the upstream
  example.** The example on git main targets a newer goxash server that
  double-encodes signalling `data` as a JSON string; our July-2026 image
  sends plain objects. The mismatch makes `JSON.parse` throw, the offer is
  never answered and connect hangs forever. Ours accepts both encodings.
  After boot the client must run `connect 127.0.0.1:8080` - the WebRTC data
  channels surface as a fake UDP peer at that address.
- The mic is optional - `getUserMedia` does not exist on plain-http origins,
  so voice needs https if ever wanted.
- The loading screen's YouTube background goes through a relay page:
  YouTube rejects embeds from IP-literal http origins (onError 150 via the
  widget API - verified against a known-embeddable control video, so it is
  the origin, not the video). `apps/web/shim/` is a Cloudflare Worker
  (deployed with `npx wrangler deploy` from that dir, currently
  https://frag-friday-bg.floral-math-a059.workers.dev) serving a page that
  hosts the real YouTube iframe on a workers.dev origin and relays widget
  postMessage traffic both ways - sound toggle and error fallback work
  unchanged. If the embed ever breaks again the client detects onError and
  drops the iframe, falling back to the plain gradient.
- `pnpm run web:dev` runs Vite locally, proxying `/websocket` and
  `/valve.zip` to the live box.
