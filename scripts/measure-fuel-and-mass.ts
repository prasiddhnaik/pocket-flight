import * as T from "three";
import { aircraftCatalog } from "../lab/aircraft";
import { loadGeometryOnly } from "./geometry-loader";
import { connectedSurfaces } from "./geometry-components";
import { fuelTable, volumeProperties, type Triangles } from "./fuel-volume";
import { aircraftSystems } from "../src/aircraft-systems";

const specifications = {
  finch: {
    sourceEmptyMass: 575,
    payloadMass: 205,
    referenceFuelKg: 80,
    allocations: [
      ["Aft electrical installation", 18, "AftEquipmentBay", "Avionics"],
      ["Fuel cell and plumbing", 12, "BellyFuelBay", "Fuselage and cabin"],
      ["Rear partition", 3, "RearCabinBulkhead", "Fuselage and cabin"],
    ],
  },
  peregrine: {
    sourceEmptyMass: 5770,
    payloadMass: 220,
    referenceFuelKg: 1400,
    allocations: [
      [
        "Aft battery, avionics and harnesses",
        164,
        "AftEquipmentBay",
        "Avionics",
      ],
      ["Hydraulics and operating fluid", 60, "HydraulicServiceBay", "Fuselage"],
      [
        "Fuel plumbing and centre cell hardware",
        50,
        "CentreFuelBay",
        "Fuselage",
      ],
      ["Rear partition", 8, "RearCabinBulkhead", "Fuselage"],
      [
        "Left wing spars, ribs and service mechanisms",
        90,
        "WingStructure_Left",
        "Wings",
      ],
      [
        "Right wing spars, ribs and service mechanisms",
        90,
        "WingStructure_Right",
        "Wings",
      ],
    ],
  },
  aurelia: {
    sourceEmptyMass: 3910,
    payloadMass: 750,
    referenceFuelKg: 1000,
    allocations: [
      [
        "Forward battery, avionics and harnesses",
        89,
        "ForwardEquipmentBay",
        "Avionics",
      ],
      [
        "Hydraulics and operating fluid",
        40,
        "HydraulicServiceBay",
        "Fuselage and cabin",
      ],
      ["Rear partition", 6, "RearCabinBulkhead", "Fuselage and cabin"],
      [
        "Left wing spars, ribs and service mechanisms",
        56,
        "WingStructure_Left",
        "Wings",
      ],
      [
        "Right wing spars, ribs and service mechanisms",
        56,
        "WingStructure_Right",
        "Wings",
      ],
    ],
  },
  stormbird: {
    sourceEmptyMass: 6510,
    payloadMass: 160,
    referenceFuelKg: 1800,
    allocations: [
      [
        "Aft battery, avionics and harnesses",
        200,
        "AftEquipmentBay",
        "Avionics",
      ],
      ["Hydraulics and operating fluid", 85, "HydraulicServiceBay", "Fuselage"],
      [
        "Fuel plumbing and centre cell hardware",
        65,
        "CentreFuelBay",
        "Fuselage",
      ],
      ["Rear partition", 8, "RearCabinBulkhead", "Fuselage"],
      [
        "Left wing spars, ribs and service mechanisms",
        107,
        "WingStructure_Left",
        "Wings",
      ],
      [
        "Right wing spars, ribs and service mechanisms",
        107,
        "WingStructure_Right",
        "Wings",
      ],
    ],
  },
} as const;
const aircraft: Record<string, unknown> = {};
for (const id of ["finch", "peregrine", "aurelia", "stormbird"] as const) {
  const config = aircraftCatalog[id],
    { scene, sha256 } = await loadGeometryOnly(
      new URL("../public/assets/" + config.asset, import.meta.url),
    );
  scene.scale.setScalar(config.scale);
  scene.position.y = config.offsetY;
  scene.updateWorldMatrix(true, true);
  const tanks = [];
  if (id === "finch") {
    const mesh = scene.getObjectByName(
      "BellyFuelBay_•_Cabin_•_brushed_aluminium",
    ) as T.Mesh;
    const parts = connectedSurfaces(mesh).sort(
      (a, b) =>
        volumeProperties(b.triangles).volume -
        volumeProperties(a.triangles).volume,
    );
    const tank = fuelTable(parts[0].triangles);
    if (
      Math.abs(
        tank.envelopeLitres -
          scene.getObjectByName("BellyFuelBay")!.userData.envelope_litres,
      ) > 0.2
    )
      throw Error("Finch tank component does not match authored volume");
    tanks.push({
      id: "belly",
      name: "Underfloor fuel cell",
      densityKgPerLitre: 0.72,
      fillPriority: 1,
      ...tank,
    });
  } else {
    scene.getObjectByName("FuelSystem")!.traverse((node) => {
      if (
        !(node instanceof T.Mesh) ||
        typeof node.userData.envelopeLitres !== "number"
      )
        return;
      const p = node.geometry.getAttribute("position"),
        ix = node.geometry.index,
        triangles: Triangles = [];
      for (let i = 0; i < (ix?.count ?? p.count); i += 3)
        triangles.push(
          [0, 1, 2].map((j) =>
            new T.Vector3()
              .fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j)
              .applyMatrix4(node.matrixWorld),
          ),
        );
      const region = node.userData.installationRegion,
        center = region === "body";
      const tank = fuelTable(triangles);
      tanks.push({
        id: center ? "centre" : region === "Wing_Left" ? "left" : "right",
        name: center
          ? "Centre fuselage cell"
          : region === "Wing_Left"
            ? "Left wet wing"
            : "Right wet wing",
        densityKgPerLitre: 0.8,
        fillPriority: center ? 2 : 1,
        ...tank,
      });
    });
  }
  if (tanks.length !== (id === "finch" ? 1 : id === "aurelia" ? 2 : 3))
    throw Error(`${id}: fuel cell measurement is incomplete`);
  const specification = specifications[id];
  const installations = specification.allocations.map(
    ([name, mass, group, source]) => {
      const bounds = new T.Box3().setFromObject(
        scene.getObjectByName(group)!,
        true,
      );
      if (bounds.isEmpty())
        throw Error(`Missing mass installation ${id} ${group}`);
      return {
        name,
        mass,
        source,
        group,
        center: bounds.getCenter(new T.Vector3()).toArray(),
        size: bounds.getSize(new T.Vector3()).toArray(),
        provenance:
          "Estimated system mass redistributed from existing empty-mass budget; installation envelope measured at runtime scale",
      };
    },
  );
  const usableFuelKg = tanks.reduce(
      (sum, t) => sum + t.usableLitres * t.densityKgPerLitre,
      0,
    ),
    unusableFuelKg = tanks.reduce(
      (sum, t) => sum + t.unusableLitres * t.densityKgPerLitre,
      0,
    );
  const maxTakeoffMass =
    specification.sourceEmptyMass +
    specification.payloadMass +
    specification.referenceFuelKg;
  const dispatchFuelKg = Math.min(
    usableFuelKg,
    Math.max(
      0,
      maxTakeoffMass -
        specification.sourceEmptyMass -
        specification.payloadMass -
        unusableFuelKg,
    ),
  );
  aircraft[id] = {
    asset: config.asset,
    assetRevision: sha256,
    tanks,
    installations,
    hardware: aircraftSystems[id],
    usableFuelKg,
    unusableFuelKg,
    emptyMassIncludingResidual: specification.sourceEmptyMass + unusableFuelKg,
    maxTakeoffMass,
    defaultLoading: { fuel: dispatchFuelKg / usableFuelKg, payload: 1 },
    validity:
      "Geometry-calibrated capacity, positions and liquid inertia; component masses, displacement, trapped-fuel allowance and takeoff mass limit remain concept estimates.",
  };
  console.log(
    id,
    Math.round(usableFuelKg),
    "kg usable fuel;",
    Math.round(unusableFuelKg),
    "kg trapped;",
    Math.round(dispatchFuelKg),
    "kg dispatch",
  );
}
const evidence = {
  version: "fuel-balance-hardware-2",
  aircraft,
  references: [
    {
      url: "https://www.faa.gov/regulationspolicies/handbooksmanuals/aviation/phak/chapter-7-aircraft-systems",
      use: "Aircraft-specific electrical and hydraulic architecture; the fictional fleet's voltages, loads, generator allowances and pump flow ratings are explicit concept estimates, not values taken from this handbook",
    },
    {
      url: "https://www.faa.gov/sites/faa.gov/files/2023-09/Weight_Balance_Handbook.pdf",
      use: "Weight and balance accounting; unusable fuel retained in empty mass",
    },
    {
      url: "https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-large-aeroplanes-cs-25?page=33",
      use: "2% expansion space relative to fill capacity; unusable quantity requires adverse-condition feed tests, so the 3% allowance is explicitly estimated",
    },
    {
      url: "https://www.mobil.com/en/sap/our-products/product-series/jetfuel-series",
      use: "Jet fuel density 775–840 kg/m3 at 15 C; nominal 800 selected",
    },
  ],
  limitations: [
    "Electrical/hydraulic load and capacity allowances are aircraft-specific estimates. Generator loads, hydraulic flow transients and system-failure power losses are not yet coupled to the flight integrator.",
    "No structural or manufacturer mass data for these fictional aircraft. Existing empty-mass totals are retained and decomposed, rather than double-counting installed structure.",
    "A three percent uniform volume-displacement allowance and three percent trapped-fuel allowance are estimates, not measured feed-test results.",
    "Fuel settles against horizontal body-Y levels; slosh, inverted operation, fuel transfer transients and failures are outside this model.",
  ],
};
await Bun.write(
  new URL("../src/fuel-mass-calibration.json", import.meta.url),
  JSON.stringify(evidence, null, 2),
);
console.log("FLEET_FUEL_MASS_MEASURED");
