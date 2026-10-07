import { describe, expect, it } from "vitest";
import {
  googleButtonState,
  ACCOUNT_LINKING_OPTIONS,
  allowedEmailDomains,
  DISABLED_AUTH_PATHS,
  emailDeliveryConfig,
  isEmailDeliveryEnabled,
  isEmailDomainAllowed,
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

  it("devrait fermer /update-user : Better Auth n'y borne pas le nom, l'app passe par une action validée", () => {
    expect(DISABLED_AUTH_PATHS).toContain("/update-user");
  });

  it("devrait fermer la suppression de compte en HTTP : seule l'action serveur de /profil (adresse recopiée) l'appelle", () => {
    expect(DISABLED_AUTH_PATHS).toEqual(expect.arrayContaining(["/delete-user", "/delete-user/callback"]));
  });

  it("devrait fermer le renvoi libre d'e-mail de vérification (renvoyé à la connexion, mot de passe à l'appui)", () => {
    expect(DISABLED_AUTH_PATHS).toContain("/send-verification-email");
  });

  it("devrait laisser ouverts les parcours utilisés par l'interface", () => {
    for (const path of ["/request-password-reset", "/reset-password", "/verify-email", "/change-password"]) {
      expect(DISABLED_AUTH_PATHS).not.toContain(path);
    }
  });
});

describe("emailDeliveryConfig", () => {
  it("devrait laisser les e-mails inactifs sans RESEND_API_KEY ni EMAIL_FROM (variables absentes ou vides)", () => {
    expect(emailDeliveryConfig({})).toBeUndefined();
    expect(emailDeliveryConfig({ RESEND_API_KEY: " ", EMAIL_FROM: "" })).toBeUndefined();
    expect(isEmailDeliveryEnabled({})).toBe(false);
  });

  it("devrait activer les e-mails avec la clé et l'expéditeur, espaces retirés", () => {
    const env = { RESEND_API_KEY: " re_123 ", EMAIL_FROM: " Grand Oral Studio <noreply@exemple.fr> " };
    expect(emailDeliveryConfig(env)).toEqual({ apiKey: "re_123", from: "Grand Oral Studio <noreply@exemple.fr>" });
    expect(isEmailDeliveryEnabled(env)).toBe(true);
  });

  it("devrait refuser une configuration partielle au démarrage", () => {
    expect(() => emailDeliveryConfig({ RESEND_API_KEY: "re_123" })).toThrow(/EMAIL_FROM/);
    expect(() => emailDeliveryConfig({ EMAIL_FROM: "noreply@exemple.fr" })).toThrow(/RESEND_API_KEY/);
  });

  it("devrait refuser un expéditeur sans adresse e-mail", () => {
    expect(() => emailDeliveryConfig({ RESEND_API_KEY: "re_123", EMAIL_FROM: "Grand Oral Studio" })).toThrow(/EMAIL_FROM/);
  });

  it("ne devrait jamais citer la clé dans un message d'erreur", () => {
    expect(() => emailDeliveryConfig({ RESEND_API_KEY: "re_secret_value", EMAIL_FROM: "x" })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("re_secret_value") }),
    );
  });
});

describe("allowedEmailDomains", () => {
  it("ne devrait rien restreindre sans ALLOWED_EMAIL_DOMAINS", () => {
    expect(allowedEmailDomains({})).toBeUndefined();
    expect(allowedEmailDomains({ ALLOWED_EMAIL_DOMAINS: " , " })).toBeUndefined();
  });

  it("devrait lire une liste séparée par des virgules, en minuscules, sans @ ni doublon", () => {
    expect(allowedEmailDomains({ ALLOWED_EMAIL_DOMAINS: " Lycee-Exemple.fr, @ac-paris.fr ,,lycee-exemple.fr" })).toEqual([
      "lycee-exemple.fr",
      "ac-paris.fr",
    ]);
  });

  it("devrait refuser une entrée qui n'est pas un nom de domaine", () => {
    expect(() => allowedEmailDomains({ ALLOWED_EMAIL_DOMAINS: "lycee exemple.fr" })).toThrow(/ALLOWED_EMAIL_DOMAINS/);
    expect(() => allowedEmailDomains({ ALLOWED_EMAIL_DOMAINS: "*.fr" })).toThrow(/ALLOWED_EMAIL_DOMAINS/);
  });
});

describe("isEmailDomainAllowed", () => {
  const domains = ["lycee-exemple.fr", "ac-paris.fr"];

  it("devrait tout accepter sans restriction", () => {
    expect(isEmailDomainAllowed("eleve@gmail.com", undefined)).toBe(true);
  });

  it("devrait comparer le domaine en minuscules", () => {
    expect(isEmailDomainAllowed("Eleve@Lycee-Exemple.FR", domains)).toBe(true);
    expect(isEmailDomainAllowed("prof@ac-paris.fr", domains)).toBe(true);
  });

  it("devrait exiger le domaine exact (ni sous-domaine, ni suffixe trompeur)", () => {
    expect(isEmailDomainAllowed("eleve@gmail.com", domains)).toBe(false);
    expect(isEmailDomainAllowed("eleve@sub.lycee-exemple.fr", domains)).toBe(false);
    expect(isEmailDomainAllowed("eleve@lycee-exemple.fr.evil.com", domains)).toBe(false);
    expect(isEmailDomainAllowed("eleve@evil-lycee-exemple.fr", domains)).toBe(false);
  });

  it("devrait juger le domaine après le dernier @ et refuser une adresse sans @", () => {
    expect(isEmailDomainAllowed("lycee-exemple.fr@evil.com", domains)).toBe(false);
    expect(isEmailDomainAllowed("lycee-exemple.fr", domains)).toBe(false);
  });
});

describe("googleButtonState", () => {
  const keys = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };

  it("vaut enabled quand les deux identifiants sont définis", () => {
    expect(googleButtonState({ ...keys, NODE_ENV: "production" })).toBe("enabled");
  });

  it("vaut unconfigured en développement sans identifiants, pour montrer le bouton à configurer", () => {
    expect(googleButtonState({ NODE_ENV: "development" })).toBe("unconfigured");
  });

  it("vaut hidden en production sans identifiants, pour ne pas afficher un bouton inutilisable", () => {
    expect(googleButtonState({ NODE_ENV: "production" })).toBe("hidden");
  });
});
