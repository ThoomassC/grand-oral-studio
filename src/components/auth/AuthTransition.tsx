"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { postLoginDestination } from "./next-path";
import { StudioLoader } from "./StudioLoader";
import styles from "./StudioLoader.module.css";

export const AUTH_TRANSITION_MS = 1100;

/** La session est vérifiée par la page serveur avant de monter cette transition. */
export function AuthTransition({ next }: { next: string }) {
  const router = useRouter();
  const destination = postLoginDestination(next);

  useEffect(() => {
    router.prefetch(destination);
    const reduced = document.documentElement.dataset.motion === "reduced"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      startTransition(() => {
        router.replace(destination);
        router.refresh();
      });
    }, reduced ? 0 : AUTH_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [destination, router]);

  return (
    <StudioLoader>
      {/* Lien utilisable aussi sans JavaScript ou si la navigation est interrompue. */}
      <Link href={destination} replace className={styles.skipLink}>
        Accéder à mon espace <span aria-hidden="true">↗</span>
      </Link>
    </StudioLoader>
  );
}
