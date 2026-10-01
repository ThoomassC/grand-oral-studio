"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * Signal « modifications non enregistrées » partagé entre un éditeur (charte,
 * gabarit) et la navigation par onglets du programme. Un ref suffit : on ne le
 * lit qu'au moment d'un clic, sans rien re-rendre.
 */
const UnsavedContext = createContext<RefObject<boolean> | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirtyRef = useRef(false);
  return <UnsavedContext.Provider value={dirtyRef}>{children}</UnsavedContext.Provider>;
}

/** Lecture du signal (onglets). */
export function useUnsavedRef(): RefObject<boolean> | null {
  return useContext(UnsavedContext);
}

/**
 * Déclare l'état de l'éditeur. Synchronise deux systèmes extérieurs au rendu :
 * l'avertissement natif du navigateur (`beforeunload`, fermeture ou
 * rechargement) et le signal lu par les onglets.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const dirtyRef = useContext(UnsavedContext);
  useEffect(() => {
    if (dirtyRef) dirtyRef.current = dirty;
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (dirtyRef) dirtyRef.current = false;
    };
  }, [dirty, dirtyRef]);
}
