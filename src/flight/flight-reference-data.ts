// Transcribed primary references. SI except the explicitly named feet axis.
// These describe reference hardware, NOT measurements of our fictional fleet.
export const references = {
  piston: {
    title: "Lycoming O-360 (76 series), 60297-25, June 2007",
    url: "https://www.lycoming.com/sites/default/files/attachments/O-360-%2520%252876%2520Series%2529%2520Oper%2520Manual%252060297-25.pdf",
    location: "Section 8, p.8-4; full-throttle normally aspirated engines",
    kind: "Manufacturer reference table; standard conditions, not an installed propeller map",
  },
  fighter: {
    title: "NASA TP-1538, Nguyen et al., December 1979",
    url: "https://ntrs.nasa.gov/api/citations/19800005879/downloads/19800005879.pdf",
    location:
      "Table VI (printed p.93, PDF p.99); Table III Cmq (printed p.66, PDF p.72)",
    kind: "Published simulation thrust deck; low-speed subscale wind-tunnel aerodynamic data. Engine deck is not independently established as measured engine-test data",
  },
  stall: {
    title: "NASA TM-101413, Wu et al., 1989",
    url: "https://ntrs.nasa.gov/api/citations/19890003184/downloads/19890003184.pdf",
    location:
      "Figure 2, printed p.5 / PDF p.7; circular experimental markers only",
    kind: "NACA 0012 section experiment reproduced from McAlister et al., NASA TM-84245; M=0.3, Re=3.9 million. Approximate visual transcription ±0.05 CL, ±0.5 degrees",
  },
  trainer: {
    title: "NASA CR-2605, Roesch and Harlan, October 1975",
    url: "https://ntrs.nasa.gov/api/citations/19760002914/downloads/19760002914.pdf",
    location: "Appendix A, Table A-1, printed p.77",
    kind: "Cessna 172 model: DATCOM estimates and borrowed rotary derivatives; wing lift slope checked against model wind-tunnel test. Cmq=-11.4 is a published model value, not a Finch measurement",
  },
};
export const pistonAltitudeFeet = [
  0, 500, 1000, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
  11000, 12000, 13000, 14000, 15000, 16000, 17000, 17500, 18000, 18500, 19000,
  19500, 20000, 20500, 21000, 21500, 22000, 22500, 23000, 23500, 24000, 24500,
  25000,
];
export const pistonPowerPercent = [
  100, 98.5, 96.8, 93.6, 92, 90.5, 87.5, 84.6, 81.7, 78.9, 76.2, 73.5, 70.8,
  68.3, 65.8, 63.4, 61, 58.7, 56.5, 54.3, 53.1, 52.1, 51.4, 50, 49.1, 48, 47.6,
  46, 45.2, 44, 43.4, 42.2, 41.4, 40.3, 39.5, 38.5,
];
export const jetMachAxis = [0.2, 0.4, 0.6, 0.8, 1];
export const jetAltitudeAxis = [0, 3048, 6096, 9144, 12192, 15240];
// Rows = Mach, columns = altitude. Rounded SI values from Table VI(a).
export const jetDryNewtons = [
  [56401, 40699, 28080, 17970, 10987, 6227],
  [56089, 41420, 29401, 19082, 11565, 6939],
  [56223, 43764, 31536, 20728, 12632, 7384],
  [55111, 45263, 34472, 23663, 14456, 8585],
  [51953, 43804, 35806, 27133, 16902, 10275],
];
export const jetMaximumNewtons = [
  [95276, 69834, 49929, 32573, 19727, 11565],
  [100970, 74993, 54488, 36269, 22240, 12610],
  [107820, 84112, 61204, 41300, 25354, 14300],
  [115959, 93742, 71057, 49440, 30513, 17570],
  [128485, 103723, 81398, 59977, 38440, 22494],
];
export const fighterAlphaDegrees = [
  -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80,
  90,
];
export const fighterPitchDamping = [
  -6.84, -6.84, -6.84, -3.47, -6.44, -6.45, -6.42, -6.4, -6.9, -6.24, -6.23,
  -6.4, -6.6, -6, -5.5, -5, -4.5, -3.5, -5, -4.4,
];
// Approximate EXPERIMENT circles, not the computed triangles/diamonds.
export const sectionAlphaDegrees = [0, 2, 4, 5, 8, 10, 12, 13.5, 15, 16, 18];
export const sectionLift = [
  0, 0.23, 0.44, 0.54, 0.94, 1.06, 1.18, 1.35, 1.18, 1.06, 1.01,
];
