#!/usr/bin/env bash
# Builds the pilot from the unpacked Sketchfab download: bun run pilot:build <folder holding scene.gltf>
set -euo pipefail
python3 -I scripts/build-pilot-atlas.py "$1"
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build-pilot.py -- "$1"
