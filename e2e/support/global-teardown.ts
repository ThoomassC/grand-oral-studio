import { countTestUsers, deleteE2eUsers } from "./db";
import { readDiagnostics } from "./diagnostics";

export default async function globalTeardown(): Promise<void> {
  await deleteE2eUsers();
  const left = await countTestUsers();
  const diags = readDiagnostics();
  const errors = diags.filter((d) => d.kind === "console");
  const server = diags.filter((d) => d.kind === "http");
  console.log(`\n[e2e] Comptes @example.test restants : ${left}`);
  console.log(`[e2e] Erreurs console collectées : ${errors.length} ; réponses HTTP >= 500 : ${server.length}`);
  const unique = new Map<string, { n: number; tests: Set<string> }>();
  for (const d of diags) {
    const key = `${d.kind} ${d.text.slice(0, 220)}`;
    const entry = unique.get(key) ?? { n: 0, tests: new Set<string>() };
    entry.n += 1;
    entry.tests.add(d.test);
    unique.set(key, entry);
  }
  for (const [key, { n, tests }] of unique) {
    console.log(`  - (${n}x) ${key}\n      dans : ${[...tests].slice(0, 3).join(" | ")}`);
  }
}
