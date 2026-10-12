async (page) => {
  const errors = [],
    results = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => !!window.pocketFlight);
  await page.evaluate(async () => {
    await window.pocketFlight.aircraft.ready;
  });
  for (const id of ["finch", "peregrine", "aurelia", "stormbird"]) {
    await page.evaluate(async (id) => {
      const g = window.pocketFlight;
      g.setSuspended(true);
      g.menu();
      await g.selectAircraft(id);
      const { missions } = await import("/src/missions.ts");
      g.start(missions.find((m) => m.id === "free"));
      const p = g.physics;
      const { gearContactHeight, finchWheels, peregrineWheels, aureliaWheels } =
        await import("/src/landing-gear.ts");
      const { stormbirdContact } = await import("/src/stormbird-contact.ts");
      p.reset(true);
      g.replay.clear();
      g.vfx.reset();
      p.gearPosition = 1;
      p.position.set(-260, 0, 260);
      p.pitch = id === "finch" ? 0.08 : -0.04;
      p.roll = 0.07;
      p.updateQuaternion();
      p.position.y =
        (id === "stormbird"
          ? stormbirdContact(p.position, p.quaternion, 1, 0, 0).height
          : gearContactHeight(
              p.position,
              p.quaternion,
              id === "aurelia"
                ? aureliaWheels
                : id === "peregrine"
                  ? peregrineWheels
                  : finchWheels,
            )) + 0.06;
      p.velocity.set(0, -1.8, id === "finch" ? -30 : -38);
      p.throttle = 0;
      p.enginePower = 0.12;
      g.keys.clear();
      g.keys.add("KeyB");
      g.previousPosition.copy(p.position);
      g.previousQuaternion.copy(p.quaternion);
      g.accumulator = 0;
      if (g.aircraft.effects) {
        g.aircraft.effects.motion.gear = 1;
        g.updateJet(0);
      }
      window.vfxEvents = [];
      window.vfxTouchTime = null;
      p.vfxOriginalStep ??= p.step.bind(p);
      p.step = (dt, input, obstacles) => {
        p.vfxOriginalStep(dt, input, obstacles);
        window.vfxEvents.push(...p.events);
        if (p.events.some((e) => e.type === "landing"))
          window.vfxTouchTime = p.flightTime;
        if (
          window.vfxTouchTime !== null &&
          p.flightTime >= window.vfxTouchTime + 0.18
        )
          g.setSuspended(true);
      };
      g.cameraMode = "landing";
      g.setSuspended(false);
    }, id);
    await page.waitForFunction(
      () => window.vfxEvents.some((e) => e.type === "landing"),
      { timeout: 15000 },
    );
    await page.waitForFunction(() => window.pocketFlight.suspended);
    const landing = await page.evaluate(() => {
      const g = window.pocketFlight,
        p = g.physics;
      g.setSuspended(true);
      g.aircraft.group.position.copy(p.position);
      g.aircraft.group.quaternion.copy(p.quaternion);
      g.aircraft.setSuspension(p.suspension);
      g.updateJet(0);
      const s = g.aircraft.cameraScale;
      g.camera.position.set(
        p.position.x + 9 * s,
        p.position.y + 2.3 * s,
        p.position.z + 11 * s,
      );
      g.camera.lookAt(p.position);
      g.camera.updateProjectionMatrix();
      g.emit();
      g.vfx.render(p.flightTime, 900, false, g.camera.aspect);
      g.renderer.render(g.scene, g.camera);
      return {
        state: g.getState(),
        events: window.vfxEvents,
        stats: g.vfx.stats,
      };
    });
    if (
      !landing.stats.clouds.active ||
      landing.stats.sparks.active ||
      landing.state.health !== 100
    )
      throw new Error(
        id + " routine touchdown VFX failed: " + JSON.stringify(landing),
      );
    await page
      .locator("canvas")
      .first()
      .screenshot({ path: `output/vfx-touchdown-${id}.png` });
    const damage = await page.evaluate(() => {
      const g = window.pocketFlight,
        p = g.physics;
      g.vfx.reset();
      p.damage.engine = 0.7;
      p.grounded = false;
      p.position.set(-260, 60, 260);
      p.velocity.set(0, 0, -90);
      for (let j = 1; j <= 120; j++) {
        p.position.z -= 90 / 60;
        p.flightTime = j / 60;
        g.vfx.step(1 / 60, g.vfxInput());
      }
      g.aircraft.group.position.copy(p.position);
      g.aircraft.group.quaternion.copy(p.quaternion);
      g.camera.position.set(
        p.position.x + 42,
        p.position.y + 8,
        p.position.z + 55,
      );
      g.camera.lookAt(p.position.x, p.position.y + 1, p.position.z + 25);
      g.camera.updateProjectionMatrix();
      g.emit();
      g.onToast("Engine damage — wind carries the smoke away.");
      g.vfx.render(2, 900, false, g.camera.aspect);
      g.renderer.render(g.scene, g.camera);
      const withVfx = g.renderer.info.render.calls;
      g.vfx.group.visible = false;
      g.renderer.render(g.scene, g.camera);
      const baseline = g.renderer.info.render.calls;
      g.vfx.group.visible = true;
      g.renderer.render(g.scene, g.camera);
      const t = performance.now();
      for (let j = 0; j < 120; j++)
        g.vfx.render(2, 900, false, g.camera.aspect);
      const cpuMs = (performance.now() - t) / 120;
      const points = g.vfx.group.children[0],
        attr = points.geometry.getAttribute("position");
      const pose = Array.from(attr.array).slice(
        0,
        points.geometry.drawRange.count * 3,
      );
      g.vfx.render(1, 900, false, g.camera.aspect);
      g.vfx.render(2, 900, false, g.camera.aspect);
      const sought = Array.from(attr.array).slice(
        0,
        points.geometry.drawRange.count * 3,
      );
      if (JSON.stringify(pose) !== JSON.stringify(sought))
        throw new Error("Seeking changed smoke poses");
      return {
        stats: g.vfx.stats,
        cpuMs,
        addedDrawCalls: withVfx - baseline,
        shaderErrors: g.renderer.info.programs.filter(
          (program) => program.diagnostics?.runnable === false,
        ).length,
      };
    });
    if (
      damage.shaderErrors ||
      damage.addedDrawCalls > 2 ||
      !damage.stats.clouds.active
    )
      throw new Error(id + " smoke failed: " + JSON.stringify(damage));
    await page
      .locator("canvas")
      .first()
      .screenshot({ path: `output/vfx-smoke-${id}.png` });
    const impact = await page.evaluate(() => {
      const g = window.pocketFlight,
        p = g.physics;
      g.vfx.reset();
      p.position.set(-260, 10, 260);
      p.velocity.set(0, 0, -30);
      p.flightTime = 0;
      g.aircraft.group.position.copy(p.position);
      g.aircraft.group.quaternion.copy(p.quaternion);
      g.vfx.impact(g.vfxInput(), 0.8);
      g.vfx.render(0.12, 900, false, g.camera.aspect);
      g.camera.position.set(-250, 14, 274);
      g.emit();
      g.onToast("Hard impact — brief sparks and settling dust.");
      g.camera.lookAt(p.position);
      g.camera.updateProjectionMatrix();
      g.renderer.render(g.scene, g.camera);
      return g.vfx.stats;
    });
    if (!impact.sparks.active || impact.drawCalls !== 2)
      throw new Error(id + " impact VFX failed");
    await page
      .locator("canvas")
      .first()
      .screenshot({ path: `output/vfx-impact-${id}.png` });
    results.push({ id, landing, damage, impact });
  }
  const trail = await page.evaluate(() => {
    const g = window.pocketFlight,
      p = g.physics;
    g.vfx.reset();
    p.damage.engine = 0;
    p.position.set(0, 2500, 0);
    p.velocity.set(0, 0, -220);
    p.flightTime = 0;
    p.grounded = false;
    g.vfxLoad = 3;
    for (let j = 1; j <= 120; j++) {
      p.position.z -= 220 / 60;
      p.flightTime = j / 60;
      g.vfx.step(1 / 60, g.vfxInput());
    }
    g.aircraft.group.position.copy(p.position);
    g.aircraft.group.quaternion.copy(p.quaternion);
    g.camera.position.set(25, 2508, p.position.z + 35);
    g.camera.lookAt(p.position);
    g.camera.updateProjectionMatrix();
    g.vfx.render(2, 900, false, g.camera.aspect);
    g.renderer.render(g.scene, g.camera);
    return g.vfx.stats;
  });
  await page
    .locator("canvas")
    .first()
    .screenshot({ path: "output/vfx-condensation.png" });
  if (!trail.clouds.active) throw new Error("Condensation missing");
  const replay = await page.evaluate(() => {
    const g = window.pocketFlight,
      p = g.physics;
    g.replay.clear();
    g.vfx.reset();
    p.damage.engine = 0.7;
    for (let j = 1; j <= 90; j++) {
      p.position.z -= 90 / 60;
      p.flightTime = j / 60;
      g.vfx.step(1 / 60, g.vfxInput());
      g.recordReplay();
    }
    g.menu();
    g.playReplay();
    g.replayClock = 0.8;
    g.poseReplay(true);
    if (!g.vfx.group.visible || !g.vfx.stats.clouds.active)
      throw new Error("Replay opened from menu lost its effects");
    return { mode: g.mode, visible: g.vfx.group.visible, stats: g.vfx.stats };
  });
  if (errors.length) throw new Error(JSON.stringify(errors));
  return { results, trail, replay, errors };
};
