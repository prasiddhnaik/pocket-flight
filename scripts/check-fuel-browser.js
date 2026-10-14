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
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
    checks.push(message);
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(page.url());
  await page.waitForFunction(() =>
    window.windTunnel?.getState().status.includes("ready"),
  );
  const bench = page.getByRole("region", { name: "Weight and balance bench" });
  await bench
    .getByRole("button", { name: "Check fuel on all four planes", exact: true })
    .click();
  await bench
    .getByRole("button", { name: "Check fuel on all four planes", exact: true })
    .waitFor({ state: "visible" });
  for (const id of ["finch", "peregrine", "aurelia", "stormbird"]) {
    await page.getByLabel("Aircraft", { exact: true }).selectOption(id);
    await page.waitForFunction((id) => {
      const s = window.windTunnel.getState();
      return (
        s.aircraft === id &&
        s.status.includes("ready") &&
        !s.performance.tracing
      );
    }, id);
    await bench.scrollIntoViewIfNeeded();
    await bench.locator("details").evaluate((node) => {
      node.open = true;
    });
    const hardware = await bench.getByTestId("hardware-profile").innerText();
    assert(
      hardware.includes(
        {
          finch: "U2-E1",
          peregrine: "HX27-EH2",
          aurelia: "S32-EH1",
          stormbird: "HX40-EH4",
        }[id],
      ),
      `${id}: aircraft-specific hardware allowance loads`,
    );
    await bench.locator("details").evaluate((node) => {
      node.open = false;
    });
    const checksText = await bench.getByTestId("fuel-checks").innerText();
    assert(
      !checksText.includes("FAIL") &&
        checksText.match(/PASS/g)?.length === (id === "aurelia" ? 10 : 9),
      `${id}: fuel, balance and gear integrator checks pass in the browser worker`,
    );
    assert(
      (await bench.getByTestId("gear-check-summary").innerText()).includes(
        "54 overlap cases",
      ),
      `${id}: both runways and three frame rates are checked with sampled tire geometry`,
    );
    await bench
      .getByRole("button", { name: "Dispatch load", exact: true })
      .click();
    const dispatch = {
      mass: await bench.getByTestId("loading-mass").innerText(),
      fuel: await bench.getByTestId("loading-fuel").innerText(),
      cg: await bench.getByTestId("loading-cg").innerText(),
    };
    assert(
      (await bench.getByTestId("loading-status").innerText()).includes(
        "WITHIN CONCEPT LIMITS",
      ),
      `${id}: dispatch is within mass and CG limits`,
    );
    await bench
      .getByRole("button", { name: "Usable fuel empty", exact: true })
      .click();
    const empty = {
      mass: await bench.getByTestId("loading-mass").innerText(),
      fuel: await bench.getByTestId("loading-fuel").innerText(),
      cg: await bench.getByTestId("loading-cg").innerText(),
    };
    assert(empty.fuel.startsWith("0.0 /"), `${id}: usable fuel reaches zero`);
    assert(
      parseFloat(dispatch.mass) > parseFloat(empty.mass) &&
        dispatch.cg !== empty.cg,
      `${id}: displayed mass and CG respond to fuel`,
    );
    await bench
      .getByRole("button", { name: "Full tanks", exact: true })
      .click();
    const fullStatus = await bench.getByTestId("loading-status").innerText();
    assert(
      fullStatus.includes(
        id === "aurelia" ? "WITHIN CONCEPT LIMITS" : "REJECTED LOAD",
      ),
      `${id}: full tanks correctly evaluate the takeoff limit`,
    );
    if (id === "aurelia" || id === "stormbird") {
      await bench
        .getByRole("button", { name: "No payload / full tanks", exact: true })
        .click();
      assert(
        (await bench.getByTestId("loading-status").innerText()).includes(
          id === "aurelia" ? "WITHIN CONCEPT LIMITS" : "CG outside",
        ),
        `${id}: no-payload CG decision reflects the measured equipment layout`,
      );
    }
    await bench
      .getByRole("button", { name: "Dispatch load", exact: true })
      .click();
    if (id !== "finch") {
      const balanced = await bench.getByTestId("loading-cg").innerText();
      await bench.getByLabel("Right wet wing fill", { exact: true }).fill("0");
      assert(
        (await bench.getByTestId("loading-cg").innerText()) !== balanced,
        `${id}: asymmetric tank loading changes lateral CG`,
      );
      await bench
        .getByRole("button", { name: "Dispatch load", exact: true })
        .click();
    }
    assert(
      (await page.getByLabel("Aircraft", { exact: true }).inputValue()) === id,
      `${id}: aircraft selection persists through the inspection`,
    );
    await bench.screenshot({ path: `output/${id}-fuel-balance.png` });
    fleet.push({ id, dispatch, empty, fullStatus, checksText });
  }
  await bench.getByLabel("Right wet wing fill", { exact: true }).fill("0");
  await page.getByLabel("Aircraft", { exact: true }).selectOption("finch");
  await page.waitForFunction(
    () => window.windTunnel?.getState().aircraft === "finch",
  );
  assert(
    (await bench.getByTestId("loading-status").innerText()).includes(
      "WITHIN CONCEPT LIMITS",
    ),
    "Switching from individually loaded wing tanks to Finch resets tank IDs safely",
  );
  await page
    .getByRole("button", { name: "Validate all four planes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Validate all four planes", exact: true })
    .waitFor({ state: "visible", timeout: 60000 });
  const flightBench = page.getByRole("region", {
    name: "Flight validation bench",
  });
  assert(
    (await flightBench.locator("tbody tr").count()) === 4,
    "Flight envelope worker completes the calibrated loading cases",
  );
  assert(
    (await page.getByRole("alert").count()) === 0,
    "No loading or flight worker errors",
  );
  assert(errors.length === 0, "No browser, network or WebGL errors");
  return { checks, fleet, errors };
};
