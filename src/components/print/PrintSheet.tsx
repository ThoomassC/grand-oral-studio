import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PrintButton } from "./PrintButton";
import "./print-sheet.css";

/**
 * Fiche imprimable (serveur) : barre d'actions (retour, impression) masquée à
 * l'impression, puis le contenu. La classe racine `print-sheet` active les
 * règles de print-sheet.css (seule la fiche s'imprime, en noir sur blanc).
 */
export function PrintSheet({
  heading,
  intro,
  backHref,
  backLabel,
  children,
}: {
  /** Titre de la page (h2, sous le h1 du projet). */
  heading: string;
  intro?: ReactNode;
  backHref: string;
  backLabel: string;
  children: ReactNode;
}) {
  return (
    <article className="print-sheet flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl">{heading}</h2>
          {intro ? <div className="mt-1 text-muted">{intro}</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <ButtonLink href={backHref} variant="ghost">
            {backLabel}
          </ButtonLink>
          <PrintButton />
        </div>
      </div>
      {children}
    </article>
  );
}
