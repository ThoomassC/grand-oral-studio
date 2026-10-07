import { describe, expect, it } from "vitest";
import { resetPasswordEmail, verificationEmail } from "@/server/email/templates";

const URL_WITH_TOKEN = "https://app.exemple.fr/api/auth/verify-email?token=abc&callbackURL=%2Fconnexion";

describe("modèles d'e-mails", () => {
  it("devrait porter le lien de confirmation dans le texte et le HTML (esperluette échappée)", () => {
    const mail = verificationEmail({ name: "Alice", url: URL_WITH_TOKEN });
    expect(mail.subject).toMatch(/Confirmez votre adresse/);
    expect(mail.text).toContain(URL_WITH_TOKEN);
    expect(mail.html).toContain('href="https://app.exemple.fr/api/auth/verify-email?token=abc&amp;callbackURL=%2Fconnexion"');
  });

  it("devrait échapper le nom saisi par l'utilisateur dans le HTML", () => {
    const mail = resetPasswordEmail({ name: '<img src=x onerror="alert(1)">', url: "https://app.exemple.fr/r" });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(mail.subject).toMatch(/mot de passe/);
    expect(mail.text).toMatch(/une heure/);
  });

  it("devrait refuser un lien qui n'est pas http(s)", () => {
    expect(() => verificationEmail({ name: "A", url: "javascript:alert(1)" })).toThrow();
  });
});
