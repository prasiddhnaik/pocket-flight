import { expect, test } from "bun:test";
import { Vector3, Quaternion, Euler } from "three";
import { resolveWheelPenetration } from "../src/wheel-contact";
import { FlightPhysics } from "../src/physics";
import { sampledTireClearance, validateGear } from "../lab/gear-validation";
for (const id of ["finch", "peregrine", "aurelia", "stormbird"] as const) {
  test(`${id}: actual tire profile samples clear both runways across frame rates and attitude`, () => {
    const result = validateGear(id);
    for (const c of result.checks)
      expect(
        c.pass,
        `${c.name}: min ${result.minimumClearance} max ${result.maximumClearance}`,
      ).toBe(true);
  });
  test(`${id}: overlap correction preserves attitude and lateral position; airborne poses are unchanged`, () => {
    const position = new Vector3(-260, 8, 260),
      q = new Quaternion().setFromEuler(new Euler(0.08, 0, 0.04)),
      before = q.clone();
    const depth = resolveWheelPenetration(position, q, id, 1);
    expect(depth).toBeGreaterThan(0);
    expect(q.equals(before)).toBe(true);
    expect(position.x).toBe(-260);
    expect(position.z).toBe(260);
    const airborne = new Vector3(-260, 100, 260),
      height = airborne.y;
    expect(resolveWheelPenetration(airborne, q, id, 1)).toBe(0);
    expect(airborne.y).toBe(height);
    if (id !== "finch")
      expect(resolveWheelPenetration(new Vector3(-260, 8, 260), q, id, 0)).toBe(
        0,
      );
  });
  test(`${id}: correcting initial overlap retains damaging landing speed`, () => {
    const p = new FlightPhysics();
    p.aircraftId = id;
    p.reset(true);
    p.gearPosition = 1;
    p.windOverride = new Vector3();
    p.beginnerAssist = false;
    p.position.set(-260, 8, 260);
    resolveWheelPenetration(p.position, p.quaternion, id, 1);
    p.position.y -= 0.2;
    p.velocity.set(0, -7, 0);
    p.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false });
    expect(p.events.some((e) => e.type === "impact" && e.part === "gear")).toBe(
      true,
    );
    expect(p.damage.gear).toBeGreaterThan(0);
    expect(sampledTireClearance(p)).toBeGreaterThanOrEqual(-1e-4);
  });
}
