async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => !!window.pocketFlight);
  await page.evaluate(async () => {
    await window.pocketFlight.aircraft.ready;
  });
  await page.getByLabel("Choose aircraft").selectOption("finch");
  await page.evaluate(() => {
    const p = window.pocketFlight.physics;
    window.takeoffEvidence = { takeoff: null, gate: null };
    const step = p.step.bind(p);
    p.step = (dt, input, obstacles) => {
      step(dt, input, obstacles);
      const e = window.takeoffEvidence;
      if (!e.takeoff && p.events.some((e) => e.type === "takeoff"))
        e.takeoff = {
          time: p.flightTime,
          knots: p.airspeed * 1.943844,
          position: p.position.toArray(),
        };
      if (!e.gate && p.position.z < 130)
        e.gate = {
          time: p.flightTime,
          height: p.position.y,
          knots: p.airspeed * 1.943844,
        };
      if (p.flightTime >= 20) window.pocketFlight.setSuspended(true);
    };
  });
  await page.getByRole("button", { name: "Start flight", exact: true }).click();
  await page.keyboard.down("Shift");
  await page.waitForFunction(
    () =>
      window.pocketFlight.physics.airspeed * 1.943844 >=
      window.pocketFlight.physics.profile.rotationKnots,
  );
  await page.keyboard.down("s");
  await page.waitForFunction(() => window.pocketFlight.suspended, {
    timeout: 45000,
  });
  await page.keyboard.up("s");
  await page.keyboard.up("Shift");
  const result = await page.evaluate(() => {
    const g = window.pocketFlight,
      p = g.physics;
    g.camera.position.set(
      p.position.x + 11,
      p.position.y + 4,
      p.position.z + 15,
    );
    g.camera.lookAt(p.position);
    g.camera.updateProjectionMatrix();
    g.emit();
    g.renderer.render(g.scene, g.camera);
    return {
      id: "finch",
      ...window.takeoffEvidence,
      state: g.getState(),
      flightTime: p.flightTime,
    };
  });
  if (
    !result.takeoff ||
    result.state.grounded ||
    result.state.crashed ||
    result.state.health !== 100 ||
    !result.gate ||
    result.gate.height < 35 ||
    result.state.position[1] < 55
  )
    throw new Error(JSON.stringify(result));
  await page
    .locator("canvas")
    .first()
    .screenshot({ path: "output/finch-keyboard-takeoff.png" });
  if (errors.length) throw new Error(JSON.stringify(errors));
  return { results: [result], errors };
};
