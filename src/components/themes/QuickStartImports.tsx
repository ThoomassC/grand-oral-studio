"use client";

import Link from "next/link";
import { useId } from "react";
import { useGuardedNavigation } from "@/components/layout/useGuardedNavigation";
import { importHref } from "@/components/projects/steps";

/** Les trois entrées se lisent pareil : texte souligné (pas seulement coloré), cible d'au moins 24 px. */
const ENTRY_CLASS = "opale-link inline-flex min-h-6 items-center underline hover:no-underline";

/**
 * Encart discret en tête de l'étape 1 : les trois imports possibles (liste de
 * thèmes, présentation → charte, prompt → gabarit). L'import de liste ouvre
 * le panneau existant du gestionnaire de thèmes ; les deux autres mènent à la
 * zone d'import de leur page.
 */
export function QuickStartImports({
  programId,
  importOpen,
  importPanelId,
  onImportList,
}: {
  programId: string;
  importOpen: boolean;
  importPanelId: string;
  onImportList: () => void;
}) {
  const { onLinkClick } = useGuardedNavigation();
  const titleId = useId();
  const brand = importHref(programId, "brand");
  const template = importHref(programId, "template");
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm"
    >
      <h2 id={titleId} className="font-display text-base font-semibold">
        Démarrer par import <span className="font-normal text-muted">(facultatif)</span>
      </h2>
      <ul className="mt-1.5 flex flex-col gap-x-6 gap-y-1.5 sm:flex-row sm:flex-wrap sm:items-center">
        <li>
          {/* Un bouton (il ouvre un panneau de cette page), habillé comme les deux liens voisins. */}
          <button
            type="button"
            className={`${ENTRY_CLASS} cursor-pointer`}
            aria-expanded={importOpen}
            aria-controls={importOpen ? importPanelId : undefined}
            onClick={onImportList}
          >
            Importer une liste de thèmes
          </button>
        </li>
        <li>
          <Link href={brand} className={ENTRY_CLASS} onClick={(e) => onLinkClick(e, brand)}>
            Déduire la charte d&apos;une présentation
          </Link>
        </li>
        <li>
          <Link href={template} className={ENTRY_CLASS} onClick={(e) => onLinkClick(e, template)}>
            Préremplir le gabarit avec un prompt
          </Link>
        </li>
      </ul>
      <p className="mt-1.5 text-muted">
        Seuls les thèmes sont obligatoires : sans import ni réglage, la charte et le gabarit gardent leurs valeurs par
        défaut.
      </p>
    </section>
  );
}
