import { describe, expect, it } from "vitest";
import { memberAddedEmail } from "@/server/email/member-added";
import { displayName, resetPasswordEmail, verificationEmail } from "@/server/email/templates";

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

describe("displayName", () => {
  it("devrait remplacer sauts de ligne et caractères de contrôle par une espace, puis réduire les espaces", () => {
    expect(displayName(" Alice\r\nBcc: eve@pirate.fr\u0000\u2028x\t ", 80)).toBe("Alice Bcc: eve@pirate.fr x");
  });

  it("devrait tronquer au nombre de caractères donné, points de suspension compris", () => {
    const cut = displayName("é".repeat(200), 80);
    expect(Array.from(cut)).toHaveLength(80);
    expect(cut.endsWith("…")).toBe(true);
    expect(displayName("a".repeat(80), 80)).toBe("a".repeat(80));
  });
});

describe("noms saisis dans les e-mails", () => {
  const LONG = "N".repeat(500);

  it("devrait nettoyer et tronquer le nom dans le corps des e-mails de compte", () => {
    const mail = verificationEmail({ name: `Alice\r\nCliquez ici${LONG}`, url: "https://app.exemple.fr/v" });
    const greeting = mail.text.split("\n")[0]!;
    expect(greeting).toMatch(/^Bonjour Alice Cliquez ici/);
    expect(Array.from(greeting).length).toBeLessThanOrEqual("Bonjour ,".length + 80);
    expect(mail.html).not.toContain(LONG);
  });

  it("devrait nettoyer et tronquer les noms (utilisateur 80, projet 120) dans l'objet et le corps de l'invitation", () => {
    const mail = memberAddedEmail({
      recipientName: `Léa\r\n${LONG}`,
      inviterName: `Claire\r\nBcc: eve@pirate.fr${LONG}`,
      programName: `BTS\u0007 SIO\n${LONG}`,
      role: "editor",
      url: "https://app.exemple.fr/projets/p1",
    });
    expect(mail.subject).not.toMatch(/[\r\n\u0000-\u001f]/);
    expect(mail.subject).toMatch(/^Claire Bcc: eve@pirate\.frN+… vous a ajouté au projet « BTS SIO N+… » – Grand Oral Studio$/);
    const [inviter, program] = mail.subject.match(/^(.*) vous a ajouté au projet « (.*) »/)!.slice(1);
    expect(Array.from(inviter!)).toHaveLength(80);
    expect(Array.from(program!)).toHaveLength(120);
    // Corps : mêmes valeurs nettoyées, aucune ligne injectée.
    const lines = mail.text.split("\n");
    expect(lines[0]).toMatch(/^Bonjour Léa N+…,$/);
    expect(lines[2]).toBe(`${inviter} vous a ajouté au projet « ${program} ».`);
    expect(mail.text).not.toContain(LONG);
    expect(mail.html).not.toContain(LONG);
    expect(mail.html).not.toContain("\u0007");
  });
});
