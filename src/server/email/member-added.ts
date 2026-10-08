import { displayName, EMAIL_NAME_MAX, type RenderedEmail } from "./templates";

/**
 * E-mail « X vous a ajouté au projet Y » (partage d'un projet, v1.2). Noms
 * saisis par les utilisateurs : nettoyés et bornés (displayName, même valeur dans
 * l'objet et le corps), puis échappés dans le HTML ; le lien est
 * construit à partir de BETTER_AUTH_URL (jamais d'une entrée client).
 */

const APP_NAME = "Grand Oral Studio";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Lien absolu vers le projet, ou null si l'URL publique n'est pas (bien) configurée. */
export function projectUrl(baseUrl: string | undefined, programId: string): string | null {
  const base = baseUrl?.trim();
  if (!base) return null;
  try {
    const url = new URL(`/projets/${encodeURIComponent(programId)}`, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function memberAddedEmail({
  recipientName,
  inviterName,
  programName,
  role,
  url,
}: {
  recipientName: string;
  inviterName: string;
  programName: string;
  role: "editor" | "viewer";
  url: string;
}): RenderedEmail {
  const recipient = displayName(recipientName, EMAIL_NAME_MAX.user);
  const greeting = recipient ? `Bonjour ${recipient},` : "Bonjour,";
  const inviter = displayName(inviterName, EMAIL_NAME_MAX.user) || "Un collègue";
  const project = displayName(programName, EMAIL_NAME_MAX.project);
  const access =
    role === "editor"
      ? "Vous pouvez le modifier : apparence, trame, sujets et diaporamas."
      : "Vous pouvez le consulter, exporter et répéter ses diaporamas, sans le modifier.";
  const intro = `${inviter} vous a ajouté au projet « ${project} ».`;
  // Objet sur une ligne : les noms ne portent plus aucun saut de ligne (displayName).
  const subject = `${inviter} vous a ajouté au projet « ${project} » – ${APP_NAME}`;
  const action = "Ouvrir le projet";
  const text = [greeting, "", intro, access, "", `${action} : ${url}`, "", `— ${APP_NAME}`].join("\n");
  const html = `<!doctype html>
<html lang="fr">
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.5;color:#1f2937">
<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(intro)} ${escapeHtml(access)}</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(action)}</a></p>
<p style="font-size:0.875em;color:#4b5563">Si le bouton ne s'ouvre pas, copiez ce lien dans votre navigateur :<br>${escapeHtml(url)}</p>
<p>— ${APP_NAME}</p>
</body>
</html>`;
  return { subject, text, html };
}
