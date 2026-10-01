import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/server/security-headers";

function asMap(headers: { key: string; value: string }[]): Map<string, string> {
  return new Map(headers.map((h) => [h.key.toLowerCase(), h.value]));
}

describe("securityHeaders", () => {
  const prod = asMap(securityHeaders({ production: true }));
  const dev = asMap(securityHeaders({ production: false }));

  it.each(["frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'", "default-src 'self'"])(
    "devrait inclure %s dans la CSP",
    (directive) => {
      expect(prod.get("content-security-policy")).toContain(directive);
      expect(dev.get("content-security-policy")).toContain(directive);
    },
  );

  it("devrait autoriser eval et le websocket de rechargement uniquement en développement", () => {
    expect(dev.get("content-security-policy")).toContain("'unsafe-eval'");
    expect(prod.get("content-security-policy")).not.toContain("'unsafe-eval'");
    expect(prod.get("content-security-policy")).not.toMatch(/ws:/);
  });

  it("devrait poser nosniff, Referrer-Policy et Permissions-Policy", () => {
    expect(prod.get("x-content-type-options")).toBe("nosniff");
    expect(prod.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(prod.get("permissions-policy")).toMatch(/camera=\(\)/);
    expect(prod.get("permissions-policy")).toMatch(/microphone=\(\)/);
  });

  it("devrait poser HSTS en production seulement", () => {
    expect(prod.get("strict-transport-security")).toMatch(/max-age=\d{7,}/);
    expect(dev.has("strict-transport-security")).toBe(false);
  });

  it("ne devrait contenir aucun saut de ligne dans les valeurs d'en-tête", () => {
    for (const value of prod.values()) expect(value).not.toMatch(/[\r\n]/);
  });
});
