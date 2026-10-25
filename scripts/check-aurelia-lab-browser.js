async (page) => {
  const checks = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const state = () => page.evaluate(() => window.windTunnel.getState());
  const assert = (ok, label) => {
    if (!ok) throw new Error(label);
    checks.push(label);
  };
  const ready = (id) =>
    page.waitForFunction((id) => {
      const s = window.windTunnel?.getState();
      const names = {
        finch: "Finch U–2",
        aurelia: "Aurelia S32",
        heron: "Heron UT–9",
      };
      return (
        s?.aircraft === id &&
        s.status === `${names[id]} ready` &&
        !s.performance.tracing
      );
    }, id);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const aircraft = page.getByRole("combobox", {
    name: "Aircraft",
    exact: true,
  });
  const canvas = page.locator(
    'canvas[aria-label="Private 3D aerodynamic test chamber"]',
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.reload();
  await ready("finch");
  await aircraft.selectOption("aurelia");
  await ready("aurelia");
  const initial = await state();
  assert(
    initial.performance.aircraftAsset === "aurelia-phenom300e.glb",
    "Lab loads the current Phenom asset",
  );
  assert(
    initial.geometryRevision ===
      "2a41ed0f0e93293b1e5413aee1f242306277f0ab9e839ef53b6661449cc8c407",
    "Wing solver uses the same export revision",
  );
  assert(
    initial.solution.reference.span > 16.7 &&
      initial.solution.reference.span < 16.8,
    "Planar lifting span excludes the winglets at the authored scale",
  );
  assert(
    initial.airflow.pathCount > 100 && initial.airflow.rejected === 0,
    "Airflow clears the new aircraft mesh",
  );
  assert(
    initial.performance.cockpitDisplays.screens === 5 &&
      initial.performance.cockpitDisplays.mounted,
    "Three primary displays and two touch controllers use mounted glass",
  );
  await button("Inspect").click();
  await canvas.screenshot({
    path: "output/aurelia-lab-model/aurelia-overview.png",
  });
  await button("Run angle sweep").click();
  await page.waitForFunction(
    () => window.windTunnel.getState().sweepCases === 17,
  );
  await button("Check convergence").click();
  await page.waitForFunction(() => !!window.windTunnel.getState().convergence);
  const experiments = await state();
  assert(
    experiments.sweepCases === 17 &&
      experiments.convergence.liftChangePercent < 1 &&
      experiments.convergence.dragChangePercent < 2,
    "New wing completes the angle sweep and convergence check",
  );
  await button("Run mechanical showcase").click();
  await button("Pause mechanisms").click();
  const slider = page.getByRole("slider", {
    name: "Mechanism cycle",
    exact: true,
  });
  const bounds = await slider.boundingBox();
  await slider.click({
    position: { x: bounds.width / 2, y: bounds.height / 2 },
  });
  const stowed = (await state()).performance.mechanics;
  assert(
    stowed.model === "aurelia-phenom300e.glb" && stowed.hardwareParts === 0,
    "Showcase preserves the new model's authored mechanical hardware",
  );
  assert(
    stowed.actualGearExtension < 0.01 &&
      Math.abs(stowed.nativeGear.mainRight + Math.PI / 2) < 1e-5,
    "Native Phenom main gear reaches the stowed pose",
  );
  assert(
    [...stowed.nativeGear.doors, ...stowed.nativeGear.wheelDoors].every(
      (angle) => Math.abs(angle) < 1e-5,
    ),
    "New gear doors seal at the stowed endpoint",
  );
  await button("Gear close-up").click();
  await canvas.screenshot({
    path: "output/aurelia-lab-model/aurelia-gear-stowed.png",
  });
  await slider.press("End");
  const deployed = (await state()).performance.mechanics;
  assert(
    deployed.actualGearExtension > 0.99 &&
      Math.abs(deployed.nativeGear.mainRight) < 1e-5,
    "Reverse scrub restores native gear down",
  );
  await button("Instrument displays").click();
  await page.waitForFunction(
    () => window.windTunnel.getState().performance.chamber.view === "displays",
  );
  await page.waitForFunction(() => {
    const p = window.windTunnel.getState().performance;
    return (
      p.cockpitDisplays.state.gear === p.mechanics.pose.gear &&
      p.cockpitDisplays.state.flaps === p.mechanics.pose.flaps
    );
  });
  await canvas.screenshot({
    path: "output/aurelia-lab-model/aurelia-cockpit.png",
  });
  const instrument = (await state()).performance.cockpitDisplays;
  assert(
    instrument.state.gear === deployed.pose.gear &&
      instrument.state.flaps === deployed.pose.flaps,
    "Mounted avionics follow the selected mechanism pose",
  );
  await button("Return to aerodynamics").click();
  await ready("aurelia");
  await page.waitForFunction(() => {
    const s = window.windTunnel.getState();
    return (
      Math.abs(
        s.performance.cockpitDisplays.state.speedKt -
          s.conditions.speed / (1852 / 3600),
      ) < 1e-6
    );
  });
  const tunnel = await state();
  assert(
    Math.abs(
      tunnel.performance.cockpitDisplays.state.speedKt -
        tunnel.conditions.speed / (1852 / 3600),
    ) < 1e-6,
    "Mounted airspeed display uses the wind-tunnel condition",
  );
  await aircraft.selectOption("heron");
  await ready("heron");
  const heron = await state();
  assert(
    heron.performance.aircraftAsset === "heron-ut9.glb" &&
      heron.airflow.pathCount > 100,
    "The new Heron still loads and traces correctly",
  );
  assert(
    heron.performance.textures <= 6,
    "Switching away releases the Phenom display textures",
  );
  await aircraft.selectOption("aurelia");
  await ready("aurelia");
  await button("Inspect").click();
  await canvas.screenshot({
    path: "output/aurelia-lab-model/aurelia-overview.png",
  });
  assert(errors.length === 0, "No browser, shader or asset-loading errors");
  return {
    checks,
    errors,
    asset: initial.performance.aircraftAsset,
    revision: initial.geometryRevision,
    wing: initial.solution.reference,
    airflow: initial.airflow,
    convergence: experiments.convergence,
    stowed,
    deployed,
    instrument: {
      screens: instrument.screens,
      mounted: instrument.mounted,
      canvases: instrument.canvases,
    },
  };
};
