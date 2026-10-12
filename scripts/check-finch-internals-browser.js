async (page) => {
  const errors = [],
    checks = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
    checks.push(message);
  };
  const state = () => page.evaluate(() => window.windTunnel.getState());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:5186/");
  await page.waitForFunction(
    () =>
      window.windTunnel?.getState().status.includes("ready") &&
      window.windTunnel.getState().performance.chamber.ready &&
      !window.windTunnel.getState().performance.tracing,
  );
  await page
    .getByRole("button", { name: "Run mechanical showcase", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pause mechanisms", exact: true })
    .click();
  await page
    .getByRole("slider", { name: "Mechanism cycle", exact: true })
    .press("Home");
  const canvas = page.locator(
    'canvas[aria-label="Private 3D aerodynamic test chamber"]',
  );
  await page
    .getByRole("button", { name: "Rear bulkhead", exact: true })
    .click();
  await page.waitForTimeout(250);
  let s = await state();
  assert(
    s.performance.mechanics.internalSystems.rearBulkhead,
    "Exported rear bulkhead is installed",
  );
  assert(
    s.performance.chamber.view === "cabin" &&
      !s.performance.mechanics.shellReveal,
    "Rear partition is inspected with the aircraft opaque",
  );
  await canvas.screenshot({ path: "output/finch-rear-bulkhead.png" });
  await page
    .getByRole("button", { name: "Internal systems", exact: true })
    .click();
  await page.waitForTimeout(250);
  s = await state();
  const systems = s.performance.mechanics.internalSystems;
  assert(
    systems.dryEquipmentBay && systems.fuelEnvelopeLitres > 100,
    "Fuel cell and separate dry bay survive runtime loading",
  );
  assert(
    s.performance.chamber.view === "internal" &&
      s.performance.mechanics.shellReveal,
    "Internal inspection enables the shell cutaway",
  );
  await canvas.screenshot({ path: "output/finch-internal-systems.png" });
  await page.setViewportSize({ width: 1360, height: 950 });
  await page.waitForTimeout(200);
  assert(
    (await state()).performance.chamber.view === "internal",
    "Internal camera survives viewport resizing",
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
  await page.waitForTimeout(250);
  await canvas.screenshot({ path: "output/finch-wing-controls-contained.png" });
  assert(
    !(await state()).performance.mechanics.shellReveal,
    "Wing exterior inspected without the cutaway",
  );
  await page
    .getByRole("button", { name: "Resume mechanisms", exact: true })
    .click();
  const before = (await state()).performance.mechanics.pose.roll;
  await page.waitForTimeout(700);
  await page
    .getByRole("button", { name: "Pause mechanisms", exact: true })
    .click();
  assert(
    (await state()).performance.mechanics.pose.roll !== before,
    "Controls still animate with internal linkages",
  );
  const fleet = [];
  for (const id of ["peregrine", "aurelia", "stormbird", "finch"]) {
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
    const s = await state();
    assert(
      s.performance.mechanics.hardwareParts > 100,
      `${id}: mechanism rig remains operational`,
    );
    fleet.push({ id, performance: s.performance });
  }
  assert(
    errors.length === 0,
    "No browser or WebGL errors during inspection and fleet switching",
  );
  return { checks, errors, systems, fleet };
};
