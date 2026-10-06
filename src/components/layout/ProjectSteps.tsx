"use client";

import { Badge, Icon } from "@thomascaron/opale-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { ProjectStep } from "@/domain/progress";
import { decksHref, stepHref, stepMeta, stepOfPath } from "@/components/projects/steps";
import { TAB_LINK_CLASS } from "./MainNav";
import { useGuardedNavigation } from "./useGuardedNavigation";

/** Marge laissée à gauche de l'étape courante quand on la ramène en vue (≈ `scroll-padding-inline`). */
const SCROLL_MARGIN = 16;

/**
 * Le fil d'étapes d'un projet (1. Apparence → 2. Trame → 3. Jour J) et, à part, l'accès aux
 * diaporamas produits. Liens vers les pages des étapes, sans verrou ni blocage :
 * l'apparence et la trame par défaut sont utilisables, les sujets facultatifs.
 *
 * - `aria-current="step"` sur l'étape de la page affichée (la Trame couvre
 *   ses diapos et ses sujets) ;
 * - l'état de chaque étape est dit en texte (masqué à l'œil, lu à l'oreille),
 *   et montré par une coche ou le numéro dans la pastille, à toutes les
 *   largeurs : jamais par la couleur seule ;
 * - sous 768 px, version compacte : numéros, libellé de l'étape courante,
 *   défilement horizontal interne. L'étape courante est ramenée en vue en
 *   faisant défiler le seul conteneur (`scrollTo({ left })`) : `scrollIntoView`
 *   déplacerait le point de départ de la tabulation du navigateur ;
 * - les Decks, hors parcours, dans leur propre navigation, sous le fil en
 *   dessous de 768 px ;
 * - garde « modifications non enregistrées » sur chaque lien vers une autre page.
 */
export function ProjectSteps({ programId, steps, deckCount }: { programId: string; steps: ProjectStep[]; deckCount: number }) {
  const pathname = usePathname();
  const { onLinkClick } = useGuardedNavigation();
  const scrollerRef = useRef<HTMLElement>(null);
  const currentRef = useRef<HTMLAnchorElement>(null);
  const current = stepOfPath(programId, pathname);
  const decks = decksHref(programId);
  const onDecks = pathname === decks || pathname.startsWith(`${decks}/`);

  // Synchronisation avec le DOM : ramener l'étape courante en vue dans le fil défilant (mobile).
  useEffect(() => {
    const scroller = scrollerRef.current;
    const link = currentRef.current;
    if (!scroller || !link) return;
    const box = scroller.getBoundingClientRect();
    const target = link.getBoundingClientRect();
    if (target.left >= box.left && target.right <= box.right) return;
    scroller.scrollTo({ left: scroller.scrollLeft + target.left - box.left - SCROLL_MARGIN });
  }, [pathname]);

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <nav ref={scrollerRef} aria-label="Étapes du projet" className="project-steps min-w-0 md:flex-1">
        <ol className="project-steps__list">
          {steps.map((step, i) => {
            const meta = stepMeta(step.id);
            const href = stepHref(programId, step.id);
            const done = step.status === "done";
            const isCurrent = current === step.id;
            return (
              <li key={step.id} className="project-steps__item">
                {i > 0 ? <span aria-hidden="true" className="project-steps__connector" data-done={steps[i - 1]!.status === "done" || undefined} /> : null}
                <Link
                  ref={isCurrent ? currentRef : undefined}
                  href={href}
                  aria-current={isCurrent ? "step" : undefined}
                  data-state={step.status}
                  className="project-step"
                  onClick={(e) => onLinkClick(e, href)}
                >
                  <span aria-hidden="true" className="project-step__dot">
                    {done ? <Icon name="check" /> : <span className="num">{meta.index}</span>}
                  </span>
                  <span className={`project-step__text ${isCurrent ? "" : "max-md:sr-only"}`}>
                    <span className="project-step__label">
                      <span className="sr-only">Étape {meta.index} : </span>
                      {meta.label}
                    </span>
                    <span className="project-step__summary max-lg:sr-only">
                      <span className="sr-only">, </span>
                      {step.summary}
                    </span>
                  </span>
                  <span className="sr-only"> — {done ? "faite" : "à faire"}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
      <nav aria-label="Diaporamas du projet" className="shrink-0">
        <Link
          href={decks}
          aria-current={onDecks ? "page" : undefined}
          className={`${TAB_LINK_CLASS} gap-2`}
          onClick={(e) => onLinkClick(e, decks)}
        >
          Decks
          <Badge tone="neutral" size="small" aria-hidden="true">
            {deckCount}
          </Badge>
          <span className="sr-only">
            {" "}
            : {deckCount} diaporama{deckCount > 1 ? "s" : ""}
          </span>
        </Link>
      </nav>
    </div>
  );
}
