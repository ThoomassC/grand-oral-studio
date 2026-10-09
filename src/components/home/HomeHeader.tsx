import Link from "next/link";
import { Icon } from "@thomascaron/opale-ui";
import { SiteSettingsButton } from "@/components/preferences/SiteSettingsButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { HomeBrand } from "./HomeBrand";
import styles from "./HomeLanding.module.css";

/** Rendu hors du contenu principal pour que le lien d’évitement passe l’en-tête. */
export function HomeHeader() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <HomeBrand />
        <nav aria-label="Navigation principale" className={styles.navigation}>
          <Link href="#parcours">Le parcours</Link>
          <Link href="#jour-j">Le jour J</Link>
          <Link href="/notes-de-version" className={styles.releaseLink}>Quoi de neuf <span aria-hidden="true">↗</span></Link>
        </nav>
        <div className={styles.preferences}><ThemeToggle /><SiteSettingsButton /></div>
        <ButtonLink href="/connexion" variant="ghost" size="small" className={styles.headerLogin}>Connexion <Icon name="arrow-right" /></ButtonLink>
      </header>
    </div>
  );
}
