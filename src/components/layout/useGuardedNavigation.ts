"use client";

import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { useUnsavedState } from "./UnsavedChanges";

const isPlainClick = (event: MouseEvent<HTMLAnchorElement>) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * Garde « modifications non enregistrées » des sorties internes de la page.
 * Si un éditeur ouvert a des modifications et que la sortie mène ailleurs,
 * elle est retenue et la confirmation unique s'affiche
 * (`UnsavedChangesBanner`) ; l'élément qui l'a demandée est mémorisé pour lui
 * rendre le focus si l'on reste.
 *
 * - `onLinkClick` : pour un `<Link>` (le routeur navigue s'il n'est pas retenu) ;
 * - `navigate` : pour un composant qui a déjà annulé la navigation native
 *   (le `onNavigate` du `Breadcrumb` d'Opale) : retient ou pousse la route ;
 * - `go` : pour un élément qui n'est pas un lien (élément de menu) ;
 * - `runOrHold` : pour une action qui quitte la page (déconnexion). Renvoie
 *   vrai si elle est retenue en attente de confirmation.
 */
export function useGuardedNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const state = useUnsavedState();

  /** Vrai quand la navigation est retenue en attente de confirmation. */
  function hold(href: string, trigger: HTMLElement | null): boolean {
    if (!state?.isDirty() || href === pathname) return false;
    state.hold({ departure: { kind: "href", href }, trigger });
    return true;
  }

  function onLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.defaultPrevented || !isPlainClick(event)) return;
    if (hold(href, event.currentTarget)) event.preventDefault();
  }

  function navigate(href: string, event: MouseEvent<HTMLAnchorElement>) {
    go(href, event.currentTarget);
  }

  function go(href: string, trigger: HTMLElement | null) {
    if (!hold(href, trigger)) router.push(href);
  }

  function runOrHold(run: () => void, trigger: HTMLElement | null): boolean {
    if (!state?.isDirty()) {
      run();
      return false;
    }
    state.hold({ departure: { kind: "action", run }, trigger });
    return true;
  }

  return { onLinkClick, navigate, go, runOrHold };
}
