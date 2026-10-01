"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useUnsavedRef } from "./UnsavedChanges";

const GROUPS = [
  {
    label: "Préparation",
    tabs: [
      { segment: "", label: "Thèmes" },
      { segment: "charte", label: "Charte" },
      { segment: "gabarit", label: "Gabarit" },
      { segment: "squelettes", label: "Squelettes" },
    ],
  },
  {
    label: "Jour J",
    tabs: [
      { segment: "jour-j", label: "Jour J" },
      { segment: "decks", label: "Decks" },
    ],
  },
] as const;

/**
 * Navigation entre les sections d'un programme. Ce sont des liens (chaque
 * onglet est une page) : `aria-current="page"` signale la section active, le
 * style ne repose pas que sur la couleur (surlignage jaune + soulignement
 * épais à l'encre + graisse).
 * Une seule ligne, défilante sur mobile ; l'onglet actif est ramené en vue.
 * L'anneau de focus est tracé à l'intérieur de l'onglet : la barre défilante
 * (overflow) le rognerait sinon en haut et en bas.
 * Si l'éditeur ouvert a des modifications non enregistrées, le changement
 * d'onglet demande confirmation.
 */
export function ProgramTabs({ programId }: { programId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const dirtyRef = useUnsavedRef();
  const activeRef = useRef<HTMLAnchorElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const warningId = useId();
  const base = `/programmes/${programId}`;

  // Synchronisation avec le DOM : faire défiler la barre jusqu'à l'onglet actif.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  function hrefOf(segment: string) {
    return segment ? `${base}/${segment}` : base;
  }

  return (
    <div>
      <nav aria-label="Sections du programme" className="relative -mb-px overflow-x-auto">
        <div className="flex min-w-max items-end gap-4">
          {GROUPS.map((group, gi) => (
            <div key={group.label} className={`relative flex items-end ${gi > 0 ? "border-l border-border pl-4" : ""}`}>
              <span className="sr-only">{group.label} :</span>
              <ul className="flex" aria-label={group.label}>
                {group.tabs.map((tab) => {
                  const href = hrefOf(tab.segment);
                  const active = tab.segment
                    ? pathname === href || pathname.startsWith(`${href}/`)
                    : pathname === base;
                  return (
                    <li key={tab.label} className="shrink-0">
                      <Link
                        ref={active ? activeRef : undefined}
                        href={href}
                        aria-current={active ? "page" : undefined}
                        onClick={(e) => {
                          if (active || !dirtyRef?.current) return;
                          e.preventDefault();
                          setPendingHref(href);
                          window.setTimeout(() => stayRef.current?.focus(), 0);
                        }}
                        className={`inline-flex min-h-11 items-center rounded-t-md border-b-[3px] px-3 transition-colors focus-visible:outline-offset-[-3px] ${
                          active
                            ? "hl border-on-highlight font-bold"
                            : "border-transparent font-medium text-muted hover:border-border-strong hover:bg-surface-2 hover:text-text"
                        }`}
                      >
                        {tab.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
      {pendingHref ? (
        <div
          role="alertdialog"
          aria-labelledby={warningId}
          className="my-3 flex flex-col gap-2 rounded-lg border border-warning/60 bg-warning-soft p-3 sm:flex-row sm:items-center sm:justify-between"
          onKeyDown={(e) => {
            if (e.key === "Escape") setPendingHref(null);
          }}
        >
          <p id={warningId} className="text-sm font-medium">
            Vos modifications ne sont pas enregistrées. Quitter cette page les abandonne.
          </p>
          <div className="flex flex-wrap gap-2">
            <button ref={stayRef} type="button" className="btn btn-secondary btn-sm" onClick={() => setPendingHref(null)}>
              Rester sur la page
            </button>
            <button
              type="button"
              className="btn btn-danger-ghost btn-sm"
              onClick={() => {
                if (dirtyRef) dirtyRef.current = false;
                const href = pendingHref;
                setPendingHref(null);
                router.push(href);
              }}
            >
              Quitter sans enregistrer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
