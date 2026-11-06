"""Dial scales and panel helpers shared by every detail cockpit.

Panel coordinates are metres on the face of each surface: x to the pilot's right,
y up the panel or forward along a console.
"""


def needle(stops, major=None, minor=None, labels=None, title="", sub="", arcs=()):
    return dict(stops=stops, major=major or [], minor=minor or [], labels=labels or {}, title=title, sub=sub, arcs=list(arcs))


def sweep(low, high, step, start=-135.0, end=135.0):
    return [[low, start], [high, end]]


# Dial scales: value to degrees clockwise from twelve o'clock.
SCALES = {
    "airspeed": needle(
        [[0, 0], [100, 30], [200, 105], [300, 160], [400, 200], [500, 235], [600, 270], [700, 305], [800, 340]],
        major=[100, 200, 300, 400, 500, 600, 700, 800],
        minor=[120, 140, 160, 180, 220, 240, 260, 280, 320, 340, 360, 380, 450, 550, 650, 750],
        labels={100: "1", 200: "2", 300: "3", 400: "4", 500: "5", 600: "6", 700: "7", 800: "8"},
        title="KNOTS", sub="MACH",
    ),
    "altimeter": needle(
        [[0, 0], [1000, 360]],
        major=[0, 100, 200, 300, 400, 500, 600, 700, 800, 900],
        minor=[n for n in range(0, 1000, 20) if n % 100],
        labels={n * 100: str(n) for n in range(10)},
        title="ALT", sub="100 FEET",
    ),
    "aoa": needle(
        sweep(0, 45, 5, -140, 140),
        major=[0, 10, 20, 30, 40], minor=[5, 15, 25, 35, 45],
        labels={0: "0", 10: "10", 20: "20", 30: "30", 40: "40"},
        title="ANGLE OF", sub="ATTACK", arcs=[(22, 26, (70, 220, 90))],
    ),
    "gmeter": needle(
        [[-4, -150], [0, -60], [1, -37.5], [10, 150]],
        major=[-4, -2, 0, 2, 4, 6, 8, 10], minor=[-3, -1, 1, 3, 5, 7, 9],
        labels={-4: "4", -2: "2", 0: "0", 2: "2", 4: "4", 6: "6", 8: "8", 10: "10"},
        title="ACCEL", sub="G UNITS", arcs=[(9, 10, (235, 60, 50))],
    ),
    "vvi": needle(
        [[-6000, -240], [-4000, -195], [-2000, -160], [-1000, -130], [0, -90], [1000, -50], [2000, -20], [4000, 15], [6000, 60]],
        major=[-6000, -4000, -2000, -1000, 0, 1000, 2000, 4000, 6000],
        minor=[-5000, -3000, -500, 500, 3000, 5000],
        labels={-6000: "6", -4000: "4", -2000: "2", -1000: "1", 0: "0", 1000: "1", 2000: "2", 4000: "4", 6000: "6"},
        title="VERT VEL", sub="1000 FT MIN",
    ),
    "rpm": needle(
        sweep(0, 110, 10, -135, 135),
        major=[0, 20, 40, 60, 80, 100], minor=[10, 30, 50, 70, 90, 110],
        labels={0: "0", 20: "2", 40: "4", 60: "6", 80: "8", 100: "10"},
        title="RPM", sub="% X 10", arcs=[(100, 110, (235, 60, 50))],
    ),
    "ftit": needle(
        [[200, -135], [1200, 135]],
        major=[200, 400, 600, 800, 1000, 1200], minor=[300, 500, 700, 900, 1100],
        labels={200: "2", 400: "4", 600: "6", 800: "8", 1000: "10", 1200: "12"},
        title="FTIT", sub="C X 100", arcs=[(980, 1200, (235, 60, 50))],
    ),
    "fuelflow": needle(
        sweep(0, 100, 10, -135, 135),
        major=[0, 20, 40, 60, 80, 100], minor=[10, 30, 50, 70, 90],
        labels={0: "0", 20: "20", 40: "40", 60: "60", 80: "80", 100: "100"},
        title="FUEL FLOW", sub="PPH X 100",
    ),
    "nozzle": needle(
        sweep(0, 100, 10, -135, 135),
        major=[0, 25, 50, 75, 100], minor=[10, 20, 30, 40, 60, 70, 80, 90],
        labels={0: "0", 25: "", 50: "5", 75: "", 100: "10"},
        title="NOZ POS", sub="% OPEN",
    ),
    "oil": needle(
        sweep(0, 100, 10, -135, 135),
        major=[0, 50, 100], minor=[25, 75],
        labels={0: "0", 50: "5", 100: "10"},
        title="OIL", sub="", arcs=[(25, 70, (70, 220, 90))],
    ),
    "hydraulic": needle(
        sweep(0, 4000, 1000, -135, 135),
        major=[0, 2000, 4000], minor=[1000, 3000],
        labels={0: "0", 2000: "2", 4000: "4"},
        title="HYD", sub="", arcs=[(2800, 3300, (70, 220, 90))],
    ),
    "fuel": needle(
        sweep(0, 14000, 1000, -140, 140),
        major=[0, 2000, 4000, 6000, 8000, 10000, 12000, 14000], minor=[1000, 3000, 5000, 7000, 9000, 11000, 13000],
        labels={0: "0", 2000: "2", 4000: "4", 6000: "6", 8000: "8", 10000: "10", 12000: "12", 14000: "14"},
        title="FUEL QTY", sub="LBS X 1000",
    ),
    "cabin": needle(
        sweep(0, 50000, 10000, -135, 135),
        major=[0, 10000, 20000, 30000, 40000, 50000], minor=[5000, 15000, 25000, 35000, 45000],
        labels={0: "0", 10000: "1", 20000: "2", 30000: "3", 40000: "4", 50000: "5"},
        title="CABIN", sub="ALT",
    ),
    "oxygen": needle(
        sweep(0, 10, 1, -120, 120),
        major=[0, 5, 10], minor=[1, 2, 3, 4, 6, 7, 8, 9],
        labels={0: "E", 5: "1/2", 10: "F"},
        title="OXYGEN", sub="LITERS",
    ),
}
def L(text, x, y, size=0.0058, align="c", colour="white"):
    return dict(text=text, x=x, y=y, size=size, align=align, colour=colour)


def knob(x, y, label="", r=0.0085, marks=(), node=None):
    return dict(kind="knob", x=x, y=y, label=label, r=r, marks=list(marks), node=node)


def rotary(x, y, label="", r=0.013, marks=()):
    return dict(kind="rotary", x=x, y=y, label=label, r=r, marks=list(marks))


def toggle(x, y, label="", up="", down=""):
    return dict(kind="toggle", x=x, y=y, label=label, up=up, down=down)


def guarded(x, y, label="", up="", down=""):
    return dict(kind="guard", x=x, y=y, label=label, up=up, down=down)


def button(x, y, label="", w=0.015, h=0.012, face="", node=None, colour="black"):
    return dict(kind="button", x=x, y=y, label=label, w=w, h=h, face=face, node=node, colour=colour)


def lamp(x, y, colour="green", label="", r=0.0045, node=None):
    return dict(kind="lamp", x=x, y=y, colour=colour, label=label, r=r, node=node)


def pull(x, y, label="", colour="yellow"):
    return dict(kind="pull", x=x, y=y, label=label, colour=colour)


def wheel(x, y, label=""):
    return dict(kind="wheel", x=x, y=y, label=label)


def plate(id, surface, x0, y0, x1, y1, title="", legends=(), controls=(), colour="black"):
    return dict(id=id, surface=surface, x0=x0, y0=y0, x1=x1, y1=y1, title=title, legends=list(legends), controls=list(controls), colour=colour)


def grid(xs, ys, make):
    return [make(x, y, i, j) for j, y in enumerate(ys) for i, x in enumerate(xs)]




def auto_plate(id, surface, x0, y0, x1, y1, title, items, columns=None):
    """Lays controls out in an even grid with a label under each one."""
    columns = columns or max(1, round((x1 - x0) / 0.052))
    rows = max(1, -(-len(items) // columns))
    top = y1 - (0.026 if title else 0.006)
    cell_w, cell_h = (x1 - x0) / columns, (top - y0) / rows
    legends, controls = [], []
    for index, (kind, label) in enumerate(items):
        col, row = index % columns, index // columns
        x, y = x0 + (col + 0.5) * cell_w, top - (row + 0.42) * cell_h
        small = min(cell_w, cell_h)
        if label:
            legends.append(L(label, x, y - min(0.024, small * 0.42), min(0.0052, cell_w / max(4, len(label)) * 1.5)))
        if kind == "knob":
            controls.append(knob(x, y, r=min(0.0095, small * 0.2)))
        elif kind == "rotary":
            controls.append(rotary(x, y, r=min(0.0125, small * 0.25)))
        elif kind == "toggle":
            controls.append(toggle(x, y))
        elif kind == "guard":
            controls.append(guarded(x, y))
        elif kind == "lamp":
            controls.append(lamp(x, y, "amber", r=min(0.0055, small * 0.14)))
        elif kind == "green":
            controls.append(lamp(x, y, "green", r=min(0.0055, small * 0.14)))
        elif kind == "pull":
            controls.append(pull(x, y))
        else:
            controls.append(button(x, y, face=kind, w=min(0.032, cell_w * 0.74), h=min(0.018, cell_h * 0.46)))
    return plate(id, surface, x0, y0, x1, y1, title, legends, controls)


def annunciators(id, surface, x0, y0, x1, y1, title, names, columns=2):
    rows = -(-len(names) // columns)
    top = y1 - 0.018
    cell_w, cell_h = (x1 - x0) / columns, (top - y0) / rows
    controls = [
        button(x0 + (i % columns + 0.5) * cell_w, top - (i // columns + 0.5) * cell_h, face=name, w=cell_w * 0.88, h=cell_h * 0.82, colour="annunciator")
        for i, name in enumerate(names)
    ]
    return plate(id, surface, x0, y0, x1, y1, "", [L(title, (x0 + x1) / 2, y1 - 0.009, 0.0048)], controls)
