"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { signOut } from "@/lib/auth-client";

/**
 * Déconnexion (Better Auth) puis retour à l'accueil. `pending` reste vrai
 * jusqu'au départ de la page ; `failed` signale un échec (réseau ou refus),
 * effacé à la tentative suivante.
 */
export function useSignOut() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function run() {
    if (pending) return;
    setFailed(false);
    startTransition(async () => {
      try {
        const { error } = await signOut();
        if (error) {
          setFailed(true);
          return;
        }
      } catch {
        setFailed(true);
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  return { pending, failed, signOut: run };
}
