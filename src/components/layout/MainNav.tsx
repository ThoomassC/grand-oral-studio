"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useGuardedNavigation } from "./useGuardedNavigation";

const ITEMS: readonly { href: string; label: string; signedInOnly: boolean }[] = [
  { href: "/projets", label: "Projets", signedInOnly: true },
  { href: "/configuration-ia", label: "Configuration IA", signedInOnly: true },
  // Page publique : visible aussi sans compte (seul onglet alors).
  { href: "/notes-de-version", label: "Notes de version", signedInOnly: false },
];

/**
 * Classe d'un onglet-lien, partagée avec la navigation d'un projet (ProjectSteps) :
 * le style des onglets de la vitrine d'Opale (`.app-tab`, globals.css). L'état
 * courant est porté par `aria-current`, pas seulement par la couleur (graisse).
 */
export const TAB_LINK_CLASS = "app-tab";

/**
 * Navigation principale de l'en-tête : des liens en onglets (Projets et
 * Configuration IA pour un compte connecté, Notes de version pour tous), `aria-current="page"` sur la section courante (« Projets » couvre
 * aussi chaque projet, sous /projets/…). Le style ne repose pas que sur la
 * couleur : lavis et graisse. Opale n'a pas d'onglets-liens
 * horizontaux (`Tabs` est un tablist ARIA, `Navbar` une colonne).
 * Garde « modifications non enregistrées » sur chaque lien vers une autre page.
 */
export function MainNav({ className = "", signedIn }: { className?: string; signedIn: boolean }) {
  const pathname = usePathname();
  const { onLinkClick } = useGuardedNavigation();
  const items = ITEMS.filter((item) => signedIn || !item.signedInOnly);
  return (
    <nav aria-label="Navigation principale" className={className}>
      <ul className="flex items-center gap-2">
        {items.map((item) => {
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
