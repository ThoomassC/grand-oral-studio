"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { usePreferences } from "@/components/preferences/store";
import { AUTH_COMPLETION_MS, AUTH_TRANSITION_MS, authMotionReduced } from "./auth-motion";
import { postLoginDestination } from "./next-path";
import { StudioLoader } from "./StudioLoader";
import styles from "./StudioLoader.module.css";

export { AUTH_TRANSITION_MS } from "./auth-motion";

/** La session est vérifiée par la page serveur avant de monter cette transition. */
export function AuthTransition({ next }: { next: string }) {
  const router = useRouter();
  const destination = postLoginDestination(next);
  const { motion } = usePreferences();
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    router.prefetch(destination);
    const reduced = authMotionReduced();
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let navigated = false;
    const navigate = () => {
      if (navigated) return;
      navigated = true;
      startTransition(() => {
        router.replace(destination);
        router.refresh();
      });
    };
    const completion = window.setTimeout(() => setComplete(true), reduced ? 0 : AUTH_TRANSITION_MS - AUTH_COMPLETION_MS);
    const timer = window.setTimeout(navigate, reduced ? 0 : AUTH_TRANSITION_MS);
    const onMotionChange = () => { if (media?.matches) navigate(); };
    media?.addEventListener?.("change", onMotionChange);
    return () => {
      window.clearTimeout(completion);
      window.clearTimeout(timer);
      media?.removeEventListener?.("change", onMotionChange);
    };
  }, [destination, router, motion]);

  return (
    <StudioLoader complete={complete}>
      {/* Lien utilisable aussi sans JavaScript ou si la navigation est interrompue. */}
      <Link href={destination} replace className={styles.skipLink}>
        Accéder à mon espace
      </Link>
    </StudioLoader>
  );
}
