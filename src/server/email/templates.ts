/**
 * Modèles des e-mails transactionnels (texte brut + HTML minimal). Le nom est
 * saisi par l'utilisateur et le lien vient de Better Auth : tout est échappé
 * dans le HTML.
 */

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const APP_NAME = "Grand Oral Studio";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assertHttpUrl(url: string): string {
  const protocol = new URL(url).protocol;
  if (protocol !== "https:" && protocol !== "http:") throw new Error("Lien d'e-mail invalide : http(s) attendu.");
  return url;
}

function render({
  name,
  url,
  subject,
  intro,
  action,
  outro,
}: {
  name: string;
  url: string;
  subject: string;
  intro: string;
  action: string;
  outro: string;
}): RenderedEmail {
  const link = assertHttpUrl(url);
  const greeting = name.trim() ? `Bonjour ${name.trim()},` : "Bonjour,";
  const text = [greeting, "", intro, "", `${action} : ${link}`, "", outro, "", `— ${APP_NAME}`].join("\n");
  const html = `<!doctype html>
<html lang="fr">
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.5;color:#1f2937">
<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(link)}">${escapeHtml(action)}</a></p>
<p style="font-size:0.875em;color:#4b5563">Si le bouton ne s'ouvre pas, copiez ce lien dans votre navigateur :<br>${escapeHtml(link)}</p>
<p style="font-size:0.875em;color:#4b5563">${escapeHtml(outro)}</p>
<p>— ${APP_NAME}</p>
</body>
</html>`;
  return { subject, text, html };
}

export function verificationEmail({ name, url }: { name: string; url: string }): RenderedEmail {
  return render({
    name,
    url,
    subject: `Confirmez votre adresse e-mail – ${APP_NAME}`,
    intro: `Pour activer votre compte ${APP_NAME}, confirmez votre adresse e-mail. Le lien est valable une heure.`,
    action: "Confirmer mon adresse",
    outro: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun compte ne sera activé.",
  });
}

export function resetPasswordEmail({ name, url }: { name: string; url: string }): RenderedEmail {
  return render({
    name,
    url,
    subject: `Choisissez un nouveau mot de passe – ${APP_NAME}`,
    intro: "Vous avez demandé à changer de mot de passe. Le lien est valable une heure et ne sert qu'une fois.",
    action: "Choisir un nouveau mot de passe",
    outro: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
  });
}
