"""Peregrine HX-27 detail cockpit: tandem seats, three displays and a centre stick.

A fictional aircraft, so the arrangement is a design choice and follows no technical order.
Parts are in real metres; the flight model is flown at 0.7 scale.
"""
import re

from layout import *  # noqa: F401,F403
from layout import SCALES as STANDARD

ID = "peregrine"
MODEL = "public/assets/peregrine-hx27.glb"
SCALE = 0.7
SILL = 2.94
FLOOR = 2.345
CONSOLE_TOP = 2.62
EYE = (0.0, 6.6, 3.44)
FRONT_PANEL = (0.0, 7.18, 2.9)
REAR_PANEL = (0.0, 5.72, 2.9)
FRONT_CONSOLE = (0.0, 6.6, CONSOLE_TOP)
REAR_CONSOLE = (0.0, 5.12, CONSOLE_TOP)
PANEL_TILT = 12.0
SCALES = {
    **STANDARD,
    "fuel": needle(sweep(0, 5000, 1000, -140, 140), major=[0, 1000, 2000, 3000, 4000, 5000], minor=[500, 1500, 2500, 3500, 4500], labels={0: '0', 1000: '1', 2000: '2', 3000: '3', 4000: '4', 5000: '5'}, title="FUEL QTY", sub="LBS X 1000"),
}
PANEL_PAINT = (92, 97, 102)
MATERIALS = {
    "paint": ((80, 85, 90), 0.0, 0.58, {}),
    "paint_dark": ((46, 49, 53), 0.0, 0.66, {}),
    "cover": ((54, 58, 62), 0.0, 0.8, {}),
    "fabric": ((78, 82, 66), 0.0, 0.92, {}),
    "cushion": ((60, 64, 52), 0.0, 0.88, {}),
    "webbing": ((150, 142, 118), 0.0, 0.92, {}),
    "chute": ((62, 66, 58), 0.0, 0.9, {}),
}
SURFACES = {
    "main": dict(scale=1500, x0=-0.47, x1=0.47, y0=-0.31, y1=0.28, left=0, top=0),
    "left": dict(scale=700, x0=-0.66, x1=-0.24, y0=-0.62, y1=0.62, left=1420, top=0),
    "right": dict(scale=700, x0=0.24, x1=0.66, y0=-0.62, y1=0.62, left=1720, top=0),
}
BINS = [dict(x0=0, x1=1412, x=0, y=900, row=0), dict(x0=1420, x1=2048, x=1420, y=880, row=0)]
FRAMES = {
    "main": ("panel", FRONT_PANEL, PANEL_TILT),
    "left": ("flat", FRONT_CONSOLE),
    "right": ("flat", FRONT_CONSOLE),
    "main@rear": ("panel", REAR_PANEL, PANEL_TILT),
    "left@rear": ("flat", REAR_CONSOLE),
    "right@rear": ("flat", REAR_CONSOLE),
}
CARVE = dict(min=(-0.98, 3.05, -10.95), max=(0.98, 5.3, -5.9), keep=re.compile(r"glaz|canopy|windscreen|arch", re.I))

PANEL_OUTLINE = [(-0.46, 0.27), (0.46, 0.27), (0.46, -0.225), (0.3, -0.225), (0.3, -0.165), (0.125, -0.165), (0.125, -0.3), (-0.125, -0.3), (-0.125, -0.165), (-0.3, -0.165), (-0.3, -0.225), (-0.46, -0.225)]
MFD_SIZE, MFD_BEZEL = 0.172, 0.232
MFD_LEFT, MFD_CENTRE, MFD_RIGHT = (-0.255, 0.03), (0.0, 0.03), (0.255, 0.03)
STANDBY_ADI = dict(x=0.0, y=-0.125, r=0.031)
CLOCK = dict(x=0.07, y=-0.192, r=0.024)
UFC = (0.0, 0.19, 0.19, 0.046)
GAUGES = [
    ("standby_airspeed", "airspeed", -0.082, -0.125, 0.025, "main"),
    ("standby_altimeter", "altimeter", 0.082, -0.125, 0.025, "main"),
    ("aoa", "aoa", -0.07, -0.192, 0.024, "main"),
    ("rpm_left", "rpm", 0.165, -0.127, 0.024, "main"),
    ("rpm_right", "rpm", 0.215, -0.127, 0.024, "main"),
    ("ftit_left", "ftit", 0.265, -0.127, 0.024, "main"),
    ("ftit_right", "ftit", 0.315, -0.127, 0.024, "main"),
    ("fuel", "fuel", 0.345, -0.195, 0.024, "main"),
    ("oil_left", "oil", 0.4, -0.195, 0.0165, "main"),
    ("oil_right", "oil", 0.44, -0.195, 0.0165, "main"),
]
CAUTIONS = ["ENG|FIRE", "APU|FIRE", "L OIL|LOW", "R OIL|LOW", "L GEN|OUT", "R GEN|OUT", "BLEED|AIR", "ECS|HOT", "HYD|LOW", "FUEL|LOW", "CADC|FAIL", "OXY|LOW", "CANOPY|OPEN", "SEAT|ARM", "ANTI|SKID", "TRIM|FAIL"]
PLATES = [
    auto_plate("arm", "main", -0.37, 0.15, -0.13, 0.245, "ARMAMENT", [("guard", "MASTER"), ("rotary", "MODE"), ("toggle", "GUN"), ("toggle", "AAM"), ("toggle", "RKT"), ("knob", "BRT")], columns=6),
    plate("ufc", "main", -0.125, 0.15, 0.125, 0.245, legends=[L("UP FRONT CONTROL", 0.0, 0.222, 0.0038)]),
    auto_plate("hud_set", "main", 0.13, 0.15, 0.37, 0.245, "HUD SET", [("knob", "BRT"), ("toggle", "SYM"), ("toggle", "DAY"), ("rotary", "MODE"), ("toggle", "RTCL"), ("knob", "DEPR")], columns=6),
    plate("fire", "main", -0.455, -0.16, -0.375, 0.245, legends=[L("FIRE", -0.415, 0.232, 0.0058), L("L", -0.435, 0.179), L("R", -0.395, 0.179), L("APU", -0.415, 0.125, 0.005), L("DISCH", -0.415, 0.073, 0.0048), L("BRAKE", -0.415, -0.125, 0.0048)],
          controls=[lamp(-0.435, 0.203, "red", r=0.013, node="Lamp_fire_left"), lamp(-0.395, 0.203, "red", r=0.013, node="Lamp_fire_right"), lamp(-0.415, 0.145, "red", r=0.007), guarded(-0.415, 0.095), button(-0.415, 0.005, face="MASTER|CAUTION", w=0.056, h=0.046, node="Lamp_master", colour="amberbutton"), pull(-0.415, -0.095)]),
    annunciators("caution", "main", 0.375, -0.16, 0.455, 0.245, "CAUTION", CAUTIONS, columns=2),
    auto_plate("data", "main", -0.37, -0.163, -0.13, -0.09, "", [("MFD 1", ""), ("MFD 2", ""), ("MFD 3", ""), ("MAP", ""), ("STPT", ""), ("WPN", ""), ("ALT", ""), ("HDG", ""), ("APR", ""), ("A/P", ""), ("Y/D", ""), ("BIT", "")], columns=6),
    plate("gear", "main", -0.455, -0.223, -0.303, -0.167, legends=[L("NOSE", -0.33, -0.175, 0.0034), L("L", -0.33, -0.195, 0.0034), L("R", -0.33, -0.215, 0.0034), L("HOOK", -0.438, -0.215, 0.0034)],
          controls=[lamp(-0.345, -0.175, "green", r=0.0042, node="Lamp_gear_nose"), lamp(-0.345, -0.195, "green", r=0.0042, node="Lamp_gear_left"), lamp(-0.345, -0.215, "green", r=0.0042, node="Lamp_gear_right"), toggle(-0.438, -0.19), wheel(-0.39, -0.195)]),
    plate("eng_small", "main", 0.303, -0.223, 0.455, -0.167),
    auto_plate("afcs", "main", -0.12, -0.298, 0.12, -0.226, "AFCS", [("toggle", "ROLL"), ("toggle", "PITCH"), ("toggle", "YAW"), ("lamp", "AUTO"), ("knob", "TRIM"), ("toggle", "ANTI-SKD")], columns=6),
    # Left console: throttles forward, then fuel, radios, transponder.
    plate("throttle", "left", -0.6, 0.1, -0.42, 0.6, colour="gray", legends=[L("AB", -0.51, 0.44, 0.007), L("MIL", -0.51, 0.34, 0.007), L("IDLE", -0.51, 0.2, 0.007), L("OFF", -0.51, 0.13, 0.007), L("FRICTION", -0.45, 0.13, 0.005)], controls=[knob(-0.45, 0.155, r=0.009)]),
    auto_plate("engine", "left", -0.42, 0.28, -0.26, 0.6, "ENGINE", [("guard", "L MSTR"), ("guard", "R MSTR"), ("toggle", "JFS"), ("toggle", "INLET"), ("rotary", "BOOST"), ("toggle", "IGN")], columns=2),
    auto_plate("trim", "left", -0.42, 0.1, -0.26, 0.28, "TRIM", [("knob", "RUDDER"), ("TAKEOFF", ""), ("toggle", "FLAP"), ("lamp", "TO")], columns=2),
    auto_plate("fuel_control", "left", -0.62, -0.13, -0.26, 0.1, "FUEL", [("rotary", "XFER"), ("guard", "DUMP"), ("toggle", "WING"), ("toggle", "CTR"), ("lamp", "SLIP"), ("rotary", "TANKS")], columns=3),
    auto_plate("uhf", "left", -0.62, -0.37, -0.26, -0.13, "COMM", [("rotary", "CHAN 1"), ("rotary", "CHAN 2"), ("knob", "VOL"), ("toggle", "SQL"), ("TONE", ""), ("toggle", "GUARD")], columns=3),
    auto_plate("iff", "left", -0.62, -0.6, -0.26, -0.37, "IFF", [("toggle", "M1"), ("toggle", "M2"), ("toggle", "M3"), ("toggle", "M4"), ("rotary", "MASTER"), ("knob", "CODE"), ("lamp", "REPLY"), ("toggle", "ANT")], columns=4),
    # Right console: sensors, navigation keypad, environment, oxygen, lights.
    auto_plate("sensor", "right", 0.26, 0.3, 0.6, 0.6, "SENSOR CONTROL", [("rotary", "RADAR"), ("rotary", "RANGE"), ("rotary", "AZ"), ("knob", "GAIN"), ("knob", "TILT"), ("knob", "SYM"), ("toggle", "BIT"), ("toggle", "PRF"), ("toggle", "ECM")], columns=3),
    auto_plate("nav", "right", 0.26, 0.04, 0.62, 0.3, "INERTIAL NAV", [("1", ""), ("2", ""), ("3", ""), ("rotary", "MODE"), ("4", ""), ("5", ""), ("6", ""), ("lamp", "ALIGN"), ("7", ""), ("8", ""), ("9", ""), ("toggle", "MAG")], columns=4),
    auto_plate("ecs", "right", 0.26, -0.2, 0.62, 0.04, "ENVIRONMENT", [("rotary", "TEMP"), ("rotary", "FLOW"), ("knob", "DEFOG"), ("guard", "CANOPY"), ("toggle", "ANTI-G"), ("toggle", "ANTI-ICE")], columns=3),
    auto_plate("oxygen_panel", "right", 0.26, -0.42, 0.62, -0.2, "OXYGEN", [("toggle", "100%"), ("toggle", "ON"), ("toggle", "EMER"), ("green", "FLOW")], columns=4),
    auto_plate("lights", "right", 0.26, -0.6, 0.62, -0.42, "LIGHTS", [("toggle", "POS"), ("knob", "FORM"), ("toggle", "STROBE"), ("knob", "INST"), ("knob", "CONS"), ("knob", "FLOOD"), ("toggle", "LDG"), ("LAMP", "")], columns=4),
]
HULL = [(7.6, 0.37, 3.56, 2.3, 3.0), (7.14, 0.553, 3.56, 2.3, 3.0), (6.65, 0.672, 3.56, 2.3, 3.0), (5.95, 0.707, 3.56, 2.3, 3.0), (5.25, 0.65, 3.56, 2.3, 3.0), (4.55, 0.47, 3.56, 2.3, 3.0), (4.32, 0.4, 3.56, 2.3, 3.0)]
GLASS = [(7.05, 0.56, 3.64, SILL), (6.65, 0.672, 3.78, SILL), (5.95, 0.707, 3.96, SILL), (5.25, 0.65, 3.92, SILL), (4.55, 0.47, 3.5, SILL), (4.34, 0.4, 3.4, SILL)]
VIEWS = {
    "forward": (EYE, (0.0, 7.18, 3.1), 68),
    "panel": (EYE, (0.0, 7.18, 2.92), 40),
    "left": (EYE, (-0.42, 6.8, 2.62), 68),
    "right": (EYE, (0.42, 6.8, 2.62), 68),
    "rear": ((0.0, 6.0, 3.55), (0.0, 5.72, 2.95), 68),
}


def panel_contents(k, suffix=""):
    surface = "main" + suffix
    for entry in PLATES:
        k.plate(entry, suffix)
    k.gauges(suffix)
    k.clock(CLOCK, surface)
    k.adi(STANDBY_ADI, "Standby_ADI", "Standby_ADI_ball", surface)
    for name, (x, y) in (("MFD_L", MFD_LEFT), ("MFD_C", MFD_CENTRE), ("MFD_R", MFD_RIGHT)):
        k.screen(name, surface, x, y, MFD_SIZE, MFD_BEZEL)
        k.display_keys(surface, x, y, MFD_SIZE, MFD_BEZEL)
    k.readout("UFC", surface, UFC[0], UFC[1], UFC[2], UFC[3])


def cockpit(k, suffix, panel_y, console_centre, seat_offset, stick_y, hud):
    surface = "main" + suffix
    k.main_panel(surface, PANEL_OUTLINE, balls=(STANDBY_ADI,), fasteners=[(-0.127, 0.148), (0.127, 0.148), (-0.127, -0.087), (0.127, -0.087)])
    panel_contents(k, suffix)
    back, front = console_centre - 0.6, console_centre + 0.6
    k.console("left" + suffix, -0.25, -0.66, back, front, CONSOLE_TOP, FLOOR)
    k.console("right" + suffix, 0.25, 0.66, back, front, CONSOLE_TOP, FLOOR)
    k.floor(FLOOR, back - 0.03, panel_y + 0.1, 0.252)
    k.knee_well(FLOOR, 2.66, panel_y + 0.02, 0.6, 0.125, panel_y - 0.09, 2.6)
    k.pedals(0.175, panel_y - 0.12, FLOOR)
    k.stick(stick_y, FLOOR)
    k.throttle("left" + suffix, -0.53, -0.49, 0.1, 0.46, 0.24, 0.17)
    with k.placed(seat_offset):
        k.seat()
    k.map_case(k.hull_half(HULL, SILL, console_centre - 0.2) - 0.01, console_centre - 0.2, 2.8)
    k.breaker_panel(-k.hull_half(HULL, SILL, console_centre - 0.25) + 0.01, console_centre - 0.25, 2.8, side=-1)
    side = SILL + 0.005
    lip_y = panel_y - 0.05
    k.hood([(lip_y, 0.505, 3.215, side), (lip_y + 0.04, 0.51, 3.225, side), (lip_y + 0.12, 0.515, 3.23, side)] + hud, [(lip_y + 0.12, 0.5, 3.17, SILL), (lip_y + 0.02, 0.5, 3.185, SILL), (lip_y - 0.01, 0.505, 3.2, SILL + 0.002), (lip_y, 0.505, 3.215, side)], stud_y=lip_y + 0.09, name="Hood" + suffix)


def build(k):
    k.tub(HULL, SILL, [4.34, 4.6, 4.9, 5.25, 5.6, 5.95, 6.3, 6.65, 6.9, 7.14, 7.4, 7.58])
    k.sill_rails(HULL, SILL, 4.42, 7.02, count=18)
    k.wall_details(HULL, SILL, 4.5, 7.05, CONSOLE_TOP, count=11)
    side = SILL + 0.005
    with k.placed((0, 0, 0)):
        cockpit(k, "", 7.18, 6.6, (0.0, 2.055, 2.59), 6.92, [(7.4, 0.47, 3.17, side + 0.005), (7.6, 0.36, 3.08, side + 0.03), (7.75, 0.27, 3.0, side + 0.05)])
    # Close in, because the windscreen slopes down soon after the canopy arch.
    with k.placed((0.0, 1.49, 2.53)):
        k.hud_unit(w=0.112, h=0.1, centre=0.88, top=0.985, back=5.66, post=5.67, rail_depth=0.04)
    with k.placed((0, 0, 0), prefix="Rear_"):
        cockpit(k, "@rear", 5.72, 5.12, (0.0, 0.57, 2.59), 5.46, [(5.98, 0.5, 3.17, side)])
    k.canopy_trim(GLASS, 7.03, [7.0, 6.65, 5.95, 5.25, 4.55, 4.36], mirrors=(0.0, -0.3, 0.3), exponent=2.2, reach=0.03, depth=0.03)
