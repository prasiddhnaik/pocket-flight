import ts from "typescript";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
const files = ["src", "lab", "tests", "scripts"]
  .flatMap((directory) => walk(resolve(root, directory)))
  .filter((path) => /\.(ts|tsx|js)$/.test(path));
const failures: string[] = [];
let imports = 0;
const isFile = (path: string) => existsSync(path) && statSync(path).isFile();
function checkImport(file: string, specifier: string) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/src/")) return;
  imports++;
  const clean = specifier.split("?")[0];
  const base = clean.startsWith("/src/")
    ? resolve(root, clean.slice(1))
    : resolve(dirname(file), clean);
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".json", "/index.ts", "/index.tsx"].map(
      (suffix) => base + suffix,
    ),
  ];
  if (!candidates.some(isFile))
    failures.push(`${file.slice(root.length)}: ${specifier}`);
}
for (const file of files) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      checkImport(file, node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      checkImport(file, node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
for (const file of readdirSync(root).filter((path) => path.endsWith(".html"))) {
  for (const match of readFileSync(resolve(root, file), "utf8").matchAll(
    /<script[^>]*\bsrc=["'](\/src\/[^"']+)["']/g,
  ))
    checkImport(resolve(root, file), match[1]);
}
// Validate navigation links without requiring a browser or starting the game.
for (const file of ["README.md", "AGENTS.md"]) {
  for (const match of readFileSync(resolve(root, file), "utf8").matchAll(
    /\[[^\]]*\]\(([^)]+)\)/g,
  )) {
    const target = match[1].split("#")[0];
    if (
      target &&
      !/^[a-z]+:/i.test(target) &&
      !existsSync(resolve(root, target))
    )
      failures.push(`${file}: ${target}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `Repository navigation OK: ${files.length} code files, ${imports} local imports/entries, and README/agent links checked.`,
);
