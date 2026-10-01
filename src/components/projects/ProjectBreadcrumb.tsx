"use client";

import { Breadcrumb } from "@thomascaron/opale-ui";
import { usePathname } from "next/navigation";
import { projectCrumbs } from "./crumbs";
import { decksHref, prepareItemMeta, prepareItemOfPath, projectBase, stepHref, stepMeta, stepOfPath } from "./steps";

/**
 * Fil d'Ariane (`Breadcrumb` d'Opale) des pages d'un projet :
 * « Projets / {projet} / Étape 1 · Préparer / Charte », « … / Étape 2 ·
 * Squelettes » ou « … / Decks ». Les pages
 * d'un deck ouvert posent le leur (avec le titre du deck) : rien ici.
 * Liens natifs : une page aux modifications non enregistrées déclenche
 * l'avertissement du navigateur.
 */
export function ProjectBreadcrumb({ programId, programName }: { programId: string; programName: string }) {
  const pathname = usePathname();
  const decks = decksHref(programId);
  const step = stepOfPath(programId, pathname);
  const isDeckDetail = pathname.startsWith(`${decks}/`) || pathname.startsWith(`${projectBase(programId)}/squelettes/`);
  if (isDeckDetail) return null;
  const item = prepareItemOfPath(programId, pathname);
  const crumb = (id: NonNullable<typeof step>) => `Étape ${stepMeta(id).index} · ${stepMeta(id).label}`;
  const leaf =
    pathname === decks
      ? [{ id: "decks", label: "Decks" }]
      : item
        ? [
            { id: "prepare", href: stepHref(programId, "prepare"), label: crumb("prepare") },
            { id: item, label: prepareItemMeta(item).label },
          ]
        : step
          ? [{ id: step, label: crumb(step) }]
          : [];
  return <Breadcrumb aria-label="Fil d'Ariane" items={projectCrumbs(programId, programName, leaf)} />;
}
