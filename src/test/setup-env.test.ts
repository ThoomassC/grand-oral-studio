import { describe, expect, it } from "vitest";
import { fillEnv } from "../../scripts/setup-env.mjs";

const TEMPLATE = [
  "# commentaire",
  "DATABASE_URL=postgresql://USER@localhost:5432/grand_oral_dev",
  "TEST_DATABASE_URL=postgresql://USER@localhost:5432/grand_oral_test",
  "BETTER_AUTH_SECRET=",
  "SETTINGS_ENCRYPTION_KEY=",
  "AI_PROVIDER=mock",
  "",
].join("\n");

const deps = { user: "alice", secret: (bytes: number) => `secret-${bytes}` };

describe("fillEnv", () => {
  it("devrait remplacer USER, générer les secrets vides et garder le reste", () => {
    const { text, changed } = fillEnv(TEMPLATE, deps);
    expect(text).toContain("DATABASE_URL=postgresql://alice@localhost:5432/grand_oral_dev");
    expect(text).toContain("TEST_DATABASE_URL=postgresql://alice@localhost:5432/grand_oral_test");
    expect(text).toContain("BETTER_AUTH_SECRET=secret-48");
    expect(text).toContain("SETTINGS_ENCRYPTION_KEY=secret-32");
    expect(text).toContain("AI_PROVIDER=mock");
    expect(text).toContain("# commentaire");
    expect(changed).toEqual(["DATABASE_URL", "TEST_DATABASE_URL", "BETTER_AUTH_SECRET", "SETTINGS_ENCRYPTION_KEY"]);
  });

  it("ne devrait jamais écraser une valeur déjà renseignée", () => {
    const existing = TEMPLATE.replace("BETTER_AUTH_SECRET=", "BETTER_AUTH_SECRET=deja-la").replace(
      "USER@localhost:5432/grand_oral_dev",
      "bob:pw@db:5432/grand_oral_dev",
    );
    const { text, changed } = fillEnv(existing, deps);
    expect(text).toContain("BETTER_AUTH_SECRET=deja-la");
    expect(text).toContain("DATABASE_URL=postgresql://bob:pw@db:5432/grand_oral_dev");
    expect(changed).not.toContain("BETTER_AUTH_SECRET");
    expect(changed).not.toContain("DATABASE_URL");
  });

  it("devrait être idempotent", () => {
    const once = fillEnv(TEMPLATE, deps).text;
    expect(fillEnv(once, deps)).toEqual({ text: once, changed: [] });
  });
});
