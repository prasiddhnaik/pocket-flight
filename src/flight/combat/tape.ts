import { Object3D, Vector3 } from "three";
import { combatAircraft } from "../../aircraft/weapons/combat-loadouts";
import type { AircraftId } from "../../aircraft/aircraft";
import type { FinchVariant } from "../../aircraft/finch/attack";
import { aircraftChoice, choiceName } from "../../app/flight-ui";
import { CombatSimulation, moveOrbit, type Ordnance } from "./simulation";
import { rangeTargets } from "./range";
import { stores } from "./loadout";
import { CombatVisuals, type Blast } from "./visuals";
import type { BlastSurface } from "./explosions";

// What the sandbox adds to a replay frame. Plain numbers and strings, so it saves
// with the frame. Each frame holds full state, so any moment can be shown alone.
export type CombatFrame = {
  /** Drone circuit clock. */
  clock: number;
  /** Dummies that are down at this moment. */
  down: string[];
  /** Rounds left on each station. */
  stores: number[];
  /** Rounds in flight: id, 0 rocket or 1 missile, position, velocity. */
  rounds: number[][];
  /** Blasts since the previous frame: position, surface, size. */
  blasts: number[][];
};
type TapeFrame = { t: number; combat?: CombatFrame };

const SURFACES: BlastSurface[] = ["ground", "water", "air"];
const metres = (n: number) => Math.round(n * 100) / 100;
// Smoke from anything older than this has already cleared.
const SETTLE = 6;
const STEP = 1 / 15;
// A longer jump is a seek, so the effects are rebuilt instead of played through.
const LONGEST_STEP = 0.5;

export function encodeBlast({ point, surface, size }: Blast) {
  return [metres(point.x), metres(point.y), metres(point.z), SURFACES.indexOf(surface), size];
}
const decodeBlast = ([x, y, z, surface, size]: number[]): Blast => ({
  point: new Vector3(x, y, z),
  surface: SURFACES[surface] ?? "ground",
  size,
});

export function captureCombat(simulation: CombatSimulation, blasts: number[][]): CombatFrame {
  return {
    clock: metres(simulation.clock),
    down: simulation.targets.filter((target) => target.health <= 0).map((target) => target.id),
    stores: simulation.stations.map((station) => station.remaining),
    rounds: simulation.projectiles.map((round) => [
      round.id,
      round.kind === "rocket" ? 0 : 1,
      metres(round.position.x), metres(round.position.y), metres(round.position.z),
      metres(round.velocity.x), metres(round.velocity.y), metres(round.velocity.z),
    ]),
    blasts,
  };
}

/** Which model a recording flew. Only the A-2 could enter the sandbox as a Finch,
 * so sandbox recordings made before the variant was saved are A-2s too. */
export function replayVariant(replay: { aircraft: string; mission: string; variant?: FinchVariant }): FinchVariant {
  return replay.variant ?? (replay.aircraft === "finch" && replay.mission === "combat" ? "attack" : "trainer");
}

/** Plays a recording's dummies, rounds and blasts back at any time, forward or scrubbed. */
export class ReplayCombat {
  readonly visuals: CombatVisuals;
  private readonly simulation: CombatSimulation;
  private last: number | null = null;
  constructor(
    id: string,
    aircraft: Object3D,
    height: (x: number, z: number) => number,
    water: (x: number, z: number) => boolean,
    private readonly onBlast?: (point: Vector3) => void,
  ) {
    const configuration = combatAircraft(id, aircraft);
    if (!configuration) throw new Error(`${id} has no combat configuration.`);
    this.simulation = new CombatSimulation(configuration.hardpoints, configuration.loadout, rangeTargets(height));
    this.visuals = new CombatVisuals(this.simulation, aircraft, water, configuration.keepStores);
  }
  private frameAt(frames: readonly TapeFrame[], time: number) {
    let lo = 0,
      hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (frames[mid].t <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  private apply(frame: TapeFrame, time: number) {
    const tape = frame.combat;
    const since = time - frame.t;
    const clock = (tape?.clock ?? frame.t) + since;
    for (const target of this.simulation.targets) {
      moveOrbit(target, clock);
      target.health = tape?.down.includes(target.id) ? 0 : (target.maxHealth ?? 3);
    }
    this.simulation.stations.forEach((station, i) => {
      station.remaining = tape?.stores[i] ?? stores[station.store].rounds;
    });
    this.simulation.projectiles = (tape?.rounds ?? []).map((round): Ordnance => {
      const velocity = new Vector3(round[5], round[6], round[7]);
      return {
        id: round[0],
        kind: round[1] === 0 ? "rocket" : "missile",
        position: new Vector3(round[2], round[3], round[4]).addScaledVector(velocity, since),
        velocity,
        age: 0,
        target: null,
        damage: 0,
        lifetime: 0,
      };
    });
  }
  private advance(frames: readonly TapeFrame[], from: number, to: number, viewScale: number, audible: boolean) {
    const index = this.frameAt(frames, to);
    for (let i = index; i >= 0 && frames[i].t > from; i--)
      for (const encoded of frames[i].combat?.blasts ?? []) {
        const blast = decodeBlast(encoded);
        this.visuals.explode(blast);
        if (audible) this.onBlast?.(blast.point);
      }
    this.apply(frames[index], to);
    this.visuals.update(to - from, [], viewScale);
  }
  /** Rebuilds what a viewer would see at `time`: old scorch marks, then recent smoke. */
  private seek(frames: readonly TapeFrame[], time: number, viewScale: number) {
    this.visuals.clearEffects();
    const start = Math.max(frames[0].t, time - SETTLE);
    for (const frame of frames) {
      if (frame.t > start) break;
      for (const encoded of frame.combat?.blasts ?? []) {
        const blast = decodeBlast(encoded);
        if (blast.surface === "ground") this.visuals.scorch(blast);
      }
    }
    for (let t = start; t < time; t += STEP)
      this.advance(frames, t, Math.min(t + STEP, time), viewScale, false);
    this.advance(frames, time, time, viewScale, false);
  }
  pose(frames: readonly TapeFrame[], time: number, viewScale: number, audible = false) {
    if (!frames.length) return;
    const step = this.last === null ? Infinity : time - this.last;
    if (step >= 0 && step < LONGEST_STEP) this.advance(frames, this.last!, time, viewScale, audible);
    else this.seek(frames, time, viewScale);
    this.last = time;
  }
  dispose() {
    this.visuals.dispose();
  }
}

export function replayAircraftName(replay: { aircraft: AircraftId; mission: string; variant?: FinchVariant }) {
  return choiceName(aircraftChoice(replay.aircraft, replayVariant(replay)));
}
