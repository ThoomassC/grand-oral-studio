"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/auth-client";
import { AUTH_COMPLETION_MS, AUTH_TRANSITION_MS, waitForAuthMotion } from "./auth-motion";

/**
 * Déconnexion (Better Auth) puis retour à l'accueil. `pending` reste vrai
 * jusqu'au départ de la page ; `failed` signale un échec (réseau ou refus),
 * effacé à la tentative suivante.
 */
export function useSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [complete, setComplete] = useState(false);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => () => operation.current?.abort(), []);

  function run() {
    if (operation.current || pending) return;
    const controller = new AbortController();
    operation.current = controller;
    const started = performance.now();
    setFailed(false);
    setComplete(false);
    setPending(true);
    void (async () => {
      try {
        const { error } = await signOut();
        if (controller.signal.aborted) return;
        if (error) throw new Error("Déconnexion refusée");
        router.prefetch("/");
        await waitForAuthMotion(AUTH_TRANSITION_MS - AUTH_COMPLETION_MS - (performance.now() - started), controller.signal);
        if (controller.signal.aborted) return;
        setComplete(true);
        await waitForAuthMotion(AUTH_COMPLETION_MS, controller.signal);
        if (controller.signal.aborted) return;
        startTransition(() => {
          router.push("/");
          router.refresh();
        });
      } catch {
        if (!controller.signal.aborted) {
          setFailed(true);
          setPending(false);
        }
      } finally {
        if (operation.current === controller) operation.current = null;
      }
    })();
  }

  return { pending, failed, complete, signOut: run };
}
