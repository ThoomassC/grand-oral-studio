import type { ReactNode } from "react";
import { BrandMark } from "@/components/layout/BrandMark";
import styles from "./StudioLoader.module.css";

/** Même signature de marque pendant la vérification et l'ouverture du studio. */
export function StudioLoader({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <div className={styles.logoScene} aria-hidden="true">
          <span className={styles.orbit} />
          <span className={styles.logoTile}><BrandMark className={styles.logo} /></span>
        </div>
        <h1 className={styles.title}>Grand Oral <span>Studio</span></h1>
        <p className={styles.status} role="status">Ouverture de votre espace…</p>
        {children}
      </div>
    </div>
  );
}
