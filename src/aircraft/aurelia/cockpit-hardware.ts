import * as T from "three";

type Point = readonly [number, number, number];
type HardwareTools = {
  rounded: (
    name: string,
    size: Point,
    at: Point,
    radius: number,
    material: T.Material,
    parent: T.Object3D,
  ) => T.Mesh;
  rod: (
    name: string,
    a: Point,
    b: Point,
    radius: number,
    material: T.Material,
    parent: T.Object3D,
  ) => T.Mesh;
  black: T.Material;
  metal: T.Material;
};

/** Visually reconstructed controls, fixed to their panels before fitting counter-scaling. */
export function detailAureliaCockpit(
  cockpit: T.Group,
  panel: T.Group,
  pedestal: T.Group,
  { rounded, rod, black, metal }: HardwareTools,
) {
  const rubber = new T.MeshStandardMaterial({
    color: "#1b2025",
    roughness: 0.92,
  });
  rubber.name = "Sculpted control grips";
  const key = new T.MeshStandardMaterial({
    color: "#3c4650",
    roughness: 0.6,
    metalness: 0.35,
  });
  key.name = "Graphite avionics keys";
  const blue = new T.MeshStandardMaterial({
    color: "#adc9dc",
    roughness: 0.4,
    emissive: "#568caf",
    emissiveIntensity: 0.25,
  });
  blue.name = "Cool white control lighting";
  const red = new T.MeshStandardMaterial({ color: "#b83e38", roughness: 0.72 });
  red.name = "Yoke disconnect switches";
  const plate = (
    name: string,
    size: Point,
    at: Point,
    legend: string,
    parent: T.Object3D,
  ) => {
    const mesh = rounded(name, size, at, Math.min(...size) / 4, black, parent);
    mesh.userData.cockpitLegend = legend;
    return mesh;
  };
  const knob = (
    name: string,
    x: number,
    y: number,
    z: number,
    parent: T.Object3D,
  ) => {
    rod(
      `${name}_collar`,
      [x, y, z - 0.003],
      [x, y, z + 0.003],
      0.009,
      metal,
      parent,
    );
    rod(name, [x, y, z + 0.001], [x, y, z + 0.019], 0.0075, rubber, parent);
    rounded(
      `${name}_index`,
      [0.0015, 0.006, 0.0015],
      [x, y + 0.003, z + 0.019],
      0.0004,
      blue,
      parent,
    );
  };

  // Coaxial knobs and softkeys seat against the bezel; glass remains inside its rim.
  for (let i = 1; i <= 3; i++) {
    const display = panel.getObjectByName(`Display_placeholder_${i}`)!;
    for (const side of [-1, 1]) {
      knob(
        `Display_${i}_encoder_${side}`,
        side * 0.151,
        -0.077,
        0.013,
        display,
      );
      for (let j = 0; j < 3; j++)
        rounded(
          `Display_${i}_side_key_${side}_${j}`,
          [0.008, 0.012, 0.005],
          [side * 0.152, 0.055 - j * 0.025, 0.01],
          0.002,
          key,
          display,
        );
    }
    for (let j = 0; j < 8; j++)
      rounded(
        `Display_${i}_softkey_${j}`,
        [0.022, 0.006, 0.006],
        [(j - 3.5) * 0.03, -0.101, 0.011],
        0.0015,
        key,
        display,
      );
  }
  // Dedicated flight-guidance strip, below the glare shield and above the screens.
  plate(
    "Flight_guidance_legends",
    [0.97, 0.039, 0.002],
    [0, 0.146, 0.046],
    "guidance",
    panel,
  );
  for (const [index, x] of [-0.43, -0.26, 0.26, 0.43].entries())
    knob(`Guidance_encoder_${index}`, x, 0.145, 0.048, panel);
  for (let i = 0; i < 7; i++)
    rounded(
      `Guidance_mode_key_${i}`,
      [0.036, 0.013, 0.005],
      [(i - 3) * 0.054, 0.14, 0.049],
      0.002,
      key,
      panel,
    );
  plate(
    "Panel_lower_legends",
    [0.94, 0.031, 0.008],
    [0, -0.143, 0.042],
    "lower",
    panel,
  );

  for (const side of [-1, 1]) {
    const yoke = cockpit.getObjectByName(
      `Yoke_${side < 0 ? "Left" : "Right"}`,
    )!;
    rounded(
      `Yoke_hub_${side}`,
      [0.067, 0.059, 0.043],
      [0, -0.018, 0.003],
      0.012,
      key,
      yoke,
    );
    // The hub overlaps both the column and the continuous yoke tube.
    rod(
      `Yoke_hub_spoke_${side}`,
      [0, -0.015, 0],
      [0, -0.065, 0],
      0.018,
      rubber,
      yoke,
    );
    for (const hand of [-1, 1]) {
      rounded(
        `Yoke_palm_grip_${side}_${hand}`,
        [0.037, 0.09, 0.04],
        [hand * 0.112, 0.016, 0],
        0.013,
        rubber,
        yoke,
      );
      for (let j = 0; j < 3; j++)
        rounded(
          `Yoke_grip_ridge_${side}_${hand}_${j}`,
          [0.0375, 0.003, 0.012],
          [hand * 0.112, -0.013 + j * 0.014, 0.017],
          0.001,
          key,
          yoke,
        );
      rounded(
        `Yoke_thumb_switch_${side}_${hand}`,
        [0.016, 0.011, 0.015],
        [hand * 0.108, 0.061, 0.002],
        0.003,
        hand < 0 ? red : key,
        yoke,
      );
    }
    const badge = plate(
      `Yoke_badge_${side}`,
      [0.045, 0.022, 0.0015],
      [0, -0.015, 0.025],
      "yoke",
      yoke,
    );
    badge.userData.cockpitLegend = "yoke";

    const glass = pedestal.getObjectByName(
      `Touch_controller_placeholder_${side}`,
    ) as T.Mesh;
    glass.geometry.scale(0.86, 1, 0.81);
    glass.userData.avionicsDisplay =
      side < 0 ? "touch-flight" : "touch-systems";
    const housing = new T.Group();
    housing.name = `Touch_controller_bezel_assembly_${side}`;
    housing.position.copy(glass.position);
    housing.rotation.copy(glass.rotation);
    pedestal.add(housing);
    rounded(
      `Touch_controller_frame_${side}`,
      [0.112, 0.022, 0.155],
      [0, -0.016, 0],
      0.008,
      key,
      housing,
    );
    for (const x of [-0.034, 0.034])
      rounded(
        `Touch_home_key_${side}_${x}`,
        [0.022, 0.007, 0.012],
        [x, -0.002, 0.066],
        0.002,
        black,
        housing,
      );

    // Quadrant plates meet the existing console roof, clear of the nose-gear tunnel.
    rounded(
      `Throttle_gate_${side}`,
      [0.054, 0.004, 0.22],
      [side * 0.034, 1.762, -4.99],
      0.001,
      key,
      pedestal,
    );
    const grip = pedestal.getObjectByName(`Thrust_grip_${side}`) as T.Mesh;
    grip.material = rubber;
    for (let i = 0; i < 4; i++)
      rounded(
        `Throttle_grip_ridge_${side}_${i}`,
        [0.041, 0.003, 0.007],
        [side * 0.034, 1.896, -5.038 + i * 0.012],
        0.001,
        key,
        pedestal,
      );
    rounded(
      `Throttle_disconnect_${side}`,
      [0.009, 0.009, 0.012],
      [side * 0.052, 1.885, -5.019],
      0.002,
      blue,
      pedestal,
    );
  }
  const quadrant = plate(
    "Throttle_quadrant_legends",
    [0.216, 0.002, 0.18],
    [0, 1.761, -4.76],
    "throttle",
    pedestal,
  );
  quadrant.userData.legendAxis = "y";
}
