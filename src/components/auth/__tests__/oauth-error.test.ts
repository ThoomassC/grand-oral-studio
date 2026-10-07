import { describe, expect, it } from "vitest";
import { oauthErrorMessage } from "@/components/auth/oauth-error";

describe("oauthErrorMessage", () => {
  it("ne devrait rien afficher sans paramètre error", () => {
    expect(oauthErrorMessage(undefined)).toBeNull();
    expect(oauthErrorMessage("")).toBeNull();
  });

  it("devrait expliquer l'annulation ou le refus côté Google", () => {
    expect(oauthErrorMessage("access_denied")).toBe("La connexion avec Google a été annulée ou refusée. Réessayez.");
  });

  it("devrait orienter vers le mot de passe quand la liaison est refusée", () => {
    expect(oauthErrorMessage("account_not_linked")).toBe(
      "Un compte existe déjà avec cette adresse. Connectez-vous avec votre e-mail et votre mot de passe.",
    );
  });

  it("ne devrait pas prétendre à un compte existant pour un échec technique de liaison", () => {
    expect(oauthErrorMessage("unable_to_link_account")).toBe("La connexion avec Google a échoué. Réessayez dans un instant.");
  });

  it("devrait afficher un message générique, jamais le code brut, pour le reste", () => {
    const message = oauthErrorMessage("<script>alert(1)</script>");
    expect(message).toBe("La connexion avec Google a échoué. Réessayez dans un instant.");
    expect(oauthErrorMessage(["state_mismatch", "x"])).toBe(message);
  });

  it("devrait expliquer le refus d'un domaine d'adresse non autorisé sur l'instance", () => {
    expect(oauthErrorMessage("EMAIL_DOMAIN_NOT_ALLOWED")).toMatch(/adresse.*n'est pas autorisée sur cette instance/);
  });

  it("devrait expliquer un lien de confirmation d'adresse expiré ou invalide", () => {
    const expected = /lien de confirmation.*n'est plus valide.*Connectez-vous/;
    expect(oauthErrorMessage("TOKEN_EXPIRED")).toMatch(expected);
    expect(oauthErrorMessage("INVALID_TOKEN")).toMatch(expected);
  });
});
