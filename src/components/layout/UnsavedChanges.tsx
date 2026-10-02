"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

/** Une navigation retenue : sa destination et l'élément qui l'a demandée (pour lui rendre le focus). */
type PendingNavigation = { href: string; trigger: HTMLElement | null };

type UnsavedState = {
  /** Signal « modifications non enregistrées », lu au moment d'un clic (un ref interne, sans re-rendu). */
  isDirty: () => boolean;
  setDirty: (dirty: boolean) => void;
  pending: PendingNavigation | null;
  hold: (navigation: PendingNavigation) => void;
  release: () => void;
};

/**
 * Signal « modifications non enregistrées » partagé entre un éditeur (charte,
 * gabarit) et toute la navigation du projet (fil d'étapes, fil d'Ariane,
 * sous-navigation, bas de page). La navigation retenue vit ici, une seule
 * pour le projet : une seule confirmation, quel que soit le lien cliqué.
 */
const UnsavedContext = createContext<UnsavedState | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirtyRef = useRef(false);
  const [pending, setPending] = useState<PendingNavigation | null>(null);
  // Stables : l'effet de `useUnsavedChanges` ne se rejoue pas quand une navigation est retenue.
  const isDirty = useCallback(() => dirtyRef.current, []);
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const value = useMemo<UnsavedState>(
    () => ({ isDirty, setDirty, pending, hold: setPending, release: () => setPending(null) }),
    [isDirty, setDirty, pending],
  );
  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>;
}

/** État partagé de la garde (navigation) ; null hors d'un projet. */
export function useUnsavedState(): UnsavedState | null {
  return useContext(UnsavedContext);
}

/**
 * Déclare l'état de l'éditeur. Synchronise deux systèmes extérieurs au rendu :
 * l'avertissement natif du navigateur (`beforeunload`, fermeture ou
 * rechargement) et le signal lu par la navigation.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const setDirty = useContext(UnsavedContext)?.setDirty;
  useEffect(() => {
    setDirty?.(dirty);
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      setDirty?.(false);
    };
  }, [dirty, setDirty]);
}

/**
 * La confirmation unique « modifications non enregistrées », posée une fois
 * dans le layout du projet, dans une `Modal` d'Opale (`ConfirmModal`). À
 * l'ouverture, le focus va sur « Rester sur la page » ; en restant (bouton,
 * Échap, voile ou croix), il revient au lien cliqué.
 */
export function UnsavedChangesBanner() {
  const state = useUnsavedState();
  const router = useRouter();
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
        if (!pending) return;
        state.setDirty(false);
        state.release();
        router.push(pending.href);
      }}
    />
  );
}
