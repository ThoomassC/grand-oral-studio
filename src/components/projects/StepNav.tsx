"use client";

import { Icon } from "@thomascaron/opale-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PrepareItem, ProjectStep, StepId } from "@/domain/progress";
import { useGuardedNavigation } from "@/components/layout/useGuardedNavigation";
import { Notice } from "@/components/ui/Notice";
import { PAGE_ORDER, PREPARE_ITEMS, blockedMessage, decksHref, exactPageOfPath, pageHref, stepHref, stepMeta, stepOfPath } from "./steps";

const BUTTON = "opale-button no-underline";
const isPrepare = (id: string) => PREPARE_ITEMS.some((p) => p.id === id);
const asStep = (id: string): StepId | null => (id === "skeletons" || id === "day" ? id : null);

/**
 * Barre de bas de page du parcours : Thèmes → Charte → Gabarit → Squelettes →
 * Jour J. « ← Étape précédente » et « Étape suivante : … → » ; sur le Jour J,
 * « Voir les diaporamas ». Dans Préparer, dès qu'il y a un thème, « Passer aux
 * squelettes » permet de sauter la suite. Rendue seulement sur la page exacte
 * d'une étape (pas sur un squelette ouvert, ni les Decks).
 *
 * Les liens annoncent leur vraie destination (des squelettes, l'étape
 * précédente est le Gabarit), et l'étape suivante dit si elle est bloquée :
 * cadenas visible, raison lue, et le lien perd l'emphase du bouton principal.
 */
export function StepNav({ programId, prepare, steps }: { programId: string; prepare: PrepareItem[]; steps: ProjectStep[] }) {
  const pathname = usePathname();
  const { onLinkClick } = useGuardedNavigation();
  const id = exactPageOfPath(programId, pathname);
  if (!id) return null;
  const i = PAGE_ORDER.findIndex((p) => p.id === id);
  const prev = PAGE_ORDER[i - 1];
  const next = PAGE_ORDER[i + 1];
  const nextStepId = next ? asStep(next.id) : null;
  const nextBlockedBy = steps.find((s) => s.id === nextStepId && s.status !== "done")?.blockedBy ?? null;
  const nextHref = next ? pageHref(programId, next.id) : decksHref(programId);
  const themesDone = prepare.find((p) => p.id === "themes")?.status === "done";
  const skip = isPrepare(id) && themesDone && next?.id !== "skeletons";
  const skeletons = stepHref(programId, "skeletons");

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
            <Link href={skeletons} className={`${BUTTON} opale-button--ghost`} onClick={(e) => onLinkClick(e, skeletons)}>
              <span>
                Passer aux squelettes<span aria-hidden="true"> →</span>
              </span>
            </Link>
          ) : null}
          <Link
            href={nextHref}
            className={`${BUTTON} ${nextBlockedBy ? "opale-button--ghost" : "opale-button--primary"}`}
            onClick={(e) => onLinkClick(e, nextHref)}
          >
            <span className="inline-flex items-center gap-1.5">
              {next ? (
                <>
                  {nextBlockedBy ? <Icon name="lock" aria-hidden="true" className="step-nav__lock" /> : null}
                  Étape suivante : {next.label}
                  {nextBlockedBy ? <span className="sr-only"> — bloquée : {blockedMessage(nextBlockedBy)}</span> : null}
                  <span aria-hidden="true"> →</span>
                </>
              ) : (
                <>
                  Voir les diaporamas<span aria-hidden="true"> →</span>
                </>
              )}
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
}

/**
 * En tête de page : si le prérequis de l'étape affichée manque, le dire et
 * proposer d'y aller. Sous-pages comprises (un squelette ouvert).
 */
export function StepBlockedNotice({ programId, steps }: { programId: string; steps: ProjectStep[] }) {
  const pathname = usePathname();
  const id = stepOfPath(programId, pathname);
  const step = steps.find((s) => s.id === id);
  if (!step || step.status === "done" || !step.blockedBy) return null;
  const missing = stepMeta(step.blockedBy);
  return (
    <Notice tone="warning" title="Prérequis manquant" className="mb-6">
      {blockedMessage(step.blockedBy)} :{" "}
      <Link href={stepHref(programId, missing.id)} className="opale-link">
        Étape {missing.index} · {missing.label}
      </Link>
      .
    </Notice>
  );
}
