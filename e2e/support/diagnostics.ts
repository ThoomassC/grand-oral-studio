import fs from "node:fs";
import path from "node:path";

export interface Diagnostic {
  kind: "console" | "http" | "pageerror";
  test: string;
  url: string;
  text: string;
}

const FILE = path.join(__dirname, "..", "..", "test-results", "diagnostics.jsonl");

export function resetDiagnostics(): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, "");
}

export function recordDiagnostic(d: Diagnostic): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.appendFileSync(FILE, `${JSON.stringify(d)}\n`);
}

export function readDiagnostics(): Diagnostic[] {
  if (!fs.existsSync(FILE)) return [];
  return fs
    .readFileSync(FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Diagnostic);
}
