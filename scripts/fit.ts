import { checkPlane, verdictText } from "./fit/checks";
import { ids } from "./fit/limits";
import { airframeIds, airframeText, checkAirframe } from "./fit/airframe";

const usage = `Usage: bun run fit <${[...ids, ...airframeIds].join("|")}|all> [--json] [--strict]`;
if (import.meta.main) {
  const [id, ...flags] = process.argv.slice(2);
  const known = (list: readonly string[]) => list.includes(id) || id === "all";
  if (!id || !known([...ids, ...airframeIds]) || flags.some((f) => f !== "--json" && f !== "--strict") || new Set(flags).size !== flags.length) {
    console.error(usage);
    process.exitCode = 2;
  } else {
    const json = flags.includes("--json"), reports = [];
    for (const plane of ids.filter((v) => id === "all" || v === id)) {
      const report = await checkPlane(plane);
      reports.push(report);
      if (!json) console.log(verdictText(report));
    }
    for (const plane of airframeIds.filter((v) => id === "all" || v === id)) {
      const report = await checkAirframe(plane);
      reports.push(report);
      if (!json) console.log(airframeText(report));
    }
    if (json) console.log(JSON.stringify(reports, null, 2));
    // Strict: anything worse than NEAR PASS fails the run (CI).
    if (flags.includes("--strict") && reports.some((r) => r.verdict === "REVIEW")) process.exitCode = 1;
  }
}
