import Image from "next/image";
import Link from "next/link";
import { Icon } from "@thomascaron/opale-ui";
import stagePhoto from "@/assets/oral-stage.webp";
import { Duration, PREP_MINUTES, PrepDial } from "@/components/day/PrepClock";
import { BrandMark } from "@/components/layout/BrandMark";
import { SlidePreview, type SlideBrand, type SlidePreviewData } from "@/components/slides/SlidePreview";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { HomeBrand } from "./HomeBrand";
import { LandingMotion } from "./LandingMotion";
import styles from "./HomeLanding.module.css";

const EXAMPLE_BRAND: SlideBrand = {
  colors: { primary: "#4F46E5", secondary: "#71717A", accent: "#A5B4FC", background: "#FFFFFF", text: "#18181B" },
  fonts: { heading: "Arial", body: "Arial" },
  logoDataUrl: null,
};
const EXAMPLE_SLIDE: SlidePreviewData = {
  layout: "content",
  title: "La transition commence à notre échelle.",
  subtitle: "Trois leviers pour les petites entreprises",
  bullets: ["Repenser les usages de l’énergie", "Mutualiser les investissements", "Mobiliser les acteurs du territoire"],
};

/** Aperçu illustratif du parcours, sans contrôles factices accessibles au clavier. */
function StudioPreview() {
  return (
    <figure id="parcours" className={styles.preview}>
      <div className={styles.studio} aria-hidden="true">
        <div className={styles.windowBar}><span /><span /><span /><p>Grand Oral Studio</p></div>
        <div className={styles.studioToolbar}>
          <div><BrandMark className={styles.miniMark} /><strong>Transition énergétique et PME</strong></div>
          <span className={styles.exampleLabel}>Projet d’exemple</span>
        </div>
        <div className={styles.board}>
          <div className={styles.boardColumn}>
            <div className={styles.columnHeading}><span className={styles.columnDot} /><strong>Apparence</strong><span>01</span></div>
            <div className={styles.boardCard}><span className={styles.cardLabel}>IDENTITÉ VISUELLE</span><h3>Votre style de présentation</h3><p>Couleurs, polices et logo réunis au même endroit.</p><div className={styles.swatches}><i /><i /><i /><i /></div><div className={styles.fontSample}><strong>Aa</strong><span>Des titres lisibles.<br />Un support cohérent.</span></div><span className={styles.cardTag}><Icon name="palette" /> Personnalisable</span></div>
          </div>
          <div className={styles.boardColumn}>
            <div className={styles.columnHeading}><span className={styles.columnDot} /><strong>Trame</strong><span>02</span></div>
            <div className={styles.boardCard}><span className={styles.cardLabel}>LE FIL DE VOTRE ORAL</span><h3>Une diapo, une idée</h3><div className={styles.slidePreview}><SlidePreview slide={EXAMPLE_SLIDE} brand={EXAMPLE_BRAND} format="16:9" number={2} deckTitle="Transition énergétique et PME" decorative /></div><div className={styles.speakerNote}><Icon name="file-text" /><span>Partir d’un exemple concret, puis ouvrir la discussion.</span></div><span className={styles.cardTag}><Icon name="layers" /> Diapos et notes d’orateur</span></div>
          </div>
          <div className={styles.boardColumn}>
            <div className={styles.columnHeading}><span className={styles.columnDot} /><strong>Jour J</strong><span>03</span></div>
            <div className={styles.boardCard}><span className={styles.cardLabel}>VOTRE PROBLÉMATIQUE</span><h3>Quels leviers pour engager les PME dans la transition énergétique ?</h3><p>Retrouvez votre trame, relisez votre diaporama et préparez votre prise de parole.</p><div className={styles.prepTime}><Icon name="clock" /><span>Temps de préparation<strong><Duration minutes={PREP_MINUTES} /></strong></span></div><span className={styles.cardTag}><Icon name="download" /> PowerPoint et Canva</span></div>
          </div>
        </div>
        <div className={styles.studioFooter}><span>Votre préparation, étape par étape.</span><span>Apparence <Icon name="chevron-right" /> Trame <Icon name="chevron-right" /> Jour J</span></div>
      </div>
      <figcaption>Un espace pour préparer votre support et votre prise de parole.</figcaption>
    </figure>
  );
}

export function HomeLanding() {
  return (
    <LandingMotion className={styles.page}>
      <section className={styles.hero} aria-labelledby="accroche">
        <Image src={stagePhoto} alt="" fill sizes="100vw" preload className={styles.heroPhoto} />
        <div className={styles.heroShade} />
        <div className={styles.heroCopy}>
          <h1 id="accroche">Des idées claires.<br /><span>Un oral qui marque.</span></h1>
          <p className={styles.heroIntro}>Préparez votre trame, composez vos diapos et entraînez-vous.<br className={styles.desktopBreak} /> Tout votre grand oral, dans un seul espace.</p>
          <div className={styles.heroActions}>
            <ButtonLink href="/inscription" size="large" className={styles.primaryAction}>Créer un compte <Icon name="arrow-right" /></ButtonLink>
            <a href="#parcours" className={styles.discoverLink}>Découvrir le parcours <Icon name="chevron-down" /></a>
          </div>
          <p className={styles.heroHint}>Apparence et trame sans IA <span aria-hidden="true">·</span> Exports PowerPoint et Canva</p>
        </div>
        <a href="https://unsplash.com/@xteemu" className={styles.photoCredit} target="_blank" rel="noreferrer">Photo : Teemu Paananen / Unsplash</a>
      </section>

      <StudioPreview />

      <section id="jour-j" className={styles.day} aria-labelledby="jour-j-title" data-reveal>
        <div className={styles.timePanel}><PrepDial className={styles.dial} /><span className={styles.timeValue}><Duration minutes={PREP_MINUTES} /></span><p>Votre temps de préparation</p><span className={styles.timeCaption}>Relire. Ajuster. Répéter.</span></div>
        <div className={styles.dayContent}>
          <p className={styles.sectionLabel}>Le jour J</p>
          <h2 id="jour-j-title">Gardez du temps<br />pour la prise de parole.</h2>
          <p className={styles.dayIntro}>Retrouvez votre préparation et concentrez-vous sur la problématique. Votre support est là pour accompagner votre oral.</p>
          <ul className={styles.featureList}>
            <li><Icon name="check" /><div><h3>Votre trame et vos notes</h3><p>Un diaporama construit à partir de votre préparation.</p></div></li>
            <li><Icon name="check" /><div><h3>Une répétition chronométrée</h3><p>Entraînez-vous avec vos notes et les questions probables du jury.</p></div></li>
            <li><Icon name="check" /><div><h3>Des exports prêts à présenter</h3><p>Emportez votre diaporama dans PowerPoint ou Canva.</p></div></li>
          </ul>
          <p className={styles.aiNote}>Avec une rédaction IA, le diaporama est rédigé. Sans IA, votre trame devient un diaporama à compléter. Vous gardez la main.</p>
        </div>
      </section>

      <footer className={styles.footer} role="contentinfo"><HomeBrand footer /><div><Link href="/notes-de-version">Notes de version <span aria-hidden="true">↗</span></Link><span>© {new Date().getFullYear()} Grand Oral Studio</span></div></footer>
    </LandingMotion>
  );
}
