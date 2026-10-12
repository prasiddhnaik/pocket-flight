async (page) => {
  const errors = [],
    checks = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const assert = (ok, name) => {
    if (!ok) throw new Error(name);
    checks.push(name);
  };
  const state = () => page.evaluate(() => window.windTunnel.getState());
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("status")
    .filter({ hasText: "Finch U–2 ready" })
    .waitFor();
  assert(
    (await state()).airflow.pathCount === 122,
    "Rebuilt geometry retains full-span certified airflow paths",
  );
  await page
    .getByRole("button", { name: "Run mechanical showcase", exact: true })
    .click();
  const slider = page.getByRole("slider", {
    name: "Mechanism cycle",
    exact: true,
  });
  await slider.press("Home");
  await page
    .getByRole("button", { name: "Cockpit close-up", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Reveal mechanisms through shell" })
    .uncheck();
  await page.waitForTimeout(500);
  const canvas = page.locator(
    'canvas[aria-label="Private 3D aerodynamic test chamber"]',
  );
  await page.screenshot({ path: "output/finch-rebuilt-cockpit-full.png" });
  await canvas.screenshot({ path: "output/finch-rebuilt-cockpit.png" });
  assert(
    (await state()).performance.mechanics.cockpit.canopyAngle === 0,
    "Complete canopy seats closed at its authored hinge",
  );
  // Inspect the foredeck junction that exposed the old loose frame ends.
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+bounds.height*.52);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width*.7-280,bounds.y+bounds.height*.52+30,{steps:20});
  await page.mouse.up();
  await page.waitForTimeout(400);
  await canvas.screenshot({path:"output/finch-flush-windshield.png"});
  await slider.press("PageUp");
  await page.waitForTimeout(400);
  const open = await state();
  assert(
    Math.abs(
      open.performance.mechanics.cockpit.canopyAngle - (55 * Math.PI) / 180,
    ) < 1e-6,
    "Native canopy reaches its designed 55-degree opening",
  );
  await page
    .getByRole("button", { name: "Cockpit close-up", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Reveal mechanisms through shell" })
    .uncheck();
  await page.waitForTimeout(400);
  await canvas.screenshot({ path: "output/finch-rebuilt-canopy-open.png" });
  assert(
    open.performance.mechanics.cockpit.stickAngles.some(
      (a) => Math.abs(a[0]) > 0.05,
    ),
    "Native cockpit sticks respond to flight-control commands",
  );
  await slider.press("Home");
  await page.getByRole("button", { name: "Pilot view", exact: true }).click();
  await page.waitForTimeout(400);
  assert(
    !(await state()).performance.mechanics.shellReveal,
    "Pilot view restores opaque aircraft materials",
  );
  await canvas.screenshot({ path: "output/finch-rebuilt-pilot-view.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Pilot-view and mechanism controls fit mobile without overflow",
  );
  await page
    .locator(".mechanics-toolbar")
    .screenshot({ path: "output/finch-rebuilt-mobile-controls.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Cockpit close-up", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Reveal mechanisms through shell" })
    .uncheck();
  assert(!errors.length, "No browser or shader errors in cockpit inspection");
  return { checks, errors, open: open.performance.mechanics };
};
