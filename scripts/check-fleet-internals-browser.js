async (page) => {
  const errors = [],
    checks = [],
    fleet = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  const assert = (ok, text) => {
    if (!ok) throw Error(text);
    checks.push(text);
  };
  const state = () => page.evaluate(() => window.windTunnel.getState());
  const ready = async (id) =>
    page.waitForFunction((id) => {
      const s = window.windTunnel?.getState();
      return (
        s?.aircraft === id &&
        s.status.includes("ready") &&
        !s.performance.tracing &&
        s.performance.chamber.ready
      );
    }, id);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(page.url());
  await ready("finch");
  await page
    .getByRole("button", { name: "Run mechanical showcase", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pause mechanisms", exact: true })
    .click();
  const canvas = page.locator(
    'canvas[aria-label="Private 3D aerodynamic test chamber"]',
  );
  for (const id of ["peregrine", "aurelia", "stormbird"]) {
    await page
      .getByRole("combobox", { name: "Aircraft", exact: true })
      .selectOption(id);
    await ready(id);
    await page
      .getByRole("slider", { name: "Mechanism cycle", exact: true })
      .press("Home");
    await page
      .getByRole("button", { name: "Rear bulkhead", exact: true })
      .click();
    await page.waitForTimeout(250);
    let s = await state();
    assert(
      s.performance.mechanics.internalSystems.rearBulkhead &&
        !s.performance.mechanics.shellReveal,
      `${id}: fitted partition loads and is shown opaque`,
    );
    await canvas.screenshot({ path: `output/${id}-rear-bulkhead.png` });
    await page
      .getByRole("button", { name: "Internal systems", exact: true })
      .click();
    await page.waitForTimeout(250);
    s = await state();
    assert(
      s.performance.mechanics.internalSystems.dryEquipmentBay &&
        s.performance.mechanics.internalSystems.partCount > 75,
      `${id}: fuel and dry service bays load`,
    );
    assert(
      s.performance.chamber.view === "internal" &&
        s.performance.mechanics.shellReveal,
      `${id}: body inspection reveals the internals`,
    );
    await canvas.screenshot({ path: `output/${id}-internal-systems.png` });
    await page
      .getByRole("button", { name: "Wing interior", exact: true })
      .click();
    await page.waitForTimeout(250);
    await canvas.screenshot({ path: `output/${id}-wing-interior.png` });
    await page.setViewportSize({ width: 1360, height: 950 });
    await page.waitForTimeout(150);
    assert(
      (await state()).performance.chamber.view === "internal",
      `${id}: wing inspection survives resize`,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("button", { name: "Control linkages", exact: true })
      .click();
    await page
      .getByRole("checkbox", {
        name: "Reveal mechanisms through shell",
        exact: true,
      })
      .uncheck();
    await page.waitForTimeout(200);
    await canvas.screenshot({
      path: `output/${id}-wing-controls-contained.png`,
    });
    assert(
      !(await state()).performance.mechanics.shellReveal,
      `${id}: exterior controls can be inspected opaque`,
    );
    const before = (await state()).performance.mechanics.pose.roll;
    await page
      .getByRole("button", { name: "Resume mechanisms", exact: true })
      .click();
    await page.waitForTimeout(800);
    await page
      .getByRole("button", { name: "Pause mechanisms", exact: true })
      .click();
    assert(
      (await state()).performance.mechanics.pose.roll !== before,
      `${id}: internal actuators animate with the controls`,
    );
    await page
      .getByRole("button", { name: "Wing interior", exact: true })
      .click();
    const first = await state();
    for (let i = 0; i < 3; i++) {
      await page
        .getByRole("button", { name: "Internal systems", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Wing interior", exact: true })
        .click();
    }
    const after = await state();
    assert(
      first.performance.geometries === after.performance.geometries &&
        first.performance.textures === after.performance.textures,
      `${id}: inspection mode cycling does not accumulate GPU resources`,
    );
    fleet.push({ id, performance: after.performance });
  }
  await page
    .getByRole("combobox", { name: "Aircraft", exact: true })
    .selectOption("finch");
  await ready("finch");
  assert(
    (await state()).performance.mechanics.internalSystems.rearBulkhead,
    "Finch remains intact after switching all three jets",
  );
  assert(errors.length === 0, "No browser, WebGL or asset-loading errors");
  return { checks, errors, fleet };
};
