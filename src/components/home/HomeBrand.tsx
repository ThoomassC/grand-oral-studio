import Link from "next/link";
import { BrandMark } from "@/components/layout/BrandMark";
import styles from "./HomeLanding.module.css";

export function HomeBrand({ footer = false }: { footer?: boolean }) {
  return (
    <Link href="/" className={styles.brand} aria-label="Grand Oral Studio — accueil">
      <span className={styles.brandTile}><BrandMark className={styles.brandMark} /></span>
      <span>Grand Oral <span className={styles.brandSuffix}>Studio</span>{footer ? <small>Les idées prennent la parole.</small> : null}</span>
    </Link>
  );
}
