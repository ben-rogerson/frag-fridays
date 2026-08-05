#!/bin/bash
# Shuffle the map rotation on every container start so each session plays the
# pool in a fresh order, then boot into the first shuffled map. Any +map arg
# from docker-compose is dropped in favour of that entry.
#
# Identical copies live in gg/, dm/ and kz/ (each mod's build context is its
# own dir). This replaces the base image's static entrypoint - keep the
# ./xash args below in sync with it:
#   docker inspect yohimik/cs-web-server-metpamx --format '{{json .Config.Entrypoint}}'
set -euo pipefail

# GNU shuf reads all input before opening the output, so in-place is safe.
# The Dockerfile chowns mapcycle.txt to xashds to make it writable here.
shuf cstrike/mapcycle.txt -o cstrike/mapcycle.txt
first="$(head -n 1 cstrike/mapcycle.txt)"
echo "[entrypoint] shuffled mapcycle, booting $first"

args=()
for a in "$@"; do
  [[ "$a" == +map* ]] || args+=("$a")
done

exec ./xash +ip 0.0.0.0 -port 27015 -game cstrike ${args[@]+"${args[@]}"} "+map $first"
