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

| Port | Protocol | Purpose |
|---|---|---|
| 22 | tcp | SSH - restrict to admin IP only |
| 27016 | tcp | Player URL / game server |
| 27018 | tcp + udp | Game networking |

## 3. Docker and the 32-bit image check

The game server image is 32-bit (`linux/386`). The host runs it correctly,
but verifying that has a trap:

- **False alarm:** `uname -m` inside a `--platform linux/386` container
  reports `x86_64`. That looks like missing 32-bit support - it is not.
  `uname` reports the *kernel* architecture, and the container has already
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

- "What were you using?" -> **"Steam client"** (SteamCMD *is* the Steam client)
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
├── valve.zip                # ~438MB game filesystem archive, built by hand
├── mods/                    # bind-mount targets for the root compose (empty)
├── src/                     # downloaded mod archives (not in repo)
│   ├── gg-src/
│   └── dm-src/
├── gg/                      # GunGame - working; own image built from addons/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── addons/
│   └── valve.zip
├── dm/                      # CSDM - compose + Dockerfile only, no addons yet
├── zp/                      # Zombie Plague - abandoned template
└── linux32/, linux64/, package/, public/, siteserverui/, steamcmd.sh
                             # SteamCMD internals - leave alone
```

There is no `update-clientcfg.sh` (the original handover doc claimed one;
writing it is in the backlog). Working mods are each their own image and
directory. Everything binds port 27016, so only one runs at a time and the
player URL never changes.

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
