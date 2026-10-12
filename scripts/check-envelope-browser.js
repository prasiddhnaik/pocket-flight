async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page
    .getByRole("button", { name: "Validate all four planes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Validate all four planes", exact: true })
    .waitFor({ state: "visible" });
  await page
    .getByRole("button", { name: "Export fleet evidence", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Export fleet evidence",
    );
    return b && !b.disabled;
  });
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    window.__envelopeOriginalURL = original;
    URL.createObjectURL = (blob) => {
      window.__envelopeBlob = blob;
      return original(blob);
    };
  });
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export fleet evidence", exact: true })
    .click();
  await (await downloaded).saveAs("output/envelope-browser-export.json");
  const data = await page.evaluate(async () => {
    URL.createObjectURL = window.__envelopeOriginalURL;
    return JSON.parse(await window.__envelopeBlob.text());
  });
  const checks = [];
  if (Object.keys(data.results).length !== 4)
    throw Error("Worker did not validate every aircraft");
  for (const id of ["finch", "peregrine", "aurelia", "stormbird"]) {
    await page.getByLabel("Aircraft", { exact: true }).selectOption(id);
    const bench = page.getByRole("region", { name: "Flight validation bench" });
    await bench
      .getByText(
        id === "finch"
          ? "Finch U–2"
          : id === "peregrine"
            ? "Peregrine HX–27"
            : id === "aurelia"
              ? "Aurelia S32"
              : "Stormbird HX–40",
        { exact: true },
      )
      .waitFor();
    await bench
      .getByRole("button", { name: "Stall behavior", exact: true })
      .click();
    await bench.screenshot({ path: `output/envelope-${id}-stall.png` });
    if ((await bench.locator("tbody tr").count()) !== 4)
      throw Error(`${id}: missing loadings`);
    await bench.getByRole("button", { name: "Stability", exact: true }).click();
    for (const axis of ["pitch", "roll", "yaw"])
      await page.getByLabel("Disturbance axis").selectOption(axis);
    await page.getByLabel("Validation loading").selectOption("3");
    await bench.screenshot({ path: `output/envelope-${id}-stability.png` });
    await bench
      .getByRole("button", { name: "Engine maps", exact: true })
      .click();
    await page.getByLabel("Engine map altitude").selectOption("3000");
    if ((await bench.locator("tbody tr").count()) !== 6)
      throw Error(`${id}: missing engine grid`);
    await bench.screenshot({ path: `output/envelope-${id}-engine.png` });
    checks.push({
      id,
      polars: data.results[id].polars.reduce((s, p) => s + p.rows.length, 0),
      disturbances: data.results[id].disturbances.length,
      stalls: data.results[id].stalls.length,
      poweredRecoveries: data.results[id].poweredRecoveries.length,
      enginePoints: data.results[id].engine.length,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    )
  )
    throw Error("Mobile document overflow");
  await page
    .getByRole("region", { name: "Flight validation bench" })
    .screenshot({ path: "output/envelope-mobile.png" });
  if (errors.length) throw Error(errors.join("\n"));
  return {
    checks,
    errors,
    exportedAircraft: Object.keys(data.results),
    mobileOverflow: false,
  };
};
