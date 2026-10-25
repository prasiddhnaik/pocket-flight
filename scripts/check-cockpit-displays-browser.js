async (page, labOnly = false) => {
  const errors = [],
    checks = [],
    lab = [],
    flight = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
    checks.push(message);
  };
  const state = () => page.evaluate(() => window.windTunnel.getState());
  const counts = { finch: 2, peregrine: 6, aurelia: 5, stormbird: 4 };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(
    () =>
      window.windTunnel?.getState().status.includes("ready") &&
      window.windTunnel.getState().performance.chamber.ready,
  );
  await page
    .getByRole("button", { name: "Run mechanical showcase", exact: true })
    .click();
  const canvas = page.locator(
    'canvas[aria-label="Private 3D aerodynamic test chamber"]',
  );
  for (const id of Object.keys(counts)) {
    await page
      .getByRole("combobox", { name: "Aircraft", exact: true })
      .selectOption(id);
    await page.waitForFunction((id) => {
      const s = window.windTunnel.getState();
      return (
        s.aircraft === id &&
        s.performance.mechanics?.id === id &&
        s.status.includes("ready") &&
        !s.performance.tracing
      );
    }, id);
    await page
      .getByRole("button", { name: "Instrument displays", exact: true })
      .click();
    await page.waitForFunction(
      () => window.windTunnel.getState().performance.cockpitDisplays.ready,
    );
    const before = (await state()).performance.cockpitDisplays;
    await page.waitForTimeout(650);
    const after = await state();
    assert(
      after.performance.cockpitDisplays.screens === counts[id],
      `${id}: all authored display faces installed`,
    );
    assert(
      id === "aurelia"
        ? after.performance.cockpitDisplays.mounted && after.performance.aircraftAsset === "aurelia-phenom300e.glb"
        : after.performance.cockpitDisplays.replacedStaticBatches === (id === "peregrine" ? 2 : 0),
      `${id}: live instruments use the current aircraft's authored fittings`,
    );
    assert(
      after.performance.cockpitDisplays.updates > before.updates &&
        after.performance.cockpitDisplays.state.roll !== before.state.roll,
      `${id}: demonstration horizon and telemetry animate`,
    );
    assert(
      after.performance.cockpitDisplays.updates - before.updates <= 15,
      `${id}: display uploads capped at 20 Hz`,
    );
    assert(
      after.performance.chamber.view === "displays",
      `${id}: instrument close-up persists`,
    );
    assert(
      after.performance.textures <= (id === "aurelia" ? 11 : 6),
      `${id}: display textures stay within the aircraft's bound`,
    );
    await canvas.screenshot({ path: `output/${id}-animated-displays.png` });
    await page
      .getByRole("button", { name: "Pause mechanisms", exact: true })
      .click();
    await page.waitForTimeout(250);
    const paused = (await state()).performance.cockpitDisplays;
    await page.waitForTimeout(350);
    assert(
      (await state()).performance.cockpitDisplays.updates === paused.updates,
      `${id}: paused displays stop drawing`,
    );
    const slider = page.getByRole("slider", {
      name: "Mechanism cycle",
      exact: true,
    });
    await slider.press("End");
    await page.waitForFunction(
      () =>
        window.windTunnel.getState().performance.cockpitDisplays.state.time >=
        35.9,
    );
    assert(
      (await state()).performance.cockpitDisplays.updates > paused.updates,
      `${id}: paused scrub redraws the selected instant`,
    );
    await page
      .getByRole("button", { name: "Resume mechanisms", exact: true })
      .click();
    lab.push({ id, performance: after.performance });
  }
  await page
    .getByRole("button", { name: "Return to aerodynamics", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.windTunnel.getState().performance.cockpitDisplays.state.mode ===
      "tunnel",
  );
  const rig = await state();
  assert(
    Math.abs(
      rig.performance.cockpitDisplays.state.pitch -
        (rig.conditions.alpha * Math.PI) / 180,
    ) < 1e-6 &&
      rig.performance.cockpitDisplays.state.speed === rig.conditions.speed,
    "Rig display uses test airspeed and fixture angle",
  );
  for (const id of ["finch", "stormbird", "finch", "stormbird"]) {
    await page
      .getByRole("combobox", { name: "Aircraft", exact: true })
      .selectOption(id);
    await page.waitForFunction((id) => {
      const s = window.windTunnel.getState();
      return (
        s.aircraft === id &&
        s.performance.cockpitDisplays.screens === (id === "finch" ? 2 : 4) &&
        s.status.includes("ready") &&
        !s.performance.tracing
      );
    }, id);
    await page.waitForTimeout(150);
    assert(
      (await state()).performance.textures <= 6,
      `${id}: repeated swaps release old display textures`,
    );
  }
  if (labOnly) {
    assert(
      !errors.length,
      "No private tester browser, shader or runtime errors",
    );
    return { checks, errors, lab, flight };
  }
  await page.goto("http://127.0.0.1:5175/");
  await page.waitForFunction(() => !!window.pocketFlight);
  await page.evaluate(async () => {
    await window.pocketFlight.aircraft.ready;
  });
  const hash = () =>
    page.evaluate(() => {
      const c = window.pocketFlight.aircraft.displays.canvas;
      const pixels = c
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < pixels.length; i += 41)
        h = (Math.imul(h, 31) + pixels[i]) | 0;
      return h;
    });
  for (const id of Object.keys(counts)) {
    await page.getByLabel("Choose aircraft").selectOption(id);
    await page.waitForFunction(
      (id) =>
        window.pocketFlight?.aircraft.id === id &&
        !!window.pocketFlight.aircraft.displays,
      id,
    );
    await page.evaluate(async () => {
      const { missions } = await import("/src/flight/missions.ts");
      const g = window.pocketFlight;
      g.start(missions[1]);
      g.cameraMode = "cockpit";
      g.orbit.y = 0.48;
    });
    await page.waitForFunction(
      () =>
        window.pocketFlight?.aircraft.displays?.diagnostics().state?.mode ===
          "flight" && window.pocketFlight.aircraft.displays.diagnostics().ready,
    );
    const before = await hash();
    await page.keyboard.down("a");
    await page.keyboard.down("s");
    await page.waitForTimeout(350);
    await page.keyboard.up("a");
    await page.keyboard.up("s");
    assert(
      (await hash()) !== before,
      `${id}: flight telemetry changes real screen pixels`,
    );
    const live = await page.evaluate(() => {
      const g = window.pocketFlight,
        p = g.physics;
      return {
        display: g.aircraft.displays.diagnostics(),
        actual: {
          time: p.flightTime,
          speed: p.airspeed,
          altitude: p.position.y,
          pitch: p.pitch,
          roll: p.roll,
          heading: -p.yaw,
          power: p.enginePower,
          fuel:
            p.fuelKg /
            p.design.massBudget
              .filter((c) => c.category === "fuel")
              .reduce((sum, c) => sum + c.mass, 0),
        },
      };
    });
    const d = live.display.state,
      p = live.actual;
    assert(
      d.mode === "flight" &&
        Math.abs(d.time - p.time) < 0.15 &&
        Math.abs(d.speed - p.speed) < 3 &&
        Math.abs(d.altitude - p.altitude) < 3 &&
        Math.abs(d.pitch - p.pitch) < 0.1 &&
        Math.abs(d.roll - p.roll) < 0.1 &&
        Math.abs(d.power - p.power) < 0.04 &&
        Math.abs(d.fuel - p.fuel) < 0.002,
      `${id}: screen data matches flight physics`,
    );
    if (id === "finch")
      await page
        .locator("canvas")
        .first()
        .screenshot({ path: "output/finch-flight-displays.png" });
    await page.evaluate(() => window.pocketFlight.pause());
    const paused = await page.evaluate(
      () => window.pocketFlight.aircraft.displays.diagnostics().updates,
    );
    await page.waitForTimeout(200);
    assert(
      (await page.evaluate(
        () => window.pocketFlight.aircraft.displays.diagnostics().updates,
      )) === paused,
      `${id}: game pause freezes displays`,
    );
    const replay = await page.evaluate(() => {
      const g = window.pocketFlight;
      g.playReplay();
      g.setSuspended(true);
      g.replayClock = g.replay.duration * 0.5;
      g.poseReplay(true);
      const sample = g.replay.sample(g.replayClock),
        mix = sample.mix;
      return {
        display: g.aircraft.displays.diagnostics().state,
        expectedSpeed: sample.a.speed + (sample.b.speed - sample.a.speed) * mix,
        expectedAltitude: sample.a.p.y + (sample.b.p.y - sample.a.p.y) * mix,
      };
    });
    assert(
      replay.display.mode === "replay" &&
        replay.display.fuel === null &&
        Math.abs(replay.display.speed - replay.expectedSpeed) < 1e-6 &&
        Math.abs(replay.display.altitude - replay.expectedAltitude) < 1e-6,
      `${id}: replay uses recorded position/speed and omits unrecorded fuel`,
    );
    flight.push({ id, live, replay });
    await page.evaluate(() => {
      const g = window.pocketFlight;
      g.menu();
      g.setSuspended(false);
    });
  }
  assert(!errors.length, "No browser, shader or runtime errors");
  return { checks, errors, lab, flight };
};
