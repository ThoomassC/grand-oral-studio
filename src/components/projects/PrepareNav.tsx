"use client";

import { Badge, type BadgeTone } from "@thomascaron/opale-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PrepareItem } from "@/domain/progress";
import { TAB_LINK_CLASS } from "@/components/layout/MainNav";
import { useGuardedNavigation } from "@/components/layout/useGuardedNavigation";
import { PREPARE_ITEMS, pageHref, prepareItemOfPath, stepHref } from "./steps";

function stateOf(item: PrepareItem): { text: string; tone: BadgeTone } {
  if (item.required) return item.status === "done" ? { text: item.summary, tone: "success" } : { text: "Obligatoire", tone: "warning" };
  return item.status === "done" ? { text: "Personnalisé", tone: "success" } : { text: "Par défaut", tone: "neutral" };
}

/**
 * Sous-navigation de l'étape 1 · Préparer : Thèmes (obligatoire), Charte et
 * Gabarit (facultatifs, « Par défaut » ou « Personnalisé »), avec l'état de
 * chacun en texte. Dès qu'il y a un thème, l'appel à l'action principal
 * « Passer aux squelettes » permet de sauter Charte et Gabarit.
 * Rendue seulement sur les trois pages de Préparer.
 */
export function PrepareNav({ programId, items }: { programId: string; items: PrepareItem[] }) {
  const pathname = usePathname();
  const { onLinkClick, dialog } = useGuardedNavigation();
  const current = prepareItemOfPath(programId, pathname);
  if (!current) return null;
  const themesDone = items.find((i) => i.id === "themes")?.status === "done";
  const skeletons = stepHref(programId, "skeletons");

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Préparer : thèmes, charte et gabarit" className="min-w-0 max-w-full overflow-x-auto">
          <ul className="flex items-center gap-2">
            {PREPARE_ITEMS.map((meta) => {
              const item = items.find((i) => i.id === meta.id);
              const href = pageHref(programId, meta.id);
              const isCurrent = current === meta.id;
              const state = item ? stateOf(item) : null;
              return (
                <li key={meta.id} className="shrink-0">
                  <Link
                    href={href}
                    aria-current={isCurrent ? "page" : undefined}
                    className={`${TAB_LINK_CLASS} gap-2`}
                    onClick={(e) => {
                      if (!isCurrent) onLinkClick(e, href);
                    }}
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
        {themesDone ? (
          <Link
            href={skeletons}
            className="opale-button opale-button--primary no-underline"
            onClick={(e) => onLinkClick(e, skeletons)}
          >
            <span>
              Passer aux squelettes<span aria-hidden="true"> →</span>
            </span>
          </Link>
        ) : null}
      </div>
      {dialog}
    </div>
  );
}
