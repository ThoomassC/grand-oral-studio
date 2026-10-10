import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@thomascaron/opale-ui";
import stagePhoto from "@/assets/oral-stage.webp";
import { BrandMark } from "@/components/layout/BrandMark";
import { SiteSettingsButton } from "@/components/preferences/SiteSettingsButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import styles from "./LoginExperience.module.css";

export function LoginExperience({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <aside className={styles.story} aria-label="Grand Oral Studio">
        <Image src={stagePhoto} alt="" fill sizes="(max-width: 900px) 0px, 50vw" preload className={styles.photo} />
        <div className={styles.shade} />
        <Link href="/" className={styles.brand} aria-label="Grand Oral Studio — accueil"><BrandMark className={styles.brandMark} /><span>Grand Oral <span className={styles.brandSuffix}>Studio</span></span></Link>
        <div className={styles.storyContent}>
          <h2 className={styles.headline}>Préparez votre oral.<br />Prenez la parole.</h2>
          <p className={styles.storyIntro}>Un espace pour organiser vos idées, construire votre support et vous entraîner.</p>
          <ul className={styles.features}><li><Icon name="check" /> Vos diapos et vos notes au même endroit</li><li><Icon name="check" /> Une préparation à votre rythme</li><li><Icon name="check" /> Votre présentation pour le jour J</li></ul>
        </div>
        <a href="https://unsplash.com/@xteemu" className={styles.photoCredit} target="_blank" rel="noreferrer">Photo : Teemu Paananen / Unsplash</a>
      </aside>
      <section className={styles.workspace} aria-labelledby="login-title">
        <header className={styles.toolbar} role="banner">
          <Link href="/" className={styles.mobileBrand} aria-label="Grand Oral Studio — accueil"><BrandMark className={styles.brandMark} /><span>Grand Oral Studio</span></Link>
          <Link href="/" className={styles.backLink}><span aria-hidden="true">←</span> Retour à l’accueil</Link>
          <div className={styles.preferences}><ThemeToggle /><SiteSettingsButton /></div>
        </header>
        <div className={styles.formContent}>
          <h1 id="login-title" className={styles.title}>Heureux de vous revoir.</h1>
          <p className={styles.intro}>Connectez-vous pour retrouver vos projets.</p>
          {children}
        </div>
        <footer className={styles.footer}><span>© {new Date().getFullYear()} Grand Oral Studio</span><Link href="/notes-de-version">Quoi de neuf <span aria-hidden="true">↗</span></Link></footer>
      </section>
    </div>
  );
}
