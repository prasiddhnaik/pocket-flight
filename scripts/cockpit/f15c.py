"""F-15C detail cockpit. Arrangement follows USAF photographs (assets/f15c/cockpit/SOURCES.md)
with the multi-purpose display and up-front control of later MSIP aircraft."""
from layout import *  # noqa: F401,F403
from layout import SCALES as STANDARD

ID = "f15c"
MODEL = "public/assets/f15c-eagle.glb"
SCALE = 1.0
PANEL_ORIGIN = (0.0, 5.33, 0.265)
PANEL_TILT = 14.0
CONSOLE_TOP = 0.03
CONSOLE_CENTRE_Y = 4.62
EYE = (0.0, 4.55, 0.988)
HINGE = (0.0, 3.13, 0.3781)
SCALES = STANDARD
SURFACES = {
    "main": dict(scale=1650, x0=-0.42, x1=0.42, y0=-0.36, y1=0.35, left=0, top=0),
    "left": dict(scale=1100, x0=-0.45, x1=-0.2, y0=-0.63, y1=0.63, left=1400, top=0),
    "right": dict(scale=1100, x0=0.2, x1=0.45, y0=-0.63, y1=0.63, left=1700, top=0),
}
BINS = [dict(x0=0, x1=1392, x=0, y=1180, row=0), dict(x0=1400, x1=2048, x=1400, y=1400, row=0)]
PRINTED = [("RADIO CALL 86-0171", 0.0, 0.341, 0.0046), ("STANDBY", -0.074, -0.157, 0.0042), ("STANDBY", 0.074, -0.157, 0.0042), ("ATTITUDE", 0.0, -0.157, 0.0042)]
REVIEW_HIDE = ("Cockpit_fixed", "Cockpit_well")
FRAMES = {
    "main": ("panel", PANEL_ORIGIN, PANEL_TILT),
    "left": ("flat", (0.0, CONSOLE_CENTRE_Y, CONSOLE_TOP)),
    "right": ("flat", (0.0, CONSOLE_CENTRE_Y, CONSOLE_TOP)),
}

GAUGES = [
    # id, scale, x, y, radius, surface
    ("airspeed", "airspeed", -0.15, 0.072, 0.043, "main"),
    ("aoa", "aoa", -0.15, -0.032, 0.031, "main"),
    ("gmeter", "gmeter", -0.15, -0.108, 0.031, "main"),
    ("altimeter", "altimeter", 0.15, 0.072, 0.043, "main"),
    ("vvi", "vvi", 0.15, -0.032, 0.031, "main"),
    ("rpm_left", "rpm", 0.232, 0.098, 0.026, "main"),
    ("rpm_right", "rpm", 0.287, 0.098, 0.026, "main"),
    ("ftit_left", "ftit", 0.232, 0.036, 0.026, "main"),
    ("ftit_right", "ftit", 0.287, 0.036, 0.026, "main"),
    ("flow_left", "fuelflow", 0.232, -0.026, 0.026, "main"),
    ("flow_right", "fuelflow", 0.287, -0.026, 0.026, "main"),
    ("nozzle_left", "nozzle", 0.232, -0.088, 0.026, "main"),
    ("nozzle_right", "nozzle", 0.287, -0.088, 0.026, "main"),
    ("oil_left", "oil", 0.335, 0.104, 0.0165, "main"),
    ("oil_right", "oil", 0.378, 0.104, 0.0165, "main"),
    ("hyd_one", "hydraulic", 0.335, 0.06, 0.0165, "main"),
    ("hyd_two", "hydraulic", 0.378, 0.06, 0.0165, "main"),
    ("fuel", "fuel", 0.356, -0.03, 0.034, "main"),
    ("cabin", "cabin", 0.356, -0.112, 0.02, "main"),
    ("standby_airspeed", "airspeed", -0.074, -0.195, 0.029, "main"),
    ("standby_altimeter", "altimeter", 0.074, -0.195, 0.029, "main"),
    ("oxygen", "oxygen", 0.285, -0.27, 0.024, "right"),
]
CLOCK = dict(x=0.15, y=-0.108, r=0.031)
ADI = dict(x=0.0, y=0.062, r=0.052)
HSI = dict(x=0.0, y=-0.058, r=0.052)
STANDBY_ADI = dict(x=0.0, y=-0.195, r=0.029)
VSD = dict(x=-0.205, y=0.235, screen=0.13, bezel=0.172)
TEWS = dict(x=0.205, y=0.235, screen=0.122, bezel=0.172)
MPCD = dict(x=-0.305, y=-0.005, screen=0.135, bezel=0.186)
UFC = dict(x=0.0, y=0.29, w=0.158, h=0.052)

# Main panel outline: knee wells either side of the centre pedestal.
PANEL_OUTLINE = [
    (-0.41, 0.305), (-0.33, 0.305), (-0.33, 0.345), (0.33, 0.345), (0.33, 0.305), (0.41, 0.305), (0.41, -0.215), (0.39, -0.24), (0.25, -0.24), (0.25, -0.145), (0.118, -0.145),
    (0.118, -0.33), (0.095, -0.355), (-0.095, -0.355), (-0.118, -0.33), (-0.118, -0.145), (-0.25, -0.145),
    (-0.25, -0.24), (-0.39, -0.24), (-0.41, -0.215),
]


UFC_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "CLR", "0", "ENT"]
ANNUNCIATORS = [
    ["ENG", "FIRE"], ["AMAD", "FIRE"], ["L ENG", "OIL"], ["R ENG", "OIL"], ["L GEN", "OUT"], ["R GEN", "OUT"],
    ["BLEED", "AIR"], ["ECS", "HOT"], ["HYD", "LOW"], ["FUEL", "LOW"], ["CADC", "FAIL"], ["PITCH", "RATIO"],
]

def moved(entry, dy):
    """A plate with its legends and controls slid along its surface."""
    return dict(entry, y0=entry["y0"] + dy, y1=entry["y1"] + dy, legends=[dict(l, y=l["y"] + dy) for l in entry["legends"]], controls=[dict(c, y=c["y"] + dy) for c in entry["controls"]])


# The throttle block sits aft of the fuel panel, within the seated pilot's reach.
THROTTLE_SHIFT = -0.21
PLATES = [
    # ---- Main panel, top band ----
    plate("fire", "main", -0.405, 0.13, -0.335, 0.3, legends=[L("FIRE", -0.37, 0.289, 0.0062), L("L", -0.388, 0.238), L("R", -0.352, 0.238), L("AMAD", -0.37, 0.2, 0.005), L("TEST", -0.37, 0.14, 0.0046)],
          controls=[lamp(-0.388, 0.262, "red", r=0.0125, node="Lamp_fire_left"), lamp(-0.352, 0.262, "red", r=0.0125, node="Lamp_fire_right"), lamp(-0.37, 0.215, "red", r=0.0068), guarded(-0.37, 0.165, up="DISCH", down="OFF")]),
    plate("vsd", "main", -0.33, 0.13, -0.112, 0.335, legends=[L("RDR", -0.305, 0.312, 0.0046), L("BRT", -0.305, 0.256, 0.0046), L("CONT", -0.305, 0.2, 0.0046), L("VERTICAL SITUATION", -0.205, 0.139, 0.0046)],
          controls=[knob(-0.305, 0.292, r=0.0075), knob(-0.305, 0.236, r=0.0075), knob(-0.305, 0.18, r=0.0075)]),
    plate("ufc", "main", -0.105, 0.125, 0.105, 0.335, legends=[L("UP FRONT CONTROL", 0.0, 0.328, 0.0046), L("UHF 1", -0.086, 0.144, 0.0046), L("UHF 2", 0.086, 0.144, 0.0046), L("VOL", -0.086, 0.21, 0.0044), L("BRT", 0.086, 0.21, 0.0044)],
          controls=grid([-0.033, 0.0, 0.033], [0.247, 0.222, 0.197, 0.172], lambda x, y, i, j: button(x, y, face=UFC_KEYS[j * 3 + i], w=0.026, h=0.019))
          + grid([-0.086, 0.086], [0.247], lambda x, y, i, j: button(x, y, face="O/S", w=0.024, h=0.017))
          + [knob(-0.086, 0.226, r=0.0075), knob(0.086, 0.226, r=0.0075), rotary(-0.086, 0.168, r=0.0125), rotary(0.086, 0.168, r=0.0125), button(0.0, 0.14, face="DATA", w=0.03, h=0.014)]),
    plate("tews", "main", 0.112, 0.13, 0.33, 0.335, legends=[L("TACTICAL ELECTRONIC WARFARE", 0.205, 0.139, 0.0043), L("MODE", 0.305, 0.312, 0.0044), L("LOAD", 0.305, 0.268, 0.0044), L("BRT", 0.305, 0.216, 0.0044)],
          controls=[button(0.305, 0.296, face="ACT", w=0.017, h=0.013), button(0.305, 0.28, face="STBY", w=0.017, h=0.013), knob(0.305, 0.198, r=0.0075), button(0.305, 0.242, face="TST", w=0.017, h=0.013)]),
    plate("caution", "main", 0.335, 0.13, 0.405, 0.3, legends=[L("CAUTION", 0.37, 0.292, 0.0048)],
          controls=grid([0.353, 0.387], [0.272, 0.2465, 0.221, 0.1955, 0.17, 0.1445], lambda x, y, i, j: button(x, y, face="|".join(ANNUNCIATORS[j * 2 + i]), w=0.03, h=0.021, colour="annunciator"))),
    # ---- Main panel, left: display and the armament switches beneath it ----
    plate("mpcd", "main", -0.405, -0.135, -0.205, 0.125, legends=[L("A/G", -0.385, -0.122, 0.0046), L("MASTER ARM", -0.305, -0.118, 0.0048), L("BRT", -0.228, -0.122, 0.0046)],
          controls=[knob(-0.385, -0.105, r=0.0065), guarded(-0.305, -0.104), knob(-0.228, -0.105, r=0.0065)]),
    # ---- Main panel, centre columns ----
    plate("flags", "main", 0.063, -0.11, 0.1, 0.122, legends=[L("A/G", 0.0815, 0.105, 0.0046), L("A/A", 0.0815, 0.07, 0.0046), L("NAV", 0.0815, 0.035, 0.0046), L("BEACON", 0.0815, -0.004, 0.004), L("RUD PED", 0.0815, -0.098, 0.0038)],
          controls=[button(0.0815, 0.09, w=0.024, h=0.018), button(0.0815, 0.055, w=0.024, h=0.018), button(0.0815, 0.02, w=0.024, h=0.018), lamp(0.0815, -0.022, "amber", r=0.0065), knob(0.0815, -0.075, r=0.009)]),
    plate("master", "main", -0.1, -0.11, -0.063, 0.122, legends=[L("EMERG JETT", -0.0815, 0.029, 0.0039), L("STEER MODE", -0.0815, -0.014, 0.0037), L("EMERG BK", -0.0815, -0.098, 0.0039)],
          controls=[button(-0.0815, 0.09, face="MASTER|CAUTION", w=0.031, h=0.031, node="Lamp_master", colour="amberbutton"), button(-0.0815, 0.05, face="JETT", w=0.028, h=0.022, colour="stripes"), rotary(-0.0815, -0.038, r=0.0105), pull(-0.0815, -0.08)]),
    # ---- Main panel, lower blocks ----
    plate("gear", "main", -0.39, -0.238, -0.255, -0.142, legends=[L("CAUTION: DO NOT LOWER GEAR ABOVE 300 KT", -0.3225, -0.149, 0.0037, colour="red"), L("NOSE", -0.268, -0.163, 0.0036), L("LEFT", -0.268, -0.188, 0.0036), L("RIGHT", -0.268, -0.213, 0.0036), L("HOOK", -0.372, -0.213, 0.0038), L("UP", -0.336, -0.166, 0.004), L("DN", -0.336, -0.225, 0.004)],
          controls=[lamp(-0.285, -0.163, "green", r=0.0047, node="Lamp_gear_nose"), lamp(-0.285, -0.188, "green", r=0.0047, node="Lamp_gear_left"), lamp(-0.285, -0.213, "green", r=0.0047, node="Lamp_gear_right"), toggle(-0.372, -0.19), wheel(-0.32, -0.195)]),
    plate("start", "main", 0.255, -0.238, 0.39, -0.142, legends=[L("JFS", 0.28, -0.155, 0.0046), L("READY", 0.28, -0.206, 0.0038), L("ENG MASTER", 0.34, -0.155, 0.0042), L("L", 0.32, -0.205, 0.004), L("R", 0.36, -0.205, 0.004)],
          controls=[pull(0.28, -0.178), lamp(0.28, -0.222, "green", r=0.0042), guarded(0.32, -0.183), guarded(0.36, -0.183)]),
    plate("afcs", "main", -0.112, -0.345, 0.112, -0.235, legends=[L("AFCS", -0.09, -0.247, 0.0047), L("ROLL", -0.09, -0.292, 0.004), L("PITCH", -0.055, -0.292, 0.004), L("YAW", -0.02, -0.292, 0.004), L("AUTO", 0.03, -0.252, 0.004), L("ATT", 0.03, -0.3, 0.004), L("HDG", 0.06, -0.3, 0.004), L("PITOT", 0.09, -0.3, 0.004), L("ANTI-SKID", -0.055, -0.335, 0.004), L("SPD BK", 0.055, -0.335, 0.004)],
          controls=[toggle(-0.09, -0.27), toggle(-0.055, -0.27), toggle(-0.02, -0.27), toggle(0.03, -0.27), toggle(0.06, -0.27), toggle(0.09, -0.27), knob(-0.055, -0.318, r=0.0065), lamp(0.055, -0.318, "amber", r=0.0052, node="Lamp_speedbrake")]),
    # ---- Left console, front to back ----
    plate("throttle", "left", -0.44, 0.17, -0.3, 0.62, colour="gray", legends=[L("MIL", -0.385, 0.33, 0.0066), L("IDLE", -0.385, 0.262, 0.0066), L("OFF", -0.385, 0.216, 0.0066), L("AB", -0.385, 0.53, 0.0066), L("FRICTION", -0.33, 0.2, 0.0048)],
          controls=[knob(-0.33, 0.222, r=0.009)]),
    plate("engine", "left", -0.3, 0.32, -0.21, 0.62, title="ENGINE CONTROL", legends=[L("L", -0.272, 0.578), L("R", -0.238, 0.578), L("MASTER", -0.255, 0.518, 0.005), L("INLET", -0.255, 0.46, 0.005), L("AUTO", -0.255, 0.388, 0.0048), L("BOOST", -0.255, 0.336, 0.0048)],
          controls=[guarded(-0.272, 0.552), guarded(-0.238, 0.552), toggle(-0.272, 0.49), toggle(-0.238, 0.49), toggle(-0.272, 0.43), toggle(-0.238, 0.43), rotary(-0.255, 0.362, r=0.0105)]),
    plate("trim", "left", -0.3, 0.17, -0.21, 0.32, title="TRIM", legends=[L("RUDDER", -0.255, 0.27, 0.0048), L("TAKEOFF", -0.255, 0.21, 0.0048)],
          controls=[knob(-0.255, 0.25, r=0.0095), button(-0.255, 0.19, face="SET", w=0.028, h=0.015)]),
    plate("fuel_control", "left", -0.44, -0.04, -0.21, 0.17, title="FUEL", legends=[L("TRANSFER", -0.385, 0.142, 0.005), L("DUMP", -0.285, 0.142, 0.005), L("WING", -0.385, 0.066, 0.005), L("CTR", -0.325, 0.066, 0.005), L("SLIPWAY", -0.255, 0.066, 0.0048), L("REFUEL", -0.39, -0.012, 0.005), L("TANKS", -0.28, -0.012, 0.005)],
          controls=[rotary(-0.385, 0.108, r=0.0135), guarded(-0.285, 0.112), toggle(-0.385, 0.04), toggle(-0.325, 0.04), lamp(-0.255, 0.04, "green"), toggle(-0.39, 0.012), rotary(-0.28, 0.018, r=0.011)]),
    plate("uhf", "left", -0.44, -0.24, -0.21, -0.04, title="UHF COMM", legends=[L("CHAN", -0.39, 0.115 - 0.17, 0.005), L("MODE", -0.255, 0.115 - 0.17, 0.005), L("VOL", -0.325, -0.165, 0.005), L("SQL", -0.255, -0.165, 0.005), L("TONE", -0.39, -0.165, 0.005), L("243.0 GUARD", -0.325, -0.228, 0.0047)],
          controls=[rotary(-0.39, -0.09, r=0.0125), rotary(-0.255, -0.09, r=0.0125), knob(-0.325, -0.19, r=0.0085), toggle(-0.255, -0.19), button(-0.39, -0.19, face="TONE", w=0.026, h=0.015), toggle(-0.325, -0.09)]),
    plate("tacan", "left", -0.44, -0.42, -0.21, -0.24, title="ILS / TACAN", legends=[L("CHAN", -0.385, -0.272, 0.005), L("FREQ", -0.26, -0.272, 0.005), L("MODE", -0.325, -0.355, 0.005), L("VOL", -0.255, -0.355, 0.005), L("T/R", -0.395, -0.355, 0.005)],
          controls=[knob(-0.385, -0.296, r=0.0105), knob(-0.26, -0.296, r=0.0105), rotary(-0.325, -0.378, r=0.011), knob(-0.255, -0.378, r=0.0075), toggle(-0.395, -0.378)]),
    plate("iff", "left", -0.44, -0.62, -0.21, -0.42, title="IFF", legends=[L("MODE 1", -0.4, -0.452, 0.0046), L("MODE 2", -0.35, -0.452, 0.0046), L("MODE 3", -0.3, -0.452, 0.0046), L("MODE 4", -0.25, -0.452, 0.0046), L("MASTER", -0.34, -0.54, 0.005), L("CODE", -0.25, -0.54, 0.005)],
          controls=[toggle(-0.4, -0.478), toggle(-0.35, -0.478), toggle(-0.3, -0.478), toggle(-0.25, -0.478), rotary(-0.34, -0.568, r=0.012), knob(-0.25, -0.568, r=0.0085)]),
    # ---- Right console, front to back ----
    plate("sensor", "right", 0.21, 0.33, 0.44, 0.62, title="SENSOR CONTROL", legends=[L("RADAR", 0.25, 0.545, 0.0052), L("IFF", 0.325, 0.545, 0.0052), L("TEWS", 0.4, 0.545, 0.0052), L("MODE", 0.25, 0.45, 0.0052), L("RANGE", 0.325, 0.45, 0.0052), L("AZ", 0.4, 0.45, 0.0052), L("BIT", 0.25, 0.356, 0.0048), L("HI PRF", 0.325, 0.356, 0.0048), L("ECM", 0.4, 0.356, 0.0048)],
          controls=[rotary(0.25, 0.512, r=0.012), rotary(0.325, 0.512, r=0.012), rotary(0.4, 0.512, r=0.012), knob(0.25, 0.42, r=0.009), knob(0.325, 0.42, r=0.009), knob(0.4, 0.42, r=0.009), toggle(0.25, 0.382), toggle(0.325, 0.382), toggle(0.4, 0.382)]),
    plate("nav", "right", 0.21, 0.08, 0.44, 0.33, title="INERTIAL NAV", legends=[L("MODE", 0.255, 0.292, 0.005), L("FAST ALIGN", 0.255, 0.215, 0.0042), L("HUD", 0.255, 0.15, 0.0048), L("MAG", 0.255, 0.1, 0.0048)],
          controls=[rotary(0.255, 0.26, r=0.0125), lamp(0.255, 0.198, "amber"), toggle(0.235, 0.13), toggle(0.275, 0.13)]
          + grid([0.32, 0.355, 0.39], [0.27, 0.235, 0.2, 0.165], lambda x, y, i, j: button(x, y, face=UFC_KEYS[j * 3 + i], w=0.03, h=0.027))),
    plate("oxygen_panel", "right", 0.21, -0.36, 0.44, -0.18, title="OXYGEN REGULATOR", legends=[L("PRESS", 0.355, -0.21, 0.0047), L("100%", 0.355, -0.29, 0.005), L("NORM", 0.4, -0.29, 0.005), L("EMER", 0.355, -0.345, 0.005), L("ON", 0.4, -0.345, 0.005)],
          controls=[toggle(0.355, -0.255), toggle(0.4, -0.255), toggle(0.355, -0.316), toggle(0.4, -0.316), lamp(0.232, -0.33, "green", r=0.0055)]),
    plate("ecs", "right", 0.21, -0.18, 0.44, 0.08, title="AIR CONDITIONING", legends=[L("TEMP", 0.26, 0.045, 0.005), L("FLOW", 0.385, 0.045, 0.005), L("DEFOG", 0.26, -0.078, 0.005), L("CANOPY", 0.385, -0.078, 0.005), L("ANTI-G", 0.26, -0.155, 0.005), L("ANTI-ICE", 0.385, -0.155, 0.0048)],
          controls=[rotary(0.26, 0.012, r=0.0145), rotary(0.385, 0.012, r=0.0145), knob(0.26, -0.052, r=0.0095), guarded(0.385, -0.052), toggle(0.26, -0.128), toggle(0.385, -0.128)]),
    plate("lights", "right", 0.21, -0.62, 0.44, -0.36, title="LIGHTS", legends=[L("POSITION", 0.255, -0.415, 0.0047), L("FORM", 0.325, -0.415, 0.0047), L("ANTI-COLL", 0.4, -0.415, 0.0042), L("INST", 0.255, -0.505, 0.0047), L("CONSOLE", 0.325, -0.505, 0.0045), L("FLOOD", 0.4, -0.505, 0.0047), L("LDG TAXI", 0.3, -0.59, 0.0047), L("TEST", 0.4, -0.59, 0.0047)],
          controls=[toggle(0.255, -0.44), knob(0.325, -0.445, r=0.009), toggle(0.4, -0.44), knob(0.255, -0.532, r=0.0095), knob(0.325, -0.532, r=0.0095), knob(0.4, -0.532, r=0.0095), toggle(0.3, -0.566), button(0.4, -0.566, face="LAMP", w=0.03, h=0.015)]),
]
PLATES = [moved(p, {"throttle": THROTTLE_SHIFT, "engine": THROTTLE_SHIFT, "trim": THROTTLE_SHIFT, "fuel_control": 0.45}.get(p["id"], 0.0)) if p["surface"] == "left" else p for p in PLATES]


SILL = 0.385
NOSE_Z = -0.4819
HULL = [(y, h, t + NOSE_Z, b + NOSE_Z, e) for y, h, t, b, e in [(6.2, 0.36, 1.6, 0.2, 3.0), (5.5, 0.45, 1.6, 0.18, 3.0), (4.0, 0.46, 1.7, 0.18, 3.0), (3.15, 0.36, 1.7, 0.25, 3.0)]]
GLASS = [(y, h, t + NOSE_Z, r + NOSE_Z) for y, h, t, r in [(6.87, 0.28, 1.06, 0.92), (6.25, 0.43, 1.40, 0.86), (5.75, 0.47, 1.65, 0.86), (5.25, 0.485, 1.77, 0.86), (4.75, 0.485, 1.77, 0.86), (4.25, 0.47, 1.72, 0.86), (3.75, 0.44, 1.64, 0.86), (3.25, 0.39, 1.54, 0.86), (2.76, 0.2, 1.44, 0.92)]]
VIEWS = {
    "forward": (EYE, (0.0, 5.3, 0.62), 68),
    "panel": (EYE, (0.0, 5.33, 0.27), 34),
    "left": (EYE, (-0.33, 4.75, 0.03), 68),
    "right": (EYE, (0.33, 4.75, 0.03), 68),
    "down": (EYE, (0.0, 4.72, -0.12), 68),
}


def build(k):
    edge = [(-0.3 + i * 0.1, 0.34) for i in range(7)]
    k.main_panel(balls=(ADI, STANDBY_ADI), fasteners=edge + [(-0.2, 0.128), (0.203, 0.128), (-0.2, -0.14), (0.207, -0.14), (-0.113, -0.14), (0.113, -0.14), (-0.405, -0.139), (0.402, -0.139), (0.402, 0.12), (-0.109, -0.2), (0.109, -0.2), (-0.109, -0.23), (0.109, -0.23)])
    for entry in PLATES:
        k.plate(entry)
    k.gauges()
    k.clock(CLOCK)
    k.drums("Drum_altitude", "main", 0.15 - 0.0145, 0.072, 3, 0.0068, 0.0105)
    k.drums("Drum_fuel", "main", 0.356, -0.03 - 0.0145, 5, 0.0062, 0.0088)
    k.adi(ADI)
    k.adi(STANDBY_ADI, "Standby_ADI", "Standby_ADI_ball")
    k.hsi(HSI)
    k.screen("VSD", "main", VSD["x"], VSD["y"], VSD["screen"], VSD["bezel"])
    k.screen("TEWS", "main", TEWS["x"], TEWS["y"], TEWS["screen"], TEWS["bezel"], round_face=True)
    k.screen("MPCD", "main", MPCD["x"], MPCD["y"], MPCD["screen"], MPCD["bezel"])
    k.display_keys("main", MPCD["x"], MPCD["y"], MPCD["screen"], MPCD["bezel"])
    k.readout("UFC", "main", UFC["x"], UFC["y"], UFC["w"], UFC["h"])
    k.tub(HULL, SILL, [3.2, 3.5, 3.8, 4.1, 4.4, 4.7, 5.0, 5.25, 5.5, 5.8, 6.1])
    k.sill_rails(HULL, SILL, 3.3, 5.42)
    k.console("left", -0.205, -0.45, 3.99, 5.275, CONSOLE_TOP, -0.245)
    k.console("right", 0.205, 0.45, 3.99, 5.275, CONSOLE_TOP, -0.245)
    k.wall_details(HULL, SILL, 3.99, 5.39, CONSOLE_TOP)
    k.jettison_handle(-0.45, 5.12, 0.3)
    k.map_case(0.45, 4.45, 0.27)
    k.breaker_panel(0.45, 5.05, 0.285)
    k.floor(-0.245, 3.96, 5.3, 0.207)
    k.knee_well(-0.245, 0.05, 5.34, 0.45, 0.065, 5.235, -0.05)
    k.pedals(0.165, 5.16, -0.245)
    k.stick(4.84, -0.245)
    k.throttle("left", -0.405, -0.365, 0.2 + THROTTLE_SHIFT, 0.55 + THROTTLE_SHIFT, 0.34 + THROTTLE_SHIFT, 0.292 + THROTTLE_SHIFT)
    side = SILL + 0.005
    k.hood([(5.37, 0.452, 0.644, side), (5.4, 0.455, 0.66, side), (5.47, 0.458, 0.668, side), (5.72, 0.46, 0.68, side), (6.0, 0.435, 0.64, SILL + 0.012), (6.3, 0.39, 0.58, SILL + 0.03), (6.6, 0.32, 0.5, SILL + 0.05)], [(5.43, 0.448, 0.61, SILL), (5.38, 0.448, 0.624, SILL), (5.36, 0.451, 0.634, SILL + 0.002), (5.37, 0.452, 0.644, side)], stud_y=5.46)
    k.hud_unit()
    k.canopy_trim(GLASS, 5.69, [5.68, 2.84])
    # Forward under the eye, so the seated pilot's back and hips rest on the cushions; the pan stops short of the stick.
    with k.placed((0.0, 0.375, 0.0)):
        k.seat(top=0.123, front=4.29)
