async (page) => {
  const errors = [];
  let stage = "initial load";
  try {
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => !!window.pocketFlight);
    await page.evaluate(async () => {
      await window.pocketFlight.aircraft.ready;
      await window.pocketFlight.world.ready;
    });
    await page
      .getByLabel("Choose aircraft", { exact: true })
      .selectOption("f15c");
    await page
      .getByRole("button", { name: "Combat range", exact: true })
      .click();
    await page.waitForFunction(
      () => window.pocketFlight.mission.id === "combat",
    );
    const initial = await page.evaluate(() => {
      const game = window.pocketFlight;
      game.setSuspended(true);
      return {
        mode: game.mode,
        rockets: game.combat.simulation.ammunition("rocket"),
        missiles: game.combat.simulation.ammunition("missile"),
        targets: game.combat.simulation.targets.length,
        stations: game.combat.simulation.stations.map((station) => ({
          id: station.hardpoint.id,
          position: station.hardpoint.position,
          remaining: station.remaining,
        })),
        hud: document.querySelector("[data-combat-hud]").textContent,
      };
    });
    if (
      initial.mode !== "playing" ||
      initial.rockets !== 8 ||
      !initial.missiles ||
      initial.targets !== 4
    )
      throw new Error(JSON.stringify(initial));
    // Set an aiming pose, then exercise real keyboard input and the running game loop.
    await page.evaluate(() => {
      const game = window.pocketFlight,
        p = game.physics;
      p.pitch = 0;
      p.roll = 0;
      p.yaw = 0;
      p.updateQuaternion();
      game.previousPosition.copy(p.position);
      game.previousQuaternion.copy(p.quaternion);
      game.setSuspended(false);
    });
    stage = "gun hits";
    await page.keyboard.down("j");
    await page.waitForFunction(
      () => window.pocketFlight.combat.simulation.destroyed >= 1,
      null,
      { timeout: 15000 },
    );
    await page.keyboard.up("j");
    const gun = await page.evaluate(() => {
      const game = window.pocketFlight;
      game.setSuspended(true);
      return {
        rounds: game.cannon.simulation.ammunition,
        hits: game.combat.simulation.hits,
        destroyed: game.combat.simulation.destroyed,
        crashed: game.physics.crashed,
        hud: document.querySelector("[data-combat-hud]").textContent,
      };
    });
    if (gun.rounds >= 940 || gun.hits < 3 || gun.crashed)
      throw new Error(JSON.stringify(gun));
    // Restart re-arms and resets target health. Aim a rocket at a ground target
    // using its declared station and inherited velocity, without changing targets.
    await page.evaluate(async () => {
      const game = window.pocketFlight;
      const { combatMission } = await import("/src/flight/missions.ts");
      game.start(combatMission);
      const p = game.physics,
        sim = game.combat.simulation;
      const target = sim.targets.find((target) => target.kind === "ground");
      const station = sim.stations.find(
        (station) => station.store === "rocket",
      );
      const { Vector3, Quaternion } =
        await import("/node_modules/.vite/deps/three.js");
      const offset = new Vector3(...station.hardpoint.position);
      const delta = target.position.clone().sub(p.position);
      let time = delta.length() / (350 + p.velocity.length());
      let direction = delta.clone();
      for (let i = 0; i < 12; i++) {
        const rotation = new Quaternion().setFromUnitVectors(
          new Vector3(0, 0, -1),
          direction.clone().normalize(),
        );
        direction = delta
          .clone()
          .sub(offset.clone().applyQuaternion(rotation))
          .addScaledVector(p.velocity, -time);
        direction.y += (9.81 * time * time) / 2;
        time = direction.length() / 350;
      }
      direction.normalize();
      p.yaw = Math.atan2(-direction.x, -direction.z);
      p.pitch = Math.asin(direction.y);
      p.roll = 0;
      p.updateQuaternion();
      game.previousPosition.copy(p.position);
      game.previousQuaternion.copy(p.quaternion);
      game.setSuspended(false);
    });
    stage = "rocket hits";
    await page.keyboard.down("k");
    await page.waitForFunction(
      () => window.pocketFlight.combat.simulation.ammunition("rocket") === 7,
    );
    await page.keyboard.up("k");
    await page.waitForFunction(
      () => window.pocketFlight.combat.simulation.destroyed >= 1,
      null,
      { timeout: 15000 },
    );
    const rocket = await page.evaluate(() => {
      const game = window.pocketFlight;
      game.setSuspended(true);
      return {
        remaining: game.combat.simulation.ammunition("rocket"),
        destroyed: game.combat.simulation.destroyed,
        groundHealth: game.combat.simulation.targets
          .filter((target) => target.kind === "ground")
          .map((target) => target.health),
        crashed: game.physics.crashed,
      };
    });
    if (
      rocket.remaining !== 7 ||
      rocket.destroyed < 1 ||
      !rocket.groundHealth.includes(0) ||
      rocket.crashed
    )
      throw new Error(JSON.stringify(rocket));
    await page.screenshot({
      path: "output/combat-check/rocket-ground-hit.png",
    });
    await page.evaluate(async () => {
      const game = window.pocketFlight;
      const { combatMission } = await import("/src/flight/missions.ts");
      game.start(combatMission);
      game.setSuspended(false);
    });
    await page.waitForFunction(
      () => window.pocketFlight.combat.simulation.lockTime >= 0.6,
      null,
      { timeout: 15000 },
    );
    stage = "missile hits";
    await page.keyboard.down("l");
    await page.waitForFunction(
      () => window.pocketFlight.combat.simulation.ammunition("missile") < 6,
    );
    await page.keyboard.up("l");
    await page.waitForFunction(
      () => window.pocketFlight.combat.simulation.destroyed >= 1,
      null,
      { timeout: 15000 },
    );
    const missile = await page.evaluate(() => {
      const game = window.pocketFlight;
      game.setSuspended(true);
      return {
        remaining: game.combat.simulation.ammunition("missile"),
        destroyed: game.combat.simulation.destroyed,
        airHealth: game.combat.simulation.targets
          .filter((target) => target.kind === "air")
          .map((target) => target.health),
        crashed: game.physics.crashed,
      };
    });
    if (
      missile.remaining !== initial.missiles - 1 ||
      !missile.airHealth.includes(0) ||
      missile.crashed
    )
      throw new Error(JSON.stringify(missile));
    await page.screenshot({ path: "output/combat-check/missile-air-hit.png" });
    stage = "fleet entry";
    const fleet = [];
    for (const choice of ["peregrine", "stormbird", "finch-attack"]) {
      await page.evaluate(() => {
        window.pocketFlight.menu();
      });
      await page
        .getByLabel("Choose aircraft", { exact: true })
        .selectOption(choice);
      await page
        .getByRole("button", { name: "Combat range", exact: true })
        .click();
      const result = await page.evaluate(() => {
        const game = window.pocketFlight;
        game.setSuspended(true);
        return {
          aircraft: game.aircraft.id,
          variant: game.aircraft.variant,
          mode: game.mode,
          rockets: game.combat.simulation?.ammunition("rocket"),
          missiles: game.combat.simulation?.ammunition("missile"),
          gun: game.combat.hasGun,
        };
      });
      if (result.mode !== "playing" || !result.rockets)
        throw new Error(JSON.stringify(result));
      fleet.push({ choice, ...result });
    }
    await page.evaluate(async () => {
      const game = window.pocketFlight;
      game.menu();
      const { missions } = await import("/src/flight/missions.ts");
      game.start(missions.find((mission) => mission.id === "free"));
    });
    const freeFlight = await page.evaluate(() => ({
      combatActive: !!window.pocketFlight.combat.simulation,
      hudHidden:
        document.querySelector("[data-combat-hud]").style.display === "none",
    }));
    if (freeFlight.combatActive || !freeFlight.hudHidden)
      throw new Error("Combat state leaked into free flight");
    if (errors.length) throw new Error(errors.join("\n"));
    return { initial, gun, rocket, missile, fleet, freeFlight, errors };
  } catch (error) {
    const state = await page.evaluate(() => {
      const game = window.pocketFlight;
      return {
        mode: game?.mode,
        suspended: game?.suspended,
        position: game?.physics.position.toArray(),
        shots: game?.cannon.simulation.shots,
        targets: game?.combat.simulation?.targets,
        rockets: game?.combat.simulation?.ammunition("rocket"),
        missiles: game?.combat.simulation?.ammunition("missile"),
        lock: game?.combat.simulation?.lockTime,
        projectiles: game?.combat.simulation?.projectiles,
      };
    });
    throw new Error(`${stage}: ${String(error)}\n${JSON.stringify(state)}`);
  }
};
