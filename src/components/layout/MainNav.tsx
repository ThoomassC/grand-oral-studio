"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/programmes", label: "Projets" },
  { href: "/parametres", label: "Paramètres" },
] as const;

/**
 * Classe d'un onglet-lien, partagée avec la navigation d'un projet (ProgramTabs) :
 * le style des onglets de la vitrine d'Opale (`.app-tab`, globals.css). L'état
 * courant est porté par `aria-current`, pas seulement par la couleur (graisse).
 */
export const TAB_LINK_CLASS = "app-tab";

/**
 * Navigation principale de l'en-tête (compte connecté) : des liens en
 * onglets, `aria-current="page"` sur la section courante (« Projets » couvre
 * aussi chaque projet, sous /programmes/…). Le style ne repose pas que sur la
 * couleur : lavis et graisse. Opale n'a pas d'onglets-liens
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
              <Link href={item.href} aria-current={active ? "page" : undefined} className={TAB_LINK_CLASS}>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
