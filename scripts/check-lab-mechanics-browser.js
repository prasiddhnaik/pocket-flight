async (page) => {
  const evidence = {
    checks: [],
    aircraft: [],
    errors: [],
    generatedAt: new Date().toISOString(),
  };
  page.on("pageerror", (e) => evidence.errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.errors.push(m.text());
  });
  const state = () => page.evaluate(() => window.windTunnel.getState());
  const assert = (ok, label) => {
    if (!ok) throw new Error(label);
    evidence.checks.push(label);
  };
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("status")
    .filter({ hasText: "Finch U–2 ready" })
    .waitFor();
  const reference = (await state()).solution.results[0].lift;
  await page
    .getByRole("button", { name: "Run mechanical showcase", exact: true })
    .click();
  for (const [id, name] of [
    ["finch", "Finch U–2"],
    ["peregrine", "Peregrine HX–27"],
    ["aurelia", "Aurelia S32"],
    ["stormbird", "Stormbird HX–40"],
  ]) {
    await page
      .getByRole("combobox", { name: "Aircraft", exact: true })
      .selectOption(id);
    await page
      .getByRole("status")
      .filter({ hasText: `${name} ready` })
      .waitFor();
    await page
      .getByRole("combobox", { name: "Systems programme", exact: true })
      .selectOption("all");
    await page.waitForTimeout(400);
    const initial = await state();
    assert(
      initial.mechanical &&
        initial.performance.mechanics.id === id &&
        initial.performance.mechanics.hardwareParts > 100,
      `${name} builds its detailed mechanical rig`,
    );
    await page.getByRole("button", { name: "Inspect", exact: true }).click();
    await page.waitForTimeout(500);
    const performance = await page.evaluate(async () => {
      const start = performance.now(),
        before = window.windTunnel.getState().performance.renderedFrames;
      await new Promise((done) => {
        const tick = (t) =>
          t - start < 1300 ? requestAnimationFrame(tick) : done();
        requestAnimationFrame(tick);
      });
      const elapsed = performance.now() - start,
        s = window.windTunnel.getState().performance;
      return { ...s, fps: ((s.renderedFrames - before) * 1000) / elapsed };
    });
    assert(
      performance.mechanics.time > initial.performance.mechanics.time,
      `${name} mechanisms advance while playing`,
    );
    await page.screenshot({ path: `output/mechanics-${id}-overview.png` });
    await page
      .getByRole("button", { name: "Gear close-up", exact: true })
      .click();
    await page.waitForTimeout(500);
    assert(
      (await state()).performance.mechanics.shellReveal &&
        !(await state()).performance.mechanics.overlaysVisible,
      `${name} reveals hardware without displaying reference aerodynamic overlays`,
    );
    await page.screenshot({ path: `output/mechanics-${id}-gear.png` });
    await page
      .getByRole("slider", { name: "Mechanism cycle", exact: true })
      .press("Home");
    await page
      .getByRole("slider", { name: "Mechanism cycle", exact: true })
      .press("PageUp");
    const held = await state();
    await page.waitForTimeout(500);
    assert(
      held.paused &&
        (await state()).performance.mechanics.time ===
          held.performance.mechanics.time,
      `${name} scrubbing pauses every mechanism`,
    );
    const slider = page.getByRole("slider", {
      name: "Mechanism cycle",
      exact: true,
    });
    const bounds = await slider.boundingBox();
    await slider.click({
      position: { x: bounds.width / 2, y: bounds.height / 2 },
    });
    const stowed = await state();
    assert(
      stowed.performance.mechanics.pose.gear < 0.01,
      `${name} reaches the retracted command`,
    );
    assert(
      stowed.performance.mechanics.fixedGear === (id === "finch"),
      `${name} retains its correct fixed/retractable gear type`,
    );
    assert(
      Math.abs(
        stowed.performance.mechanics.actualGearExtension -
          (id === "finch" ? 1 : 0),
      ) < 0.01,
      `${name} applies the correct physical gear extension`,
    );
    await page.getByRole("button", { name: "Inspect", exact: true }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `output/mechanics-${id}-stowed.png` });
    await slider.press("End");
    assert(
      (await state()).performance.mechanics.pose.gear > 0.99,
      `${name} returns to the deployed command`,
    );
    await page
      .getByRole("button", { name: "Resume mechanisms", exact: true })
      .click();
    evidence.aircraft.push({
      id,
      performance,
      stowed: stowed.performance.mechanics,
    });
  }
  await page
    .getByRole("combobox", { name: "Aircraft", exact: true })
    .selectOption("finch");
  await page
    .getByRole("status")
    .filter({ hasText: "Finch U–2 ready" })
    .waitFor();
  await page
    .getByRole("button", { name: "Return to aerodynamics", exact: true })
    .click();
  const restored = await state();
  assert(
    !restored.mechanical &&
      restored.performance.mechanics === null &&
      Math.abs(restored.solution.results[0].lift - reference) < 1e-6 &&
      restored.airflow.pathCount === 122,
    "Returning to aerodynamics restores the neutral reference and existing airflow",
  );
  await page
    .getByRole("button", { name: "Run mechanical showcase", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Mechanism controls fit the mobile viewport",
  );
  await page
    .locator(".mechanics-toolbar")
    .screenshot({ path: "output/mechanics-mobile-controls.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert(
    evidence.errors.length === 0,
    "No browser or shader errors during mechanical inspection",
  );
  return evidence;
};
