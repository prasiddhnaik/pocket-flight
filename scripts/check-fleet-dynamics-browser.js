async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.waitForFunction(() => !!window.pocketFlight);
  const results = [];
  for (const id of ["finch", "peregrine", "aurelia", "stormbird"]) {
    await page
      .getByRole("combobox", { name: "Choose aircraft" })
      .selectOption(id);
    await page.waitForFunction(
      (id) =>
        window.pocketFlight.aircraft.id === id &&
        !document.querySelector(".aircraft-picker").disabled,
      id,
    );
    await page.evaluate(async () => {
      const g = window.pocketFlight,
        p = g.physics;
      await g.aircraft.ready;
      p.beginnerAssist = true;
      p.originalFleetStep ??= p.step.bind(p);
      window.fleetDeparture = { takeoff: null, gate: null };
      p.step = (dt, input, obstacles) => {
        p.originalFleetStep(dt, input, obstacles);
        if (
          !window.fleetDeparture.takeoff &&
          p.events.some((e) => e.type === "takeoff")
        )
          window.fleetDeparture.takeoff = {
            time: p.flightTime,
            knots: p.airspeed * 1.943844,
            position: p.position.toArray(),
          };
        if (!window.fleetDeparture.gate && p.position.z < 130)
          window.fleetDeparture.gate = {
            time: p.flightTime,
            height: p.position.y,
          };
        if (p.flightTime >= 20) g.setSuspended(true);
      };
    });
    await page
      .getByRole("button", { name: "Start flight", exact: true })
      .click();
    await page.keyboard.down("Shift");
    await page.waitForFunction(
      () =>
        window.pocketFlight.physics.airspeed * 1.943844 >=
        window.pocketFlight.physics.profile.rotationKnots,
      null,
      { timeout: 45000 },
    );
    await page.keyboard.down("s");
    await page.waitForFunction(() => window.pocketFlight.suspended, null, {
      timeout: 60000,
    });
    await page.keyboard.up("s");
    await page.keyboard.up("Shift");
    const evidence = await page.evaluate(() => {
      const g = window.pocketFlight,
        p = g.physics;
      const state = g.getState();
      const gearPose = g.aircraft.effects?.motion.gear ?? 1;
      const surfacePose =
        g.aircraft.effects?.motion ?? g.aircraft.surfaces.snapshot();
      g.camera.position.set(
        p.position.x + 18,
        p.position.y + 7,
        p.position.z + 28,
      );
      g.camera.lookAt(p.position);
      g.camera.updateProjectionMatrix();
      g.emit();
      g.renderer.render(g.scene, g.camera);
      return {
        id: p.aircraftId,
        departure: window.fleetDeparture,
        state,
        gearPose,
        surfaces: {
          pitch: surfacePose.pitch,
          roll: surfacePose.roll,
          yaw: surfacePose.yaw,
        },
        physicalSurfaces: { ...p.surfaces },
        gearPosition: p.gearPosition,
      };
    });
    if (
      !evidence.departure.takeoff ||
      evidence.state.grounded ||
      evidence.state.crashed ||
      evidence.state.health !== 100 ||
      !evidence.state.aerodynamics ||
      evidence.state.position[1] < 55
    )
      throw new Error(JSON.stringify(evidence));
    if (Math.abs(evidence.gearPose - evidence.gearPosition) > 0.00001)
      throw new Error(
        "Rendered gear disagrees with physical extension: " +
          JSON.stringify(evidence),
      );
    for (const axis of ["pitch", "roll", "yaw"])
      if (
        Math.abs(evidence.surfaces[axis] - evidence.physicalSurfaces[axis]) >
        0.00001
      )
        throw new Error(
          "Rendered controls disagree with physical actuators: " +
            JSON.stringify(evidence),
        );
    await page
      .locator("canvas")
      .first()
      .screenshot({ path: `output/fleet-dynamics-${id}-departure.png` });
    const seededLanding = await page.evaluate(() => {
      const g = window.pocketFlight,
        p = g.physics;
      p.step = p.originalFleetStep;
      p.reset(true);
      p.position.set(-260, 13, 410);
      p.gearPosition = 1;
      p.flapPosition = p.jet ? 0.65 : 0;
      p.windOverride = p.wind.clone().set(0, 0, 0);
      const speed = p.stallSpeed * 1.35,
        a = p.design.aerodynamics;
      const alpha =
        ((p.loadedMass * 9.80665) /
          (0.5 * 1.225 * speed ** 2 * p.design.geometry.wingArea) -
          a.cl0 -
          a.flapLift * p.flapPosition) /
        a.liftSlope;
      p.velocity.set(0, -1.2, -speed);
      p.pitch = alpha - Math.atan2(1.2, speed);
      p.throttle = p.enginePower = 0.08;
      let touchdown = null;
      const start = performance.now();
      for (let n = 0; n < 1200; n++) {
        p.step(1 / 60, {
          pitch: p.grounded
            ? 0
            : ((p.position.y < 11 ? alpha + 0.015 : alpha - 0.04) - p.pitch) *
              4,
          roll: 0,
          yaw: 0,
          throttle: p.grounded ? -1 : 0,
          brake: p.grounded,
        });
        touchdown ??= p.events.find((e) => e.type === "landing");
      }
      const cpuMillisecondsPerStep = (performance.now() - start) / 1200;
      return {
        touchdown,
        health: p.health,
        crashed: p.crashed,
        grounded: p.grounded,
        speed: p.velocity.length(),
        position: p.position.toArray(),
        cpuMillisecondsPerStep,
      };
    });
    if (
      !seededLanding.touchdown ||
      seededLanding.health !== 100 ||
      seededLanding.crashed ||
      !seededLanding.grounded ||
      seededLanding.speed > 1 ||
      seededLanding.position[2] < 25
    )
      throw new Error(
        "Seeded landing failed: " + JSON.stringify({ id, ...seededLanding }),
      );
    results.push({ ...evidence, seededLanding });
    await page.evaluate(() => {
      const g = window.pocketFlight;
      g.physics.windOverride = null;
      g.menu();
      g.setSuspended(false);
    });
  }
  if (errors.length) throw new Error(JSON.stringify(errors));
  return {
    results,
    errors,
    method:
      "Real keyboard departures; deterministic seeded approach/stop checks in the actual browser physics.",
  };
};
