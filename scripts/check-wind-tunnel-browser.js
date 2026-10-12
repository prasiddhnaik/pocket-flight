async (page) => {
  const evidence = {
    aircraft: [],
    checks: [],
    errors: [],
    generatedAt: new Date().toISOString(),
  };
  page.on("pageerror", (e) => evidence.errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.errors.push(m.text());
  });
  const state = () => page.evaluate(() => window.windTunnel.getState());
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
    evidence.checks.push(message);
  };
  const ready = async (name) =>
    page
      .getByRole("status")
      .filter({ hasText: `${name} ready` })
      .waitFor();
  await page.reload();
  await ready("Finch U–2");
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [id, name] of [
    ["finch", "Finch U–2"],
    ["peregrine", "Peregrine HX–27"],
    ["aurelia", "Aurelia S32"],
    ["stormbird", "Stormbird HX–40"],
  ]) {
    await page
      .getByRole("combobox", { name: "Aircraft", exact: true })
      .selectOption(id);
    await ready(name);
    const s = await state();
    assert(
      s.aircraft === id && s.solution.results[0].lift > 0,
      `${name} loads and computes lift`,
    );
    assert(
      s.airflow?.pathCount >= 65 && s.airflow.rejected < 6,
      `${name} airflow clears its mesh and includes a wake`,
    );
    evidence.aircraft.push({
      airflow: s.airflow,
      id,
      status: s.status,
      revision: s.geometryRevision,
      ...s.solution.results[0],
      spanLoading: undefined,
    });
    await page.screenshot({ path: `output/wind-tunnel-${id}.png` });
  }
  await page
    .getByRole("button", { name: "Run angle sweep", exact: true })
    .click();
  await page.waitForFunction(
    () => window.windTunnel.getState().sweepCases === 17,
  );
  assert((await state()).sweepCases === 17, "17-case angle sweep completes");
  await page
    .getByRole("button", { name: "Check convergence", exact: true })
    .click();
  await page.waitForFunction(
    () => window.windTunnel.getState().convergence !== null,
  );
  const c = (await state()).convergence;
  assert(
    c.rows.length === 4 && c.liftChangePercent < 1 && c.dragChangePercent < 1,
    "Four refinement levels converge below 1% at reference condition",
  );
  await page
    .getByRole("button", { name: "Compare fleet", exact: true })
    .click();
  await page.waitForFunction(
    () => window.windTunnel.getState().comparison.length === 4,
  );
  assert(
    (await state()).comparison.length === 4,
    "Matched-condition comparison covers all four aircraft",
  );
  for (const kind of ["JSON", "CSV"]) {
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: `Export ${kind}`, exact: true })
      .click();
    const download = await pending;
    const path = `output/wind-tunnel-browser-export.${kind.toLowerCase()}`;
    await download.saveAs(path);
    const stream = await download.createReadStream();
    let contents = "";
    for await (const chunk of stream) contents += chunk.toString();
    if (kind === "JSON") {
      const r = JSON.parse(contents);
      assert(
        r.results.length === 17 &&
          r.geometry.stations.length > 2 &&
          r.geometryRevision === (await state()).geometryRevision,
        "JSON export includes 17 cases, complete geometry and matching revision",
      );
    } else
      assert(
        contents.includes("alpha_deg,speed_m_s") &&
          contents.includes("Stormbird"),
        "CSV export identifies aircraft, conditions and coefficients",
      );
  }
  await page
    .getByRole("slider", { name: "Angle of attack", exact: true })
    .press("End");
  await page
    .getByRole("alert")
    .filter({ hasText: "No aerodynamic result" })
    .waitFor();
  assert(
    (await state()).solution === null &&
      (await page
        .getByRole("button", { name: "Export JSON", exact: true })
        .isDisabled()),
    "Unsupported angle withholds results and disables export",
  );
  const angle = page.getByRole("slider", {
    name: "Angle of attack",
    exact: true,
  });
  await angle.press("Home");
  for (let i = 0; i < 16; i++) await angle.press("ArrowRight");
  await page.waitForFunction(
    () =>
      window.windTunnel.getState().conditions.alpha === -4 &&
      window.windTunnel.getState().solution !== null,
  );
  assert(
    (await state()).solution.results[0].lift < 0,
    "Negative angle produces downward lift",
  );
  for (let i = 0; i < 16; i++) await angle.press("ArrowRight");
  await page.waitForFunction(
    () => window.windTunnel.getState().conditions.alpha === 4,
  );
  const base = (await state()).solution.results[0];
  const speed = page.getByRole("slider", { name: "Airspeed", exact: true });
  for (let i = 0; i < 30; i++) await speed.press("ArrowRight");
  await page.waitForFunction(
    () => window.windTunnel.getState().conditions.speed === 60,
  );
  const fast = (await state()).solution.results[0];
  assert(
    Math.abs(fast.lift / base.lift - 4) < 1e-8 &&
      Math.abs(fast.cl - base.cl) < 1e-8,
    "Browser airspeed changes scale lift by V squared and preserve CL",
  );
  for (let i = 0; i < 30; i++) await speed.press("ArrowLeft");
  await page
    .getByRole("spinbutton", { name: "Air density", exact: true })
    .fill("0.8");
  await page.waitForFunction(
    () => window.windTunnel.getState().conditions.density === 0.8,
  );
  assert(
    Math.abs(
      (await state()).solution.results[0].lift / base.lift - 0.8 / 1.225,
    ) < 1e-8,
    "Browser density changes scale forces linearly",
  );
  await page
    .getByRole("spinbutton", { name: "Air density", exact: true })
    .fill("1.225");
  await page
    .getByRole("checkbox", { name: "Analysis lattice", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Wing surfaces only", exact: true })
    .check();
  await page.getByRole("button", { name: "Plan view", exact: true }).click();
  await page.screenshot({ path: "output/wind-tunnel-lattice.png" });
  assert(
    (await state()).layers.lattice && (await state()).layers.wingOnly,
    "Analysis lattice and wing isolation controls update scene state",
  );
  await page
    .getByRole("button", { name: "Pause flow animation", exact: true })
    .click();
  assert((await state()).paused, "Pause control freezes flow animation state");
  await page
    .getByRole("button", { name: "Resume flow animation", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Analysis lattice", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Wing surfaces only", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await page.getByText("Section assumption", { exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Override zero-lift angle", exact: true })
    .check();
  await page
    .getByRole("spinbutton", { name: "Zero-lift angle", exact: true })
    .fill("-2");
  await page.waitForFunction(() =>
    window.windTunnel.getState().geometryRevision.endsWith("alpha0=-2"),
  );
  assert(
    (await state()).solution.geometry.stations.every(
      (s) => s.zeroLiftAlpha === -2,
    ),
    "Section override changes geometry input and export revision",
  );
  await page
    .getByRole("checkbox", { name: "Override zero-lift angle", exact: true })
    .uncheck();
  await page.getByText("Section assumption", { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile layout has no horizontal overflow",
  );
  await page.screenshot({ path: "output/wind-tunnel-mobile.png" });
  await page
    .getByRole("combobox", { name: "Aircraft", exact: true })
    .selectOption("aurelia");
  await ready("Aurelia S32");
  assert(
    (await state()).aircraft === "aurelia",
    "Mobile aircraft selector switches geometry and model",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("combobox", { name: "Aircraft", exact: true })
    .selectOption("stormbird");
  await ready("Stormbird HX–40");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "output/wind-tunnel-desktop.png" });
  assert(
    evidence.errors.length === 0,
    "No browser exceptions or error console messages during acceptance run",
  );
  return evidence;
};
