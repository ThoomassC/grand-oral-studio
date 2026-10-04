import type { OpaleTone } from "@thomascaron/opale-ui";
import type { ReactNode } from "react";

const TITLES: Record<OpaleTone, string> = {
  neutral: "Remarque",
  success: "Succès",
  info: "Information",
  warning: "Attention",
  error: "Erreur",
};

/**
 * Encart de message au rendu de `Feedback` d'Opale (mêmes classes, même
 * structure : titre puis message), SANS rôle ARIA.
 *
 * À employer à l'intérieur d'une région live déjà montée (`LiveRegion`) :
 * `Feedback` porte son propre `role="status"`/`"alert"`, qui naît avec lui
 * (Opale le signale : son apparition n'est pas garantie d'être annoncée) et
 * doublerait l'annonce de la région. Pour un encart présent dès le
 * chargement, employez directement `Feedback`.
 */
export function Notice({
  tone = "info",
  title,
  children,
  className = "",
  id,
}: {
  tone?: OpaleTone;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={`opale-feedback opale-feedback--${tone} ${className}`}>
      <strong>{title ?? TITLES[tone]}</strong>
      <div>{children}</div>
    </div>
  );
}
