import { checkPlane, verdictText } from "./fit/checks";
import { ids } from "./fit/limits";

if (import.meta.main) {
  const args = process.argv.slice(2), id = args[0];
  if ((!ids.some((v) => v === id) && id !== "all") || args.slice(1).some((v) => v !== "--json") || args.filter((v) => v === "--json").length > 1) {
    console.error("Usage: bun run fit <f15c|peregrine|stormbird|aurelia|all> [--json]");
    process.exitCode = 2;
  } else {
    const reports = [];
    for (const plane of ids.filter((v) => id === "all" || v === id)) {
      const report = await checkPlane(plane);
      reports.push(report);
      if (!args.includes("--json")) console.log(verdictText(report));
    }
    if (args.includes("--json")) console.log(JSON.stringify(reports, null, 2));
  }
}
