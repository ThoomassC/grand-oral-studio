import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/layout/BrandMark";
import { SiteSettingsButton } from "@/components/preferences/SiteSettingsButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import styles from "./LoginExperience.module.css";

export function LoginExperience({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <aside className={styles.story} aria-label="Grand Oral Studio">
        <Link href="/" className={styles.brand} aria-label="Grand Oral Studio — accueil">
          <span className={styles.brandIcon}><BrandMark className={styles.brandMark} /></span>
          <span>Grand Oral <span className={styles.brandSuffix}>Studio</span></span>
        </Link>

        <div className={styles.storyContent}>
          <p className={styles.eyebrow}><span /> VOTRE PROCHAINE PRISE DE PAROLE</p>
          <h2 className={styles.headline}>Prenez la parole.<br /><span>Marquez les esprits.</span></h2>
          <p className={styles.storyIntro}>De la première idée au jour J, donnez à votre oral<br className={styles.desktopBreak} /> le fond et la forme qu’il mérite.</p>

          <div className={styles.composition} aria-hidden="true">
            <div className={styles.orbit} />
            <div className={styles.slideBack} />
            <div className={styles.slide}>
              <div className={styles.slideTop}><span>GRAND ORAL</span><span>01 / 03</span></div>
              <div className={styles.slideContent}>
                <span className={styles.slideOverline}>UNE IDÉE. UN IMPACT.</span>
                <p>Tout commence<br />par une idée claire<span>.</span></p>
                <div className={styles.slideLine} />
                <span className={styles.slideCaption}>À vous de lui donner une voix.</span>
              </div>
              <div className={styles.slideArtwork}><i /><i /><i /></div>
              <div className={styles.slideBottom}><span>Votre présentation prend forme</span><span>↗</span></div>
            </div>
            <div className={styles.voiceNote}>
              <span className={styles.voiceIcon}>
                <svg viewBox="0 0 24 24" fill="none"><path d="M7 10v4m3-7v10m4-12v14m3-9v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </span>
              <span><strong>Votre voix fait la différence.</strong><span>Préparez. Répétez. Convainquez.</span></span>
              <svg className={styles.noteCheck} viewBox="0 0 24 24" fill="none"><path d="m6 12 4 4 8-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
        </div>

        <div className={styles.storyFooter}>
          <div><span>01</span> Préparez</div><i /><div><span>02</span> Répétez</div><i /><div><span>03</span> Présentez</div>
        </div>
      </aside>

      <section className={styles.workspace} aria-labelledby="login-title">
        <header className={styles.toolbar} role="banner">
          <Link href="/" className={styles.mobileBrand} aria-label="Grand Oral Studio — accueil">
            <BrandMark className={styles.brandMark} /><span>Grand Oral <span>Studio</span></span>
          </Link>
          <Link href="/" className={styles.backLink}><span aria-hidden="true">←</span> Retour à l’accueil</Link>
          <div className={styles.preferences}><ThemeToggle /><SiteSettingsButton /></div>
        </header>

        <div className={styles.formContent}>
          <div className={styles.welcomeMark} aria-hidden="true"><BrandMark className={styles.brandMark} /></div>
          <p className={styles.formEyebrow}>VOTRE ESPACE DE PRÉPARATION</p>
          <h1 id="login-title" className={styles.title}>Heureux de vous revoir<span>.</span></h1>
          <p className={styles.intro}>Vos idées, vos diaporamas, votre prochain grand oral.<br />Reprenez là où vous en étiez.</p>
          {children}
          <p className={styles.reassurance}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4.5" y="8.5" width="11" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M6.5 8V6a3.5 3.5 0 0 1 7 0v2M10 12v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            Un espace personnel pour préparer sereinement.
          </p>
        </div>

        <footer className={styles.footer}>
          <span>© {new Date().getFullYear()} Grand Oral Studio</span>
          <Link href="/notes-de-version">Quoi de neuf <span aria-hidden="true">↗</span></Link>
        </footer>
      </section>
    </div>
  );
}
