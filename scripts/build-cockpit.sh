#!/usr/bin/env bash
# Paints the atlas and builds one detail cockpit: bun run cockpit:build f15c [--review]
set -euo pipefail
python3 scripts/build-cockpit-atlas.py "$1"
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build-cockpit.py -- "$@"
