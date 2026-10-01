"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { segment: "", label: "Thèmes" },
  { segment: "charte", label: "Charte" },
  { segment: "gabarit", label: "Gabarit" },
  { segment: "squelettes", label: "Squelettes" },
  { segment: "jour-j", label: "Jour J" },
  { segment: "decks", label: "Decks" },
] as const;

/**
 * Navigation entre les sections d'un programme. Ce sont des liens (chaque
 * onglet est une page) : `aria-current="page"` signale la section active,
 * et le style ne repose pas que sur la couleur (soulignement épais + graisse).
 */
export function ProgramTabs({ programId }: { programId: string }) {
  const pathname = usePathname();
  const base = `/programmes/${programId}`;

  return (
    <nav aria-label="Sections du programme" className="-mb-px">
      <ul className="flex flex-wrap gap-x-1">
        {TABS.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          const active = tab.segment ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base;
          return (
            <li key={tab.label}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-[3px] px-2.5 sm:px-3 text-[0.9375rem] transition-colors ${
                  active
                    ? "border-accent font-bold text-text"
                    : "border-transparent font-medium text-muted hover:border-border-strong hover:text-text"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
