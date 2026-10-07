"use client";

import { Breadcrumb } from "@thomascaron/opale-ui";
import { usePathname } from "next/navigation";
import { useGuardedNavigation } from "@/components/layout/useGuardedNavigation";
import { projectCrumbs, type Crumb } from "./crumbs";
import type { StepId } from "@/domain/progress";
import { decksHref, pageHref, projectBase, shareHref, stepHref, stepMeta, stepOfPath, templateTabOfPath } from "./steps";

/**
 * Le deck ouvert, quand la page en affiche un (fourni par le slot `@crumbs` de ses
 * routes). `id` : permet de lier le deck depuis ses sous-pages (répétition…).
 */
export type OpenDeck = { id?: string; title: string };

/** Sous-pages d'un diaporama (`/decks/<id>/<segment>`) et leur élément final. */
const DECK_PAGES: Readonly<Record<string, string>> = {
  repetition: "Répétition",
  questions: "Questions du jury",
  notes: "Notes d'orateur",
};

const stepCrumb = (id: StepId) => `Étape ${stepMeta(id).index} · ${stepMeta(id).label}`;

/** L'élément final du fil selon la page affichée. Aucune entrée ne lie la page courante. */
function leafOf(programId: string, pathname: string, deck: OpenDeck | undefined): Crumb[] {
  const decks = decksHref(programId);
  // Tout deck ouvert vit dans Decks, ancien squelette (version 1.0) compris.
  if (deck) {
    const deckHref = deck.id ? `${decks}/${deck.id}` : null;
    const segment = deckHref && pathname.startsWith(`${deckHref}/`) ? pathname.slice(deckHref.length + 1).split("/")[0] : undefined;
    const page = segment ? DECK_PAGES[segment] : undefined;
    const decksCrumb = { id: "decks", href: decks, label: "Diaporamas" };
    if (deckHref && page) return [decksCrumb, { id: "deck", href: deckHref, label: deck.title }, { id: "deck-page", label: page }];
    return [decksCrumb, { id: "deck", label: deck.title }];
  }
  if (pathname === shareHref(programId)) return [{ id: "partage", label: "Partage" }];
  const base = projectBase(programId);
  if (pathname.startsWith(`${base}/`) && /^\/sujets\/[^/]+\/fiche$/.test(pathname.slice(base.length))) {
    return [
      { id: "template", href: stepHref(programId, "template"), label: stepCrumb("template") },
      { id: "subjects", href: pageHref(programId, "subjects"), label: "Sujets" },
      { id: "fiche", label: "Fiche de révision" },
    ];
  }
  if (pathname === decks) return [{ id: "decks", label: "Diaporamas" }];
  if (pathname.startsWith(`${decks}/`)) return [{ id: "decks", href: decks, label: "Diaporamas" }];
  if (templateTabOfPath(programId, pathname) === "subjects") {
    return [
      { id: "template", href: stepHref(programId, "template"), label: stepCrumb("template") },
      { id: "subjects", label: "Sujets" },
    ];
  }
  const step = stepOfPath(programId, pathname);
  return step ? [{ id: step, label: stepCrumb(step) }] : [];
}

/**
 * Fil d'Ariane (`Breadcrumb` d'Opale) des pages d'un projet, rendu par le
 * layout au même endroit sur toutes les pages (slot `@crumbs`) :
 * « Projets / {projet} / Étape 1 · Apparence », « … / Étape 2 · Trame /
 * Sujets [/ Fiche de révision] », « … / Partage » ou « … / Decks / {deck}
 * [/ Répétition | Questions du jury | Notes d'orateur] ».
 * Les clics passent par le routeur (`onNavigate`) et par la garde
 * « modifications non enregistrées ».
 */
export function ProjectBreadcrumb({ programId, programName, deck }: { programId: string; programName: string; deck?: OpenDeck }) {
  const pathname = usePathname();
  const { navigate } = useGuardedNavigation();
  const items = projectCrumbs(programId, programName, leafOf(programId, pathname, deck)).map((c) =>
    // Sur l'apparence, le projet et « Étape 1 · Apparence » sont la page courante : pas de lien vers elle-même.
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
