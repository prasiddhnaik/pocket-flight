"""Aurelia detail flight deck for the Phenom 300E-based airframe: two crew side by side, yokes and an overhead panel.

The panel, tilt panel and pedestal follow the avionics layout in the Citation CJ4 Specification and Description (Oct 2015, section 10.2).
Parts are in real metres. The layout is drawn in its own frame and shifted forward by OFFSET into the airframe,
which the game flies at its exported size.
"""
import math
import re

from layout import *  # noqa: F401,F403
from layout import SCALES as STANDARD

ID = "aurelia"
MODEL = "public/assets/aurelia-phenom300e.glb"
SCALE = 1.0
# The layout frame sits this far aft of the airframe: everything below is in the layout frame.
OFFSET = (0.0, 0.66, 0.0)
FLOOR = 1.66
SILL = 2.27
SHELF_TOP = 2.12
# The crew station stands 0.72 m back from the panel, far enough for a 1.65 m pilot's knees and the yoke to stay under the sightlines to it.
EYE = (-0.32, 5.26, 2.72)
PANEL = (0.0, 6.0, 2.17)
SHELF = (0.0, 5.45, SHELF_TOP)
PEDESTAL = (0.0, 5.43, 1.95)
KNEE_WALL = 6.19
OVERHEAD = (0.0, 5.25, 2.94)
SCALES = STANDARD
BACKLIT = ("overhead",)
PANEL_PAINT = (66, 68, 72)
PLATE_PAINT = (28, 28, 30)
MATERIALS = {
    "paint": ((60, 62, 66), 0.2, 0.5, {}),
    "paint_dark": ((206, 200, 186), 0.0, 0.7, {}),
    "cover": ((40, 40, 42), 0.0, 0.72, {}),
    "cushion": ((44, 42, 40), 0.0, 0.62, {}),
    "fabric": ((30, 29, 28), 0.0, 0.7, {}),
    "webbing": ((122, 114, 96), 0.0, 0.92, {}),
}
SURFACES = {
    "main": dict(scale=1200, x0=-0.74, x1=0.74, y0=-0.31, y1=0.27, left=0, top=0),
    "left": dict(scale=800, x0=-0.95, x1=-0.5, y0=-0.5, y1=0.5, left=0, top=704),
    "right": dict(scale=800, x0=0.5, x1=0.95, y0=-0.5, y1=0.5, left=368, top=704),
    "pedestal": dict(scale=1200, x0=-0.14, x1=0.14, y0=-0.36, y1=0.44, left=736, top=704),
    "overhead": dict(scale=1000, x0=-0.38, x1=0.38, y0=-0.42, y1=0.42, left=1080, top=704),
    "tilt": dict(scale=1200, x0=-0.72, x1=0.72, y0=-0.16, y1=0.0, left=0, top=1856),
}
BINS = [dict(x0=0, x1=728, x=0, y=1512, row=0, y1=1852), dict(x0=736, x1=1072, x=736, y=1672, row=0, y1=1852), dict(x0=1080, x1=2048, x=1080, y=1552, row=0, y1=1852), dict(x0=1790, x1=2048, x=1790, y=0, row=0, y1=700)]
NO_HSI = True
# The tilt panel hangs from the instrument panel's lower edge, over the pedestal in the middle and clear of the shins either side.
TILT_ANGLE = 52.0
TILT_TOP = (5.97569, 2.03213)
TILT_OUTER, TILT_CENTRE = 0.1, 0.15
FRAMES = {
    "main": ("panel", PANEL, 10.0),
    "left": ("flat", SHELF),
    "right": ("flat", SHELF),
    "pedestal": ("flat", PEDESTAL),
    "overhead": ("overhead", OVERHEAD),
    "tilt": ("panel", (0.0, *TILT_TOP), TILT_ANGLE),
}
# Airframe frame, game axes. The glass, its seals and the airframe's own flight deck are left whole.
CARVE = dict(min=(-1.2, 1.62, -7.0), max=(1.2, 3.6, -5.15), keep=re.compile(r"(^|/)(Cockpit|Flight_deck|Windshield_-?1_seal|Cockpit_side_window_-?1_seal)(/|$)"), touching=True)
# The airframe's simple flight deck, hidden while this one is shown. Its glareshield deck under the windshield stays.
REPLACES = ("Cockpit_floor", "Pilot_seat_Left_mount", "Pilot_seat_Right_mount", "Yoke_Left_mount", "Yoke_Right_mount", "Centre_pedestal_mount", "Instrument_panel_mount",
            "Pedal_assembly_-1_-1_mount", "Pedal_assembly_-1_1_mount", "Pedal_assembly_1_-1_mount", "Pedal_assembly_1_1_mount", "Cockpit_partition")
REVIEW_HIDE = REPLACES

PANEL_OUTLINE = [(-0.72, 0.26), (0.72, 0.26), (0.72, -0.14), (-0.72, -0.14)]
TILT_OUTLINE = [(-0.72, 0.0), (0.72, 0.0), (0.72, -TILT_OUTER), (0.136, -TILT_OUTER), (0.136, -TILT_CENTRE), (-0.136, -TILT_CENTRE), (-0.136, -TILT_OUTER), (-0.72, -TILT_OUTER)]
# Four 8 x 10 inch portrait displays, outer PFDs and inner MFDs, with the standby instrument between them.
SCREEN_W, SCREEN_H = 0.2, 0.25
BEZEL_W, BEZEL_H = 0.236, 0.286
SCREEN_Y = 0.045
SCREENS = [("PFD", -0.426), ("MFD_L", -0.178), ("MFD_R", 0.178)]
ESIS = dict(x=0.0, y=0.13, size=0.09, bezel=0.112)
CLOCK = dict(x=-0.633, y=-0.0975, r=0.028)
GAUGES = [
    ("cabin", "cabin", 0.633, -0.0975, 0.028, "main"),
    ("oxygen", "oxygen", 0.3, -0.33, 0.028, "overhead"),
]
CDU_FUNCTION_KEYS = ["IDX", "FPL", "LEGS", "DEP", "PERF", "DIR", "MFD", "TUN", "PROG", "EXEC", "PREV", "NEXT"]
CDU_KEYS = ["1", "2", "3", "A", "B", "C", "D", "E", "4", "5", "6", "F", "G", "H", "I", "J", "7", "8", "9", "K", "L", "M", "N", "O", ".", "0", "CLR", "P", "Q", "R", "S", "T"]
CDU_SCREEN = dict(y=-0.037, w=0.094, h=0.056)


def cdu_plate(id, x):
    """Line select keys beside the screen, function keys under it, then the keypad."""
    keys = [button(x + side * 0.0575, y, w=0.009, h=0.0085) for side in (-1, 1) for y in (-0.0175, -0.0305, -0.0435, -0.0565)]
    keys += grid([x + (i - 2.5) * 0.0205 for i in range(6)], [-0.0735, -0.0855], lambda px, py, i, j: button(px, py, face=CDU_FUNCTION_KEYS[j * 6 + i], w=0.0185, h=0.0095))
    keys += grid([x + (i - 3.5) * 0.015 for i in range(8)], [-0.099, -0.1125, -0.126, -0.1395], lambda px, py, i, j: button(px, py, face=CDU_KEYS[j * 8 + i], w=0.0125, h=0.0105))
    return plate(id, "tilt", x - 0.065, -0.147, x + 0.065, -0.004, controls=keys)


def group(id, surface, x0, y0, x1, y1, title, items, columns=2):
    return auto_plate(id, surface, x0, y0, x1, y1, title, items, columns=columns)


GUIDANCE = auto_plate("guidance", "main", -0.295, 0.19, 0.295, 0.258, "", [("rotary", "CRS"), ("NAV", ""), ("APR", ""), ("VNV", ""), ("rotary", "HDG"), ("HDG", ""), ("FD", ""), ("AP", ""), ("YD", ""), ("XFR", ""), ("FLC", ""), ("VS", ""), ("ALT", ""), ("rotary", "ALT"), ("rotary", "CRS")], columns=15)
GUIDANCE["legends"].append(L("CVR MIC", 0.009, 0.2495, 0.0042, "l"))
# The handles beneath the tilt panel are labelled along its lower edge.
OXYGEN = group("oxygen", "tilt", -0.715, -0.094, -0.655, -0.004, "OXYGEN", [("toggle", "SUPPLY"), ("lamp", "LOW"), ("knob", "MASK"), ("toggle", "PAX")])
OXYGEN["legends"] += [L("EMER BRAKE", -0.66, -0.0972, 0.0042), L("PARK BRAKE", -0.58, -0.0972, 0.0042), L("CONTROL LOCK", -0.32, -0.0972, 0.0042)]
PLATES = [
    # A. Centre glareshield panel.
    plate("warn_left", "main", -0.72, 0.19, -0.5, 0.258, legends=[L("ENG FIRE", -0.68, 0.244, 0.0048), L("WARN", -0.61, 0.244, 0.0048), L("CAUTION", -0.54, 0.244, 0.0048)],
          controls=[guarded(-0.695, 0.214), lamp(-0.665, 0.214, "red", r=0.0065, node="Lamp_fire_left"), lamp(-0.61, 0.214, "red", r=0.012, node="Lamp_master_warning"), button(-0.54, 0.214, face="MASTER", w=0.06, h=0.024, node="Lamp_master", colour="amberbutton")]),
    plate("warn_right", "main", 0.5, 0.19, 0.72, 0.258, legends=[L("ENG FIRE", 0.68, 0.244, 0.0048), L("WARN", 0.61, 0.244, 0.0048), L("CAUTION", 0.54, 0.244, 0.0048)],
          controls=[guarded(0.695, 0.214), lamp(0.665, 0.214, "red", r=0.0065, node="Lamp_fire_right"), lamp(0.61, 0.214, "red", r=0.012, node="Copilot_Lamp_master_warning"), button(0.54, 0.214, face="MASTER", w=0.06, h=0.024, node="Copilot_Lamp_master", colour="amberbutton")]),
    auto_plate("dcp_left", "main", -0.495, 0.19, -0.3, 0.258, "DISPLAY CONTROL", [("knob", "BARO"), ("STD", ""), ("ROSE", ""), ("ARC", ""), ("knob", "RNG"), ("TFC", ""), ("REV", "")], columns=7),
    GUIDANCE,
    auto_plate("dcp_right", "main", 0.3, 0.19, 0.495, 0.258, "DISPLAY CONTROL", [("knob", "BARO"), ("STD", ""), ("ROSE", ""), ("ARC", ""), ("knob", "RNG"), ("TFC", ""), ("REV", "")], columns=7),
    # B. Instrument panel, outboard of each PFD; the gear module sits under the standby instrument.
    auto_plate("dacp_left", "main", -0.715, 0.04, -0.552, 0.186, "AUDIO CONTROL", [("COM1", ""), ("COM2", ""), ("NAV1", ""), ("NAV2", ""), ("DME", ""), ("MKR", ""), ("SPKR", ""), ("PA", ""), ("knob", "VOL"), ("knob", "SIDE"), ("toggle", "MASK"), ("toggle", "EMER")], columns=4),
    auto_plate("power", "main", -0.715, -0.055, -0.552, 0.036, "AVIONICS / ELEC POWER", [("toggle", "BATT"), ("toggle", "GEN L"), ("toggle", "GEN R"), ("toggle", "AVN"), ("guard", "DISPATCH"), ("toggle", "EMER")], columns=3),
    plate("gear", "main", -0.056, -0.135, 0.056, 0.072, legends=[L("LANDING GEAR", 0.0, 0.0625, 0.0048), L("NOSE", 0.0, 0.0335, 0.004), L("LEFT", -0.03, 0.0095, 0.004), L("RIGHT", 0.03, 0.0095, 0.004), L("UP", 0.03, -0.015, 0.0044), L("DN", 0.03, -0.075, 0.0044)],
          controls=[lamp(0.0, 0.046, "green", r=0.0052, node="Lamp_gear_nose"), lamp(-0.03, 0.022, "green", r=0.0052, node="Lamp_gear_left"), lamp(0.03, 0.022, "green", r=0.0052, node="Lamp_gear_right"), wheel(-0.008, -0.045), button(0.0, -0.11, face="HORN MUTE", w=0.06, h=0.017)]),
    auto_plate("dacp_right", "main", 0.552, 0.04, 0.715, 0.186, "AUDIO CONTROL", [("COM1", ""), ("COM2", ""), ("NAV1", ""), ("NAV2", ""), ("DME", ""), ("MKR", ""), ("SPKR", ""), ("PA", ""), ("knob", "VOL"), ("knob", "SIDE"), ("toggle", "MASK"), ("toggle", "EMER")], columns=4),
    auto_plate("recorder", "main", 0.552, -0.055, 0.715, 0.036, "CVR / DATABASE", [("TEST", ""), ("ERASE", ""), ("lamp", "CVR"), ("LOAD", ""), ("USB", ""), ("lamp", "DBU")], columns=3),
    # C. Tilt panel, left to right.
    OXYGEN,
    group("cockpit_temp", "tilt", -0.655, -0.094, -0.595, -0.004, "CKPT TEMP", [("rotary", "TEMP"), ("knob", "FAN"), ("toggle", "AUTO"), ("toggle", "DEFOG")]),
    group("fuel", "tilt", -0.595, -0.094, -0.535, -0.004, "FUEL", [("toggle", "BOOST L"), ("toggle", "BOOST R"), ("toggle", "XFER L"), ("toggle", "XFER R")]),
    group("ignition", "tilt", -0.535, -0.094, -0.475, -0.004, "IGNITION", [("toggle", "L"), ("toggle", "R"), ("lamp", "L IGN"), ("lamp", "R IGN")]),
    group("fadec", "tilt", -0.475, -0.094, -0.415, -0.004, "FADEC", [("toggle", "L"), ("toggle", "R"), ("RESET", ""), ("lamp", "TLD")]),
    group("pressure_tilt", "tilt", -0.415, -0.094, -0.345, -0.004, "PRESSURIZATION", [("rotary", "LDG ALT"), ("toggle", "MODE"), ("toggle", "DUMP"), ("knob", "RATE")]),
    group("ice", "tilt", -0.345, -0.094, -0.255, -0.004, "ICE PROTECTION", [("toggle", "WING"), ("toggle", "ENG"), ("toggle", "TAIL"), ("toggle", "PITOT"), ("toggle", "WSHLD"), ("lamp", "ICE")], columns=3),
    group("ccp_left", "tilt", -0.25, -0.094, -0.14, -0.004, "CURSOR CONTROL", [("knob", "RANGE"), ("1", ""), ("2", ""), ("3", ""), ("knob", "CURSOR"), ("MENU", ""), ("CHKL", ""), ("ENT", "")], columns=4),
    cdu_plate("cdu_left", -0.068),
    cdu_plate("cdu_right", 0.068),
    group("ccp_right", "tilt", 0.14, -0.094, 0.25, -0.004, "CURSOR CONTROL", [("knob", "RANGE"), ("1", ""), ("2", ""), ("3", ""), ("knob", "CURSOR"), ("MENU", ""), ("CHKL", ""), ("ENT", "")], columns=4),
    group("comms", "tilt", 0.255, -0.094, 0.345, -0.004, "COMMS", [("PTT", ""), ("MUTE", ""), ("EVENT", ""), ("toggle", "HOT"), ("knob", "SPKR"), ("lamp", "CVR")], columns=3),
    group("cabin_temp", "tilt", 0.345, -0.094, 0.415, -0.004, "CABIN TEMP", [("rotary", "TEMP"), ("knob", "FAN"), ("toggle", "AUTO"), ("toggle", "AIR")]),
    group("elt", "tilt", 0.415, -0.094, 0.475, -0.004, "ELT", [("guard", "ON"), ("lamp", "XMIT"), ("TEST", ""), ("RESET", "")]),
    plate("hour_meter", "tilt", 0.475, -0.094, 0.565, -0.004, title="FLIGHT HOURS", legends=[L("01247.3", 0.52, -0.052, 0.0105)]),
    group("pulse", "tilt", 0.565, -0.094, 0.715, -0.004, "LANDING LIGHTS", [("toggle", "LEFT"), ("toggle", "RIGHT"), ("toggle", "PULSE"), ("lamp", "ON")], columns=4),
    # Side shelves beside each seat, ending short of the panel so the tilt panel's outer ends stay in view.
    auto_plate("tiller_left", "left", -0.78, -0.02, -0.55, 0.26, "NOSE STEERING", [("rotary", "TILLER"), ("toggle", "ARM"), ("lamp", "NWS"), ("toggle", "BRAKE"), ("knob", "MIC"), ("knob", "SPKR"), ("lamp", "O2"), ("toggle", "MASK"), ("toggle", "BOOM"), ("toggle", "LIGHT"), ("knob", "DIM"), ("RESET", "")], columns=3),
    plate("breakers_left", "left", -0.83, -0.48, -0.55, -0.02, title="CIRCUIT BREAKERS"),
    auto_plate("tiller_right", "right", 0.55, -0.02, 0.78, 0.26, "CHART / OXYGEN", [("rotary", "CHART"), ("toggle", "ARM"), ("lamp", "CHART"), ("toggle", "SYNC"), ("knob", "MIC"), ("knob", "SPKR"), ("lamp", "O2"), ("toggle", "MASK"), ("toggle", "BOOM"), ("toggle", "LIGHT"), ("knob", "DIM"), ("RESET", "")], columns=3),
    plate("breakers_right", "right", 0.55, -0.48, 0.83, -0.02, title="CIRCUIT BREAKERS"),
    # D. Centre pedestal: thrust levers with their detents forward, then lighting, engine start and trim.
    plate("thrust", "pedestal", -0.13, 0.02, 0.13, 0.3, colour="gray", legends=[L("TO", 0.0, 0.282, 0.0056), L("CLB", 0.0, 0.252, 0.0056), L("CRU", 0.0, 0.21, 0.0056), L("IDLE", 0.0, 0.1, 0.0056), L("SPD BRK", -0.098, 0.04, 0.0046), L("FLAPS", 0.098, 0.04, 0.0046), L("RET", -0.12, 0.2, 0.0042), L("EXT", -0.12, 0.12, 0.0042), L("UP", 0.12, 0.2, 0.0042), L("15", 0.12, 0.16, 0.0042), L("35", 0.12, 0.12, 0.0042)]),
    auto_plate("lighting", "pedestal", -0.13, -0.12, 0.13, 0.02, "LIGHTING / DIMMING", [("knob", "PANEL"), ("knob", "EFIS"), ("knob", "FLOOD"), ("knob", "MAP"), ("toggle", "NAV"), ("toggle", "STROBE"), ("toggle", "BEACON"), ("toggle", "TAXI")], columns=4),
    auto_plate("engine_start", "pedestal", -0.13, -0.22, 0.13, -0.12, "ENGINE START", [("guard", "START L"), ("guard", "START R"), ("toggle", "STOP L"), ("toggle", "STOP R")], columns=4),
    auto_plate("trim", "pedestal", -0.13, -0.35, 0.13, -0.22, "TRIM", [("rotary", "AILERON"), ("rotary", "RUDDER"), ("toggle", "ELEV 2"), ("lamp", "SET")], columns=4),
    # Overhead: electrical, engines, lights and pressurisation.
    auto_plate("electrical", "overhead", -0.36, 0.1, 0.0, 0.4, "ELECTRICAL", [("guard", "BATT"), ("toggle", "GEN 1"), ("toggle", "GEN 2"), ("toggle", "INV"), ("toggle", "BUS"), ("lamp", "AC"), ("knob", "VOLT"), ("toggle", "EMER")], columns=4),
    auto_plate("engines", "overhead", 0.0, 0.1, 0.36, 0.4, "ENGINES", [("guard", "L FUEL"), ("guard", "R FUEL"), ("toggle", "IGN L"), ("toggle", "IGN R"), ("rotary", "START"), ("toggle", "BLEED"), ("toggle", "BOOST"), ("lamp", "FIRE")], columns=4),
    auto_plate("lights", "overhead", -0.36, -0.14, 0.0, 0.1, "LIGHTS", [("toggle", "NAV"), ("toggle", "STROBE"), ("toggle", "BEACON"), ("toggle", "LDG"), ("toggle", "TAXI"), ("toggle", "LOGO"), ("knob", "PANEL"), ("knob", "DOME")], columns=4),
    auto_plate("pressure", "overhead", 0.0, -0.14, 0.36, 0.1, "PRESSURE", [("rotary", "CABIN"), ("knob", "RATE"), ("toggle", "DUMP"), ("toggle", "EMER"), ("rotary", "TEMP"), ("knob", "FAN"), ("toggle", "DEFOG"), ("toggle", "ICE")], columns=4),
    auto_plate("cabin_controls", "overhead", -0.36, -0.41, 0.2, -0.14, "CABIN", [("toggle", "SIGNS"), ("toggle", "BELTS"), ("knob", "CAB LT"), ("toggle", "ATTEND"), ("knob", "VENT"), ("CALL", "")], columns=6),
]
# Superellipses (station, half width, top, bottom, exponent) fitted to plane sections of the skin and the window edges,
# 2-7 mm RMS, in the layout frame.
HULL = [(6.89, 0.581, 2.486, 1.594, 2.1), (6.69, 0.641, 2.579, 1.581, 2.0), (6.49, 0.689, 2.674, 1.566, 2.0), (6.29, 0.731, 2.775, 1.545, 2.0),
        (6.09, 0.773, 2.886, 1.534, 2.0), (5.89, 0.809, 2.986, 1.514, 2.0), (5.69, 0.844, 3.074, 1.506, 2.0), (5.49, 0.873, 3.146, 1.474, 2.0),
        (5.29, 0.905, 3.218, 1.462, 2.0), (5.09, 0.936, 3.285, 1.455, 2.0), (4.89, 0.962, 3.342, 1.438, 2.0), (4.69, 0.982, 3.385, 1.415, 2.0),
        (4.49, 0.996, 3.412, 1.388, 2.0)]
GLAZING = ["Windshield_-1", "Windshield_1", "Cockpit_side_window_-1", "Cockpit_side_window_1"]
BULKHEAD = 4.52


def airframe(point):
    return tuple(a + b for a, b in zip(point, OFFSET))


VIEWS = {name: (airframe(origin), airframe(target), fov) for name, (origin, target, fov) in {
    "forward": (EYE, (-0.2, 6.0, 2.42), 68),
    "panel": (EYE, (-0.1, 6.0, 2.2), 46),
    "left": (EYE, (-0.75, 5.4, 2.12), 68),
    "right": (EYE, (0.75, 5.5, 2.3), 68),
    "pedestal": (EYE, (0.05, 5.48, 1.98), 60),
    "tilt": (EYE, (0.0, 5.9, 2.02), 42),
    "overhead": (EYE, (0.0, 5.3, 2.97), 68),
    "rear": ((0.0, 5.7, 2.6), (0.0, 4.5, 2.4), 72),
}.items()}


def lever(k, name, material, x, y, z, height, knob_size=0.02):
    """A short handle standing on the pedestal."""
    k.emit(name + "_slot", "rubber", k.box(x - 0.008, y - 0.05, z - 0.004, x + 0.008, y + 0.05, z + 0.0045))
    k.emit(name + "_arm", "metal", k.box(x - 0.005, y - 0.006, z, x + 0.005, y + 0.006, z + height))
    k.emit(name + "_knob", material, k.box(x - knob_size, y - knob_size * 0.8, z + height - 0.006, x + knob_size, y + knob_size * 0.8, z + height + 0.024, chamfer=0.006))


def tilt_point(drop):
    """Forward station and height of a point this far down the tilt panel."""
    angle = math.radians(TILT_ANGLE)
    return TILT_TOP[0] - drop * math.sin(angle), TILT_TOP[1] - drop * math.cos(angle)


def tilt_body(k, name, x0, x1, drop):
    """Solid under the tilt panel, closing the gap down to the knee wall."""
    y, z = tilt_point(drop)
    section = [(y, 1.895), (6.035, 1.895), (6.035, TILT_TOP[1] - 0.0015), (TILT_TOP[0], TILT_TOP[1] - 0.0015), (y, z - 0.0015)]
    # Section is drawn in (forward, up) and swept across the aircraft.
    k.emit(name, "paint", k.transform(k.prism(section, x0, x1), k.Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))))


def t_handle(k, name, material, x, y, z):
    """A pull handle standing aft from a vertical face."""
    frame = k.Matrix.Translation((x, y, z)) @ k.Matrix.Rotation(1.5708, 4, "X")
    k.emit(f"{name}_collar", "metal_dark", k.lathe([(0.008, -0.002), (0.008, 0.002), (0.005, 0.004), (0.0, 0.004)], 12), frame)
    k.emit(f"{name}_shaft", "metal", k.lathe([(0.003, 0.0), (0.003, 0.034), (0.0, 0.034)], 8), frame)
    k.emit(name, material, k.box(-0.022, -0.007, 0.03, 0.022, 0.007, 0.042, chamfer=0.003), frame)


def build(k):
    with k.placed(OFFSET):
        layout(k)


def layout(k):
    # Shell: the tub to the window line, then a liner over the top with the real windows cut out.
    k.tub(HULL, SILL, [BULKHEAD, 4.86, 5.1, 5.39, 5.72, 6.0, 6.2, 6.4])
    windows = [[point - k.Vector(OFFSET) for point in k.glazing_outline(MODEL, name, SCALE)] for name in GLAZING]
    stations = [BULKHEAD + i * 0.02 for i in range(119)]
    k.windowed_liner(HULL, SILL, stations, windows)
    for outline in windows:
        k.window_frame(HULL, outline)
    # Hood over the panel, reaching forward under the windshields to the wall on each side.
    wide = lambda y: k.hull_half(HULL, SILL, y) + 0.008
    side = SILL - 0.008
    # It stops under the windshield's lower edge, where the airframe's own glareshield deck carries on forward.
    k.hood([(y, wide(y), top, side) for y, top in ((5.93, 2.47), (5.97, 2.48), (6.1, 2.49), (6.25, 2.485), (6.36, 2.465))], [(y, wide(y), top, side - 0.03) for y, top in ((6.05, 2.42), (5.95, 2.44), (5.92, 2.455))] + [(5.93, wide(5.93), 2.47, side)], exponent=9.0)
    # Blanks either side of the panel, out to the hull.
    for sign in (-1, 1):
        k.emit("Panel_cheek", "paint", k.box(min(sign * 0.715, sign * 1.0), 5.97, 1.84, max(sign * 0.715, sign * 1.0), 6.05, 2.46))
    # Panel.
    k.main_panel("main", PANEL_OUTLINE, fasteners=[(-0.7165, -0.13), (0.7165, -0.13)])
    k.main_panel("tilt", TILT_OUTLINE)
    tilt_body(k, "Tilt_body", -0.136, 0.136, TILT_CENTRE)
    for x0, x1 in ((-0.715, -0.136), (0.136, 0.715)):
        tilt_body(k, "Tilt_body", x0, x1, TILT_OUTER)
    for entry in PLATES:
        k.plate(entry)
    k.gauges()
    k.clock(CLOCK)
    k.emit("CVR_mic", "knob", k.lathe([(0.0042, -0.001), (0.0042, 0.0012), (0.003, 0.002), (0.0, 0.002)], 12), k.at("main", 0.0, 0.2495, k.PLATE_Z))
    for name, x in SCREENS:
        k.screen(name, "main", x, SCREEN_Y, SCREEN_W, BEZEL_W, height=SCREEN_H, bezel_height=BEZEL_H)
    with k.placed(prefix="Copilot_"):
        k.screen("PFD", "main", -SCREENS[0][1], SCREEN_Y, SCREEN_W, BEZEL_W, height=SCREEN_H, bezel_height=BEZEL_H)
    k.screen("ESIS", "main", ESIS["x"], ESIS["y"], ESIS["size"], ESIS["bezel"], height=ESIS["size"], bezel_height=ESIS["bezel"])
    k.readout("CDU", "tilt", -0.068, CDU_SCREEN["y"], CDU_SCREEN["w"], CDU_SCREEN["h"])
    with k.placed(prefix="Copilot_"):
        k.readout("CDU", "tilt", 0.068, CDU_SCREEN["y"], CDU_SCREEN["w"], CDU_SCREEN["h"])
    # E. Beneath the tilt panel, on the face below its lower edge.
    face, height = tilt_point(TILT_OUTER)
    handle_z = (height + 1.895) / 2
    t_handle(k, "Emergency_brake_handle", "red", -0.66, face, handle_z)
    t_handle(k, "Parking_brake_handle", "knob", -0.58, face, handle_z)
    t_handle(k, "Control_lock_handle", "yellow", -0.32, face, handle_z)
    # F. On the floor aft of the pedestal.
    release = k.Matrix.Translation((0.0, 5.01, FLOOR + 0.002))
    k.emit("Emergency_gear_well", "metal_dark", k.box(-0.03, -0.02, -0.002, 0.03, 0.02, 0.004, chamfer=0.001), release)
    k.emit("Emergency_gear_shaft", "metal", k.lathe([(0.003, 0.0), (0.003, 0.03), (0.0, 0.03)], 8), release)
    k.emit("Emergency_gear_handle", "red", k.box(-0.03, -0.008, 0.026, 0.03, 0.008, 0.04, chamfer=0.004), release)
    # Miscellaneous cockpit equipment: eye position reference and four ventilation outlets.
    k.emit("Eye_reference_post", "metal_dark", k.box(-0.0015, 5.958, 2.468, 0.0015, 5.961, 2.525))
    for z in (2.505, 2.525):
        k.emit("Eye_reference_ball", "white", k.lathe([(0.0, -0.005), (0.0035, -0.0035), (0.005, 0.0), (0.0035, 0.0035), (0.0, 0.005)], 12), k.Matrix.Translation((0.0, 5.9595, z)))
    for sign in (-1, 1):
        for z in (2.2, 2.34):
            outlet = k.Matrix.Translation((sign * 0.745, 5.97, z)) @ k.Matrix.Rotation(1.5708, 4, "X")
            k.emit("Vent_bezel", "metal_dark", k.lathe([(0.02, -0.002), (0.02, 0.002), (0.016, 0.006), (0.012, 0.004)], 16), outlet)
            k.emit("Vent_ball", "knob", k.lathe([(0.012, 0.002), (0.012, 0.008), (0.008, 0.013), (0.0, 0.014)], 14), outlet)
    # Below the panel: pedestal column, knee space and floor.
    k.emit("Knee_wall", "paint", ([(-0.95, KNEE_WALL, FLOOR), (0.95, KNEE_WALL, FLOOR), (0.95, KNEE_WALL, 1.9), (-0.95, KNEE_WALL, 1.9)], [(3, 2, 1, 0)], []))
    k.emit("Pedestal_body", "paint", k.box(-0.135, 5.07, FLOOR, 0.135, 6.03, 1.945, chamfer=0.01))
    k.emit("Carpet", "carpet", k.rectangle(-0.94, BULKHEAD, 0.94, KNEE_WALL, FLOOR + 0.003, step=0.08))
    for x in (-0.6, -0.32, 0.32, 0.6):
        k.emit("Floor_rib", "metal_dark", k.box(x - 0.009, BULKHEAD, FLOOR + 0.002, x + 0.009, KNEE_WALL - 0.05, FLOOR + 0.008))
    for sign in (-1, 1):
        for j in range(3):
            path = [(sign * (0.2 + j * 0.05), KNEE_WALL, 1.68 + j * 0.03), (sign * (0.22 + j * 0.05), KNEE_WALL - 0.04, 1.76), (sign * (0.24 + j * 0.05), KNEE_WALL, 1.84)]
            k.emit("Well_wiring", "wire", k.tube(path, 0.0052, 6))
    k.emit("Foot_rest", "metal_dark", k.box(-0.135, 5.9, FLOOR + 0.002, 0.135, 6.02, FLOOR + 0.04, chamfer=0.006))
    # Both crew positions.
    for x, side_name, prefix in ((-0.32, "left", ""), (0.32, "right", "Copilot_")):
        with k.placed((x, 0.0, 0.0), prefix=prefix or ""):
            # Heels on the floor, the pedal arms rising through it, and clear of the tilt panel's lower edge.
            k.pedals(0.11, 5.98, FLOOR - 0.065)
        k.yoke(side_name, x, 5.68, FLOOR, 0.525)
        k.crew_seat(x, 5.38, FLOOR, 1.958)
    # Pedestal top.
    k.emit("Pedestal_top", "paint", k.box(-0.136, 5.07, 1.94, 0.136, 6.0, 1.951, chamfer=0.002))
    k.throttle("pedestal", -0.04, 0.04, 0.08, 0.3, 0.2, 0.292)
    lever(k, "Speedbrake", "knob", -0.098, PEDESTAL[1] + 0.16, 1.953, 0.05)
    lever(k, "Flap", "white", 0.098, PEDESTAL[1] + 0.16, 1.953, 0.05)
    # Trim wheels on the side of the pedestal, ahead of the seat pans.
    for sign in (-1, 1):
        wheel = k.Matrix.Translation((sign * 0.136, 5.72, 1.88)) @ k.Matrix.Rotation(sign * 1.5708, 4, "Y")
        k.emit("Trim_wheel", "knob", k.lathe([(0.075, -0.012), (0.075, 0.012), (0.066, 0.012), (0.066, -0.012)], 28), wheel)
        k.emit("Trim_hub", "metal", k.lathe([(0.02, -0.014), (0.02, 0.014), (0.0, 0.014)], 12), wheel)
        for j in range(4):
            k.emit("Trim_spoke", "knob", k.transform(k.box(-0.007, 0.018, -0.004, 0.007, 0.068, 0.004), k.Matrix.Rotation(j * 1.5708, 4, "Z")), wheel)
    # Shelves and overhead.
    k.console("left", -0.55, -0.95, 4.95, 5.72, SHELF_TOP, FLOOR)
    k.console("right", 0.55, 0.95, 4.95, 5.72, SHELF_TOP, FLOOR)
    for sign, label in ((-1, "left"), (1, "right")):
        mask = k.Matrix.Translation((sign * 0.72, 5.06, SHELF_TOP))
        k.emit("Mask_box", "black", k.box(-0.08, -0.09, 0.0, 0.08, 0.09, 0.13, chamfer=0.012), mask)
        k.emit("Mask_door", "paint", k.box(-0.072, -0.082, 0.128, 0.072, 0.082, 0.136, chamfer=0.004), mask)
        k.emit("Mask_tab", "red", k.box(-0.02, -0.07, 0.135, 0.02, -0.05, 0.142), mask)
        k.emit("Cup_holder", "metal", k.lathe([(0.042, 0.0), (0.042, 0.004), (0.036, 0.004), (0.036, -0.03)], 18), k.Matrix.Translation((sign * 0.64, 5.64, SHELF_TOP + 0.001)))
    for surface, x0 in (("left", -0.81), ("right", 0.57)):
        for i in range(5):
            for j in range(10):
                k.emit("Breaker", "white" if (i + j) % 5 == 0 else "knob", k.lathe([(0.0042, -0.0008), (0.0042, 0.003), (0.0028, 0.0052), (0.0, 0.0056)], 8), k.at(surface, x0 + i * 0.05, -0.43 + j * 0.044, k.PLATE_Z))
    frame = k.FRAMES["overhead"]
    for x, material in ((-0.345, "white"), (0.0, "metal"), (0.345, "white")):
        k.emit("Reading_light" if x else "Floodlight", material, k.lathe([(0.009, -0.002), (0.009, 0.004), (0.006, 0.008), (0.0, 0.008)], 14), frame @ k.Matrix.Translation((x, 0.405, 0.0)))
    k.emit("Overhead_face", "atlas_lit", k.rectangle(-0.37, -0.41, 0.37, 0.41, -0.0002, k.surface_uv("overhead"), step=0.05), frame)
    k.emit("Overhead_case", "black", k.box(-0.375, -0.415, -0.17, 0.375, 0.415, -0.0006), frame)
    # Bulkhead behind the seats with a door through to the cabin.
    y = BULKHEAD + 0.01
    k.emit("Bulkhead", "liner", k.box(-1.1, y - 0.02, FLOOR, -0.3, y + 0.01, 3.45))
    k.emit("Bulkhead", "liner", k.box(0.3, y - 0.02, FLOOR, 1.1, y + 0.01, 3.45))
    k.emit("Bulkhead_top", "liner", k.box(-0.3, y - 0.02, 2.82, 0.3, y + 0.01, 3.45))
    k.emit("Door", "cover", k.box(-0.3, y - 0.015, FLOOR, 0.3, y + 0.002, 2.82))
    k.emit("Door_frame", "metal_dark", k.box(-0.31, y, 2.815, 0.31, y + 0.018, 2.835, chamfer=0.003))
    for sign in (-1, 1):
        k.emit("Door_frame", "metal_dark", k.box(sign * 0.3 - 0.012, y, FLOOR, sign * 0.3 + 0.012, y + 0.018, 2.835, chamfer=0.003))
    k.emit("Door_handle", "metal", k.box(0.19, y, 2.16, 0.27, y + 0.03, 2.185, chamfer=0.006))
    k.emit("Door_lock", "metal_dark", k.lathe([(0.018, 0.0), (0.018, 0.012), (0.0, 0.014)], 12), k.Matrix.Translation((0.23, y + 0.002, 2.26)) @ k.Matrix.Rotation(-1.5708, 4, "X"))
    for sign in (-1, 1):
        panel = k.Matrix.Translation((sign * 0.7, y + 0.01, 2.46)) @ k.Matrix.Rotation(1.5708, 4, "X")
        k.emit("Breaker_panel", "black", k.box(-0.14, -0.1, -0.006, 0.14, 0.1, 0.006, chamfer=0.002), panel)
        for i in range(8):
            for j in range(6):
                k.emit("Breaker", "white" if (i + j) % 5 == 0 else "knob", k.lathe([(0.0042, -0.0008), (0.0042, 0.003), (0.0028, 0.0052), (0.0, 0.0056)], 8), panel @ k.Matrix.Translation((-0.115 + i * 0.033, -0.078 + j * 0.031, 0.006)))
