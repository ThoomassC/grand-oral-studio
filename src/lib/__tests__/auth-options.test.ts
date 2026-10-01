import { describe, expect, it } from "vitest";
import {
  ACCOUNT_LINKING_OPTIONS,
  DISABLED_AUTH_PATHS,
  googleProviderOptions,
  ipAddressOptions,
  isGoogleSignInEnabled,
  SESSION_OPTIONS,
} from "@/lib/auth-options";

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

describe("googleProviderOptions", () => {
  it("devrait désactiver Google sans identifiants (variables absentes ou vides)", () => {
    expect(googleProviderOptions({})).toBeUndefined();
    expect(googleProviderOptions({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "  " })).toBeUndefined();
  });

  it("devrait activer Google avec l'ID client et le secret, sans scope additionnel", () => {
    const options = googleProviderOptions({ GOOGLE_CLIENT_ID: " id.apps.googleusercontent.com ", GOOGLE_CLIENT_SECRET: "secret" });
    expect(options).toEqual({
      clientId: "id.apps.googleusercontent.com",
      clientSecret: "secret",
      prompt: "select_account",
    });
    expect(options).not.toHaveProperty("scope");
  });

  it("devrait refuser une configuration partielle au démarrage", () => {
    expect(() => googleProviderOptions({ GOOGLE_CLIENT_ID: "id" })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => googleProviderOptions({ GOOGLE_CLIENT_SECRET: "secret" })).toThrow(/GOOGLE_CLIENT_ID/);
  });
});

describe("isGoogleSignInEnabled", () => {
  it("devrait refléter la présence des deux variables", () => {
    expect(isGoogleSignInEnabled({})).toBe(false);
    expect(isGoogleSignInEnabled({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" })).toBe(true);
  });
});

describe("ACCOUNT_LINKING_OPTIONS", () => {
  it("ne devrait pas faire confiance à Google sans e-mail vérifié (pas de trustedProviders)", () => {
    expect(ACCOUNT_LINKING_OPTIONS).not.toHaveProperty("trustedProviders");
    expect(ACCOUNT_LINKING_OPTIONS.allowDifferentEmails).toBe(false);
  });

  it("ne devrait pas lier Google à un compte dont l'adresse n'est pas vérifiée localement", () => {
    // Absent = défaut Better Auth (true) : liaison refusée, ?error=account_not_linked.
    expect(ACCOUNT_LINKING_OPTIONS).not.toHaveProperty("requireLocalEmailVerified");
  });
});

describe("DISABLED_AUTH_PATHS", () => {
  it("devrait fermer la liaison explicite /link-social, inutilisée par l'interface", () => {
    expect(DISABLED_AUTH_PATHS).toContain("/link-social");
  });
});
