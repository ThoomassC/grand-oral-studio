import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestError, requestErrorFields } from "@/instrumentation";

const CONTEXT = {
  routerKind: "App Router" as const,
  routePath: "/reinitialiser-mot-de-passe",
  routeType: "render" as const,
  renderSource: "server-rendering" as const,
  revalidateReason: undefined,
  renderType: "dynamic" as const,
};

const REQUEST = {
  path: "/reinitialiser-mot-de-passe?token=jeton-secret",
  method: "GET",
  headers: { cookie: "better-auth.session_token=abc", authorization: "Bearer x" },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("requestErrorFields", () => {
  it("devrait retenir le digest et le chemin, sans la requête (jetons possibles) ni les en-têtes", () => {
    const error = Object.assign(new Error("boom"), { digest: "123456789" });
    const fields = requestErrorFields(error, REQUEST, CONTEXT);
    expect(fields).toMatchObject({
      digest: "123456789",
      path: "/reinitialiser-mot-de-passe",
      method: "GET",
      routePath: "/reinitialiser-mot-de-passe",
      routeType: "render",
    });
    expect(JSON.stringify(fields)).not.toContain("jeton-secret");
    expect(fields).not.toHaveProperty("headers");
  });

  it("devrait accepter une valeur levée qui n'est pas une Error", () => {
    expect(requestErrorFields("oops", REQUEST, CONTEXT)).toMatchObject({ digest: undefined, error: "oops" });
  });
});

describe("onRequestError", () => {
  it("devrait journaliser une ligne JSON d'erreur avec le digest et le chemin", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));
    await onRequestError(Object.assign(new Error("boom"), { digest: "42" }), REQUEST, CONTEXT);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({ level: "error", event: "request.error", digest: "42", path: "/reinitialiser-mot-de-passe" });
    expect(lines[0]).not.toContain("jeton-secret");
    expect(lines[0]).not.toContain("session_token");
  });
});
