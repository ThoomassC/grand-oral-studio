"use client";

import { Badge, type BadgeTone } from "@thomascaron/opale-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TemplateTab } from "@/domain/progress";
import { TAB_LINK_CLASS } from "@/components/layout/MainNav";
import { useGuardedNavigation } from "@/components/layout/useGuardedNavigation";
import { TEMPLATE_TABS, projectBase, templateTabOfPath } from "./steps";

/** L'état d'un onglet, dit en texte dans son badge (jamais par la couleur seule). */
function stateOf(tab: TemplateTab): { text: string; tone: BadgeTone } {
  if (tab.id === "slides") return tab.status === "done" ? { text: "Personnalisée", tone: "success" } : { text: "Par défaut", tone: "neutral" };
  return tab.status === "done" ? { text: tab.summary, tone: "success" } : { text: "Facultatif", tone: "neutral" };
}

/**
 * Sous-navigation de l'étape 2 · Trame : ses diapos (« Par défaut » ou
 * « Personnalisée ») et les sujets (facultatifs, ou leur nombre), l'état de
 * chacun en texte. Liens vers deux pages (`aria-current="page"` sur la page
 * affichée), garde « modifications non enregistrées » comprise.
 * Rendue seulement sous `/trame`.
 */
export function TemplateTabs({ programId, tabs }: { programId: string; tabs: TemplateTab[] }) {
  const pathname = usePathname();
  const { onLinkClick } = useGuardedNavigation();
  const current = templateTabOfPath(programId, pathname);
  if (!current) return null;

  return (
    <nav aria-label="Trame : diapos et sujets" className="mb-6 min-w-0 max-w-full">
      {/* À la ligne plutôt qu'un défilement interne peu visible à 320 px. */}
      <ul className="flex flex-wrap items-center gap-2">
        {TEMPLATE_TABS.map((meta) => {
          const tab = tabs.find((t) => t.id === meta.id);
          const href = `${projectBase(programId)}/${meta.segment}`;
          const state = tab ? stateOf(tab) : null;
          return (
            <li key={meta.id} className="shrink-0">
              <Link
                href={href}
                aria-current={current === meta.id ? "page" : undefined}
                className={`${TAB_LINK_CLASS} gap-2`}
                onClick={(e) => onLinkClick(e, href)}
              >
                {meta.label}
                {state ? (
                  <Badge tone={state.tone} size="small">
                    <span className="sr-only"> : </span>
                    {state.text}
                  </Badge>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
