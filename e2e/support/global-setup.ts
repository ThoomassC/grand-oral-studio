import { deleteE2eUsers, resetAuthRateLimit } from "./db";
import { generateFixtures } from "./files";
import { resetDiagnostics } from "./diagnostics";

export default async function globalSetup(): Promise<void> {
  const res = await fetch(process.env.E2E_BASE_URL ?? "http://localhost:3000/", { redirect: "manual" }).catch(() => null);
  if (!res) throw new Error("Serveur de dev injoignable sur http://localhost:3000 : lancez `npm run dev`.");
  await deleteE2eUsers();
  await resetAuthRateLimit();
  await generateFixtures();
  resetDiagnostics();
}
