"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/programmes", label: "Projets" },
  { href: "/parametres", label: "Paramètres" },
] as const;

/**
 * Classes d'un onglet-lien, partagées avec la navigation d'un projet (ProgramTabs).
 * Onglet actif « surligneur » : fond à l'accent d'Opale, texte et soulignement
 * épais à l'encre (9,8:1), en gras — l'état ne repose pas que sur la couleur.
 */
export function tabLinkClass(active: boolean): string {
  return `inline-flex min-h-11 items-center rounded-t-md border-b-[3px] px-3 text-sm no-underline transition-colors focus-visible:outline-offset-[-3px] sm:px-4 ${
    active
      ? "border-on-highlight bg-highlight font-bold text-on-highlight"
      : "border-transparent font-medium text-muted hover:border-border-strong hover:bg-surface-2 hover:text-text"
  }`;
}

/**
 * Navigation principale de l'en-tête (compte connecté) : des liens en
 * onglets, `aria-current="page"` sur la section courante (« Projets » couvre
 * aussi chaque projet, sous /programmes/…). Le style ne repose pas que sur la
 * couleur : surlignage, soulignement épais et graisse. Opale n'a pas d'onglets-liens
 * horizontaux (`Tabs` est un tablist ARIA, `Navbar` une colonne).
 */
export function MainNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="self-stretch">
      <ul className="flex h-full items-end">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={active ? "page" : undefined} className={tabLinkClass(active)}>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
