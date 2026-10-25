import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bettyFiles } from "../src/audio/betty";

const dir = fileURLToPath(new URL("../public/audio/betty/", import.meta.url));
const files = Object.values(bettyFiles).map((f) => `${dir}${f}.mp3`);

describe("betty clips", () => {
  test("every clip exists, is non-trivial, and the set stays under 150 KB", () => {
    let total = 0;
    for (const f of files) {
      expect(existsSync(f)).toBe(true);
      const size = statSync(f).size;
      expect(size).toBeGreaterThan(1000);
      total += size;
    }
    expect(total).toBeLessThan(150_000);
  });
});
