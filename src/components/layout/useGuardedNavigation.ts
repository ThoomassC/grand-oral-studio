"use client";

import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { useUnsavedState } from "./UnsavedChanges";

const isPlainClick = (event: MouseEvent<HTMLAnchorElement>) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * Garde « modifications non enregistrées » des liens internes d'un projet.
 * Si l'éditeur ouvert a des modifications et que le lien mène à une autre
 * page, la navigation est retenue et la confirmation unique du projet
 * s'affiche (`UnsavedChangesBanner`) ; le lien cliqué est mémorisé pour lui
 * rendre le focus si l'on reste.
 *
 * - `onLinkClick` : pour un `<Link>` (le routeur navigue s'il n'est pas retenu) ;
 * - `navigate` : pour un composant qui a déjà annulé la navigation native
 *   (le `onNavigate` du `Breadcrumb` d'Opale) : retient ou pousse la route.
 */
export function useGuardedNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const state = useUnsavedState();

  /** Vrai quand la navigation est retenue en attente de confirmation. */
  function hold(href: string, trigger: HTMLElement | null): boolean {
    if (!state?.isDirty() || href === pathname) return false;
    state.hold({ href, trigger });
    return true;
  }

  function onLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.defaultPrevented || !isPlainClick(event)) return;
    if (hold(href, event.currentTarget)) event.preventDefault();
  }

  function navigate(href: string, event: MouseEvent<HTMLAnchorElement>) {
    if (!hold(href, event.currentTarget)) router.push(href);
  }

  return { onLinkClick, navigate };
}
