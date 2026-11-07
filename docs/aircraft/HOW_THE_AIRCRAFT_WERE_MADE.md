# How the Pocket Flight aircraft were made

Prepared September 13, 2026. This documents Finch U–2, Peregrine HX–27, and Aurelia S32 from their local modeling scripts, saved Blender projects, validation reports, and the development history of this project.

The aircraft are original game assets. Their dimensions and construction details support believable visuals; they are not engineering drawings or validated flight hardware.

## 1. The three workflows at a glance

| Aircraft | Design direction | Geometry workflow | Animation workflow |
|---|---|---|---|
| **Finch U–2** | Small, approachable two-seat propeller trainer | Parametric CAD using `cadgen`/`build123d`, then Blender finishing | Separate controls, propeller, steering and suspension nodes; Three.js drives them during flight |
| **Peregrine HX–27** | Fighter front end with the body mass of a transport | Custom Blender Python mesh construction guided by the supplied fighter and C-5 images | Articulated model plus browser animation/effects logic |
| **Aurelia S32** | Broad, premium civilian executive jet | Custom Blender Python mesh construction; later changes through Blender MCP | Native Blender keyframes for system demonstrations; exported gear curves and input-driven browser systems |

These were not all made with the same tool. Finch genuinely has a CAD/STEP master. The two jets were built primarily as Blender meshes. Houdini MCP was investigated, but no Houdini-authored aircraft or animation was completed in this workflow. The later Aurelia systems were authored through Blender MCP.

## 2. Shared modeling principles

### Establish the silhouette first

The main decisions were fuselage length and width, cockpit placement, wing sweep/span, tail proportions, engine placement, and wheel layout. Surface detail came after those proportions worked from multiple angles.

A smooth fuselage was constructed from cross-sections whose width, height and center changed along the aircraft. Lofting or interpolating those sections produces a shaped cabin, nose and tail rather than a uniformly stretched cylinder.

Wings were built from airfoil sections: rounded leading edges, upper and lower surfaces, and thin trailing edges. The section positions, chords, thicknesses and heights change along the span. That gives taper, sweep and dihedral while retaining an actual underside.

### Separate moving components before finishing

Wings, ailerons, flaps, elevators, rudders, propellers/fans and gear components have named objects or parent empties. A parent empty acts as a hinge: geometry is positioned relative to it, and rotating the parent moves the whole assembly.

A typical hierarchy is:

```text
Aircraft root
├── Fuselage
├── Cockpit
├── Wing_Left / Wing_Right
│   ├── Aileron
│   └── Flap
├── Empennage
│   ├── Elevator(s)
│   └── Rudder
├── Engine(s) / Propeller or fan
└── LandingGear
    ├── Gear assemblies and wheels
    └── Retraction hinges and doors, where implemented
```

Fixed objects were consolidated by parent/material where practical. Movable objects retained independent transforms so optimization would not destroy articulation.

### Coordinate conventions

Blender design coordinates use **X across the wings, +Y forward, +Z up**, in meters. The glTF export uses **+Y up and −Z forward**. Finch's CAD construction uses millimeters internally and converts to meters for transfer into Blender.

This conversion matters for animation: a fan spinning around Blender Y spins around the corresponding glTF Z axis. A rudder's Blender Z rotation becomes a glTF Y rotation. Rotating the wrong axis makes a part tumble instead of pivoting correctly.

## 3. Finch U–2: CAD master, then Blender finishing

### CAD airframe

The main source is [airframe.py](../../assets/finch/src/airframe.py).

1. Define fuselage stations containing longitudinal position, half-width, and upper/lower heights.
2. Loft elliptical section wires into the body and cowling shapes.
3. Generate airfoil section curves with a thickness distribution and modest camber.
4. Use monotone PCHIP interpolation along the wing to avoid unwanted oscillation between sections.
5. Separate control surfaces using geometric masks/cuts.
6. Build labeled mechanical components and retain their identities in the CAD assembly.
7. Export the CAD master as STEP and an initial tessellated GLB.

The STEP master is [Finch-U2-airframe.step](../../assets/finch/STEP/Finch-U2-airframe.step).

### Transfer and artistic finishing

[export_transfer.py](../../assets/finch/src/export_transfer.py) tessellates the labeled CAD parts into a JSON transfer file containing vertices, faces and component names. It also converts millimeters to meters.

[finish_aircraft.py](../../assets/finch/src/finish_aircraft.py) reconstructs those meshes in Blender and places each one under the appropriate aircraft, wing, control, steering or suspension parent. It welds nearby CAD face boundaries, recalculates normals, and simplifies selected mechanical parts.

The finishing pass adds the cockpit glazing and framing, seats, belts, panel/instruments, yokes, trim, markings, detailed wheels and propeller construction. Bevels, smooth shading and carefully chosen roughness make the surfaces catch light more naturally.

[make_textures.py](../../assets/finch/src/make_textures.py) generates the instrument atlas and packed paint material texture. The instrument atlas supplies readable gauge detail without modeling every mark. The paint texture adds restrained roughness variation.

### Fixes and animation

Cockpit iterations addressed seat/control clearance and the awkward appearance of the dashboard and yokes from external views. Clearance reports and yoke-travel checks were saved rather than relying only on a pleasing camera angle.

The game drives the propeller with spool-up/coast-down and a high-speed blur treatment. Separate control-surface nodes respond to pitch, roll and yaw. Steering and suspension are separate from the fixed tricycle gear structure; Finch was not converted into a retractable-gear aircraft.

### Main files

- Editable aircraft/studio: [Finch-U2.blend](../../assets/finch/Finch-U2.blend)
- Geometry-focused source: [Finch-U2-geometry.blend](../../assets/finch/Finch-U2-geometry.blend)
- Runtime model: [finch-u2.glb](../../public/assets/finch-u2.glb)
- Validation script: [validate_export.py](../../assets/finch/src/validate_export.py)
- Geometry inventory: [model-manifest.json](../../assets/finch/validation/model-manifest.json)
- Cockpit clearance: [cockpit-clearance.json](../../assets/finch/validation/cockpit-clearance.json)
- Yoke travel: [yoke-travel.json](../../assets/finch/validation/yoke-travel.json)

## 4. Peregrine HX–27: fighter/transport hybrid

### Reference-led shape

The user supplied two references: [the fighter](../../assets/peregrine/references/A-fighter.png) and [the transport](../../assets/peregrine/references/B-transport.png). The fighter guided the pointed nose, bubble canopy, chin-intake language and swept wings. The transport guided the broader body and heavier physical presence.

The design was iterated rather than copied from either reference. An early version is preserved in [build_peregrine_v1.py](../../assets/peregrine/source/build_peregrine_v1.py); the later builder is [build_peregrine.py](../../assets/peregrine/source/build_peregrine.py). The accepted wheel direction is also recorded in [approved-six-wheel-study.png](../../assets/peregrine/references/approved-six-wheel-study.png).

### Blender geometry construction

- Cross-section interpolation forms the pressure body and pointed nose.
- Surface-following curves place seams and maintenance details against the actual skin.
- Hollow intake lofts provide rounded lips, dark internal passages and recessed compressor detail.
- Blended engine shoulders, mounting seals, nozzle barrels and inner liners integrate the engines into the tail.
- Swept airfoil meshes form the wings and separate trailing-edge controls.
- The canopy is fitted to a computed hull opening, with a separate fixed windscreen, moving canopy, rails, gasket and coaming.
- The approved landing gear has six tires: two nose tires and a twin-wheel main assembly on each side.

The significant revisions were the wheel-count reduction, engine/body fit, and canopy fit. These were geometry changes, not merely camera adjustments.

### Runtime animation and effects

The Blender model provides named parts and pivot locations. The browser's jet-effects code supplies smoothly changing engine power, gear, canopy and control poses, plus military-jet effects such as afterburner behavior. Those effects respond to the game state; they are not a movie played behind the aircraft.

### Main files

- Editable aircraft: [Peregrine-HX27.blend](../../assets/peregrine/Peregrine-HX27.blend)
- Studio: [Peregrine-HX27-studio.blend](../../assets/peregrine/Peregrine-HX27-studio.blend)
- Runtime model: [peregrine-hx27.glb](../../public/assets/peregrine-hx27.glb)
- Validation: [validate_export.py](../../assets/peregrine/source/validate_export.py)
- Recorded geometry facts: [model-facts.json](../../assets/peregrine/validation/model-facts.json)

## 5. Aurelia S32: civilian aircraft and Blender MCP systems

### Original executive-jet geometry

[build_aurelia.py](../../assets/aurelia/source/build_aurelia.py) constructs the civilian model. It uses the same general family of section/loft and mesh helpers as the jet workflow, with new proportions and civilian details.

The design has a fuller passenger cabin, streamlined cockpit windows, swept wings with curved winglets, twin rear-mounted turbofans, and a clean tail. Its pearl, Atlantic-blue and champagne finish distinguishes it from Peregrine's military styling.

The model includes 16 cabin windows, four cockpit panes, 12 passenger seats, two pilot seats, cockpit instruments and controls, engine ducts and fans, access panels, and six wheels. Window apertures are cut into the shell and fitted with separate glazing and seals.

The fans have individually shaped blades with twist. The nacelles have rounded intake lips and actual recessed internal geometry. The wings have separate flaps and ailerons; the tail has separate elevators and rudder.

### Geometry corrections and inspection

The first inspection found a cabin-floor plate protruding through the lower body, an overlapping wing-root fairing, and shading dents around window cuts. The floor was fitted to the interior hull section, the overlapping skin was removed, and the shell received shape-derived custom normals. Glazing tint and registration placement were also refined.

A 25-image inspection set was produced: 12 views at 30° intervals around the aircraft, four three-quarter angles, front/back/left/right, and five beauty/detail views. Camera framing was corrected where the top view cropped the aircraft or a low camera intersected the studio floor.

That photo session was for final model inspection. **The later animation workflow was changed to viewport playback only, at the user's request. Full animation renders should not be started unless explicitly requested.**

### Systems authored through Blender MCP

The initial builder creates the base aircraft. Later animation and gear modifications were made directly in the running Blender scene using Python executed through Blender MCP.

The final systems scene contains:

1. **Retractable landing gear:** wheel-bay openings cut into the body, curved doors retained from the original skin, three retraction pivots, staggered main-gear stowage, and doors timed around gear travel. Parent offsets and tire clearance were corrected after inspection.
2. **Exhaust:** animated noise and bump-driven refraction, mixed with transparency and an edge fade. Aurelia uses a subtle civilian heat-distortion effect, not afterburner flames.
3. **Lights:** steady red/green navigation lights, white double-flash strobes, and an offset red beacon. The beacon was moved above the fuselage after a placement issue was found.
4. **Fans:** keyed rotor phase with smooth acceleration and deceleration to a complete stop.
5. **Controls:** separate roll, pitch, yaw and flap checks, with neutral holds and clamped Bézier handles to avoid unwanted overtravel. The flap direction was corrected to deploy downward.

The 24-fps review timeline is organized as follows:

| Frames | System |
|---|---|
| 1–288 | Gear down → retract → stow → extend |
| 289–384 | Exhaust |
| 385–480 | Lights |
| 481–624 | Engine fans |
| 625–816 | Controls: roll, pitch, yaw, then flaps |

### Important source distinction

The base builder does **not** reproduce every later MCP edit. The authoritative saved artifact for those edits is [Aurelia-S32-systems.blend](../../assets/aurelia/effects-blender-mcp/Aurelia-S32-systems.blend). Rebuilding only `build_aurelia.py` would recreate the base model, not the complete later retractable-gear/system scene.

### Main files

- Base aircraft: [Aurelia-S32.blend](../../assets/aurelia/Aurelia-S32.blend)
- Studio: [Aurelia-S32-studio.blend](../../assets/aurelia/Aurelia-S32-studio.blend)
- Earlier effects scene: [Aurelia-S32-effects.blend](../../assets/aurelia/effects-blender-mcp/Aurelia-S32-effects.blend)
- Final systems scene: [Aurelia-S32-systems.blend](../../assets/aurelia/effects-blender-mcp/Aurelia-S32-systems.blend)
- Base viewer model: [aurelia-s32.glb](../../public/assets/aurelia-s32.glb)
- Flight model with gear animation: [aurelia-flight.glb](../../public/assets/aurelia-flight.glb)
- Base export checks: [validate_aurelia.py](../../assets/aurelia/source/validate_aurelia.py)
- Gear position checks: [gear-validation.json](../../assets/aurelia/effects-blender-mcp/gear-validation.json)
- Other system checks: [other-systems-checks.json](../../assets/aurelia/effects-blender-mcp/other-systems-checks.json)
- Photo packaging: [package_inspection.py](../../assets/aurelia/source/package_inspection.py)

## 6. How the Blender work becomes a playable aircraft

The game uses React/TypeScript for its interface and Three.js for rendering. [aircraft.ts](../../src/aircraft.ts) selects the GLB, prepares materials, locates named parts, and assigns the relevant animation controller.

The exported model is not itself the flight simulator. [physics.ts](../../src/physics.ts) calculates movement, lift/drag behavior, stalls, ground contact and damage. [game.ts](../../src/game.ts) connects those values to the visual aircraft, cameras, effects and replay state.

### What is imported and what is recreated

| System | Connection to the game |
|---|---|
| Geometry and pivots | Imported from GLB |
| Aurelia gear and doors | Blender animation tracks are filtered into a Three.js clip and sampled according to the current gear state |
| Pitch/roll/yaw and flaps | The game rotates the exported control nodes with smoothed live inputs |
| Propeller and fans | Browser motion logic drives their exported nodes; phase/state is managed for pause and replay |
| Navigation/strobe lights | Lightweight browser objects and timed visibility reproduce the lighting behavior |
| Exhaust and afterburner effects | Browser shaders/effect code reproduce the intended appearance; Blender shader graphs do not transfer directly as equivalent WebGL effects |
| Suspension and tire contact | Collision coordinates and visual offsets are matched to the runtime model scale |

Peregrine is scaled to 0.7 and Aurelia to 0.55 in the flight loader, with a vertical center offset. Their hangar/model dimensions and their game-space collision coordinates therefore differ. Those transformations must stay consistent with [landing-gear.ts](../../src/landing-gear.ts).

Useful runtime sources:

- [control-surfaces.ts](../../src/control-surfaces.ts): Finch control poses.
- [propeller.ts](../../src/propeller.ts): propeller motion and blur behavior.
- [jet-effects.ts](../../src/jet-effects.ts): jet motion and effects.
- [aurelia-effects.ts](../../src/aurelia-effects.ts): Aurelia gear-track sampling, controls, fans and lights.
- [jet-heat.ts](../../src/jet-heat.ts): browser heat-distortion implementation.
- [App.tsx](../../src/App.tsx): aircraft selection and interface.

## 7. Validation and recorded model sizes

Validation combined direct visual inspection, independent GLB reimport, geometry/clearance checks, and browser gameplay checks. A passing export alone does not establish that the cockpit fits, the wheels clear the runway, or the animation looks correct.

The stored base-model reports record:

| Aircraft | Span × length × height | Triangles | Meshes |
|---|---|---:|---:|
| Finch U–2 | 10.98 × 8.09 × 3.22 m | 118,703 | 111 |
| Peregrine HX–27 | 19.84 × 29.39 × 7.88 m | 210,380 | 137 |
| Aurelia S32 | 27.24 × 31.50 × 9.55 m | 190,630 | 197 |

These are values from the saved modeling reports, **not newly measured counts for every current runtime export**. Aurelia's later wheel bays, doors and exported animation add work beyond its base-model report.

The September 8 integration was checked with 47 passing tests and a live Aurelia flight-start check. This documentation task did not rerun those tests or reverify the deployed site. Current local files also contain subsequent uncommitted performance/effects work; this guide does not claim that all of those changes are deployed.

## 8. Continuing the workflow safely

1. Open the aircraft's editable Blender source; use Aurelia's **systems** file when continuing its animations.
2. Keep a versioned working copy before changing geometry or hierarchy.
3. Preserve named articulation nodes and check their local axes and origins.
4. Check motion in viewport playback. Inspect gear down, mid-travel, fully stowed and extended again; inspect controls in both directions.
5. Use material preview when checking light/emission/transparency effects. Solid shading is suitable for motion but does not establish shader appearance.
6. Export aircraft geometry and required animation only, excluding studio cameras, floors, preview-only objects and lighting rigs.
7. Reimport the GLB and verify the named parts, scale, orientation, animation tracks and material appearance.
8. Verify the actual browser flow: choose the aircraft, start a flight, take off, land, pause/resume and replay. Check browser errors as well as the visible result.
9. Run relevant project checks with Bun, for example `bun run build` and `bun test --timeout 15000`.

The modeling builders contain scene-clearing operations and may render selected views as part of their workflow. They should be run in a fresh Blender process or a deliberately disposable scene, not executed blindly inside the user's unsaved working scene. A source script's presence is not a guarantee that the complete environment is currently installed or that all later manual/MCP edits are encoded in it.
