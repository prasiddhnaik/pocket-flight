async (page) => {
  const id = "__AIRCRAFT__";
  const start = { f15c: 140, peregrine: 120, stormbird: 130, aurelia: 110 }[id];
  const out = "output/cockpit-check";
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const ready = async () => {
    await page.waitForFunction(() => !!window.pocketFlight);
    await page.evaluate(async () => {
      await window.pocketFlight.aircraft.ready;
      await window.pocketFlight.world.ready;
    });
    await page.getByLabel("Choose aircraft", { exact: true }).selectOption(id);
    await page.waitForFunction((want) => window.pocketFlight.aircraft.id === want, id);
  };
  const cockpit = async () => {
    await page.evaluate(async () => {
      const g = window.pocketFlight;
      g.cameraMode = "cockpit";
      await new Promise((resolve) => setTimeout(resolve, 200));
      await g.aircraft.interior.loaded;
    });
  };
  const fly = async (speed) => {
    await page.evaluate((v) => {
      const g = window.pocketFlight, p = g.physics;
      p.reset(true);
      p.initializeAirStart(v);
      p.position.set(-260, 560, 1500);
      g.previousPosition.copy(p.position);
      g.previousQuaternion.copy(p.quaternion);
      g.accumulator = 0;
    }, speed);
  };
  await page.reload();
  await page.setViewportSize({ width: 1600, height: 900 });
  await ready();
  await page.getByRole("button", { name: "Free flight", exact: true }).first().click();
  await page.waitForFunction(() => window.pocketFlight.mode === "playing", null, { timeout: 30000 });
  await fly(start);
  await cockpit();
  await fly(start);
  await page.waitForTimeout(6500);
  const shot = (name) => page.screenshot({ path: `${out}/${id}-${name}.png` });
  await shot("rest");
  const look = async (x, y, name) => {
    await page.evaluate(([ox, oy]) => { window.pocketFlight.orbit = { x: ox, y: oy }; }, [x, y]);
    await page.waitForTimeout(350);
    await shot(name);
  };
  await look(0, 0.3, "panel");
  await page.keyboard.down("KeyZ");
  await page.waitForTimeout(900);
  await shot("zoom");
  await page.keyboard.up("KeyZ");
  await page.waitForTimeout(600);
  await look(0.85, 0.5, "left");
  await look(-0.85, 0.5, "right");
  await look(2.7, 0.15, "back");
  if (id === "aurelia") {
    await look(0.0, -0.7, "up");
    await look(-0.7, 0.75, "pedestal");
  }
  const state = await page.evaluate(() => {
    const g = window.pocketFlight, i = g.aircraft.interior;
    const needle = g.aircraft.group.getObjectByName("Needle_standby_airspeed");
    return { active: i.active, needleTurned: needle ? needle.quaternion.angleTo(needle.quaternion.clone().identity()) : null, calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles, fps: g.fps, hudHidden: !!document.querySelector(".hud-in-cockpit") };
  });
  await page.evaluate(() => {
    const g = window.pocketFlight;
    g.orbit = { x: 0, y: 0 };
    g.cameraMode = "chase";
  });
  await page.waitForTimeout(500);
  const chase = await page.evaluate(() => {
    const g = window.pocketFlight;
    return { active: g.aircraft.interior.active, calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles, fps: g.fps };
  });
  await shot("chase");
  // Night lighting on the printed panels.
  await page.evaluate(() => {
    const g = window.pocketFlight;
    g.cameraMode = "cockpit";
    g.night = true;
    g.orbit = { x: 0, y: 0.3 };
  });
  await fly(start);
  await page.waitForTimeout(5000);
  await shot("night");
  let combat = null;
  if (id !== "aurelia") {
    await page.reload();
    await ready();
    await page.getByRole("button", { name: "Weapons sandbox", exact: true }).click();
    await page.waitForFunction(() => window.pocketFlight.mode === "playing", null, { timeout: 30000 });
    await cockpit();
    await page.evaluate(() => { window.pocketFlight.orbit = { x: 0, y: 0.3 }; });
    await page.keyboard.down("KeyZ");
    await page.waitForTimeout(1500);
    await shot("combat");
    await page.keyboard.up("KeyZ");
    combat = await page.evaluate(() => ({ contacts: window.pocketFlight.combat.targets().length, magazine: window.pocketFlight.combat.magazine() }));
  }
  return JSON.stringify({ id, state, chase, combat, errors });
}
