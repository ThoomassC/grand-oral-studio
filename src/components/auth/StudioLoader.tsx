import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import stagePhoto from "@/assets/oral-stage.webp";
import { BrandMark } from "@/components/layout/BrandMark";
import { AUTH_COMPLETION_MS, AUTH_TRANSITION_MS } from "./auth-motion";
import styles from "./StudioLoader.module.css";

/** La photo de l’accueil, le logo et une barre sans pourcentage fictif. */
export function StudioLoader({ children, mode = "signin", complete = false }: {
  children?: ReactNode;
  mode?: "signin" | "signout";
  complete?: boolean;
}) {
  const status = mode === "signout" ? "Déconnexion en cours…" : "Ouverture de votre espace…";
  return (
    <div className={styles.page} data-state={complete ? "complete" : "loading"} style={{
      "--auth-fill-duration": `${AUTH_TRANSITION_MS - AUTH_COMPLETION_MS}ms`,
      "--auth-completion-duration": `${AUTH_COMPLETION_MS}ms`,
    } as CSSProperties}>
      <div className={styles.background} aria-hidden="true">
        <Image src={stagePhoto} alt="" fill sizes="100vw" preload placeholder="blur" className={styles.photo} />
      </div>
      <div className={styles.shade} aria-hidden="true" />
      <div className={styles.content}>
        <div className={styles.logoScene} aria-hidden="true">
          <BrandMark className={styles.logo} />
        </div>
        <div className={styles.progress} role="progressbar" aria-label={status}>
          <span className={styles.progressFill} />
        </div>
        <h1 className="sr-only">Grand Oral Studio</h1>
        <p className="sr-only" role="status">{status}</p>
        {children}
      </div>
    </div>
  );
}
