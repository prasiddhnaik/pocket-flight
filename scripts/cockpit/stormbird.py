"""Stormbird HX-40 detail cockpit: tandem seats, two large displays and a side stick.

A fictional aircraft, so the arrangement is a design choice and follows no technical order.
"""
import re

from layout import *  # noqa: F401,F403
from layout import SCALES as STANDARD

ID = "stormbird"
MODEL = "public/assets/stormbird-hx40.gltf"
SCALE = 1.0
SILL = 2.57
FLOOR = 1.63
CONSOLE_TOP = 1.95
EYE = (0.0, 5.28, 2.78)
FRONT_PANEL = (0.0, 5.9, 2.26)
REAR_PANEL = (0.0, 4.33, 2.26)
FRONT_CONSOLE = (0.0, 5.3, CONSOLE_TOP)
REAR_CONSOLE = (0.0, 3.72, CONSOLE_TOP)
PANEL_TILT = 14.0
SCALES = {
    **STANDARD,
    "fuel": needle(sweep(0, 8000, 2000, -140, 140), major=[0, 2000, 4000, 6000, 8000], minor=[1000, 3000, 5000, 7000], labels={0: '0', 2000: '2', 4000: '4', 6000: '6', 8000: '8'}, title="FUEL QTY", sub="LBS X 1000"),
}
PANEL_PAINT = (84, 92, 100)
MATERIALS = {
    "paint": ((72, 80, 88), 0.0, 0.58, {}),
    "paint_dark": ((42, 47, 52), 0.0, 0.66, {}),
    "cover": ((48, 53, 58), 0.0, 0.8, {}),
    "fabric": ((70, 78, 70), 0.0, 0.92, {}),
    "cushion": ((54, 60, 54), 0.0, 0.88, {}),
    "chute": ((60, 68, 62), 0.0, 0.9, {}),
}
SURFACES = {
    "main": dict(scale=1500, x0=-0.42, x1=0.42, y0=-0.31, y1=0.32, left=0, top=0),
    "left": dict(scale=700, x0=-0.52, x1=-0.19, y0=-0.62, y1=0.62, left=1270, top=0),
    "right": dict(scale=700, x0=0.19, x1=0.52, y0=-0.62, y1=0.62, left=1510, top=0),
}
BINS = [dict(x0=0, x1=1262, x=0, y=960, row=0), dict(x0=1270, x1=2048, x=1270, y=880, row=0)]
FRAMES = {
    "main": ("panel", FRONT_PANEL, PANEL_TILT),
    "left": ("flat", FRONT_CONSOLE),
    "right": ("flat", FRONT_CONSOLE),
    "main@rear": ("panel", REAR_PANEL, PANEL_TILT),
    "left@rear": ("flat", REAR_CONSOLE),
    "right@rear": ("flat", REAR_CONSOLE),
}
# The old cockpit is baked into the airframe meshes here, so it can only be cut out.
CARVE = dict(min=(-0.52, 1.55, -6.25), max=(0.52, 2.96, -2.98), keep=re.compile(r"canopy|actuator", re.I))

PANEL_OUTLINE = [(-0.41, 0.31), (0.41, 0.31), (0.41, -0.235), (0.22, -0.235), (0.22, -0.165), (0.125, -0.165), (0.125, -0.3), (-0.125, -0.3), (-0.125, -0.165), (-0.22, -0.165), (-0.22, -0.235), (-0.41, -0.235)]
MFD_SIZE, MFD_BEZEL = 0.235, 0.29
MFD_LEFT, MFD_RIGHT = (-0.19, 0.095), (0.19, 0.095)
STANDBY_ADI = dict(x=0.0, y=-0.105, r=0.036)
CLOCK = dict(x=0.17, y=-0.105, r=0.028)
UFC = (0.0, 0.263, 0.2, 0.04)
GAUGES = [
    ("standby_airspeed", "airspeed", -0.092, -0.105, 0.03, "main"),
    ("standby_altimeter", "altimeter", 0.092, -0.105, 0.03, "main"),
    ("rpm_left", "rpm", -0.33, -0.105, 0.024, "main"),
    ("rpm_right", "rpm", -0.28, -0.105, 0.024, "main"),
    ("ftit_left", "ftit", -0.23, -0.105, 0.024, "main"),
    ("ftit_right", "ftit", -0.18, -0.105, 0.024, "main"),
    ("fuel", "fuel", 0.24, -0.105, 0.03, "main"),
    ("aoa", "aoa", 0.31, -0.105, 0.03, "main"),
    ("vvi", "vvi", 0.37, -0.105, 0.0245, "main"),
]
CAUTIONS = ["ENG|FIRE", "APU|FIRE", "L OIL|LOW", "R OIL|LOW", "L GEN|OUT", "R GEN|OUT", "BLEED|AIR", "ECS|HOT", "HYD|LOW", "FUEL|LOW", "CADC|FAIL", "OXY|LOW"]
PLATES = [
    plate("ufc", "main", -0.17, 0.242, 0.17, 0.31, legends=[L("UP FRONT", -0.158, 0.25, 0.0032, "l")]),
    plate("armament", "main", -0.405, -0.052, -0.34, 0.31, legends=[L("FIRE", -0.3725, 0.296, 0.0052), L("L", -0.388, 0.248), L("R", -0.357, 0.248), L("MASTER", -0.3725, 0.164, 0.0042), L("CAUTION", -0.3725, 0.156, 0.0042), L("ARM", -0.3725, 0.065, 0.005), L("JETT", -0.3725, -0.008, 0.0046)],
          controls=[lamp(-0.388, 0.27, "red", r=0.0115, node="Lamp_fire_left"), lamp(-0.357, 0.27, "red", r=0.0115, node="Lamp_fire_right"), guarded(-0.3725, 0.22), button(-0.3725, 0.19, face="MASTER|CAUTION", w=0.05, h=0.036, node="Lamp_master", colour="amberbutton"), guarded(-0.3725, 0.09), rotary(-0.3725, 0.035, r=0.012), pull(-0.3725, -0.03)]),
    annunciators("caution", "main", 0.34, -0.052, 0.405, 0.31, "CAUTION", CAUTIONS, columns=2),
    plate("spine", "main", -0.041, -0.052, 0.041, 0.246, legends=[L("HDG", 0.0, 0.228, 0.0044), L("ALT", 0.0, 0.18, 0.0044), L("SPD", 0.0, 0.132, 0.0044), L("BRT", 0.0, 0.05, 0.0044), L("CONT", 0.0, -0.01, 0.0042)],
          controls=[button(0.0, 0.21, face="SET", w=0.05, h=0.018), button(0.0, 0.162, face="SET", w=0.05, h=0.018), button(0.0, 0.114, face="SET", w=0.05, h=0.018), knob(0.0, 0.07, r=0.0105), knob(0.0, 0.012, r=0.0105), lamp(0.0, -0.035, "green", r=0.005)]),
    plate("gear", "main", -0.405, -0.232, -0.225, -0.165, legends=[L("NOSE", -0.255, -0.174, 0.0036), L("LEFT", -0.255, -0.197, 0.0036), L("RIGHT", -0.255, -0.22, 0.0036), L("HOOK", -0.385, -0.22, 0.0036)],
          controls=[lamp(-0.272, -0.174, "green", r=0.0044, node="Lamp_gear_nose"), lamp(-0.272, -0.197, "green", r=0.0044, node="Lamp_gear_left"), lamp(-0.272, -0.22, "green", r=0.0044, node="Lamp_gear_right"), toggle(-0.385, -0.195), wheel(-0.325, -0.197)]),
    auto_plate("start", "main", 0.225, -0.232, 0.405, -0.165, "", [("guard", "L MSTR"), ("guard", "R MSTR"), ("pull", "JFS"), ("green", "READY")], columns=4),
    auto_plate("afcs", "main", -0.12, -0.298, 0.12, -0.172, "AFCS", [("toggle", "ROLL"), ("toggle", "PITCH"), ("toggle", "YAW"), ("lamp", "AUTO"), ("knob", "TRIM"), ("toggle", "PITOT"), ("toggle", "ANTI-SKD"), ("lamp", "SPD BK")], columns=4),
    # Left console: throttles forward, then fuel, radios, transponder.
    plate("throttle", "left", -0.49, 0.1, -0.33, 0.6, colour="gray", legends=[L("AB", -0.41, 0.44, 0.0068), L("MIL", -0.41, 0.34, 0.0068), L("IDLE", -0.41, 0.2, 0.0068), L("OFF", -0.41, 0.13, 0.0068)], controls=[knob(-0.355, 0.13, r=0.0085)]),
    auto_plate("engine", "left", -0.33, 0.28, -0.205, 0.6, "ENGINE", [("guard", "L"), ("guard", "R"), ("toggle", "JFS"), ("toggle", "INLET"), ("knob", "BOOST"), ("toggle", "IGN")], columns=2),
    auto_plate("trim", "left", -0.33, 0.1, -0.205, 0.28, "TRIM", [("knob", "RUD"), ("T/O", ""), ("toggle", "FLAP"), ("lamp", "TO")], columns=2),
    auto_plate("fuel_control", "left", -0.495, -0.13, -0.205, 0.1, "FUEL", [("rotary", "XFER"), ("guard", "DUMP"), ("toggle", "WING"), ("toggle", "CTR"), ("lamp", "SLIP"), ("rotary", "TANK")], columns=3),
    auto_plate("uhf", "left", -0.495, -0.37, -0.205, -0.13, "COMM", [("rotary", "CH 1"), ("rotary", "CH 2"), ("knob", "VOL"), ("toggle", "SQL"), ("TONE", ""), ("toggle", "GRD")], columns=3),
    auto_plate("iff", "left", -0.495, -0.6, -0.205, -0.37, "IFF", [("toggle", "M1"), ("toggle", "M2"), ("toggle", "M3"), ("toggle", "M4"), ("rotary", "MSTR"), ("knob", "CODE")], columns=3),
    # Right console: side stick forward, with its arm rest over the rear panels.
    plate("stick", "right", 0.205, 0.26, 0.495, 0.6, colour="gray", legends=[L("FLIGHT CONTROL", 0.35, 0.575, 0.0058)]),
    auto_plate("sensor", "right", 0.205, 0.0, 0.495, 0.26, "SENSOR", [("rotary", "RDR"), ("rotary", "RNG"), ("knob", "GAIN"), ("toggle", "BIT"), ("toggle", "PRF"), ("toggle", "ECM")], columns=3),
    auto_plate("ecs", "right", 0.205, -0.24, 0.495, 0.0, "ENVIRONMENT", [("rotary", "TEMP"), ("rotary", "FLOW"), ("knob", "DEFOG"), ("guard", "CANOPY"), ("toggle", "ANTI-G"), ("toggle", "ICE")], columns=3),
    auto_plate("lights", "right", 0.205, -0.6, 0.495, -0.24, "OXYGEN / LIGHTS", [("toggle", "100%"), ("toggle", "ON"), ("toggle", "EMER"), ("toggle", "POS"), ("knob", "FORM"), ("toggle", "STROBE"), ("knob", "INST"), ("knob", "CONS"), ("knob", "FLOOD")], columns=3),
]
HULL = [(6.6, 0.21, 3.64, 1.5, 3.0), (6.2, 0.41, 3.64, 1.5, 3.0), (5.6, 0.51, 3.64, 1.5, 3.0), (4.8, 0.53, 3.64, 1.5, 3.0), (4.0, 0.53, 3.64, 1.5, 3.0), (3.2, 0.41, 3.64, 1.5, 3.0), (2.92, 0.3, 3.64, 1.5, 3.0)]
GLASS = [(6.2, 0.41, 3.0, SILL), (5.6, 0.51, 3.2, SILL), (4.8, 0.53, 3.22, SILL), (4.0, 0.53, 3.22, SILL), (3.2, 0.41, 3.0, SILL), (2.95, 0.33, 2.85, SILL)]
VIEWS = {
    "forward": (EYE, (0.0, 5.9, 2.5), 68),
    "panel": (EYE, (0.0, 5.9, 2.28), 42),
    "left": (EYE, (-0.34, 5.5, 1.95), 68),
    "right": (EYE, (0.34, 5.5, 1.95), 68),
    "rear": ((0.0, 4.62, 2.82), (0.0, 4.33, 2.28), 68),
}


def cockpit(k, suffix, panel_y, console_centre, seat_offset):
    surface = "main" + suffix
    k.main_panel(surface, PANEL_OUTLINE, balls=(STANDBY_ADI,), fasteners=[(-0.405, -0.16), (0.405, -0.16), (-0.13, -0.165), (0.13, -0.165), (-0.13, -0.055), (0.13, -0.055)])
    for entry in PLATES:
        k.plate(entry, suffix)
    k.gauges(suffix)
    k.clock(CLOCK, surface)
    k.adi(STANDBY_ADI, "Standby_ADI", "Standby_ADI_ball", surface)
    k.screen("MFD_L", surface, MFD_LEFT[0], MFD_LEFT[1], MFD_SIZE, MFD_BEZEL)
    k.screen("MFD_R", surface, MFD_RIGHT[0], MFD_RIGHT[1], MFD_SIZE, MFD_BEZEL)
    k.display_keys(surface, MFD_LEFT[0], MFD_LEFT[1], MFD_SIZE, MFD_BEZEL)
    k.display_keys(surface, MFD_RIGHT[0], MFD_RIGHT[1], MFD_SIZE, MFD_BEZEL)
    k.readout("UFC", surface, UFC[0], UFC[1], UFC[2], UFC[3])
    back, front = console_centre - 0.6, console_centre + 0.62
    k.console("left" + suffix, -0.205, -0.52, back, front, CONSOLE_TOP, FLOOR)
    k.console("right" + suffix, 0.205, 0.52, back, front, CONSOLE_TOP, FLOOR)
    # Pedals under the panel, far enough forward for the seated pilot's knees; a slim pedestal between the boots.
    k.floor(FLOOR, back - 0.03, panel_y + 0.15, 0.207)
    k.knee_well(FLOOR, 1.98, panel_y + 0.13, min(0.5, k.hull_half(HULL, SILL, panel_y + 0.13) - 0.01), 0.065, panel_y + 0.025, 1.96)
    k.pedals(0.15, panel_y - 0.02, FLOOR)
    k.side_stick("right" + suffix, 0.35, 0.42)
    k.throttle("left" + suffix, -0.43, -0.39, 0.1, 0.46, 0.24, 0.17)
    with k.placed(seat_offset):
        k.seat(top=0.064)
    k.map_case(k.hull_half(HULL, SILL, console_centre - 0.22) - 0.006, console_centre - 0.22, 2.3)
    k.breaker_panel(-k.hull_half(HULL, SILL, console_centre - 0.25) + 0.006, console_centre - 0.25, 2.3, side=-1)
    side = SILL + 0.005
    lip_y = panel_y - 0.03
    forward = [(6.2, 0.4, 2.66, side), (6.45, 0.27, 2.62, side), (6.6, 0.16, 2.6, side)] if not suffix else [(panel_y + 0.22, 0.5, 2.62, side)]
    half = 0.46 if not suffix else 0.5
    k.hood([(lip_y, half, 2.6, side), (lip_y + 0.03, half + 0.005, 2.625, side), (lip_y + 0.1, half + 0.01, 2.635, side)] + forward, [(lip_y + 0.1, half, 2.555, SILL), (lip_y + 0.02, half, 2.57, SILL), (lip_y - 0.01, half + 0.003, 2.585, SILL + 0.002), (lip_y, half, 2.6, side)], stud_y=lip_y + 0.075, exponent=3.0, name="Hood" + suffix)


def build(k):
    k.tub(HULL, SILL, [2.95, 3.2, 3.5, 3.8, 4.1, 4.4, 4.7, 5.0, 5.3, 5.6, 5.85, 6.1, 6.35, 6.55])
    k.sill_rails(HULL, SILL, 3.1, 5.86, count=18)
    k.wall_details(HULL, SILL, 3.12, 5.88, CONSOLE_TOP, count=11)
    k.jettison_handle(-k.hull_half(HULL, SILL, 5.62) + 0.006, 5.62, 2.3)
    cockpit(k, "", 5.9, 5.3, (0.0, 1.085, 1.875))
    # The projector sits on top of the glareshield, clear of the displays.
    with k.placed((0.0, 0.3, 1.93)):
        k.hud_unit(w=0.128, h=0.1, centre=0.817, top=0.93, back=5.6)
    with k.placed((0, 0, 0), prefix="Rear_"):
        cockpit(k, "@rear", 4.33, 3.72, (0.0, -0.485, 1.875))
    k.canopy_trim(GLASS, 4.06, [5.9, 5.6, 4.8, 4.0, 3.2, 3.0], mirrors=(), exponent=2.4)
