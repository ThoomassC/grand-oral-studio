"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useGuardedNavigation } from "@/components/layout/useGuardedNavigation";
import { PAGE_ORDER, decksHref, exactPageOfPath, pageHref, stepHref } from "./steps";

const BUTTON = "opale-button no-underline";

/**
 * Barre de bas de page du parcours : Apparence → Trame → Sujets → Jour J.
 * « ← Étape précédente » et « Étape suivante : … → » ; sur le Jour J,
 * « Voir les diaporamas ». Sur l'Apparence et la Trame, « Passer au Jour J »
 * permet de sauter la suite : rien ne bloque (apparence et trame par défaut
 * utilisables, sujets facultatifs). Rendue seulement sur la page exacte d'une
 * étape (pas dans les Decks).
 *
 * Les liens annoncent leur vraie destination (de l'Apparence, l'étape suivante
 * est la Trame ; du Jour J, l'étape précédente est la page des Sujets).
 */
export function StepNav({ programId }: { programId: string }) {
  const pathname = usePathname();
  const { onLinkClick } = useGuardedNavigation();
  const id = exactPageOfPath(programId, pathname);
  if (!id) return null;
  const i = PAGE_ORDER.findIndex((p) => p.id === id);
  const prev = PAGE_ORDER[i - 1];
  const next = PAGE_ORDER[i + 1];
  const nextHref = next ? pageHref(programId, next.id) : decksHref(programId);
  // Raccourci seulement quand l'étape suivante n'est pas déjà le Jour J.
  const skip = next !== undefined && next.id !== "day";
  const day = stepHref(programId, "day");

  return (
    <nav aria-label="Étapes précédente et suivante" className="mt-10 border-t border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {prev ? (
          <Link
            href={pageHref(programId, prev.id)}
            className={`${BUTTON} opale-button--ghost`}
            onClick={(e) => onLinkClick(e, pageHref(programId, prev.id))}
          >
            <span>
              <span aria-hidden="true">← </span>Étape précédente<span className="sr-only"> : {prev.label}</span>
            </span>
          </Link>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {skip ? (
            <Link href={day} className={`${BUTTON} opale-button--ghost`} onClick={(e) => onLinkClick(e, day)}>
              <span>
                Passer au Jour J<span aria-hidden="true"> →</span>
              </span>
            </Link>
          ) : null}
          <Link href={nextHref} className={`${BUTTON} opale-button--primary`} onClick={(e) => onLinkClick(e, nextHref)}>
            <span>
              {next ? `Étape suivante : ${next.label}` : "Voir les diaporamas"}
              <span aria-hidden="true"> →</span>
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
