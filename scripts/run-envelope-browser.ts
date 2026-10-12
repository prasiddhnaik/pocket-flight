import { envelopeFingerprint } from "./envelope-source";
const sourceHashes = await envelopeFingerprint();
const cli = [
  "bun",
  "node_modules/.bin/playwright-cli",
  "-s=envelope-validation",
];
async function command(args: string[]) {
  const p = Bun.spawn([...cli, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code) throw Error(out + err);
  return out;
}
try {
  await command(["open", "http://127.0.0.1:5186/"]);
  const out = await command([
    "run-code",
    (await Bun.file("scripts/check-envelope-browser.js").text())
      .trim()
      .replace(/;$/, ""),
  ]);
  await Bun.write("output/envelope-browser.log", out);
  const result = out.match(/### Result\n([\s\S]*?)\n### Ran/);
  if (!result) throw Error(out);
  await Bun.write(
    "output/envelope-browser.json",
    JSON.stringify({ ...JSON.parse(result[1]), sourceHashes }, null, 2),
  );
  if (
    JSON.stringify(sourceHashes) !== JSON.stringify(await envelopeFingerprint())
  )
    throw Error("Source changed during browser validation; rerun.");
  console.log(result[1]);
} finally {
  await command(["close"]);
}
