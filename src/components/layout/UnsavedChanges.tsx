"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

/**
 * Ce que l'utilisateur a demandé en quittant la page, rejoué s'il confirme :
 * - `href` : un lien ou un élément de menu interne ;
 * - `back` : le bouton « Précédent » du navigateur ;
 * - `action` : une action qui quitte la page (déconnexion).
 */
export type Departure = { kind: "href"; href: string } | { kind: "back" } | { kind: "action"; run: () => void };

/** Une sortie retenue : ce qu'elle rejoue, et l'élément qui l'a demandée (pour lui rendre le focus). */
type PendingNavigation = { departure: Departure; trigger: HTMLElement | null };

type UnsavedState = {
  /** Signal « modifications non enregistrées », lu au moment d'un clic (un ref interne, sans re-rendu). */
  isDirty: () => boolean;
  /** Déclare (ou retire) une source de modifications : plusieurs formulaires peuvent coexister sur une page. */
  setDirty: (source: string, dirty: boolean) => void;
  pending: PendingNavigation | null;
  hold: (navigation: PendingNavigation) => void;
  release: () => void;
  /** Abandonne les modifications et rejoue la sortie retenue. */
  leave: (departure: Departure) => void;
};

/**
 * Signal « modifications non enregistrées » partagé entre les éditeurs
 * (charte, gabarit, diapo, thème, profil, paramètres) et toute la navigation
 * de l'application (en-tête, menu du compte, fil d'étapes, fil d'Ariane,
 * sous-navigation, bas de page, « Précédent » du navigateur). Posé une fois
 * dans le layout racine : une seule confirmation, quelle que soit la sortie.
 *
 * « Précédent » ne passe par aucun lien : dès la première modification, une
 * entrée d'historique sentinelle (même URL) est empilée. « Précédent » la
 * dépile sans quitter la page ; on la rétablit aussitôt et la confirmation
 * s'ouvre. La sentinelle est retirée quand les modifications disparaissent
 * (enregistrement, abandon, démontage), et remplacée par la destination quand
 * on quitte par un lien : l'historique ne s'allonge pas.
 */
const UnsavedContext = createContext<UnsavedState | null>(null);

const preventUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
};

/** Marque de l'entrée sentinelle dans `history.state`, à côté de l'état du routeur de Next. */
const SENTINEL_KEY = "__unsavedSentinel";
let sentinelCount = 0;

type HistoryRecord = Record<string, unknown>;
const asRecord = (state: unknown): HistoryRecord | null =>
  typeof state === "object" && state !== null ? (state as HistoryRecord) : null;

/** L'état sans la marque : l'entrée d'origine ne doit pas passer pour une sentinelle. */
function withoutSentinel(state: unknown): unknown {
  const record = asRecord(state);
  if (!record || !(SENTINEL_KEY in record)) return state;
  const copy: HistoryRecord = { ...record };
  delete copy[SENTINEL_KEY];
  return copy;
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const sourcesRef = useRef(new Set<string>());
  /** URL et numéro de la sentinelle quand elle est l'entrée courante de l'historique. */
  const sentinelRef = useRef<{ url: string; token: number } | null>(null);
  /** Retrait de la sentinelle en cours (`history.back()` émis par nous) : l'état à reposer sur l'entrée d'origine. */
  const consumingRef = useRef<{ state: unknown } | null>(null);
  const [pending, setPending] = useState<PendingNavigation | null>(null);

  // Synchronisation avec l'historique du navigateur (système extérieur), hors rendu.
  const arm = useCallback(() => {
    if (sentinelRef.current !== null || consumingRef.current !== null) return;
    // L'état courant (celui du routeur de Next, `__NA`) est recopié : le routeur reconnaît l'entrée.
    sentinelCount += 1;
    const token = sentinelCount;
    const state = withoutSentinel(window.history.state);
    window.history.pushState({ ...asRecord(state), [SENTINEL_KEY]: token }, "", window.location.href);
    sentinelRef.current = { url: window.location.href, token };
  }, []);

  /** Retire la sentinelle si elle est encore l'entrée courante (sinon une navigation l'a déjà dépassée). */
  const disarm = useCallback(() => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (sentinel === null || sentinel.url !== window.location.href) return;
    consumingRef.current = { state: withoutSentinel(window.history.state) };
    window.history.back();
  }, []);

  const isDirty = useCallback(() => sourcesRef.current.size > 0, []);

  const setDirty = useCallback(
    (source: string, dirty: boolean) => {
      const sources = sourcesRef.current;
      const was = sources.size > 0;
      if (dirty) sources.add(source);
      else sources.delete(source);
      const is = sources.size > 0;
      if (is === was) return;
      if (is) {
        window.addEventListener("beforeunload", preventUnload);
        arm();
      } else {
        window.removeEventListener("beforeunload", preventUnload);
        disarm();
      }
    },
    [arm, disarm],
  );

  const leave = useCallback(
    (departure: Departure) => {
      const onSentinel = sentinelRef.current !== null && sentinelRef.current.url === window.location.href;
      sourcesRef.current.clear();
      sentinelRef.current = null;
      window.removeEventListener("beforeunload", preventUnload);
      setPending(null);
      if (departure.kind === "href") {
        // La destination prend la place de la sentinelle : pas d'entrée en double dans l'historique.
        if (onSentinel) router.replace(departure.href);
        else router.push(departure.href);
      } else if (departure.kind === "back") {
        // Sentinelle rétablie à l'interception : on recule de deux entrées (sentinelle + page).
        window.history.go(onSentinel ? -2 : -1);
      } else {
        departure.run();
      }
    },
    [router],
  );

  useEffect(() => {
    // Phase de capture : notre écouteur passe avant celui du routeur de Next (phase de bulle sur window),
    // et l'arrête quand le retour ne doit pas changer de page.
    const onPopState = (event: PopStateEvent) => {
      const consuming = consumingRef.current;
      if (consuming) {
        consumingRef.current = null;
        event.stopImmediatePropagation();
        // L'entrée d'origine reprend l'état le plus récent (arbre du routeur rafraîchi après un enregistrement).
        window.history.replaceState(consuming.state, "", window.location.href);
        // Modifié de nouveau pendant le retrait : on réarme.
        if (sourcesRef.current.size > 0) arm();
        return;
      }
      const sentinel = sentinelRef.current;
      if (sentinel === null) return;
      // Retour sur la sentinelle elle-même (depuis une ancre `#…` de la page) : on n'a pas quitté la page.
      if (asRecord(event.state)?.[SENTINEL_KEY] === sentinel.token) return;
      sentinelRef.current = null;
      // Saut de plusieurs entrées (menu de l'historique) : on ne sait pas y revenir, le routeur suit.
      if (window.location.href !== sentinel.url) return;
      event.stopImmediatePropagation();
      arm();
      const active = document.activeElement;
      setPending({ departure: { kind: "back" }, trigger: active instanceof HTMLElement ? active : null });
    };
    window.addEventListener("popstate", onPopState, { capture: true });
    return () => {
      window.removeEventListener("popstate", onPopState, { capture: true });
      window.removeEventListener("beforeunload", preventUnload);
    };
  }, [arm]);

  const value = useMemo<UnsavedState>(
    () => ({ isDirty, setDirty, pending, hold: setPending, release: () => setPending(null), leave }),
    [isDirty, setDirty, pending, leave],
  );
  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>;
}

/** État partagé de la garde (navigation) ; null hors du fournisseur. */
export function useUnsavedState(): UnsavedState | null {
  return useContext(UnsavedContext);
}

/**
 * Déclare l'état d'un éditeur. Tant que `dirty` est vrai, la garde est armée :
 * confirmation sur les liens et « Précédent », avertissement natif du
 * navigateur (`beforeunload`) à la fermeture ou au rechargement.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const setDirty = useContext(UnsavedContext)?.setDirty;
  const source = useId();
  useEffect(() => {
    if (!dirty || !setDirty) return;
    setDirty(source, true);
    return () => setDirty(source, false);
  }, [dirty, setDirty, source]);
}

/**
 * La confirmation unique « modifications non enregistrées », posée une fois
 * dans le layout racine, dans une `Modal` d'Opale (`ConfirmModal`). À
 * l'ouverture, le focus va sur « Rester sur la page » ; en restant (bouton,
 * Échap, voile ou croix), il revient à l'élément qui a demandé la sortie.
 */
export function UnsavedChangesBanner() {
  const state = useUnsavedState();
  const pending = state?.pending ?? null;
  if (!state) return null;

  function stay() {
    const trigger = pending?.trigger;
    state?.release();
    // Après le démontage de la modale, qui rend d'abord le focus à l'élément actif à son ouverture.
    window.setTimeout(() => {
      if (trigger?.isConnected) trigger.focus();
    }, 0);
  }

  return (
    <ConfirmModal
      open={pending !== null}
      title="Quitter sans enregistrer ?"
      description="Vos modifications ne sont pas enregistrées. Quitter cette page les abandonne."
      cancelLabel="Rester sur la page"
      confirmLabel="Quitter sans enregistrer"
      onCancel={stay}
      onConfirm={() => {
        if (pending) state.leave(pending.departure);
      }}
    />
  );
}
