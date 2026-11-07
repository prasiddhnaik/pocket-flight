# Principles of Making Planes

**Pocket Flight aircraft design handbook — researched 30 September 2026**

This is the working reference for designing, modeling, animating, and tuning aircraft in Pocket Flight. The goal is to make original aircraft whose shape, mechanisms, performance, and handling follow real aerodynamic principles. A good aircraft should make sense from its silhouette down to its landing gear, and its behavior should match its design.

The rules below distinguish **physical principles**, **design tradeoffs**, and **Pocket Flight recommendations**. Recommendations are applications of the research to this game, not statements that the current simulator already implements them. Numerical examples are illustrative unless explicitly attributed to a real aircraft. This document is a game-development reference, not a set of instructions for manufacturing or operating real aircraft.

## Contents

1. [Core rules](#1-core-rules)
2. [Design the mission before the shape](#2-design-the-mission-before-the-shape)
3. [The physics everything else depends on](#3-the-physics-everything-else-depends-on)
4. [Units, coordinates, and scale](#4-units-coordinates-and-scale)
5. [Sizing wings and choosing their geometry](#5-sizing-wings-and-choosing-their-geometry)
6. [Airfoils and stall progression](#6-airfoils-and-stall-progression)
7. [Drag and efficiency](#7-drag-and-efficiency)
8. [Mass, center of gravity, and inertia](#8-mass-center-of-gravity-and-inertia)
9. [Stability, trim, and tail design](#9-stability-trim-and-tail-design)
10. [Controls and high-lift systems](#10-controls-and-high-lift-systems)
11. [Propulsion and engine installation](#11-propulsion-and-engine-installation)
12. [Landing gear and ground handling](#12-landing-gear-and-ground-handling)
13. [Structure, packaging, and cockpit](#13-structure-packaging-and-cockpit)
14. [Performance and the flight envelope](#14-performance-and-the-flight-envelope)
15. [Weather and environmental effects](#15-weather-and-environmental-effects)
16. [Modeling and animation rules](#16-modeling-and-animation-rules)
17. [How these principles apply to Pocket Flight today](#17-how-these-principles-apply-to-pocket-flight-today)
18. [Repeatable aircraft-development workflow](#18-repeatable-aircraft-development-workflow)
19. [Acceptance checklist and flight-test matrix](#19-acceptance-checklist-and-flight-test-matrix)
20. [Worked sizing example](#20-worked-sizing-example)
21. [Common myths and mistakes](#21-common-myths-and-mistakes)
22. [Glossary](#22-glossary)
23. [Research method, limitations, and source library](#23-research-method-limitations-and-source-library)

## 1. Core rules

These are project acceptance rules synthesized from the research below:

| Do | Don't | Why it matters |
|---|---|---|
| Define payload, speed, altitude, and runway needs first. | Start with a cool silhouette and invent its performance afterward. | The mission constrains the whole configuration. |
| Size the wing using weight, density, speed, and lift capability. | Give a heavy aircraft tiny wings and compensate with a magic lift multiplier. | Wing loading must agree with the intended takeoff and landing behavior. |
| Calculate forces using motion through the air. | Use groundspeed as the aerodynamic speed. | Wind changes air-relative velocity. |
| Keep attitude, flight path, and angle of attack distinct. | Treat nose-up pitch as lift or climb by itself. | The wing reacts to airflow, not the horizon. |
| Define CG, trim, control authority, and the stability strategy. | Assume a symmetrical mesh is automatically stable. | Symmetry does not establish force or moment balance. |
| Design gear placement and retraction while laying out the aircraft. | Add wheels wherever they look attractive at the end. | Gear must support the aircraft, permit rotation, and fit inside it. |
| Make control animation and aerodynamic response agree. | Rotate the aircraft while the supposed controls move the wrong way. | The visual aircraft must explain the flight behavior. |
| State each simplification and assistance mode. | Describe artificial self-leveling as natural stability. | Players and developers need an honest model of the simulation. |
| Compare multiple phases of flight against a design sheet. | Approve an aircraft after one successful takeoff. | A configuration can work at one condition and fail elsewhere. |

Use the detailed sections for the conditions and exceptions behind these rules. None of these rules requires copying an existing airplane; they require an original design to have a coherent engineering explanation.

## 2. Design the mission before the shape

Aircraft design joins aerodynamics, propulsion, structure, mass distribution, and control. These disciplines constrain each other. Configuration selection starts with what the aircraft carries, how far and fast it travels, and its operating conditions. [Virginia Tech configuration design][U07]

### 2.1 Required design brief

Before modeling, write down:

- Role: trainer, touring aircraft, business jet, transport, fighter, glider, or another defined category.
- People, cargo, equipment, fuel, and desired mission duration.
- Target cruise speed and altitude; maximum intended speed regime.
- Runway surface and available length; takeoff and landing requirements.
- Handling goal: forgiving training, stable cruising, maneuverability, or a documented combination.
- Propulsion type and whether engine failure is a simulated scenario.
- Configuration changes: flaps, gear, canopy, speed brakes, variable geometry.
- Which behaviors must be physical and which may use an optional assist.

**Do:** compare several compatible real aircraft, using their manufacturers' specifications and manuals. Record the variant, weight, atmosphere, configuration, and speed units behind every number.

**Don't:** combine a fighter's speed, a glider's efficiency, a transport's payload, and a trainer's runway performance without paying for the resulting design requirements.

### 2.2 Starting directions for the game

These are **recommended design directions**, not measured performance claims about the current assets:

| Pocket Flight aircraft | Design direction to substantiate | Questions the design must answer |
|---|---|---|
| Finch U–2 | Forgiving propeller trainer | Can it rotate, trim, approach, and recover from a stall with understandable controls? |
| Peregrine HX–27 | Fighter/transport hybrid | How do its body volume and mass affect wing loading, acceleration, fuel needs, and agility? |
| Aurelia S32 | Civilian executive jet | Do its cabin, rear engines, swept wings, gear, and stable handling fit a civilian mission? |
| Stormbird HX–40 | High-performance military aircraft | What provides its maneuverability, what constrains it, and what requires flight-control augmentation? |

The existing asset descriptions are in [How the aircraft were made](HOW_THE_AIRCRAFT_WERE_MADE.md). They document the modeling workflows; they do not establish aerodynamic validity.

## 3. The physics everything else depends on

### 3.1 Air-relative motion

For a world-space wind field:

```text
airRelativeVelocity = aircraftGroundVelocity - windVelocity
trueAirspeed = length(airRelativeVelocity)
```

The relative wind points opposite the aircraft's velocity through the air. Aerodynamic axes follow that relative flow; they are not necessarily aligned with body axes or world axes. [JSBSim reference frames][J02]

**Do:** include horizontal and vertical wind components. Distinguish airspeed from groundspeed in physics and the HUD.

**Don't:** create lift using the speed of the aircraft over the terrain. A uniform tailwind does not itself increase aerodynamic speed.

### 3.2 Lift is a force, not a height command

Pressure and shear over the aircraft produce aerodynamic forces. A lifting wing changes the airflow's momentum; pressure-based and momentum-based explanations describe the same physical interaction. Upper and lower surfaces both matter. Air passing over and under a wing does not have to meet again at the trailing edge. [NASA lift][N01], [Bernoulli and Newton][N02], [equal-transit misconception][N03]

```text
q = 0.5 × rho × V²
L = q × S × CL
D = q × S × CD
```

Here `q` is dynamic pressure, `rho` is air density, `V` is airspeed, `S` is the declared reference area, and `CL`/`CD` are dimensionless coefficients. Lift acts perpendicular to relative flow; drag opposes it. Coefficients depend on shape and operating condition. [NASA lift equation][N04], [drag equation][N05]

**Do:** evaluate gravity, thrust, aerodynamic forces, and their directions separately.

**Don't:** apply lift permanently along world-up, or move the airplane upward directly when the player pitches up.

### 3.3 Angle of attack is not pitch attitude

Angle of attack, `alpha`, is the angle between an airfoil's chord and the local relative airflow. Pitch attitude compares the aircraft to the horizon. A diving airplane can have positive angle of attack; a climbing airplane can have a low angle of attack. [NASA inclination effects][N16]

In a simple wings-level, negligible-sideslip case:

```text
wingAlpha ≈ pitchAttitude - airRelativeFlightPathAngle + wingIncidence
```

**Do:** use body-space airflow and the surface's own orientation for general banked and sideslipping flight.

**Don't:** rely on the simple two-angle subtraction as a general three-dimensional solution.

### 3.4 Forces also produce moments

```text
momentAboutCG = offsetFromCG × force
linearAcceleration = totalForce / mass
```

The cross product makes force location important. A force away from CG can pitch, roll, or yaw the aircraft. Full aircraft models represent three force axes and three moment axes, with contributions from multiple components. [JSBSim force and moment modeling][J01]

**Pocket Flight recommendation:** eventually represent angular velocity and inertia explicitly. A control input should change a surface or control-law command, which changes moments, which changes aircraft motion.

### 3.5 A climb needs energy

In simplified steady climbing flight with thrust along the flight path:

```text
T - D = W × sin(gamma)
L = W × cos(gamma)
```

`gamma` is climb angle. These are approximations for the stated alignment, not identities for every maneuver. A steady climb need not have lift greater than weight. [NASA climb forces][N14]

Stored mechanical energy is approximately `m × g × h + 0.5 × m × V²`. Excess power supplies a sustained climb; pitch can exchange speed and height. Simply pulling back cannot produce unlimited altitude at constant speed. [FAA energy management][F07]

## 4. Units, coordinates, and scale

### 4.1 Use a declared engineering convention

Recommended internal units:

| Quantity | Unit |
|---|---|
| Length, position | meters |
| Mass | kilograms |
| Force, weight | newtons |
| Moment | newton-meters |
| Velocity | meters per second |
| Angles for computation | radians |
| Angular velocity | radians per second |
| Area | square meters |
| Inertia | kilogram-square-meters |

Weight is a force: `W = mass × g`. A wing loading reported in `kg/m²` uses mass per area; `N/m²` uses weight per area. Convert explicitly before applying equations. [Virginia Tech sizing][U06]

For display, `1 knot = 0.514444… m/s`, `1 foot = 0.3048 m`, and `1 degree = pi/180 radians`. Label conversions at the boundary; never make a HUD number silently change the physics convention.

### 4.2 Pocket Flight asset conventions

The existing aircraft-workflow document specifies Blender **X across the wings, +Y forward, +Z up**, with exported aircraft using **+Y up and −Z forward**. The runtime forward vector in `src/flight/physics.ts` is `(0, 0, -1)`. Confirm each actual import and pivot rather than assuming every source uses one convention.

**Do:** document body, world, CAD, Blender, and export frames. Define the signs of pitch, roll, yaw, and control deflection.

**Don't:** copy an equation or inertia tensor from a flight-dynamics reference without converting its axis and sign conventions. JSBSim, for example, distinguishes aerodynamic, body, and structural frames. [JSBSim frames][J02], [mass balance][J03]

### 4.3 Scaling is a physics decision

If all lengths scale by `k`, area scales by `k²`. With geometrically similar construction and unchanged density, mass scales by `k³` and inertia by `k⁵`—dimensional relationships, not predictions for differently engineered aircraft.

**Do:** match runtime span, collision points, gear contact positions, propulsion locations, reference area, CG, and physics scale.

**Don't:** shrink a jet visually and keep its original performance data without documenting the intended scale model. Reynolds number changes with characteristic length; aerodynamic similarity does not follow from appearance alone. [NASA Reynolds number][N21]

## 5. Sizing wings and choosing their geometry

### 5.1 Required wing measurements

Record span `b`, reference area `S`, root and tip chords, taper ratio, mean aerodynamic chord, sweep with its reference line, dihedral, incidence, twist, and airfoil stations. Wing area is projected planform area, not the sum of the upper and lower skin areas. [NASA wing geometry][N07]

For a single straight-edged, symmetric trapezoidal planform:

```text
S = b × (rootChord + tipChord) / 2
taperRatio = tipChord / rootChord
AR = b² / S
MAC = (2/3) × rootChord × (1 + taperRatio + taperRatio²) / (1 + taperRatio)
```

These geometric expressions do not describe a cranked, curved, or multi-panel wing automatically. For complex wings, integrate station geometry and record the convention used for the fuselage-covered portion of the reference wing. OpenVSP explicitly separates wing geometry controls and projected-area analysis. [NASA OpenVSP wings][N27]

### 5.2 Size for the difficult mission conditions

Wing loading is `W/S`. For an approximate one-g stall at a stated weight, density, and configuration:

```text
Vstall ≈ sqrt(2 × W / (rho × S × CLmax))
Srequired ≈ 2 × W / (rho × VstallTarget² × CLmax)
```

These follow from the lift equation at the assumed maximum coefficient. They are initial estimates: whole-aircraft trim, contamination, control authority, and the actual stall definition still matter. [NASA lift equation][N04], [Virginia Tech sizing][U06]

**Do:** check takeoff, cruise, climb, approach, and maneuver requirements together.

**Don't:** choose `CLmax` merely to force a tiny wing to meet a desired stall speed. High-lift devices have mechanism, drag, mass, and packaging costs.

### 5.3 Aspect ratio

Longer wings can reduce induced drag at a given lift, area, and efficiency. However, increasing span affects bending loads, stiffness, structural mass, maneuver response, and airport compatibility. Flexible, high-aspect-ratio wings need aeroelastic analysis. [NASA induced drag][N06], [flexible-wing research][N25], [Boeing airport compatibility][C05]

**Do:** choose span and aspect ratio for the mission, then provide an explanation for structural support and control response.

**Don't:** make every airplane a glider. An efficient cruising wing is not automatically the best wing for high-speed maneuvering or tight ground operations.

### 5.4 Sweep, taper, dihedral, and incidence

| Feature | Useful purpose | Design obligation |
|---|---|---|
| Sweep | Manage high-speed flow and configuration layout | Check low-speed lift, stall progression, structure, and control. |
| Taper | Shape span loading and structural geometry | Check whether outboard sections stall before the root. |
| Dihedral/anhedral | Influence rolling moment in sideslip | Evaluate the complete lateral-directional response. |
| Incidence | Establish wing orientation relative to the fuselage | Keep cruise attitude, runway attitude, and wing airflow consistent. |
| Twist | Shape local loading and angle of attack | Preserve it in both mesh geometry and aerodynamic data. |

Sweep has costs as well as benefits. Forward sweep can create structural divergence issues; aft sweep can contribute to undesirable tip stall and pitch-up. These are configuration-dependent engineering problems, not universal prohibitions. [Virginia Tech configuration design][U07], [NASA X-29][N26]

Dihedral primarily changes response to sideslip; it is not a simple gravitational spring that pulls every banked aircraft level. Wing-fuselage interaction, sweep, vertical-tail forces, and flight dynamics all contribute. [Peet roll-stability lecture][U08]

**Do:** measure sweep at a declared chord fraction; verify twist station by station.

**Don't:** assume a high wing is a pendulum or choose anhedral purely because it looks military.

## 6. Airfoils and stall progression

### 6.1 An airfoil is more than a rounded front edge

Specify the section's camber, thickness distribution, leading-edge contour, trailing edge, and any changes along the span. Coordinate files define geometry; aerodynamic polars describe measured or computed behavior under particular conditions. UIUC provides separate coordinate and wind-tunnel-data resources. [UIUC coordinates][U05], [UIUC wind-tunnel data][U04]

**Do:** choose sections that suit the speed range and local Reynolds number. Preserve a plausible structure depth and room for control mechanisms.

**Don't:** claim an airfoil is validated because its name or coordinates appear in a database. A section polar is not automatically a complete aircraft polar.

### 6.2 Use actual operating conditions

```text
Re = rho × V × characteristicLength / dynamicViscosity
Mach = V / speedOfSound
```

Reynolds number describes the importance of viscous effects. Mach number describes compressibility. Airfoil data at model-airplane scale or a different Mach number may not represent a full-scale aircraft. [NASA Reynolds number][N21], [Mach number][N22]

XFOIL supports section analysis with transition and limited separation, but its documented failure modes include massive separation, inherently unsteady flow, poor resolution, and very low Reynolds numbers. It is not a substitute for validated deep-stall, three-dimensional, or transonic aircraft behavior. [XFOIL user guide][U02]

### 6.3 Stall is an airflow condition

Beyond a critical angle of attack, separation reduces lift capability and increases drag. A wing can stall in climbing, descending, banked, or accelerated flight. Stall warnings should represent the aircraft's approach to that condition rather than a single universal speed switch. [FAA upset/stall training][F08]

**Do:** store `CL(alpha)` and `CD(alpha)` behavior through the stall region. Represent loss of control effectiveness where appropriate, with documented warning cues.

**Don't:** increase lift linearly forever, erase all lift instantly, or assume every section stalls at the same angle. The actual curve depends on geometry and operating condition.

### 6.4 Stall progression matters

Root-first separation can preserve outboard control longer, but taper, local sections, Reynolds number, twist, flaps, fuselage interference, and leading-edge devices all affect progression. Even a rectangular wing is not guaranteed to have benign stall behavior in every combination of these variables. [NACA maximum-lift and wing-stall research][N29]

**Do:** for a forgiving trainer, aim for progressive, recoverable behavior and useful warning. Washout—lower geometric incidence toward the tip—is one possible design tool; validate the resulting loading and stall sequence.

**Don't:** use “root stalls first” as an unsupported label, or promise full aileron authority after the local flow has separated.

### 6.5 Tail stall and deep stall are distinct problems

A stalled wing's wake can reduce tail effectiveness. NASA's full-scale T-tail study found configuration- and CG-dependent high-angle-of-attack pitch-up and possible deep-stall trim with greatly reduced elevator control. It studied a particular unpowered executive-jet configuration, not all T-tails. [NASA T-tail investigation][N28]

**Do:** check high-angle-of-attack tail airflow when considering a high-mounted tail and aft engines.

**Don't:** assume a tail is safe merely because it is high, or make all T-tails enter an identical scripted deep stall.

### 6.6 A spin needs stalled, asymmetric flight

A spin involves stalled flight with autorotation; it is different from a steep, unstalled spiral descent. Uncoordinated motion and asymmetric wing behavior are therefore important to the model. Aircraft configuration and loading affect the response and recoverability. [FAA upset/stall training][F08]

**Do:** if spins are supported, model the relevant wing/control asymmetry and distinguish spin entry from spiral acceleration. Establish an aircraft-specific recovery model and test it.

**Don't:** turn every stall into a decorative corkscrew, use the same spin animation for every aircraft, or call an imposed sinusoidal roll a validated spin simulation.

## 7. Drag and efficiency

### 7.1 Keep the causes of drag distinct

- **Skin-friction and form drag:** affected by the boundary layer, surface condition, and shape.
- **Induced drag:** associated with finite-wing lift and its spanwise distribution.
- **Interference drag:** associated with interacting components and their junctions.
- **Wave drag:** significant in compressible, especially transonic and supersonic, flows.

The boundary layer and separation affect drag; visually smooth shading alone says nothing about the physical flow. [NASA boundary layers][N20], [what is drag][N30]

For a useful limited-range, attached-flow model:

```text
CD ≈ CD0 + CL² / (pi × AR × e)
```

The reference area must match across coefficients. This is not a general post-stall or supersonic model. An elliptical **loading distribution**, rather than an elliptical outline alone, is the classical planar-wing ideal under lifting-line assumptions. [NASA induced drag][N06]

**Do:** increase drag appropriately for exposed gear, flaps, spoilers, damage, and other configuration changes.

**Don't:** give every aircraft the same drag curve because all its models look streamlined.

### 7.2 Winglets are integrated aerodynamic components

Winglets can improve efficiency but add surface, loading, and structural obligations. Some tested designs improve drag; others produce little benefit or worsen it. Their performance belongs to the complete wing. [NASA winglets][N08], [Airbus wingtip devices][C04]

**Do:** justify the chosen tip geometry and preserve its orientation and transition into the wing.

**Don't:** award a universal efficiency bonus whenever a wingtip points upward.

### 7.3 High-speed aircraft need high-speed reasoning

Local flow can become supersonic before the aircraft's overall Mach number reaches one. Shock waves and their interaction with the boundary layer affect drag and separation. Supercritical sections and sweep help manage the design problem; they do not eliminate it. [NASA Mach number][N22], [supercritical-wing development][N24]

The area rule concerns the longitudinal distribution of the **combined aircraft cross-sectional area**, including contributing components, near the relevant speed regime. It is not a rule that every aircraft needs a pinched fuselage. [NASA area-rule history][N23]

**Do:** establish a plausible maximum Mach, cruise Mach, inlet strategy, tail/control effectiveness, and drag rise for a high-speed aircraft.

**Don't:** make pointed noses, thin wings, or afterburners automatically grant supersonic flight.

### 7.4 Glide efficiency

In a steady, still-air glide, a larger lift-to-drag ratio corresponds to a shallower descent angle. Best glide, minimum sink, and powered range/endurance optima are different conditions. Do not substitute one for another. [NASA lift-to-drag ratio][N09], [FAA aircraft performance][F05]

**Pocket Flight recommendation:** derive a distinct engine-out glide target for each aircraft. Losing thrust should expose the aircraft's aerodynamic efficiency, rather than turn it into a falling object with no wing forces.

## 8. Mass, center of gravity, and inertia

### 8.1 Build a mass budget

Track airframe, propulsion, landing gear, interior, avionics, equipment, payload, and fuel. The total and its distribution both matter. Aircraft loading must respect the model's chosen CG envelope across the mission. [FAA weight and balance][F04], [EAA weight-and-balance guidance][A01]

```text
totalMass = sum(componentMass)
CG = sum(componentMass × componentPosition) / totalMass
```

This works in three dimensions when each position is a vector in a common frame.

**Do:** calculate empty, full-fuel, low-fuel, light-payload, and heavy-payload cases.

**Don't:** use the geometric midpoint, mesh origin, or bounding-box center as a substitute for CG.

### 8.2 Position heavy components deliberately

Moving engines, fuel, passengers, cargo, or gear changes mass properties. Fuel consumption can change CG; even apparently symmetric loading can be too far forward or aft. [FAA weight and balance][F04]

**Do:** specify component masses and positions early enough to influence wing, tail, and gear layout.

**Don't:** move a heavy engine rearward for appearance and preserve the previous balance without recalculation.

### 8.3 Forward and aft CG have different consequences

A forward CG may demand more pitch-control authority for rotation and flare. An aft CG can reduce longitudinal stability and worsen control or stall behavior. Applicable limits depend on the airplane and configuration. [FAA weight and balance][F04]

**Do:** test both CG extremes, including low-speed full-flap and engine-out conditions where relevant.

**Don't:** use “more forward is always safer” or “aft CG means better handling” as a design rule.

### 8.4 Inertia controls how quickly the aircraft responds

Equal mass does not imply equal rotational response: mass far from the axis contributes more inertia. A flight model needs a declared inertia tensor and consistent frame/sign conventions. [JSBSim mass balance][J03]

**Pocket Flight recommendation:** distinguish a broad transport from a compact fighter through mass properties and control moments. Avoid changing only a maximum rotation-rate constant while leaving the structural layout unexplained.

## 9. Stability, trim, and tail design

### 9.1 Trim and stability are separate

Trim balances forces and moments at a selected flight condition. Stability describes how the aircraft responds after a disturbance. A model can be trimmed but unstable, or stable but badly trimmed. [NASA trimmed aircraft][N10], [Cornell stability notes][U01]

**Do:** define a target trimmed speed and configuration, then disturb the aircraft and examine the response.

**Don't:** force the airplane's nose toward a constant pitch and call that a physical trim model.

### 9.2 Longitudinal stability and static margin

For a common convention with longitudinal positions increasing aft:

```text
staticMargin = (neutralPoint - CG) / MAC
```

A positive margin indicates CG forward of the neutral point in the relevant linear, control-fixed model. Static longitudinal stability normally corresponds to a negative pitching-moment slope with angle of attack. The whole-aircraft neutral point is not the same as the wing's center of pressure. [Cornell stability and control][U01]

**Do:** choose a stability objective suitable for the aircraft role and state the model's limits.

**Don't:** mandate “CG at 25% chord” for every airplane or assume a fighter needs an undocumented unstable configuration.

### 9.3 Tail size, leverage, and airflow

Tail effectiveness depends on surface area, moment arm, local dynamic pressure, downwash, configuration, and control geometry. Tail volume coefficients are useful preliminary descriptors, not proof of acceptable handling. [Cornell stability notes][U01], [Virginia Tech design process][U09]

```text
horizontalTailVolume = horizontalTailArea × declaredTailArm / (wingArea × MAC)
verticalTailVolume = verticalTailArea × declaredTailArm / (wingArea × wingSpan)
```

**Do:** declare how the tail arm is measured; different references use different conventions. Check trim and authority rather than copying a coefficient without context.

**Don't:** shorten the fuselage and preserve a tiny tail solely because the proportions look cleaner.

### 9.4 A tail need not always push downward

A conventional aft tail often supplies downforce at a design condition, but trim force depends on the complete moment balance. A foreplane can carry positive lift and still impose demanding stability, interference, and control requirements. [NASA trim explanation][N10], [elevator/foreplane explanation][N11], [Virginia Tech canard comparisons][U10]

**Do:** state the tail or canard's role and stall/control behavior.

**Don't:** claim every canard is stall-proof, every aft tail produces downforce in every condition, or every flying wing can simply omit stability analysis.

### 9.5 Lateral-directional dynamics

Roll and yaw interact through sideslip and aerodynamic moments. Dynamic behavior includes short-period pitch motion, phugoid motion, Dutch roll, roll subsidence, and spiral behavior. Static stability alone cannot establish acceptable dynamics. EASA's normal-category specification separately addresses static stability and dynamic short-period/Dutch-roll stability; use that distinction as a design reference, not a claim of game-aircraft certification. [Peet aircraft-dynamics lecture][U08], [Cornell stability notes][U01], [EASA CS-23][E01]

**Do:** test disturbed roll/yaw response and distinguish natural damping from a yaw damper or artificial assistance.

**Don't:** force every aircraft back to wings-level at the same rate.

### 9.6 Flight-control augmentation

NASA's X-29 demonstrates that an intentionally unstable aircraft can rely on computerized control to fly. This is a documented engineering strategy, not evidence that instability is free performance. Manufacturer flight-control protections also depend on specific laws and operating conditions. [NASA X-29][N26], [Airbus protections overview][C03]

**Pocket Flight recommendation:** define beginner assists and aircraft augmentation separately. Set limits, actuator rates, and authority; identify what happens when the assist is disabled. Ordinary civilian aircraft should have a defensible underlying stability strategy.

## 10. Controls and high-lift systems

### 10.1 Correct control directions

For a conventional aircraft, viewed from behind toward the nose:

| Desired response | Conventional surface behavior | Check |
|---|---|---|
| Roll right | Right aileron up, left aileron down | Left/right lift difference creates the intended roll. |
| Pitch up | Aft elevator trailing edge up | Tail force change creates a nose-up moment. |
| Yaw right | Rudder trailing edge right | Tail force moves tail left and nose right. |
| Symmetric flap deployment | Flaps deploy with the mechanism's intended motion | Both wings change configuration consistently. |
| Right spoiler roll command | Right spoiler rises where fitted | Right-wing lift reduction produces right roll. |

Canards, elevons, stabilators, V-tails, differential tails, and thrust vectoring require their own mapping; the conventional table must not be copied blindly. [NASA ailerons][N12], [rudder][N13], [elevator][N11], [spoilers][N15]

### 10.2 Controls have limits and coupled effects

Aileron motion can cause adverse yaw. Differential and Frise-type ailerons are among the methods used to reduce it; rudder coordination also matters. Authority varies with airflow and configuration. [FAA flight controls][F03]

**Do:** specify each surface's hinge axis, limits, actuation rate, aerodynamic contribution, and mixing rules.

**Don't:** allow instant unlimited deflection, make tiny controls equally powerful at every speed, or use rudder as a universal flat-turn command. Banking redirects the lift vector to curve the flight path in a coordinated turn. [NASA banking turns][N17]

### 10.3 Flaps, slats, and spoilers are different devices

Flaps and slats can change camber, effective area, and usable lift. Flap deployment also changes drag and pitching moment. Spoilers disturb flow, reduce lift, and add drag. Ground spoilers can increase wheel loading and improve braking effectiveness after landing. [NASA flaps/slats][N14A], [spoilers][N15]

| Device | Modeling requirement |
|---|---|
| Plain flap | A genuine trailing-edge hinge and compatible surface motion. |
| Split flap | Movement of the lower trailing-edge surface. |
| Slotted flap | A purposeful gap and flow passage when deployed. |
| Fowler flap | Rearward travel plus deflection, supported by believable tracks/linkages. |
| Slat | Leading-edge travel with appropriate slot geometry. |
| Spoiler | Panel rises from the upper wing surface; it is not an upward flap. |

These flap types differ mechanically and aerodynamically. [FAA flight controls][F03]

**Do:** validate deployment symmetry, intermediate positions, control mixing, clearances, and aircraft-specific limits.

**Don't:** give Fowler motion to a simple hinge, deploy gear or flaps at every speed without consequence, or use the same coefficient increment for unrelated mechanisms.

## 11. Propulsion and engine installation

### 11.1 Match the engine to the mission

Propellers, turboprops, turbojets, and turbofans accelerate air in different ways and suit different mission requirements. A turbine-powered aircraft need not have an afterburner. Propeller thrust is mainly produced by the rotating blades, not the piston engine's exhaust. [NASA turbine propulsion][N18], [propeller propulsion][N19]

**Do:** record thrust or shaft power, installation, spool response, fuel use if simulated, and operating-condition dependence.

**Don't:** use “jet” as a single physical category with identical behavior for a civilian executive jet and a military afterburning aircraft.

### 11.2 Propellers are rotating wings

Blade section orientation changes along the radius because tangential speed increases outward. Blade twist, pitch, RPM, and airspeed affect loading and efficiency. [NASA propeller propulsion][N19]

**Do:** give blades actual airfoil shape and consistent handedness. Check the rotating disk against ground, fuselage, and gear clearances, including compressed suspension and aircraft rotation.

**Don't:** model perfectly flat untwisted paddles and describe them as realistic propellers, or reverse the rotation without checking blade pitch and intended thrust direction.

For constant-speed propellers, the governor adjusts blade pitch to maintain selected RPM over its operating range. Throttle, blade pitch, and RPM therefore need not move together. [FAA aircraft systems][F06]

### 11.3 Propeller power is not constant thrust

In a useful moving-flight approximation, `T × V ≈ efficiency × shaftPower`. This cannot be divided by `V` at zero speed to obtain infinite thrust. Static and low-speed behavior require a separate model or suitable propeller data. The general thrust equation accounts for airflow momentum and, where relevant, pressure terms. [NASA thrust equation][N20A]

**Pocket Flight recommendation:** use a bounded thrust/power map that depends on airspeed and RPM/pitch, with plausible engine response. Include torque, slipstream, and asymmetric effects at the fidelity appropriate to the game, rather than unexplained constant yaw.

### 11.4 Give jet engines real airflow paths

An engine inlet must deliver suitable air to the engine. Nonuniform inlet pressure or temperature can reduce performance and compressor stability margin; effects depend on the installation and condition. [NASA inlet-distortion investigations][N31]

**Do:** model a plausible intake lip, duct, compressor/fan position, nacelle, and nozzle. Check fuselage boundary-layer ingestion, upstream wakes, maneuver flow, and exhaust impingement when assessing the layout.

**Don't:** place a solid wall immediately behind a decorative intake or assume the engine keeps full thrust at every angle of attack and sideslip.

### 11.5 Engine location changes the aircraft

Engine/nacelle installation interacts with the surrounding airframe. NASA/Boeing testing of modified 727 nacelles examined stability and control as well as the geometry; results belonged to that tested configuration. [NASA/Boeing refan installation study][N32]

**Do:** account for engine mass, thrust-line offset, supporting structure, ground clearance, and local aerodynamic interference.

**Don't:** treat aft-mounted and underwing engines as interchangeable accessories.

For asymmetric thrust, use the actual surviving engine's force and lever arm to generate yaw. Relevant multiengine control limits and response must be aircraft-specific; two engines do not guarantee a climb after one fails. [FAA multiengine handbook][F13]

### 11.6 Exhaust appearance must explain the system

**Pocket Flight rules:** civilian turbofans should use plausible heat distortion and exhaust treatment. Afterburner flames require an explicitly afterburning installation. Tie visual intensity and spool response to engine state; distinguish nozzle/engine motion from world-space particles. These are project presentation requirements informed by the propulsion distinctions above, not new measured engine-performance claims.

## 12. Landing gear and ground handling

### 12.1 Gear is part of the initial configuration

Landing gear integration couples CG, load distribution, rotation, stability, structure, ground clearance, tire requirements, and stowage. Solving it after completing the fuselage and wings can force expensive layout changes. [Chai and Mason landing-gear study][N33]

**Do:** draw side/front/top views with CG limits, wheel contact points, propeller/engine clearances, and rotation envelope.

**Don't:** choose strut lengths or wheel count simply by aircraft size or visual taste.

### 12.2 Main-gear location must permit both support and rotation

For a simple static tricycle arrangement with stations increasing aft:

```text
Lnose = xCG - xNoseContact
Lmain = xMainContact - xCG
noseLoadFraction = Lmain / (Lnose + Lmain)
mainLoadFraction = Lnose / (Lnose + Lmain)
```

These follow from force and moment balance on a level surface, neglecting aerodynamic and dynamic loads. Check them at both CG extremes. They are not a universal required nose-wheel percentage.

**Do:** place mains so the aircraft can rotate with available control moment while retaining ground stability. Check braking, turning, aft loading, and loading/unloading states. [Landing-gear integration][N33]

**Don't:** push mains far aft to make the airplane stand up if that prevents realistic rotation.

### 12.3 Clearances require motion envelopes

Include tail strike during rotation/flare, nacelle and propeller ground clearance, wingtip clearance with roll, tire deformation, compressed suspension, uneven terrain, and the full gear/door travel envelope. Manufacturer airport-planning documents provide useful real-aircraft ground geometry; they are not flight-performance manuals. [Boeing aircraft characteristics][C05A], [landing-gear study][N33]

**Pocket Flight recommendation:** inspect the whole model through the expected attitude and suspension range. A single neutral pose does not prove ground clearance.

### 12.4 Retraction must be mechanically possible

**Project rules:**

- Reserve space for tires, struts, links, actuators, door hinges, and surrounding structure.
- Check open, retracting, stowed, extending, and locked-down states.
- Preserve fixed link lengths where a mechanism is intended to be rigid.
- Model intentional bogie/strut rotations; do not pass solid parts through the skin.
- Distinguish commanded state, actual travel, downlock, and damage state.
- Use the same gear state for visuals, contact physics, drag, and landing logic.

These checks are game-development applications of landing-gear integration and kinematic-clearance requirements. They do not assert that every real aircraft uses the same doors or sequence. [Landing-gear integration][N33]

### 12.5 Tires, brakes, and suspension

Landing loads include vertical and horizontal components. Suspension must absorb and damp contact motion. Braking depends on tire/runway interaction and wheel loading; water can substantially reduce braking and directional control. [FAA aircraft performance][F05], [NASA spoilers][N15]

**Do:** use sink/closing velocity and the contacting geometry when evaluating landings. Spin wheels from rolling motion and align nose steering with actual ground controls.

**Don't:** equate total forward speed with landing impact severity or give airborne wheels full runway braking force.

### 12.6 Tailwheel aircraft need their own behavior

Tailwheel configurations have different installation, steering, ground attitude, and handling requirements. They should not reuse tricycle gear logic without examining those differences. [EAA tailwheel installations][A02]

**Pocket Flight recommendation:** make tailwheel, rough-field, float, ski, and carrier gear separate supported configurations only when their contact, handling, and mechanism requirements are implemented. Changing wheel appearance is insufficient.

## 13. Structure, packaging, and cockpit

### 13.1 An aircraft needs load paths

Wing structure includes spars, ribs, and skin/stringer systems. Wing, engine, tail, and gear loads need plausible paths into the airframe. Cantilever wings and externally supported wings solve this differently. [FAA aircraft construction][F01]

**Do:** reserve a wing carry-through region, meaningful engine/gear mounting locations, and structure around major openings.

**Don't:** attach heavy engines to thin cosmetic tabs, carve a gear bay through the conceptual main spar without an alternative load path, or use the canopy as the only apparent wing attachment.

### 13.2 Thin wings have internal consequences

Wing thickness constrains structural depth, fuel volume, mechanisms, and gear stowage. Real transport wings also carry fuel and route control-system services; integrating these systems is part of wing design. [Airbus wing systems][C02]

**Do:** make a rough internal packaging drawing before surface detailing.

**Don't:** put full-sized tires, deep fuel tanks, and large actuators inside a visibly razor-thin section without a documented accommodation.

### 13.3 A pressurized cabin is a pressure vessel

Pressurization uses a sealed cabin and regulated airflow to maintain an appropriate pressure difference. It requires more than decorative windows. [FAA aircraft systems][F06]

**Project rules:** fit floors, seats, occupants, doors, glazing, and equipment inside the actual shell. Provide a plausible pressure-body shape and reinforcement around apertures when the aircraft is presented as pressurized. Do not let cabin floors or dashboards protrude through the skin.

### 13.4 Design for the pilot and passengers

**Project rules:** check pilot eye position, runway visibility, instrument readability, seat/control clearance, full yoke or stick travel, pedal space, canopy/door operation, and entry/exit. Use people or simple occupant volumes as a scale reference. Check cockpit and cabin from ordinary gameplay cameras, not only an external beauty view.

These are asset acceptance checks, not measurements of certified human-factors compliance. The existing Finch and Aurelia workflow documentation includes clearance issues that justify explicit inspection in this project.

### 13.5 Flexible wings need more than an animation

Flutter couples aerodynamic forces with structural elasticity and inertia. It can become a growing oscillation, with consequences very different from benign wing bending. [NASA aeroelastic research][N25], [NASA flutter explanation][N34]

**Do:** if wing flex is represented, tie it to loading and document whether it affects the aerodynamic model.

**Don't:** label arbitrary wing wobble as real structural simulation, or raise speed limits without considering the declared structural/flight envelope.

## 14. Performance and the flight envelope

### 14.1 Specify a condition, not just a number

Every performance claim should identify aircraft/configuration, weight, CG if relevant, altitude, temperature/density, wind, runway surface, and measurement method. Manufacturer data and observed performance only compare meaningfully under compatible conditions. [FAA performance-baseline guidance][F12]

**Do:** distinguish takeoff ground roll from total distance over an obstacle; distinguish landing ground roll from total approach/landing distance.

**Don't:** mix those distances or compare a light, cold-day game takeoff against a maximum-weight published example without adjustment.

### 14.2 Turns cost lift and energy

For steady, coordinated, level turns under the simplified assumptions:

```text
loadFactor = 1 / cos(bankAngle)
turnRate = g × tan(bankAngle) / V
turnRadius = V² / (g × tan(bankAngle))
acceleratedStallSpeed ≈ oneGStallSpeed × sqrt(loadFactor)
```

At 60° bank, the level-turn load factor is 2; the stall-speed multiplier is approximately 1.414 if other conditions are unchanged. These are level-turn relationships, not rules for every banked descent. [NASA banking turns][N17], [FAA aerodynamic/load-factor discussion][F02]

**Do:** require additional lift/AOA and energy to maintain altitude in a turn.

**Don't:** allow unlimited level turning at low speed, or assume a bank angle by itself implies a fixed load factor during an unconstrained maneuver.

### 14.3 Speed limits protect different things

Define appropriate limits for flaps, gear operation/extension, structural speed, Mach, maneuver loads, and engine operating conditions. A maneuvering-speed concept is not a promise that all combinations of control input or repeated load reversal are harmless. [FAA aerodynamics][F02], [jet transition handbook][F14]

**Project recommendation:** store the intended envelope on the aircraft data sheet and make exceeding it produce the specified aerodynamic, control, structural, or warning behavior. Do not invent universal real-world speed limits for fictional aircraft.

Distinguish **instantaneous** maneuver capability from **sustained** capability. An aircraft may briefly turn hard by spending stored speed/altitude, yet lack the excess power to sustain that turn. A higher thrust setting cannot erase the lift, drag, or structural requirements of the maneuver. [FAA energy management][F07], [Virginia Tech sizing][U06]

### 14.4 Takeoff and landing must fit the design

Rotation, acceleration, climb, configuration changes, flare, touchdown, and rollout are different phases. Low-speed lift, control authority, ground clearance, drag, and available thrust all matter. [FAA takeoffs and climbs][F09], [approaches and landings][F15]

**Do:** test rejected takeoff, normal takeoff, approach, go-around, and landing at more than one loading condition.

**Don't:** use a universal rotation speed or an automatic altitude jump when reaching a speed threshold.

### 14.5 Benchmark a real aircraft without misusing it

The manufacturer's current Skyhawk page lists approximately **11.00 m span, 16.17 m² wing area, 1,157 kg maximum takeoff weight, and 180 hp**. These provide a scale/performance sanity reference for a small piston aircraft, not Finch's specifications. Manufacturer performance entries also distinguish speed conventions such as KTAS and KCAS. [Textron Skyhawk][C01]

**Do:** use multiple compatible references and the exact manual/conditions when assigning performance targets.

**Don't:** make Finch a 172 clone by copying numbers into unrelated geometry, or treat a marketing specification as a complete aerodynamic dataset.

## 15. Weather and environmental effects

### 15.1 Density altitude

High density altitude means reduced air density and can degrade takeoff/climb performance. Altitude, temperature, and humidity influence density; propulsion effects depend on the engine and its controls. [FAA density-altitude guide][F16]

**Do:** make density affect dynamic pressure and propulsion consistently when environmental simulation is enabled.

**Don't:** increase an indicated stall-speed threshold simply because altitude increased while treating indicated and true airspeed as identical. At a similar weight/configuration, required true airspeed increases as density falls; instrument conversions need their own model. [FAA aircraft performance][F05]

### 15.2 Wind, gusts, and shear

Uniform wind primarily changes the ground track relative to the air-relative motion. Spatial or temporal wind changes can change the aircraft's local aerodynamic condition. Mountain waves, rotors, and terrain-related turbulence are physically organized phenomena, not just random screen shake. [NOAA mountain waves][W01], [NOAA flight environment][W02]

**Pocket Flight recommendation:** apply gusts through a wind field, then let the aircraft respond. A camera shake can communicate the result but should not replace it. Terrain-specific effects should follow the terrain/wind situation.

### 15.3 Icing and contamination

Ice can change lifting-surface shape, degrade lift and control, increase drag, and affect propeller performance. Tailplane icing can produce a different upset from a wing stall; recovery guidance is aircraft-specific. [FAA icing guide][F11]

**Do:** if icing is added, couple the visible accumulation to declared aerodynamic effects and system protection state.

**Don't:** present icing as only added weight or provide a universal recovery script for both wing and tailplane stalls.

### 15.4 Ground effect and wake

Ground proximity modifies the wing's flow and induced-drag behavior; an airplane may lift off or float near the surface without adequate performance to climb away. Wingtip vortices are also part of finite-wing flow, with strength tied to operating condition. [FAA ground-effect discussion][F02], [NASA induced drag][N06]

**Pocket Flight recommendation:** if modeled, use a height/span-dependent treatment with a stated validity range. Do not give the aircraft a constant upward boost near the runway, or show identical vortex effects regardless of loading and weather.

## 16. Modeling and animation rules

These are **Pocket Flight production rules**, derived from the physical functions above and the existing asset pipeline.

### 16.1 Build the correct big shapes first

Check top, side, front, rear, underside, and ordinary gameplay views. Establish wing/body/tail/engine proportions, actual thickness, gear stance, and cockpit/cabin volume before adding seams or decals. Glossy materials and dense detail cannot correct unsuitable geometry.

### 16.2 Keep fixed and moving parts separate

Use named nodes and local pivots for ailerons, elevators, rudder, flaps/slats, spoilers, fans/propellers, gear legs/wheels, doors, canopy, and required linkages. Preserve hinge axes through export, and check both signs of every control input.

**Do:** inspect the complete operating range, including intermediate positions.

**Don't:** put a pivot at the object's geometric center when the mechanism needs a hinge elsewhere, or merge all geometry so articulation becomes impossible.

### 16.3 Make the physics and animation share state

The displayed flap or gear position must correspond to the aerodynamic/contact configuration. A visual downlock should not coexist with physically retracted wheels. Engine-out, damage, and spool states must be consistent across movement, sound, effects, and instruments.

**Do:** record continuous animation state for replay and interpolation.

**Don't:** make propellers/fans jump or reverse because phase is recomputed inconsistently from sparse replay samples.

### 16.4 Match light functions

Conventional position lights distinguish red left, green right, and white rear from the pilot's viewpoint. Separate position, anticollision, landing, and taxi functions. [FAA night operations][F10]

**Project rule:** use plausible placement and timing; inspect visibility from relevant views. A bright decorative light does not replace correct orientation cues.

### 16.5 Validate the exported aircraft

- Confirm dimensions and axis conversion in the imported GLB.
- Inspect normals, thin trailing edges, glazing, internal openings, and visible seams.
- Verify all moving node names and animation tracks used by runtime code.
- Check gear and control travel after the actual loader's scale/offset transforms.
- Verify runtime wheels, collision/contact datums, engine effects, and lights against the visible asset.
- Inspect material/effect appearance in the browser; Blender appearance does not automatically transfer.
- Confirm aircraft-only export excludes studio-only objects.

Keep the editable source and a compact aircraft manifest. Triangle count, export success, or a good render establishes only the thing actually checked.

## 17. How these principles apply to Pocket Flight today

**Implementation update, 12 October 2026:** all four aircraft now use shared force and rigid-body rotation, measured main-wing references, geometry-derived attached lift, declared component mass/CG/inertia, estimated propulsion and fuel, and bounded physical actuators. The current source and verification record are in [Fleet dynamics validation](../validation/FLEET_DYNAMICS_VALIDATION.html). The September snapshot below records the earlier implementation and the gaps that motivated this work; its missing-mass and direct-attitude observations no longer describe the current runtime. Parameters without measured aircraft data remain explicit concept estimates.

**Source snapshot:** local code inspected 30 September 2026. The checkout contains other uncommitted development work. This documentation task does not change, approve, or runtime-validate that work.

`code-review-graph status` was attempted from the repository root, but the command was unavailable. The limited implementation observations below were checked directly against the source.

| File | Observed responsibility or behavior | Design implication |
|---|---|---|
| [`src/flight/flight-profiles.ts`](../../src/flight/flight-profiles.ts) | Profile constants for thrust, lift, drag, rates, and speed thresholds; Peregrine and Aurelia share the `jet` object. | Current profiles are tuning data, not measured aircraft engineering datasets. |
| [`src/flight/physics.ts`](../../src/flight/physics.ts) | Subtracts wind from velocity; computes speed-dependent lift/drag; controls directly influence attitude/rates and includes assistance. | Air-relative motion is present, but the model is not a full component-based six-degree-of-freedom aerodynamic simulation. |
| [`src/flight/physics.ts`](../../src/flight/physics.ts) | AOA approximation uses pitch minus air-relative path angle; stall combines a speed threshold with an absolute-AOA threshold. | This is an approximation, especially in banked/sideslipping flight; it does not encode aircraft-specific local stall progression. |
| [`src/flight/physics.ts`](../../src/flight/physics.ts) | Lift/thrust/drag variables feed acceleration directly; no explicit mass/inertia/CG model is defined in this class. | Do not label profile thrust as newtons or lift as `q × S × CL` without changing the data model. |
| [`src/flight/physics.ts`](../../src/flight/physics.ts) | Pitch and roll damping, coordinated-turn yaw, sideslip damping, and stall attitude corrections help guide the aircraft. | Document these as assistance/approximation. They are not evidence of natural aerodynamic stability. |
| [`src/flight/flight-profiles.ts`](../../src/flight/flight-profiles.ts) | Shared jet data includes a nonzero afterburner multiplier; Aurelia uses that shared profile. | A future civilian propulsion model should be distinguished from military afterburning propulsion even if its visuals differ today. |
| [`src/aircraft/aircraft.ts`](../../src/aircraft/aircraft.ts) | Runtime loader scales Aurelia by 0.55 and Peregrine by `JET_SCALE = 0.7`; Stormbird has a different center offset and no scale reduction in its branch. | Use actual loaded geometry for reference dimensions and datums; source-model dimensions alone are insufficient. |
| [`src/aircraft/landing-gear.ts`](../../src/aircraft/landing-gear.ts) | Physics imports aircraft-specific wheel data and contact-height logic. | Geometry changes must preserve or intentionally update the physical contact datums. |
| [`src/flight/game.ts`](../../src/flight/game.ts) | Advances physics at 60 Hz and interpolates visible poses. | Validate new behavior across rendering rates while retaining a consistent physics timestep. |

### 17.1 Recommended fidelity order

These are **future implementation recommendations**, not work implemented by this document:

1. **Aircraft manifest:** connect real runtime dimensions, reference area, mass, CG, inertia, propulsion, controls, and limits to an explicit design sheet.
2. **Airflow and angles:** use three-dimensional body/local surface airflow, with consistent conventions and low-speed safeguards.
3. **Force/moment model:** distinguish physical forces from acceleration coefficients; represent pitch/roll/yaw moments and damping.
4. **Distinct aircraft data:** separate trainer, civilian jet, hybrid, and high-performance military behavior using their missions and geometry.
5. **Configuration effects:** connect actual flap/gear/spoiler travel to aerodynamic and contact state.
6. **Stall and envelope:** use documented coefficient curves and limits, and validate warning, control loss, and recovery.
7. **Environment and systems:** add density effects, asymmetric engine failure, icing, and other features only with a clear model and validation conditions.

Begin with the simplest model that produces the required physical relationships. JSBSim demonstrates coefficient/function-based aircraft modeling; AVL supports useful rigid-aircraft trim and stability analysis; OpenVSP supports geometric definition and analysis. None proves a particular Pocket Flight aircraft valid merely by being available. [JSBSim modeling][J01], [AVL][U03], [OpenVSP][N27]

## 18. Repeatable aircraft-development workflow

### 18.1 The workflow

1. **Write the mission and reference sheet.** Select comparable real aircraft and source conditions.
2. **Set a first mass and loading budget.** Include fuel/payload variation and CG bounds.
3. **Estimate wing area and propulsion.** Check a feasible combination across takeoff, climb, cruise, and approach. [Virginia Tech initial sizing][U06]
4. **Lay out the whole aircraft.** Place people, structure, fuel, engines, wing, tail, and gear before detail.
5. **Check balance and moments.** Establish trim, stability strategy, control authority, and ground load distribution.
6. **Choose sections and mechanisms.** Record aerodynamic-data conditions and software limitations.
7. **Build the asset.** Preserve engineering datums and named articulation nodes.
8. **Inspect mechanical motion.** Check clearances at intermediate states and relevant attitudes.
9. **Export and reimport.** Measure the actual runtime representation.
10. **Tune against the sheet.** Record any assist or simplification explicitly.
11. **Run the flight-test matrix.** Compare results against acceptance targets, recording conditions.
12. **Save the evidence and revision.** A later change to mass, geometry, scale, or control mapping must reopen the affected checks.

### 18.2 Aircraft design-sheet template

```text
Aircraft name / ID / revision:
Mission and comparable real aircraft:
Sources and source conditions:

GEOMETRY
Runtime length / span / height:
Wing reference-area convention / area / aspect ratio:
Root chord / tip chord / MAC / MAC position:
Sweep reference / dihedral / incidence / twist stations:
Airfoil stations and coordinate source:
Horizontal and vertical tail geometry / declared arms:
Intake / nozzle / propeller dimensions and locations:

MASS AND BALANCE
Component mass budget / empty mass / fuel / payload:
CG by loading case / intended envelope:
Inertia tensor and frame convention:

AERODYNAMICS AND PROPULSION
CL / CD / moment data and validity range:
Reynolds / Mach / configuration conditions:
Stall behavior / warning / control effectiveness:
Thrust or shaft-power map / spool / fuel model:
Thrust-line locations / asymmetric failure behavior:

SYSTEMS AND MECHANISMS
Control surfaces / limits / rates / mixing:
Flaps / slats / spoilers and configuration effects:
Gear contacts / load fractions / strut travel / stowage:
Doors / canopy / lights / relevant interlocks:

ENVELOPE AND VALIDATION
Speeds and exact speed types / load limits:
Target takeoff / climb / cruise / glide / landing behavior:
Atmosphere / runway / wind / test loading:
Assists and intentional simplifications:
Source asset / runtime export / tests / observed results:
Unverified assumptions and next validation needed:
```

## 19. Acceptance checklist and flight-test matrix

These are recommended project gates. They must be adapted to the aircraft's implemented systems; a test requires defined expected behavior before it can pass.

### 19.1 Design and asset gates

- [ ] The mission, reference conditions, and intended fidelity are documented.
- [ ] Dimensions, area convention, mass, CG, and propulsion are coherent.
- [ ] The wing and tail have a defensible aerodynamic role.
- [ ] Pilot, cabin, fuel, mechanisms, and conceptual structure fit.
- [ ] Gear supports the aircraft and permits required rotation/roll clearance.
- [ ] Every mechanism clears its surroundings throughout travel.
- [ ] Control signs, pivots, limits, and mixing match the intended forces.
- [ ] Runtime dimensions, wheel datums, effects, and physics agree.
- [ ] Source provenance and assumptions accompany aerodynamic data.
- [ ] Simplifications and assists are identified explicitly.

### 19.2 Flight-test matrix

| Test | Conditions to vary | Observe / record |
|---|---|---|
| Taxi and brake | Loading, steering, surface, wind | Stability, contact, wheel motion, stopping behavior. |
| Takeoff | Weight, CG, density, wind, flap state | Ground roll, rotation, clearance, liftoff, obstacle/climb performance. |
| Trimmed cruise | Speed, altitude, loading | Control requirement, AOA, power, acceleration and vertical trend. |
| Pitch disturbance | Speed, CG, assist state | Return trend, overshoot, damping, sustained oscillation. |
| Roll/yaw disturbance | Sideslip, speed, assist state | Coupling, damping, Dutch-roll/spiral tendencies if modeled. |
| Coordinated turn | Bank, speed, power | Load factor, altitude, AOA, speed loss, turn rate/radius. |
| Slow flight and stall | Power, bank, flaps, CG | Warning, stall onset, rolloff, control change, recovery. |
| Glide / engine out | Weight, configuration, wind | Trim, speed, sink, glide path, remaining control. |
| Asymmetric engine failure | Relevant speed and engine state | Yaw/roll, rudder demand, achievable flight path. |
| Configuration change | Gear/flap/spoiler travel, speed | Pitch/drag effects, synchronization, limits, clearances. |
| Approach / flare / landing | Loading, wind, runway condition | Energy state, flare authority, contact sequence, sink, rollout. |
| Go-around | Approach configuration and loading | Thrust response, pitch/control demand, speed and climb. |
| Envelope boundaries | Declared speed/load limits | Warnings, authority/assist behavior, documented consequences. |
| Runtime/replay | Render rate, pause/resume, replay | Consistent physics, continuous mechanisms, reliable input and state. |

Record wind, density, mass, CG, configuration, assistance, and software revision with the results. Establish a repeatable baseline rather than approving a single favorable run. [FAA baseline-performance guidance][F12]

### 19.3 Evidence levels

- **Calculated:** equations or analysis predict the result under declared assumptions.
- **Mechanically inspected:** source/export geometry and articulation were checked.
- **Tested in code:** a specified automated check passed.
- **Observed in gameplay:** the actual browser aircraft was flown and the result recorded.

Do not substitute one evidence level for another. A build cannot establish a correct stall; a screenshot cannot establish a valid flight model.

## 20. Worked sizing example

This is an **invented trainer example**, not Finch's current data and not a validated real aircraft design.

Assume `mass = 900 kg`, `rho = 1.225 kg/m³`, `g = 9.81 m/s²`, target one-g stall `V = 22 m/s`, and assumed whole-aircraft/configuration `CLmax = 1.6`.

```text
W = 900 × 9.81 = 8,829 N
S = 2 × 8,829 / (1.225 × 22² × 1.6)
S ≈ 18.61 m²
```

Choose illustrative `AR = 7`:

```text
b = sqrt(AR × S) ≈ 11.41 m
average geometric chord = S / b ≈ 1.63 m
weight loading ≈ 474 N/m²
mass loading ≈ 48.4 kg/m²
```

The area follows from the lift equation; the span follows from the aspect-ratio definition. Neither proves the chosen airfoil, tail, gear, propulsion, or structure works. [NASA lift equation][N04], [wing geometry][N07]

With unchanged density/configuration and 20% additional mass, the estimated stall speed rises by `sqrt(1.2)` to about `24.10 m/s`. In an ideal steady 60° level turn, the original example's stall estimate becomes `22 × sqrt(2) ≈ 31.11 m/s`. [FAA aerodynamic relationships][F02]

**What this means for modeling:** a wing this large must appear at the intended runtime scale and fit the fuselage, structure, and controls. If the artist reduces its area substantially, the design sheet and tuning must be revised together. Increased engine power cannot independently recover the same unpowered one-g stall speed with unchanged wing lift capability.

## 21. Common myths and mistakes

| Mistake | Correct principle / action |
|---|---|
| “Air over the top must meet air under the bottom.” | Equal transit time is not a valid lift requirement. [N03] |
| “A wing must have a longer curved upper surface to make lift.” | Symmetric sections can lift at appropriate AOA. [N03] |
| “Pitch up means climb.” | Track energy and air-relative flight path. [F07] |
| “A stall is an engine failure.” | Wing airflow stall and loss of propulsion are different conditions. [F08], [N18] |
| “Below one speed, every aircraft always stalls.” | Critical AOA, loading, configuration, and maneuver state matter. [F08], [F02] |
| “A banked plane always experiences 1/cos(bank) g.” | That relationship assumes a steady coordinated level turn. [N17] |
| “A rudder works like a boat's steering.” | Model side force/yaw and coordinate banked turning. [N13], [N17] |
| “CG, center of pressure, and neutral point are the same.” | Separate mass location, resultant-force location, and stability reference. [F04], [U01] |
| “Every horizontal tail always pushes down.” | Solve the applicable trim balance. [N10] |
| “Any winglet increases range.” | Assess the integrated wing and added costs. [N08] |
| “The most swept wing is the fastest/best wing.” | Evaluate speed-regime benefits against low-speed, structural, and control costs. [U07] |
| “All canards and all T-tails behave alike.” | Analyze the actual loading, interference, and high-AOA control. [U10], [N28] |
| “A full-sized mesh has full-sized physics.” | Declare the runtime scale and engineering data separately. [N21] |
| “A successful CAD export proves the aircraft can fly.” | Geometry validation and aerodynamic/handling validation are separate project gates. |
| “More polygons mean a more realistic aircraft.” | Prioritize geometry, mechanism, state, and behavior correctness. |
| “A fixed self-leveling rate proves stability.” | Separate assists from the aerodynamic response. [U08] |

## 22. Glossary

| Term | Meaning in this guide |
|---|---|
| AOA / alpha | Angle between a surface chord and its local relative airflow. |
| Sideslip / beta | Lateral misalignment between aircraft orientation and airflow, with sign/frame declared. |
| Incidence | Fixed mounting angle relative to the chosen aircraft reference. |
| Washout | Decreasing geometric incidence toward the wingtip. |
| Chord | Distance from leading to trailing edge in the defined section. |
| MAC | Mean aerodynamic chord; reference length/location used in aerodynamic and balance work. |
| Planform | Wing shape viewed in the reference projection. |
| Aspect ratio | Span squared divided by reference wing area. |
| Dynamic pressure | `0.5 × rho × V²`. |
| CL / CD / Cm | Lift, drag, and pitching-moment coefficients with declared reference quantities. |
| CG | Center of gravity; coincides with center of mass for the usual local uniform-gravity model. |
| Neutral point | CG location giving neutral pitch stability in the specified model. |
| Static margin | Neutral-point/CG separation normalized by MAC, with convention stated. |
| Trim | Balanced force/moment state at a specified flight condition. |
| Static stability | Initial tendency after a disturbance. |
| Dynamic stability | Time evolution of the disturbed motion. |
| TAS | True speed through the surrounding air. |
| IAS / CAS / EAS | Indicated, calibrated, and equivalent airspeed; they require distinct definitions/conversions. |
| Groundspeed | Speed relative to the ground. |
| Load factor | Aerodynamic support/loading relative to aircraft weight under the stated convention. |
| Reynolds / Mach | Viscous-flow and compressibility similarity parameters. |
| Deep stall | A high-AOA condition with seriously compromised recovery control in susceptible configurations. |
| Flutter | Coupled aerodynamic/elastic/inertial oscillation that can grow with speed/condition. |
| Flight envelope | Declared operating region of speed, load, altitude, configuration, and other limits. |

For deeper definitions and sign conventions, consult the linked NASA, FAA, Cornell, and JSBSim references rather than treating this short glossary as a complete flight-dynamics specification.

## 23. Research method, limitations, and source library

### 23.1 What was researched

Research used **web browsing, Exa, and Parallel Search**, followed by reading original agency, university, manufacturer, builder-organization, and simulator documentation. Exa ran three discovery searches requesting ten results each across sizing/configuration, landing gear, and propulsion installation. Parallel Search ran three related-query batches and targeted extracts, including a follow-up that replaced an obsolete Boeing PDF URL with revision K. Those search results are discovery candidates, not thirty distinct validated references.

The source library below contains **76 distinct linked source URLs**. Related pages from the same organization are **sources**, not separate organizations. Large handbooks/reports were consulted for relevant sections; this is not a claim that every page of every publication was read. FAA PHAK chapters exceeding the browser's size limit were fetched from their official URLs and text-extracted locally. Some sources were available through indexed excerpts or targeted extracts where a full-page fetch failed.

Original principles are paraphrased and linked rather than copied wholesale. Project-specific checklists, production rules, and implementation priorities are explicitly recommendations. Long-standing research remains useful for underlying physics; its test findings must stay attached to the studied configuration. Historical reports are not assertions of current regulatory requirements.

### 23.2 How to resolve disagreement

1. Use the exact aircraft's approved flight/operating data for claims about that aircraft.
2. Use original experiments for the tested condition; do not universalize their percentages or angles.
3. Distinguish introductory simplifications from whole-aircraft engineering analysis.
4. Compare reference area, axes, speed type, weight, density, Reynolds number, Mach, and configuration.
5. Label unresolved values as assumptions and define a test or analysis that would resolve them.

Examples: an elliptical planform is not a guarantee of elliptical loading; a high tail can have clean airflow in one condition and problematic wake exposure in another; a canard can offer useful trim behavior while imposing difficult stability and interference constraints.

### 23.3 Sources

**FAA and EASA — foundational flight behavior, construction, systems, and operational context**

| ID | Original source | Used for |
|---|---|---|
| F01 | [PHAK chapter 3: Aircraft Construction][F01] | Wing/fuselage construction and load-path reasoning. |
| F02 | [PHAK chapter 5: Aerodynamics of Flight][F02] | Load factor, stall relationships, ground effect. |
| F03 | [PHAK chapter 6: Flight Controls][F03] | Adverse yaw, flap types, control mechanisms. |
| F04 | [PHAK chapter 10: Weight and Balance][F04] | Loading, CG envelope and consequences. |
| F05 | [PHAK chapter 11: Aircraft Performance][F05] | Atmosphere, glide/performance, runway conditions. |
| F06 | [PHAK chapter 7: Aircraft Systems][F06] | Propeller governor and pressurization. |
| F07 | [Airplane Flying Handbook chapter 4: Energy Management][F07] | Energy and coordinated pitch/power behavior. |
| F08 | [AFH chapter 5: Upset Prevention and Recovery][F08] | AOA, stall warning and control. |
| F09 | [AFH chapter 6: Takeoffs and Departure Climbs][F09] | Takeoff phases and configuration. |
| F10 | [AFH chapter 11: Night Operations][F10] | Aircraft position-light convention. |
| F11 | [AC 91-74B: Flight in Icing Conditions][F11] | Icing and aircraft-specific wing/tail effects. |
| F12 | [Aircraft Performance & Calculations][F12] | Repeatable performance baselines and test conditions. |
| F13 | [AFH chapter 13: Multiengine Airplanes][F13] | Engine-out controllability and performance. |
| F14 | [AFH chapter 16: Jet-Powered Airplanes][F14] | Jet operation and speed-envelope distinctions. |
| F15 | [AFH chapter 9: Approaches and Landings][F15] | Landing and approach-phase distinctions. |
| F16 | [FAASafety.gov: Density Altitude][F16] | Density-altitude causes and performance effects. |
| E01 | [EASA CS-23 amendment 6, AMC/GM issue 5][E01] | Cross-check of stability, control, and icing principles; game reference only. |

**NASA and NACA — aerodynamics, propulsion, experiments, and engineering tools**

| ID | Original source | Used for |
|---|---|---|
| N01 | [What Is Lift?][N01] | Relative flow and force direction. |
| N02 | [Bernoulli and Newton][N02] | Compatible lift explanations. |
| N03 | [Equal Transit Theory][N03] | Rejecting a common lift misconception. |
| N04 | [Lift Equation][N04] | Dynamic pressure and sizing relationships. |
| N05 | [Drag Equation][N05] | Coefficients and reference-area consistency. |
| N06 | [Induced Drag Coefficient][N06] | Aspect ratio, loading, induced drag. |
| N07 | [Wing Geometry Definitions][N07] | Span, chord, planform and reference area. |
| N08 | [Winglets][N08] | Benefits, integration, and counterexamples. |
| N09 | [Lift-to-Drag Ratio][N09] | Efficiency and glide angle. |
| N10 | [Trimmed Aircraft][N10] | Tail/wing moment balance. |
| N11 | [Aircraft Elevator][N11] | Pitch force/moment and foreplane context. |
| N12 | [Ailerons][N12] | Roll-control direction and force. |
| N13 | [Rudder][N13] | Side force, yaw, and coordination. |
| N14 | [Forces in a Climb][N14] | Flight-path force balance. |
| N14A | [Flaps and Slats][N14A] | Configuration lift/drag and mechanisms. |
| N15 | [Spoilers][N15] | Lift reduction, drag, roll and braking. |
| N16 | [Inclination Effects / Fluid Dynamics Interactive][N16] | AOA geometry and behavior. |
| N17 | [Banking Turns][N17] | Banked lift and curved flight path. |
| N18 | [Gas Turbine Propulsion][N18] | Engine categories and missions. |
| N19 | [Propeller Propulsion][N19] | Rotating airfoils, twist, and propulsion. |
| N20 | [Boundary Layer][N20] | Viscous flow and separation context. |
| N20A | [Thrust Equation][N20A] | Momentum, pressure, and propulsion models. |
| N21 | [Reynolds Number][N21] | Scale and viscous similarity. |
| N22 | [Mach Number][N22] | Compressibility and speed regimes. |
| N23 | [The Whitcomb Area Rule][N23] | Combined-area distribution and historical evidence. |
| N24 | [Modern Supercritical Wing Development][N24] | High-speed flow and airfoil tradeoffs. |
| N25 | [NASA/Boeing Flexible-Wing Research][N25] | High aspect ratio, gust loads, aeroelasticity. |
| N26 | [X-29 Demonstrator][N26] | Forward sweep and active control of instability. |
| N27 | [OpenVSP Wings][N27] | Parametric geometry and analysis conventions. |
| N28 | [Full-scale T-tail wind-tunnel investigation][N28] | Configuration-specific deep-stall evidence. |
| N29 | [Maximum-Lift and Stalling Characteristics of Wings][N29] | Taper, sections, interference, Reynolds/Mach and stall progression. |
| N30 | [What Is Drag?][N30] | Skin friction, form and wave drag. |
| N31 | [Engine Response to Distorted Inlet Conditions][N31] | Installation airflow and compressor stability. |
| N32 | [NASA/Boeing 727 Refan Nacelle Tests][N32] | Engine-installation effects on stability/control. |
| N33 | [Landing Gear Integration in Aircraft Conceptual Design][N33] | Ground geometry, loads, layout, stowage. |
| N34 | [NASA Aeronautical Flight Research: Flutter][N34] | Aeroelastic/inertial interaction and flutter clearance. |

**Universities and flight-model documentation**

| ID | Original source | Used for |
|---|---|---|
| U01 | [Cornell: Aircraft Stability and Control][U01] | Neutral point, trim, derivatives, dynamics. |
| U02 | [Drela/Youngren: XFOIL User Guide][U02] | Section analysis and validity limits. |
| U03 | [Drela/Youngren: AVL][U03] | Trim, mass properties, linearized dynamics. |
| U04 | [UIUC Wind-Tunnel Data][U04] | Measured airfoil data and provenance. |
| U05 | [UIUC Airfoil Coordinates Database][U05] | Geometry source separate from aerodynamic evidence. |
| U06 | [Virginia Tech: Initial Sizing][U06] | Wing/thrust loading and mission constraints. |
| U07 | [Virginia Tech: Configuration Aerodynamic Design][U07] | Mission-led integrated layout and tradeoffs. |
| U08 | [Peet: Roll Control and Review][U08] | Sideslip coupling, roll/yaw, six-degree-of-freedom context. |
| U09 | [Virginia Tech: Purpose and Process][U09] | Tail sizing, configuration, subsystem integration. |
| U10 | [Virginia Tech: Canard Comparisons][U10] | Mission-dependent canard benefits and costs. |
| J01 | [JSBSim: Forces and Moments][J01] | Coefficient/function-based simulation structure. |
| J02 | [JSBSim: Frames of Reference][J02] | Air-relative and aerodynamic/body frames. |
| J03 | [JSBSim: Mass Balance][J03] | Component masses, inertia and frame convention. |

**Manufacturers, builders, and weather agencies**

| ID | Original source | Used for |
|---|---|---|
| C01 | [Textron Aviation: Cessna Skyhawk][C01] | Real piston-aircraft dimensional/performance reference. |
| C02 | [Airbus: The Wonder of Wings][C02] | Wing fuel, systems, structure and anti-ice context. |
| C03 | [Airbus: Flight Control Protections][C03] | Distinguishing aircraft control laws from generic assists. |
| C04 | [Airbus: Wingtip Devices][C04] | Manufacturer perspective on integrated winglets. |
| C05 | [Boeing: 747-8 Airport Compatibility][C05] | Span and ground-operation constraints. |
| C05A | [Boeing: 737 MAX Airport Planning][C05A] | Ground dimensions, gear/steering and clearances. |
| A01 | [EAA: Weight and Balance][A01] | Builder loading and CG context. |
| A02 | [EAA: Tail Wheel Installations][A02] | Tailwheel installation/handling distinction. |
| W01 | [NOAA/NWS: Mountain Waves][W01] | Terrain, airflow and turbulence conditions. |
| W02 | [NOAA/NWS: Flight Environment][W02] | Wind/shear, rotors and terrain-related flow. |

### 23.4 Remaining aircraft-specific research

Before claiming realistic performance for any Pocket Flight aircraft, obtain or explicitly estimate its component mass budget, runtime wing measurements, valid coefficient curves, trim/CG envelope, propulsion map, and control/gear limits. Wind-tunnel or flight-test data for a superficially similar aircraft is useful context, not validation of our original design.

Future expansions should add substantiated sections on specific airfoils, aircraft-class benchmarks, spinning/post-stall dynamics, seaplanes, carrier aircraft, detailed propulsion maps, and aeroelastic models when those features become part of the game's intended scope.

[F01]: https://www.faa.gov/sites/faa.gov/files/05_phak_ch3_0.pdf
[F02]: https://www.faa.gov/sites/faa.gov/files/07_phak_ch5_0.pdf
[F03]: https://www.faa.gov/sites/faa.gov/files/08_phak_ch6.pdf
[F04]: https://www.faa.gov/sites/faa.gov/files/12_phak_ch10.pdf
[F05]: https://www.faa.gov/sites/faa.gov/files/13_phak_ch11.pdf
[F06]: https://www.faa.gov/sites/faa.gov/files/09_phak_ch7.pdf
[F07]: https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/05_afh_ch4.pdf
[F08]: https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/06_afh_ch5.pdf
[F09]: https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/07_afh_ch6.pdf
[F10]: https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/12_afh_ch11.pdf
[F11]: https://www.faa.gov/documentlibrary/media/advisory_circular/ac_91-74b.pdf
[F12]: https://www.faa.gov/sites/faa.gov/files/2022-01/Aircraft%20Performance%20&%20Calculations.pdf
[F13]: https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/14_afh_ch13.pdf
[F14]: https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/17_afh_ch16.pdf
[F15]: https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/10_afh_ch9.pdf
[F16]: https://www.faasafety.gov/files/gslac/library/documents/2011/Aug/56396/FAA%20P-8740-02%20DensityAltitude%5Bhi-res%5D%20branded.pdf
[E01]: https://www.easa.europa.eu/en/downloads/143486/en
[N01]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/what-is-lift/
[N02]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/bernoulli-and-newton/
[N03]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/foilw1/
[N04]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/lift-equation/
[N05]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/
[N06]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/induced-drag-coefficient/
[N07]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/wing-geometry-interactive/
[N08]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/winglets/
[N09]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/lift-to-drag-ratio/
[N10]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/trimmed-aircraft/
[N11]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/aircraft-elevator-interactive/
[N12]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/ailerons/
[N13]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/rudder-interactive/
[N14]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/forces-in-a-climb/
[N14A]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/flaps-and-slats/
[N15]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/spoilers-interactive/
[N16]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/foilinc/
[N17]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/banking-turns/
[N18]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/turbine-engines/
[N19]: https://www.grc.nasa.gov/www/k-12/airplane/propeller.html
[N20]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/boundary-layer/
[N20A]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/thrust-force/
[N21]: https://www.grc.nasa.gov/WWW/K-12/airplane/reynolds.html
[N22]: https://www.grc.nasa.gov/www/k-12/airplane/mach.html
[N23]: https://www.nasa.gov/history/SP-4219/Chapter5.html
[N24]: https://www.nasa.gov/aeronautics/how-a-nasa-engineer-created-the-modern-airplane-wing/
[N25]: https://www.nasa.gov/aeronautics/nasa-boeing-test-aircraft-wings/
[N26]: https://www.nasa.gov/aeronautics/nasa-aircraft/x-29-demonstrator/
[N27]: https://www.nasa.gov/reference/openvsp-wings/
[N28]: https://ntrs.nasa.gov/api/citations/19720002382/downloads/19720002382.pdf?attachment=true
[N29]: https://ntrs.nasa.gov/api/citations/19790079949/downloads/19790079949.pdf
[N30]: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/what-is-drag/
[N31]: https://ntrs.nasa.gov/api/citations/19860016864/downloads/19860016864.pdf
[N32]: https://ntrs.nasa.gov/api/citations/19740003695/downloads/19740003695.pdf
[N33]: https://ntrs.nasa.gov/api/citations/19970031272/downloads/19970031272.pdf
[N34]: https://www.nasa.gov/wp-content/uploads/2023/04/sp-4529.pdf
[U01]: https://courses.cit.cornell.edu/mae5070/Caughey_2011_04.pdf
[U02]: https://web.mit.edu/drela/Public/web/xfoil/xfoil_doc.txt
[U03]: https://web.mit.edu/drela/Public/web/avl/
[U04]: https://m-selig.ae.illinois.edu/pd.html
[U05]: https://m-selig.ae.illinois.edu/ads/coord_database.html
[U06]: https://www.aoe.vt.edu/content/dam/aoe_vt_edu/people/faculty/praj/avd-fundamentals/A5%20-%20Initial%20Sizing%20-%20Wing%20Loading%20and%20Thrust%20Loading%20Estimation.pdf
[U07]: https://pressbooks.lib.vt.edu/configurationaerodynamics/chapter/configuration-aerodynamic-design/
[U08]: https://control.asu.edu/Classes/MMAE441/Aircraft/441Lecture8.pdf
[U09]: https://www.aoe.vt.edu/content/dam/aoe_vt_edu/people/faculty/praj/avd-fundamentals/A1%20-%20Purpose%20and%20Process.pdf
[U10]: https://archive.aoe.vt.edu/mason/Mason_f/canardsS03.pdf
[J01]: https://jsbsim-team.github.io/jsbsim-reference-manual/user/concepts/forces-and-moments/
[J02]: https://jsbsim-team.github.io/jsbsim-reference-manual/user/concepts/frames-of-reference/
[J03]: https://jsbsim-team.github.io/jsbsim/classJSBSim_1_1FGMassBalance.html
[C01]: https://cessna.txtav.com/en/piston/cessna-skyhawk
[C02]: https://www.airbus.com/en/newsroom/stories/2023-06-the-wonder-of-wings
[C03]: https://flightsafety.airbus.com/2022/01/28/autopilot-and-flight-control-protections/
[C04]: https://www.airbus.com/en/newsroom/news/2017-02-winglets-a-tip-top-solution-for-more-efficient-aircraft
[C05]: https://www.boeing.com/commercial/airports/7478-airport-comp
[C05A]: https://www.boeing.com/content/dam/boeing/v2/airports/acaps/737MAX_RevK.pdf
[A01]: https://www.eaa.org/eaa/aircraft-building/builderresources/while-youre-building/building-articles/weight-and-balance/weight-and-balance
[A02]: https://www.eaa.org/eaa/aircraft-building/builderresources/while-youre-building/building-articles/landing-gear-wheels-and-brakes/tail-wheel-installations
[W01]: https://www.weather.gov/mrx/mountainwaves
[W02]: https://www.weather.gov/source/zhu/ZHU_Training_Page/winds/Wx_Terms/Flight_Environment.htm
