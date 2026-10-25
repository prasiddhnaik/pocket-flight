async (page) => {
  const errors = [],
    results = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 900 });
  const seed = async (id, sink) =>
    page.evaluate(
      async ({ id, sink }) => {
        const game = window.pocketFlight,
          p = game.physics;
        const {
          gearContactHeight,
          finchWheels,
          peregrineWheels,
          aureliaWheels,
        } = await import("/src/aircraft/landing-gear.ts");
        const { stormbirdContact } = await import("/src/aircraft/stormbird/stormbird-contact.ts");
        p.reset(true);
        game.replay.clear();
        p.gearPosition = 1;
        p.position.set(-260, 0, 260);
        p.pitch = id === "finch" ? 0.08 : -0.04;
        p.roll = 0.11;
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
              )) + 0.18;
        p.velocity.set(0, -sink, id === "finch" ? -30 : -38);
        p.throttle = 0;
        p.enginePower = 0.12;
        game.keys.clear();
        game.keys.add("KeyB");
        game.cameraMode = "landing";
        game.previousPosition.copy(p.position);
        game.previousQuaternion.copy(p.quaternion);
        game.accumulator = 0;
        if (game.aircraft.effects) {
          game.aircraft.effects.motion.gear = 1;
          game.updateJet(0);
        }
        game.aircraft.setSuspension(0);
        const mounts = [
          game.aircraft.gear,
          ...(game.aircraft.effects?.legs ?? []).map((l) => l.pivot),
        ];
        window.landingCheck = {
          events: [],
          touch: null,
          mounts: mounts.map((node) => ({
            node,
            position: node.position.clone(),
            quaternion: node.quaternion.clone(),
          })),
        };
        p.originalLandingStep ??= p.step.bind(p);
        p.step = (dt, input, obstacles) => {
          p.originalLandingStep(dt, input, obstacles);
          window.landingCheck.events.push(...p.events);
          if (
            !window.landingCheck.touch &&
            p.events.some((e) => e.type === "landing")
          )
            window.landingCheck.touch = {
              damage: { ...p.damage },
              health: p.health,
              crashed: p.crashed,
              suspension: p.suspension,
            };
        };
        return { sink, bankDegrees: (p.roll * 180) / Math.PI };
      },
      { id, sink },
    );
  for (const id of ["finch", "peregrine", "aurelia", "stormbird"]) {
    await page
      .getByRole("combobox", { name: "Choose aircraft" })
      .selectOption(id);
    await page.waitForFunction(
      (id) => window.pocketFlight?.aircraft.id === id,
      id,
    );
    await page
      .getByRole("button", { name: "Free flight", exact: true })
      .click();
    await page.waitForFunction(() => window.pocketFlight?.mode === "playing");
    for (const sink of [1.8, 7]) {
      const approach = await seed(id, sink);
      await page.waitForFunction(
        () => !!window.landingCheck.touch,
        {},
        { timeout: 10000 },
      );
      await page.waitForTimeout(250);
      const result = await page.evaluate(() => {
        const game = window.pocketFlight,
          c = window.landingCheck;
        return {
          touch: c.touch,
          events: c.events,
          mountGaps: c.mounts.map((m) => ({
            name: m.node.name,
            distance: m.node.position.distanceTo(m.position),
            rotation: m.node.quaternion.angleTo(m.quaternion),
          })),
          gearRotation: game.aircraft.gear.rotation.z,
          grounded: game.physics.grounded,
        };
      });
      if (
        result.mountGaps.some((m) => m.distance > 1e-5 || m.rotation > 1e-5) ||
        Math.abs(result.gearRotation) > 1e-5 ||
        result.touch.crashed
      )
        throw new Error(`${id} mount separation: ${JSON.stringify(result)}`);
      if (
        sink < 2 &&
        (result.touch.health !== 100 ||
          result.events.some((e) => e.type === "impact" || e.type === "crash"))
      )
        throw new Error(
          `${id} routine touchdown damaged gear: ${JSON.stringify(result)}`,
        );
      if (sink > 6 && !(result.touch.damage.gear > 0))
        throw new Error(`${id} hard landing lost damage`);
      results.push({ id, approach, ...result });
      if (sink < 2) {
        await page.evaluate(() => {
          const g = window.pocketFlight;
          g.setSuspended(true);
          const p = g.physics.position,
            c = g.aircraft.cameraScale;
          g.camera.position.set(p.x + 9 * c, p.y + 3 * c, p.z + 11 * c);
          g.camera.lookAt(p);
          g.renderer.render(g.scene, g.camera);
        });
        await page.screenshot({ path: `output/landing-fixed-${id}.png` });
        await page.evaluate(() => window.pocketFlight.setSuspended(false));
      }
    }
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.pocketFlight.playReplay());
    await page.waitForTimeout(150);
    const replay = await page.evaluate(() => {
      const g = window.pocketFlight;
      return {
        mode: g.mode,
        rotation: g.aircraft.gear.rotation.z,
        mountGap: Math.max(
          ...window.landingCheck.mounts.map((m) =>
            m.node.position.distanceTo(m.position),
          ),
        ),
      };
    });
    if (
      replay.mode !== "replay" ||
      Math.abs(replay.rotation) > 1e-5 ||
      replay.mountGap > 1e-5
    )
      throw new Error(
        `${id} replay separated gear mounts: ${JSON.stringify(replay)}`,
      );
    results[results.length - 1].replay = replay;
    await page.evaluate(() => window.pocketFlight.stopReplay());
    await page
      .getByRole("button", { name: "Back to the island", exact: true })
      .click();
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    results,
    errors,
    scope:
      "Seeded approaches through the live game update and render loop; no manual full-circuit flight",
  };
};
