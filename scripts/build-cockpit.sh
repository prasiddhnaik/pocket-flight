#!/usr/bin/env bash
# Paints the atlas and builds one detail cockpit: bun run cockpit:build f15c [--review | --fit-map]
set -euo pipefail
if [[ " $* " != *" --fit-map "* ]]; then
    python3 scripts/build-cockpit-atlas.py "$1"
fi
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/build-cockpit.py -- "$@"
