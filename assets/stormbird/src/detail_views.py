"""Inspection exports taken directly from the master assembly, without remodeling.
Cockpit glazing and the surrounding airframe are omitted to expose attachment details.
"""
from cadgen import build123d as b, step
from copy import copy
from stormbird import stormbird


def select(prefixes, group_name):
    master=copy(stormbird())
    parts=[s.moved(b.Location()) for s in master.children if any(s.label.startswith(p) for p in prefixes)]
    return b.Compound(children=parts,label=group_name)


@step(out='../STEP/inspection/Cockpit.step')
def cockpit():
    return select(('Cockpit_pressure','Seat_','Seat_back','Back_','Headrest','Harness','Instrument_',
                   'Display_','Side_console','Switch_','Stick_','Pedal_','Rudder_pedal'),'Cockpit')


@step(out='../STEP/inspection/LandingGear.step')
def landing_gear():
    return select(('LandingGear','Main_bay','Nose_bay','Main_trunnion','Main_drag','Nose_drag',
                   'Main_door','Nose_door'),'Landing_gear_detail')


@step(out='../STEP/inspection/Nozzles.step')
def nozzles():
    return select(('Nozzle_','Exhaust_liner','Turbine_'),'Nozzle_detail')


@step(out='../STEP/inspection/Intakes.step')
def intakes():
    return select(('Fuselage','Compressor_','Engine_core_case_','Engine_shaft_'),'Intake_shoulders_context')


@step(out='../STEP/inspection/CompressorFaces.step')
def compressor_faces():
    # Inspect the actual saved artifact without rebuilding the complete master.
    from pathlib import Path
    from cadgen import read_scene, srgb
    scene=read_scene(Path(__file__).resolve().parents[1]/'STEP/Stormbird-HX40.step')
    parts=[]
    for node in scene.roots[0].children:
        if not node.label.startswith('Compressor_'):continue
        part=scene.resolve(node.ref).shape()
        part.label=node.label
        part.color=srgb('#293b47' if node.label.startswith('Compressor_case_') else '#a2acb4')
        parts.append(part)
    return b.Compound(children=parts,label='Compressor_faces')


if __name__=='__main__':
    cockpit(); landing_gear(); nozzles(); intakes(); compressor_faces()
