"use client";

import { Breadcrumb } from "@thomascaron/opale-ui";
import { usePathname } from "next/navigation";
import { useGuardedNavigation } from "@/components/layout/useGuardedNavigation";
import { projectCrumbs, type Crumb } from "./crumbs";
import type { StepId } from "@/domain/progress";
import { decksHref, prepareItemMeta, prepareItemOfPath, stepHref, stepMeta, stepOfPath } from "./steps";

/** Le deck ouvert, quand la page en affiche un (fourni par le slot `@crumbs` de ses routes). */
export type OpenDeck = { kind: "skeleton" | "final"; title: string };

const stepCrumb = (id: StepId) => `Étape ${stepMeta(id).index} · ${stepMeta(id).label}`;

/** L'élément final du fil selon la page affichée. Aucune entrée ne lie la page courante. */
function leafOf(programId: string, pathname: string, deck: OpenDeck | undefined): Crumb[] {
  const decks = decksHref(programId);
  if (deck) {
    return [
      deck.kind === "skeleton"
        ? { id: "squelettes", href: stepHref(programId, "skeletons"), label: stepCrumb("skeletons") }
        : { id: "decks", href: decks, label: "Decks" },
      { id: "deck", label: deck.title },
    ];
  }
  if (pathname === decks) return [{ id: "decks", label: "Decks" }];
  if (pathname.startsWith(`${decks}/`)) return [{ id: "decks", href: decks, label: "Decks" }];
  const item = prepareItemOfPath(programId, pathname);
  if (item) {
    return [
      { id: "prepare", href: stepHref(programId, "prepare"), label: stepCrumb("prepare") },
      { id: item, label: prepareItemMeta(item).label },
    ];
  }
  const step = stepOfPath(programId, pathname);
  return step ? [{ id: step, label: stepCrumb(step) }] : [];
}

/**
 * Fil d'Ariane (`Breadcrumb` d'Opale) des pages d'un projet, rendu par le
 * layout au même endroit sur toutes les pages (slot `@crumbs`) :
 * « Projets / {projet} / Étape 1 · Préparer / Charte », « … / Étape 2 ·
 * Squelettes / {squelette} » ou « … / Decks / {deck} ».
 * Les clics passent par le routeur (`onNavigate`) et par la garde
 * « modifications non enregistrées ».
 */
export function ProjectBreadcrumb({ programId, programName, deck }: { programId: string; programName: string; deck?: OpenDeck }) {
  const pathname = usePathname();
  const { navigate } = useGuardedNavigation();
  const items = projectCrumbs(programId, programName, leafOf(programId, pathname, deck)).map((c) =>
    // Sur Thèmes, le projet et « Étape 1 · Préparer » sont la page courante : pas de lien vers elle-même.
    c.href === pathname ? { ...c, href: undefined } : c,
  );
  return (
    <Breadcrumb
      aria-label="Fil d'Ariane"
      items={items}
      onNavigate={(item, event) => {
        if (item.href) navigate(item.href, event);
      }}
    />
  );
}
