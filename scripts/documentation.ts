import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Plugin } from "vite";

const remote = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
export const walkDocuments = (directory: string): string[] =>
  existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walkDocuments(path) : [path];
  }) : [];

function links(source: string, markdown: boolean) {
  if (markdown) return [
    ...[...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]),
    ...[...source.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm)].map((m) => m[1] ?? m[2]),
  ];
  return [...source.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)].flatMap((tag) =>
    [...tag[0].matchAll(/\s(?:href|src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map((m) => (m[1] ?? m[2] ?? m[3]).replaceAll("&amp;", "&")),
  );
}
function target(root: string, file: string, url: string, built = false) {
  const path = decodeURIComponent(url.split(/[?#]/)[0]);
  if (!path) return file;
  if (!path.startsWith("/")) return resolve(dirname(file), path);
  const local = resolve(root, `.${path}`);
  return !built && !existsSync(local) ? resolve(root, "public", `.${path}`) : local;
}
export function checkDocumentation(root: string, built = false) {
  const files = built ? walkDocuments(root).filter((f) => f.endsWith(".html")) : [
    ...walkDocuments(resolve(root, "docs")).filter((f) => /\.(html|md)$/.test(f)),
    ...walkDocuments(resolve(root, "public")).filter((f) => f.endsWith(".html")),
    ...readdirSync(root).filter((f) => /\.html$|^(README|AGENTS)\.md$/.test(f)).map((f) => resolve(root, f)),
  ];
  const failures: string[] = [];
  let references = 0;
  for (const file of files) for (const url of links(readFileSync(file, "utf8"), file.endsWith(".md"))) {
    if (!url || remote.test(url)) continue;
    references++;
    let destination: string;
    try { destination = target(root, file, url, built); }
    catch { failures.push(`${relative(root, file)}: invalid URL ${url}`); continue; }
    if (!existsSync(destination)) failures.push(`${relative(root, file)}: ${url}`);
    else if (url.includes("#") && destination.endsWith(".html") && statSync(destination).isFile()) {
      const anchor = decodeURIComponent(url.slice(url.indexOf("#") + 1));
      const ids = [...readFileSync(destination, "utf8").matchAll(/\bid\s*=\s*(["'])(.*?)\1/g)].map((m) => m[2]);
      if (anchor && !ids.includes(anchor)) failures.push(`${relative(root, file)}: ${url} (missing anchor)`);
    }
  }
  return { files: files.length, references, failures };
}

/** Ship public research links; retain private repository references as labelled text. */
export function documentationAssets(): Plugin {
  let root = "", outDir = "";
  const evidence = new Set<string>();
  return {
    name: "documentation-assets",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = resolve(root, config.build.outDir);
    },
    buildStart() { evidence.clear(); },
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        return html.replace(/<a\b([^>]*?)>([\s\S]*?)<\/a\s*>/gi, (original, attributes: string, label: string) => {
          const href = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
          const url = href && (href[1] ?? href[2] ?? href[3]);
          if (!url || remote.test(url) || url.startsWith("#")) return original;
          const path = relative(root, target(root, context.filename, url));
          if (path.startsWith("docs/research/f15c/") && !path.endsWith(".html")) evidence.add(path);
          if (!/^(?:src|lab|assets|output)\//.test(path)) return original;
          const title = path.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
          return `<span class="local-reference" title="Local repository: ${title}">${label} <small>(local only)</small></span>`;
        });
      },
    },
    generateBundle() {
      for (const path of evidence) this.emitFile({ type: "asset", fileName: path, source: readFileSync(resolve(root, path)) });
    },
    closeBundle() {
      const { failures } = checkDocumentation(outDir, true);
      if (failures.length) this.error(`Broken production documentation links:\n${failures.join("\n")}`);
    },
  };
}
