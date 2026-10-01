import { describe, expect, it } from "vitest";
import { ipAddressOptions, SESSION_OPTIONS } from "@/lib/auth-options";

describe("ipAddressOptions", () => {
  it("devrait laisser le comportement par défaut de Better Auth sans TRUSTED_IP_HEADER", () => {
    expect(ipAddressOptions({})).toBeUndefined();
    expect(ipAddressOptions({ TRUSTED_IP_HEADER: "  " })).toBeUndefined();
  });

  it("devrait n'utiliser que l'en-tête posé par le proxy de confiance", () => {
    expect(ipAddressOptions({ TRUSTED_IP_HEADER: "X-Real-IP" })).toEqual({ ipAddressHeaders: ["x-real-ip"] });
    expect(ipAddressOptions({ TRUSTED_IP_HEADER: "cf-connecting-ip" })).toEqual({ ipAddressHeaders: ["cf-connecting-ip"] });
  });

  it("devrait refuser un nom d'en-tête invalide", () => {
    expect(() => ipAddressOptions({ TRUSTED_IP_HEADER: "x-real-ip, x-forwarded-for" })).toThrow(/TRUSTED_IP_HEADER/);
  });
});

describe("SESSION_OPTIONS", () => {
  it("devrait garder la session 30 jours, prolongée au plus une fois par jour", () => {
    expect(SESSION_OPTIONS).toEqual({ expiresIn: 30 * 24 * 3600, updateAge: 24 * 3600 });
  });
});
