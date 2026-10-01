"use client";

import { Badge, Icon } from "@thomascaron/opale-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { ProjectStep } from "@/domain/progress";
import { blockedMessage, decksHref, stepHref, stepMeta, stepOfPath } from "@/components/projects/steps";
import { TAB_LINK_CLASS } from "./MainNav";
import { useGuardedNavigation } from "./useGuardedNavigation";

type Visual = "done" | "todo" | "blocked";

function visualOf(step: ProjectStep): Visual {
  if (step.status === "done") return "done";
  return step.blockedBy ? "blocked" : "todo";
}

/**
 * Le fil d'étapes d'un projet (1. Préparer → 2. Squelettes → 3. Jour J) et, à part, l'accès aux
 * diaporamas produits. Liens vers les pages existantes, sans verrou : une
 * étape dont le prérequis manque le dit (« bloquée : … ») mais reste ouverte.
 *
 * - `aria-current="step"` sur l'étape de la page affichée (Préparer couvre
 *   Thèmes, Charte et Gabarit ; un squelette ouvert reste dans Squelettes) ;
 * - l'état de chaque étape est dit en texte (masqué à l'œil, lu à l'oreille),
 *   et montré par une coche, une icône de cadenas ou le numéro : jamais par la
 *   couleur seule ;
 * - sous 768 px, version compacte : numéros, libellé de l'étape courante,
 *   défilement horizontal interne (l'étape courante est ramenée en vue) ;
 * - garde « modifications non enregistrées » sur chaque lien.
 */
export function ProjectSteps({ programId, steps, deckCount }: { programId: string; steps: ProjectStep[]; deckCount: number }) {
  const pathname = usePathname();
  const { onLinkClick, dialog } = useGuardedNavigation();
  const currentRef = useRef<HTMLAnchorElement>(null);
  const current = stepOfPath(programId, pathname);
  const decks = decksHref(programId);
  const onDecks = pathname === decks || pathname.startsWith(`${decks}/`);

  // Synchronisation avec le DOM : ramener l'étape courante en vue (fil défilant sur mobile).
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <nav aria-label="Étapes du projet" className="project-steps min-w-0 flex-1">
          <ol className="project-steps__list">
            {steps.map((step, i) => {
              const meta = stepMeta(step.id);
              const href = stepHref(programId, step.id);
              const visual = visualOf(step);
              const isCurrent = current === step.id;
              const stateText =
                visual === "done" ? "faite" : visual === "blocked" ? `bloquée : ${blockedMessage(step.blockedBy!)}` : "à faire";
              return (
                <li key={step.id} className="project-steps__item">
                  {i > 0 ? <span aria-hidden="true" className="project-steps__connector" data-done={steps[i - 1]!.status === "done" || undefined} /> : null}
                  <Link
                    ref={isCurrent ? currentRef : undefined}
                    href={href}
                    aria-current={isCurrent ? "step" : undefined}
                    data-state={visual}
                    title={visual === "blocked" ? blockedMessage(step.blockedBy!) : undefined}
                    className="project-step"
                    onClick={(e) => {
                      if (!isCurrent) onLinkClick(e, href);
                    }}
                  >
                    <span aria-hidden="true" className="project-step__dot">
                      {visual === "done" ? <Icon name="check" /> : <span className="num">{meta.index}</span>}
                    </span>
                    <span className={`project-step__text ${isCurrent ? "" : "max-md:sr-only"}`}>
                      <span className="project-step__label">
                        <span className="sr-only">Étape {meta.index} : </span>
                        {meta.label}
                      </span>
                      {visual === "blocked" ? (
                        <span aria-hidden="true" className="project-step__summary project-step__summary--blocked max-lg:hidden">
                          <Icon name="lock" />
                          {blockedMessage(step.blockedBy!)}
                        </span>
                      ) : (
                        <span className="project-step__summary max-lg:hidden">{step.summary}</span>
                      )}
                    </span>
                    <span className="sr-only"> — {stateText}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
        <Link
          href={decks}
          aria-current={onDecks ? "page" : undefined}
          className={`${TAB_LINK_CLASS} shrink-0 gap-2`}
          onClick={(e) => {
            if (!onDecks) onLinkClick(e, decks);
          }}
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
      </div>
      {dialog}
    </div>
  );
}
