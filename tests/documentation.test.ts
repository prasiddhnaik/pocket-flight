import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import config from "../vite.config";

const fixtures: string[] = [];
afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "pocket-flight-docs-")));
  fixtures.push(directory);
  const write = (file: string, contents: string) => {
    const target = join(directory, file);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, contents);
  };
  for (const folder of ["src", "lab", "tests", "scripts", "docs", "public"]) mkdirSync(join(directory, folder));
  write("README.md", "[Guide](docs/guide.html)");
  write("AGENTS.md", "");
  write("docs/guide.html", '<a href="missing.html">Next page</a>');
  for (const file of ["check-repository-layout.ts", "documentation.ts"]) {
    if (existsSync(`scripts/${file}`)) cpSync(`scripts/${file}`, join(directory, "scripts", file));
  }
  symlinkSync(resolve("node_modules"), join(directory, "node_modules"), "dir");
  return { directory, write };
}
async function check(directory: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, "scripts/check-repository-layout.ts", ...args], {
    cwd: directory, stdout: "pipe", stderr: "pipe",
  });
  return { code: await child.exited, output: await new Response(child.stderr).text() };
}
test("repo:check rejects missing links inside retained HTML documentation", async () => {
  const { directory } = fixture();
  const result = await check(directory);
  expect(result.code).toBe(1);
  expect(result.output).toContain("docs/guide.html");
  expect(result.output).toContain("missing.html");
}, 60_000);
test("repo:check checks Markdown targets and HTML anchors in retained documents", async () => {
  const { directory, write } = fixture();
  write("docs/guide.html", '<h1 id="start">Guide</h1>');
  write("docs/notes.md", "[Missing source](../src/moved.ts)\n[Missing section](guide.html#removed)");
  const result = await check(directory);
  expect(result.code).toBe(1);
  expect(result.output).toContain("src/moved.ts");
  expect(result.output).toContain("guide.html#removed");
}, 60_000);
test("repo:check --built rejects links absent from the production output", async () => {
  const { directory, write } = fixture();
  write("dist/index.html", '<a href="/docs/evidence.json">Evidence</a>');
  const result = await check(directory, "--built");
  expect(result.code).toBe(1);
  expect(result.output).toContain("docs/evidence.json");
}, 60_000);
test("repo:check includes unquoted HTML attributes and Markdown reference definitions", async () => {
  const { directory, write } = fixture();
  write("docs/guide.html", '<a href=missing.html>Next page</a>');
  write("docs/notes.md", "[Manual][guide]\n\n[guide]: missing-manual.md");
  const result = await check(directory);
  expect(result.code).toBe(1);
  expect(result.output).toContain("missing.html");
  expect(result.output).toContain("missing-manual.md");
}, 60_000);

function buildFixture(directory: string) {
  return build({
    ...config,
    configFile: false,
    root: directory,
    publicDir: false,
    logLevel: "silent",
    build: { rollupOptions: { input: join(directory, "index.html") } },
  });
}
test("the documentation build packages linked research and labels private references", async () => {
  const { directory, write } = fixture();
  write("index.html", '<!doctype html><a href=docs/research/f15c/evidence.json>Research</a><a href=lab/private.html>Private lab</a>');
  write("docs/research/f15c/evidence.json", '{"verified":true}');
  write("lab/private.html", "Private lab");
  await buildFixture(directory);
  expect(existsSync(join(directory, "dist/docs/research/f15c/evidence.json"))).toBe(true);
  const html = readFileSync(join(directory, "dist/index.html"), "utf8");
  expect(html).not.toContain('href="lab/private.html"');
  expect(html).toContain("local only");
  expect(existsSync(join(directory, "dist/lab/private.html"))).toBe(false);
}, 60_000);
test("the documentation build fails when a public navigation target is missing", async () => {
  const { directory, write } = fixture();
  write("index.html", '<!doctype html><a href="missing.html">Public page</a>');
  await expect(buildFixture(directory)).rejects.toThrow("missing.html");
}, 60_000);
