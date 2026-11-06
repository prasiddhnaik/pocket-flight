async (page) => {
  const id = "__AIRCRAFT__";
  const out = "output/pilot-check";
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.reload();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForFunction(() => !!window.pocketFlight);
  await page.evaluate(async () => {
    await window.pocketFlight.aircraft.ready;
    await window.pocketFlight.world.ready;
  });
  await page.getByLabel("Choose aircraft", { exact: true }).selectOption(id);
  await page.waitForFunction((want) => window.pocketFlight.aircraft.id === want, id);
  await page.getByRole("button", { name: "Free flight", exact: true }).first().click();
  await page.waitForFunction(() => window.pocketFlight.mode === "playing", null, { timeout: 30000 });
  await page.evaluate(async () => {
    const g = window.pocketFlight;
    await g.aircraft.pilot.ready;
    g.cameraMode = "cockpit";
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (g.aircraft.interior) await g.aircraft.interior.loaded;
  });
  await page.waitForTimeout(2500);
  const shot = (name) => page.screenshot({ path: `${out}/${id}-${name}.png` });
  const look = async (x, y, name) => {
    await page.evaluate(([ox, oy]) => { window.pocketFlight.orbit = { x: ox, y: oy }; }, [x, y]);
    await page.waitForTimeout(400);
    await shot(name);
  };
  await look(0, 0, "seat");
  await look(0, 0.75, "down");
  await look(0.6, 0.6, "left");
  await look(-0.6, 0.6, "right");
  const seated = await page.evaluate(() => {
    const g = window.pocketFlight;
    return { fps: g.fps, head: g.aircraft.group.getObjectByName("head").scale.x };
  });
  await page.evaluate(() => {
    const g = window.pocketFlight;
    g.orbit = { x: 0.9, y: 0.25 };
    g.cameraMode = "chase";
  });
  await page.waitForTimeout(800);
  await shot("chase");
  const chase = await page.evaluate(() => {
    const g = window.pocketFlight;
    return { fps: g.fps, head: g.aircraft.group.getObjectByName("head").scale.x };
  });
  // Paused, with the game's camera frozen, look in from beside the cockpit.
  await page.evaluate(() => {
    const g = window.pocketFlight;
    g.pause();
    g.cameraUpdate = () => {};
    const group = g.aircraft.group, eye = g.aircraft.pilot.seat.eye;
    const at = (x, y, z) => group.localToWorld(g.camera.position.clone().set(eye[0] + x, eye[1] + y, eye[2] + z));
    g.camera.position.copy(at(-1.9, 0.75, 0.5));
    g.camera.lookAt(at(0, -0.45, -0.15));
    g.camera.fov = 38;
    g.camera.near = 0.05;
    g.camera.updateProjectionMatrix();
    // Hide the pause menu and its blurred backdrop for the photo.
    const style = document.createElement("style");
    style.textContent = ".modal-scrim { display: none !important; }";
    document.head.append(style);
  });
  await page.waitForTimeout(500);
  await shot("outside");
  return JSON.stringify({ id, seated, chase, errors });
}
