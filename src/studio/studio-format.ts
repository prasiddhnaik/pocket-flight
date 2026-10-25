export const seconds = (n: number) => `${n.toFixed(2)}s`;
export const clock = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toFixed(1).padStart(4, "0")}`;
export const slug = (name: string) =>
  name.replace(/[^\w-]+/g, "-").slice(0, 70) || "replay";
export const message = (e: unknown) =>
  e instanceof Error ? e.message : "Browser storage is unavailable.";
