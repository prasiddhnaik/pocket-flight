"""Aurelia detail flight deck for the Phenom 300E-based airframe: two crew side by side, four large displays, yokes and an overhead panel.

Modelled on a light business jet flight deck, without following any one aircraft's manual.
Parts are in real metres. The layout is drawn in its own frame and shifted forward by OFFSET into the airframe,
which the game flies at its exported size.
"""
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
EYE = (-0.32, 5.38, 2.72)
PANEL = (0.0, 6.0, 2.17)
SHELF = (0.0, 5.45, SHELF_TOP)
PEDESTAL = (0.0, 5.55, 1.95)
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
}
BINS = [dict(x0=0, x1=728, x=0, y=1512, row=0), dict(x0=736, x1=1072, x=736, y=1672, row=0), dict(x0=1080, x1=2048, x=1080, y=1552, row=0), dict(x0=1790, x1=2048, x=1790, y=0, row=0)]
FRAMES = {
    "main": ("panel", PANEL, 10.0),
    "left": ("flat", SHELF),
    "right": ("flat", SHELF),
    "pedestal": ("flat", PEDESTAL),
    "overhead": ("overhead", OVERHEAD),
}
# Airframe frame, game axes. The glass, its seals and the airframe's own flight deck are left whole.
CARVE = dict(min=(-1.2, 1.62, -7.0), max=(1.2, 3.6, -5.15), keep=re.compile(r"(^|/)(Cockpit|Flight_deck|Windshield_-?1_seal|Cockpit_side_window_-?1_seal)(/|$)"), touching=True)
# The airframe's simple flight deck, hidden while this one is shown. Its glareshield deck under the windshield stays.
REPLACES = ("Cockpit_floor", "Pilot_seat_Left_mount", "Pilot_seat_Right_mount", "Yoke_Left_mount", "Yoke_Right_mount", "Centre_pedestal_mount", "Instrument_panel_mount",
            "Pedal_assembly_-1_-1_mount", "Pedal_assembly_-1_1_mount", "Pedal_assembly_1_-1_mount", "Pedal_assembly_1_1_mount", "Cockpit_partition")
REVIEW_HIDE = REPLACES

PANEL_OUTLINE = [(-0.72, 0.26), (0.72, 0.26), (0.72, -0.14), (0.47, -0.14), (0.47, -0.29), (0.16, -0.29), (0.16, -0.3), (-0.16, -0.3), (-0.16, -0.29), (-0.47, -0.29), (-0.47, -0.14), (-0.72, -0.14)]
SCREEN_W, SCREEN_H = 0.222, 0.196
BEZEL_W, BEZEL_H = 0.268, 0.242
SCREENS = [("PFD", -0.49), ("MFD_L", -0.165), ("MFD_R", 0.165)]
STANDBY_ADI = dict(x=0.0, y=-0.098, r=0.034)
CLOCK = dict(x=-0.6, y=-0.08, r=0.028)
GAUGES = [
    ("standby_airspeed", "airspeed", -0.092, -0.098, 0.03, "main"),
    ("standby_altimeter", "altimeter", 0.092, -0.098, 0.03, "main"),
    ("cabin", "cabin", 0.6, -0.08, 0.028, "main"),
    ("oxygen", "oxygen", 0.3, -0.33, 0.028, "overhead"),
]
CAUTIONS = ["ENG FIRE", "APU FIRE", "L OIL", "R OIL", "L GEN", "R GEN", "BLEED", "CABIN ALT", "HYD", "FUEL", "ICE", "TRIM"]
PLATES = [
    auto_plate("guidance", "main", -0.34, 0.19, 0.34, 0.258, "", [("FD", ""), ("HDG", ""), ("NAV", ""), ("APR", ""), ("rotary", "HDG"), ("rotary", "CRS"), ("AP", ""), ("YD", ""), ("rotary", "ALT"), ("VS", ""), ("FLC", ""), ("ALT", ""), ("rotary", "SPD")], columns=13),
    plate("warn_left", "main", -0.72, 0.19, -0.345, 0.258, legends=[L("MASTER", -0.66, 0.232, 0.0048), L("WARN", -0.585, 0.232, 0.0048), L("AUDIO", -0.43, 0.242, 0.0046)], controls=[button(-0.66, 0.21, face="CAUTION", w=0.06, h=0.024, node="Lamp_master", colour="amberbutton"), lamp(-0.585, 0.21, "red", r=0.009, node="Lamp_fire_left"), knob(-0.43, 0.21, r=0.009), knob(-0.385, 0.21, r=0.009)]),
    plate("warn_right", "main", 0.345, 0.19, 0.72, 0.258, legends=[L("MASTER", 0.66, 0.232, 0.0048), L("WARN", 0.585, 0.232, 0.0048), L("AUDIO", 0.43, 0.242, 0.0046)], controls=[button(0.66, 0.21, face="CAUTION", w=0.06, h=0.024, node="Copilot_Lamp_master", colour="amberbutton"), lamp(0.585, 0.21, "red", r=0.009, node="Lamp_fire_right"), knob(0.43, 0.21, r=0.009), knob(0.385, 0.21, r=0.009)]),
    auto_plate("left_lower", "main", -0.715, -0.137, -0.47, -0.04, "", [("toggle", "PITOT"), ("toggle", "AOA HT"), ("knob", "PFD"), ("knob", "MFD"), ("toggle", "STALL"), ("toggle", "RAIN")], columns=6),
    auto_plate("right_lower", "main", 0.47, -0.137, 0.715, -0.04, "", [("toggle", "PITOT"), ("toggle", "AOA HT"), ("knob", "PFD"), ("knob", "MFD"), ("toggle", "CHART"), ("toggle", "RAIN")], columns=6),
    annunciators("caution", "main", -0.46, -0.285, -0.17, -0.142, "ANNUNCIATORS", CAUTIONS, columns=4),
    plate("gear", "main", 0.17, -0.285, 0.46, -0.142, legends=[L("LANDING GEAR", 0.315, -0.15, 0.005), L("NOSE", 0.215, -0.17, 0.004), L("LEFT", 0.215, -0.2, 0.004), L("RIGHT", 0.215, -0.23, 0.004), L("UP", 0.32, -0.172, 0.0044), L("DN", 0.32, -0.27, 0.0044), L("BRAKE", 0.415, -0.27, 0.0044)],
          controls=[lamp(0.245, -0.17, "green", r=0.0052, node="Lamp_gear_nose"), lamp(0.245, -0.2, "green", r=0.0052, node="Lamp_gear_left"), lamp(0.245, -0.23, "green", r=0.0052, node="Lamp_gear_right"), wheel(0.32, -0.22), pull(0.415, -0.225)]),
    auto_plate("centre_lower", "main", -0.158, -0.298, 0.158, -0.15, "BACKUP", [("toggle", "BATT"), ("toggle", "STBY"), ("knob", "BRT"), ("lamp", "ON"), ("toggle", "AHRS"), ("toggle", "ADC"), ("knob", "BARO"), ("green", "OK")], columns=4),
    # Side shelves beside each seat.
    # The nose narrows forward, so the shelves stop short of the wall there.
    auto_plate("tiller_left", "left", -0.78, 0.08, -0.55, 0.47, "NOSE STEERING", [("rotary", "TILLER"), ("toggle", "ARM"), ("lamp", "NWS"), ("toggle", "BRAKE"), ("knob", "MIC"), ("knob", "SPKR"), ("lamp", "O2"), ("toggle", "MASK"), ("toggle", "BOOM"), ("toggle", "LIGHT"), ("knob", "DIM"), ("RESET", "")], columns=3),
    auto_plate("audio_left", "left", -0.83, -0.48, -0.55, 0.08, "AUDIO", [("COM1", ""), ("COM2", ""), ("COM3", ""), ("NAV1", ""), ("NAV2", ""), ("ADF", ""), ("DME", ""), ("MKR", ""), ("knob", "VOL"), ("knob", "ICS"), ("toggle", "HOT"), ("toggle", "EMER")], columns=3),
    auto_plate("tiller_right", "right", 0.55, 0.08, 0.78, 0.47, "CHART / OXYGEN", [("rotary", "CHART"), ("toggle", "ARM"), ("lamp", "CHART"), ("toggle", "SYNC"), ("knob", "MIC"), ("knob", "SPKR"), ("lamp", "O2"), ("toggle", "MASK"), ("toggle", "BOOM"), ("toggle", "LIGHT"), ("knob", "DIM"), ("RESET", "")], columns=3),
    auto_plate("audio_right", "right", 0.55, -0.48, 0.83, 0.08, "AUDIO", [("COM1", ""), ("COM2", ""), ("COM3", ""), ("NAV1", ""), ("NAV2", ""), ("ADF", ""), ("DME", ""), ("MKR", ""), ("knob", "VOL"), ("knob", "ICS"), ("toggle", "HOT"), ("toggle", "EMER")], columns=3),
    # Centre pedestal, thrust levers forward and the flight management keypad aft.
    plate("thrust", "pedestal", -0.13, 0.02, 0.13, 0.43, colour="gray", legends=[L("TO", 0.0, 0.33, 0.0056), L("CLB", 0.0, 0.29, 0.0056), L("CRZ", 0.0, 0.25, 0.0056), L("IDLE", 0.0, 0.1, 0.0056), L("SPD BRK", -0.098, 0.04, 0.0046), L("FLAPS", 0.098, 0.04, 0.0046)]),
    plate("fms", "pedestal", -0.13, -0.35, 0.13, 0.02, title="FLIGHT MANAGEMENT",
          controls=grid([-0.085, -0.0283, 0.0283, 0.085], [-0.095, -0.13, -0.165, -0.2, -0.235, -0.27, -0.305], lambda x, y, i, j: button(x, y, face=["1", "2", "3", "NAV", "4", "5", "6", "PERF", "7", "8", "9", "FPL", "CLR", "0", "ENT", "DIR", "A", "B", "C", "PROG", "D", "E", "F", "MSG", "G", "H", "I", "MENU"][j * 4 + i], w=0.045, h=0.026))),
    # Overhead: electrical, engines, lights and pressurisation.
    auto_plate("electrical", "overhead", -0.36, 0.1, 0.0, 0.4, "ELECTRICAL", [("guard", "BATT"), ("toggle", "GEN 1"), ("toggle", "GEN 2"), ("toggle", "APU"), ("toggle", "BUS"), ("lamp", "AVAIL"), ("knob", "VOLT"), ("toggle", "EMER")], columns=4),
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
    "pedestal": (EYE, (0.05, 5.6, 1.98), 60),
    "overhead": (EYE, (0.0, 5.3, 2.97), 68),
    "rear": ((0.0, 5.7, 2.6), (0.0, 4.5, 2.4), 72),
}.items()}


def lever(k, name, material, x, y, z, height, knob_size=0.02):
    """A short handle standing on the pedestal."""
    k.emit(name + "_slot", "rubber", k.box(x - 0.008, y - 0.05, z - 0.004, x + 0.008, y + 0.05, z + 0.0045))
    k.emit(name + "_arm", "metal", k.box(x - 0.005, y - 0.006, z, x + 0.005, y + 0.006, z + height))
    k.emit(name + "_knob", material, k.box(x - knob_size, y - knob_size * 0.8, z + height - 0.006, x + knob_size, y + knob_size * 0.8, z + height + 0.024, chamfer=0.006))


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
    k.main_panel("main", PANEL_OUTLINE, balls=(STANDBY_ADI,), fasteners=[(-0.71, 0.0), (0.71, 0.0), (-0.335, 0.183), (0.335, 0.183), (-0.012, 0.183), (0.012, 0.183)])
    for entry in PLATES:
        k.plate(entry)
    k.gauges()
    k.clock(CLOCK)
    k.adi(STANDBY_ADI, "Standby_ADI", "Standby_ADI_ball")
    for name, x in SCREENS:
        k.screen(name, "main", x, 0.07, SCREEN_W, BEZEL_W, height=SCREEN_H, bezel_height=BEZEL_H)
    with k.placed(prefix="Copilot_"):
        k.screen("PFD", "main", 0.49, 0.07, SCREEN_W, BEZEL_W, height=SCREEN_H, bezel_height=BEZEL_H)
    # Below the panel: pedestal column, knee space and floor.
    k.emit("Knee_wall", "paint", ([(-0.95, 6.03, FLOOR), (0.95, 6.03, FLOOR), (0.95, 6.03, 1.9), (-0.95, 6.03, 1.9)], [(3, 2, 1, 0)], []))
    k.emit("Pedestal_body", "paint", k.box(-0.135, 5.19, FLOOR, 0.135, 6.03, 1.945, chamfer=0.01))
    k.emit("Carpet", "carpet", k.rectangle(-0.94, BULKHEAD, 0.94, 6.03, FLOOR + 0.003, step=0.08))
    for x in (-0.6, -0.32, 0.32, 0.6):
        k.emit("Floor_rib", "metal_dark", k.box(x - 0.009, BULKHEAD, FLOOR + 0.002, x + 0.009, 5.98, FLOOR + 0.008))
    for sign in (-1, 1):
        for j in range(3):
            path = [(sign * (0.2 + j * 0.05), 6.03, 1.68 + j * 0.03), (sign * (0.22 + j * 0.05), 5.99, 1.76), (sign * (0.24 + j * 0.05), 6.03, 1.84)]
            k.emit("Well_wiring", "wire", k.tube(path, 0.0052, 6))
    k.emit("Foot_rest", "metal_dark", k.box(-0.135, 5.9, FLOOR + 0.002, 0.135, 6.02, FLOOR + 0.04, chamfer=0.006))
    # Both crew positions.
    for x, side_name, prefix in ((-0.32, "left", ""), (0.32, "right", "Copilot_")):
        with k.placed((x, 0.0, 0.0), prefix=prefix or ""):
            k.pedals(0.085, 5.92, FLOOR)
        k.yoke(side_name, x, 5.78, FLOOR, 0.38)
        k.crew_seat(x, 5.5, FLOOR, 2.0)
    # Pedestal top.
    k.emit("Pedestal_top", "paint", k.box(-0.136, 5.19, 1.94, 0.136, 6.0, 1.951, chamfer=0.002))
    k.throttle("pedestal", -0.04, 0.04, 0.08, 0.36, 0.2, 0.31)
    lever(k, "Speedbrake", "knob", -0.098, 5.71, 1.953, 0.05)
    lever(k, "Flap", "white", 0.098, 5.71, 1.953, 0.05)
    k.readout("FMS", "pedestal", 0.0, -0.045, 0.2, 0.066)
    # Trim wheels on the side of the pedestal, turning against the print.
    for sign in (-1, 1):
        wheel = k.Matrix.Translation((sign * 0.136, 5.6, 1.88)) @ k.Matrix.Rotation(sign * 1.5708, 4, "Y")
        k.emit("Trim_wheel", "knob", k.lathe([(0.075, -0.012), (0.075, 0.012), (0.066, 0.012), (0.066, -0.012)], 28), wheel)
        k.emit("Trim_hub", "metal", k.lathe([(0.02, -0.014), (0.02, 0.014), (0.0, 0.014)], 12), wheel)
        for j in range(4):
            k.emit("Trim_spoke", "knob", k.transform(k.box(-0.007, 0.018, -0.004, 0.007, 0.068, 0.004), k.Matrix.Rotation(j * 1.5708, 4, "Z")), wheel)
    # Shelves and overhead.
    k.console("left", -0.53, -0.95, 4.95, 5.95, SHELF_TOP, FLOOR)
    k.console("right", 0.53, 0.95, 4.95, 5.95, SHELF_TOP, FLOOR)
    for sign, label in ((-1, "left"), (1, "right")):
        mask = k.Matrix.Translation((sign * 0.72, 5.2, SHELF_TOP))
        k.emit("Mask_box", "black", k.box(-0.08, -0.09, 0.0, 0.08, 0.09, 0.13, chamfer=0.012), mask)
        k.emit("Mask_door", "paint", k.box(-0.072, -0.082, 0.128, 0.072, 0.082, 0.136, chamfer=0.004), mask)
        k.emit("Mask_tab", "red", k.box(-0.02, -0.07, 0.135, 0.02, -0.05, 0.142), mask)
        k.emit("Cup_holder", "metal", k.lathe([(0.042, 0.0), (0.042, 0.004), (0.036, 0.004), (0.036, -0.03)], 18), k.Matrix.Translation((sign * 0.64, 5.72, SHELF_TOP + 0.001)))
    frame = k.FRAMES["overhead"]
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
