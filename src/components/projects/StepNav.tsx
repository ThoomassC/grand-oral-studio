"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useGuardedNavigation } from "@/components/layout/useGuardedNavigation";
import { PAGE_NAV, decksHref, exactPageOfPath, pageHref, pageLabel } from "./steps";

const BUTTON = "opale-button no-underline";

/**
 * Barre de bas de page du parcours : Apparence → Trame → Jour J.
 * « ← Étape précédente » et « Étape suivante : … → » ; sur le Jour J,
 * « Voir les diaporamas ». Les sujets, facultatifs, ne sont pas une étape :
 * depuis la Trame, « Ajouter des sujets (facultatif) » est un lien secondaire
 * et l'étape suivante reste le Jour J. Sur l'Apparence, « Passer au Jour J »
 * permet de sauter la trame : rien ne bloque (apparence et trame par défaut
 * utilisables). Rendue seulement sur la page exacte d'une étape (pas dans les
 * Decks).
 *
 * Les liens annoncent leur vraie destination (de l'Apparence, l'étape suivante
 * est la Trame ; du Jour J, l'étape précédente est la Trame).
 */
export function StepNav({ programId }: { programId: string }) {
  const pathname = usePathname();
  const { onLinkClick } = useGuardedNavigation();
  const id = exactPageOfPath(programId, pathname);
  if (!id) return null;
  const { prev, next, aside } = PAGE_NAV[id];
  const nextHref = next ? pageHref(programId, next) : decksHref(programId);
  const asideHref = aside ? pageHref(programId, aside.page) : null;

  return (
    <nav aria-label="Étapes précédente et suivante" className="mt-10 border-t border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {prev ? (
          <Link
            href={pageHref(programId, prev)}
            className={`${BUTTON} opale-button--ghost`}
            onClick={(e) => onLinkClick(e, pageHref(programId, prev))}
          >
            <span>
              <span aria-hidden="true">← </span>Étape précédente<span className="sr-only"> : {pageLabel(prev)}</span>
            </span>
          </Link>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {aside && asideHref ? (
            <Link href={asideHref} className={`${BUTTON} opale-button--ghost`} onClick={(e) => onLinkClick(e, asideHref)}>
              <span>
                {aside.label}
                <span aria-hidden="true"> →</span>
              </span>
            </Link>
          ) : null}
          <Link href={nextHref} className={`${BUTTON} opale-button--primary`} onClick={(e) => onLinkClick(e, nextHref)}>
            <span>
              {next ? `Étape suivante : ${pageLabel(next)}` : "Voir les diaporamas"}
              <span aria-hidden="true"> →</span>
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
