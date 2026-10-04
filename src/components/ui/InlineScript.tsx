"use client";

/**
 * Script inline exécuté pendant l'analyse du HTML (ex. thème avant la première
 * peinture). Composant client pour la seule raison donnée par le guide Next
 * « Preventing flash before hydration » : React avertit en développement
 * quand il rend un <script> côté client ; on le rend donc `text/plain`
 * (inerte) côté client et `text/javascript` côté serveur, l'écart étant
 * accepté par suppressHydrationWarning. Autorisé par la CSP
 * (`script-src 'self' 'unsafe-inline'`).
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
