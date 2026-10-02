"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useGuardedNavigation } from "./useGuardedNavigation";

const ITEMS = [
  { href: "/projets", label: "Projets" },
  { href: "/configuration-ia", label: "Configuration IA" },
] as const;

/**
 * Classe d'un onglet-lien, partagée avec la navigation d'un projet (ProjectSteps) :
 * le style des onglets de la vitrine d'Opale (`.app-tab`, globals.css). L'état
 * courant est porté par `aria-current`, pas seulement par la couleur (graisse).
 */
export const TAB_LINK_CLASS = "app-tab";

/**
 * Navigation principale de l'en-tête (compte connecté) : des liens en
 * onglets, `aria-current="page"` sur la section courante (« Projets » couvre
 * aussi chaque projet, sous /projets/…). Le style ne repose pas que sur la
 * couleur : lavis et graisse. Opale n'a pas d'onglets-liens
 * horizontaux (`Tabs` est un tablist ARIA, `Navbar` une colonne).
 * Garde « modifications non enregistrées » sur chaque lien vers une autre page.
 */
export function MainNav({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const { onLinkClick } = useGuardedNavigation();
  return (
    <nav aria-label="Navigation principale" className={className}>
      <ul className="flex items-center gap-2">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={TAB_LINK_CLASS}
                onClick={(e) => onLinkClick(e, item.href)}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
