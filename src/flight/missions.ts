import { Vector3 } from "three";
export type MissionId =
  | "discovery"
  | "island"
  | "canyon"
  | "short"
  | "emergency"
  | "race"
  | "crosswind"
  | "free";
export type Mission = {
  id: MissionId;
  name: string;
  eyebrow: string;
  description: string;
  duration: string;
  difficulty: string;
  icon: string;
  airStart: boolean;
  short?: boolean;
  land?: string;
  rings: Vector3[];
  par: number;
};
const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
export const missions: Mission[] = [
  {
    id: "discovery",
    name: "First light",
    eyebrow: "FLIGHT SCHOOL",
    description:
      "Find your wings. Lift off toward open water, follow the coast, and bring it home.",
    duration: "3–5 min",
    difficulty: "Easy",
    icon: "sunrise",
    airStart: false,
    land: "Palm Bay",
    rings: [
      v(-260, 50, 390),
      v(-465, 95, 700),
      v(-700, 110, 650),
      v(-790, 100, 40),
      v(-700, 100, 420),
      v(-350, 105, 740),
      v(-260, 60, 630),
    ],
    par: 230,
  },
  {
    id: "island",
    name: "The island loop",
    eyebrow: "ISLAND EXPLORER",
    description:
      "A little altitude. A whole new perspective. Follow the golden rings around the islands.",
    duration: "3–4 min",
    difficulty: "Easy",
    icon: "compass",
    airStart: true,
    rings: [
      v(-260, 105, 220),
      v(-530, 150, -350),
      v(-390, 190, -720),
      v(30, 180, -830),
      v(460, 160, -700),
      v(830, 110, -390),
      v(890, 100, 60),
      v(430, 125, 420),
      v(-160, 120, 650),
    ],
    par: 210,
  },
  {
    id: "canyon",
    name: "Between the peaks",
    eyebrow: "CANYON RUN",
    description:
      "Thread the emerald passage. Stay low, keep your wings level, and trust your line.",
    duration: "2–3 min",
    difficulty: "Medium",
    icon: "mountain",
    airStart: true,
    rings: [
      v(95, 100, 200),
      v(95, 94, -40),
      v(95, 100, -250),
      v(95, 92, -470),
      v(95, 110, -710),
    ],
    par: 145,
  },
  {
    id: "short",
    name: "A small arrival",
    eyebrow: "PRECISION LANDING",
    description:
      "Needle Point has 245 meters with your name on them. Touch down gently and stop.",
    duration: "2 min",
    difficulty: "Medium",
    icon: "landing",
    airStart: true,
    short: true,
    land: "Needle Point",
    rings: [],
    par: 120,
  },
  {
    id: "emergency",
    name: "Quiet skies",
    eyebrow: "ENGINE-OUT LANDING",
    description:
      "Your engine is out. Trade altitude for airspeed and glide safely into Palm Bay.",
    duration: "2 min",
    difficulty: "Hard",
    icon: "wind",
    airStart: true,
    land: "Palm Bay",
    rings: [],
    par: 120,
  },
  {
    id: "race",
    name: "Postcard express",
    eyebrow: "TIME TRIAL",
    description:
      "The afternoon mail is waiting. Chase every ring and beat the island clock.",
    duration: "3 min",
    difficulty: "Medium",
    icon: "timer",
    airStart: true,
    rings: [
      v(-260, 95, 150),
      v(-560, 140, -330),
      v(-370, 180, -720),
      v(60, 160, -830),
      v(550, 135, -620),
      v(880, 100, -210),
      v(720, 100, 230),
      v(100, 120, 600),
    ],
    par: 170,
  },
  {
    id: "crosswind",
    name: "Against the breeze",
    eyebrow: "CROSSWIND LANDING",
    description:
      "A lively ocean breeze. Crab into the wind, line up, and settle onto Palm Bay.",
    duration: "2 min",
    difficulty: "Hard",
    icon: "wind",
    airStart: true,
    land: "Palm Bay",
    rings: [],
    par: 120,
  },
  {
    id: "free",
    name: "Nowhere to be",
    eyebrow: "FREE FLIGHT",
    description:
      "No clock. No checklist. Just you, your little plane, and a whole island to explore.",
    duration: "Your own pace",
    difficulty: "Relaxed",
    icon: "compass",
    airStart: true,
    rings: [],
    par: 0,
  },
];
export type FlightResult = {
  success: boolean;
  title: string;
  medal: "gold" | "silver" | "bronze" | null;
  score: number;
  time: number;
  smoothness: number;
  accuracy: number;
  health: number;
  mission: string;
};
export function scoreFlight(
  time: number,
  par: number,
  health: number,
  sink: number,
  accuracy: number,
  rings: number,
) {
  const smoothness = Math.max(0, 100 - sink * 13);
  const pace = Math.min(1.3, par / Math.max(time, 1));
  const score = Math.round(
    health * 15 + smoothness * 10 + accuracy * 800 + pace * 900 + rings * 250,
  );
  const quality =
    health * 0.3 + smoothness * 0.25 + accuracy * 20 + Math.min(1, pace) * 25;
  return {
    score,
    smoothness,
    medal: (quality >= 85 ? "gold" : quality >= 65 ? "silver" : "bronze") as
      "gold" | "silver" | "bronze",
  };
}
