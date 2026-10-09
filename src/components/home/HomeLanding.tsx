import Link from "next/link";
import { Icon } from "@thomascaron/opale-ui";
import { Duration, PREP_MINUTES, PrepDial } from "@/components/day/PrepClock";
import { BrandMark } from "@/components/layout/BrandMark";
import { SlidePreview, type SlideBrand, type SlidePreviewData } from "@/components/slides/SlidePreview";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { HomeBrand } from "./HomeBrand";
import { LandingMotion } from "./LandingMotion";
import styles from "./HomeLanding.module.css";

/** Une vraie miniature du diaporama, rendue par le même composant que dans le studio. */
const EXAMPLE_BRAND: SlideBrand = {
  colors: { primary: "#294C66", secondary: "#66777F", accent: "#92B3C4", background: "#F9FBFC", text: "#172E38" },
  fonts: { heading: "Arial", body: "Arial" },
  logoDataUrl: null,
};

const EXAMPLE_SLIDE: SlidePreviewData = {
  layout: "content",
  title: "La transition commence à notre échelle.",
  subtitle: "Trois leviers pour les petites entreprises",
  bullets: ["Repenser les usages de l’énergie", "Mutualiser les investissements", "Mobiliser les acteurs du territoire"],
};

function StudioPreview() {
  return (
    <figure className={styles.preview}>
      <div className={styles.studio} aria-hidden="true">
        <div className={styles.studioToolbar}>
          <span className={styles.studioBrand}><BrandMark className={styles.miniMark} /> Grand Oral Studio</span>
          <div className={styles.studioSteps}><span><Icon name="check" /> Apparence</span><span><Icon name="check" /> Trame</span><span>03 <strong>Jour J</strong></span></div>
          <span className={styles.exampleLabel}>Projet d’exemple</span>
        </div>
        <div className={styles.studioBody}>
          <div className={styles.slideList}>
            <span className={styles.slideListLabel}>VOTRE DIAPORAMA</span>
            <div className={styles.slideListItem}><span>01</span><div className={styles.miniCover}><span>Transition énergétique<br />et PME</span><i /></div></div>
            <div className={`${styles.slideListItem} ${styles.slideListActive}`}><span>02</span><div className={styles.miniContent}><strong>Trois leviers concrets</strong><i /><i /><i /></div></div>
            <div className={styles.slideListItem}><span>03</span><div className={styles.miniConclusion}><strong>Pour aller plus loin.</strong><i /><i /></div></div>
            <span className={styles.slideListFooter}><Icon name="layers" /> Votre trame, votre rythme.</span>
          </div>
          <div className={styles.stage}>
            <div className={styles.stageOrbit} />
            <div className={styles.deckBack} />
            <div className={styles.deckFront}>
              <SlidePreview slide={EXAMPLE_SLIDE} brand={EXAMPLE_BRAND} format="16:9" number={2} deckTitle="Transition énergétique et PME" decorative className={styles.slidePreview} />
            </div>
            <div className={styles.speakerNote}>
              <span className={styles.noteIcon}><Icon name="mic" /></span>
              <div><strong>Vos notes, votre voix.</strong><span>« Partir d’un exemple concret, puis ouvrir la discussion. »</span></div>
            </div>
            <span className={styles.exportBadge}><Icon name="check" /> Prêt à exporter</span>
          </div>
        </div>
      </div>
      <figcaption>Votre préparation prend forme, une diapo après l’autre.</figcaption>
    </figure>
  );
}

export function HomeLanding() {
  return (
    <LandingMotion className={styles.page}>
      <section className={styles.hero} aria-labelledby="accroche">
        <div className={styles.heroCopy}>
          <p className={styles.heroLabel}><span aria-hidden="true" /> De la première idée au jour J</p>
          <h1 id="accroche">Des idées claires.<br /><span>Un oral qui marque.</span></h1>
          <p className={styles.heroIntro}>Préparez votre trame, donnez du style à vos diapos et entraînez-vous.<br className={styles.desktopBreak} /> Le jour J, faites de votre problématique une présentation qui vous ressemble.</p>
          <div className={styles.heroActions}>
            <ButtonLink href="/inscription" size="large" className={styles.primaryAction}>Créer un compte <Icon name="arrow-right" /></ButtonLink>
            <Link href="#parcours" className={styles.discoverLink}>Découvrir le parcours <Icon name="chevron-down" /></Link>
          </div>
          <p className={styles.heroHint}>Apparence et trame sans IA <span aria-hidden="true">·</span> Exports PowerPoint et Canva</p>
        </div>
        <StudioPreview />
      </section>

      <div className={styles.benefits} data-reveal>
        <div><Icon name="palette" /><span>Une présentation<br /><strong>à votre image.</strong></span></div>
        <div><Icon name="mic" /><span>Des répétitions<br /><strong>à votre rythme.</strong></span></div>
        <div><Icon name="file-text" /><span>Des notes d’orateur<br /><strong>pour garder le fil.</strong></span></div>
      </div>

      <section id="parcours" className={styles.journey} aria-labelledby="etapes" data-reveal>
        <div className={styles.sectionHeading}>
          <div><p className={styles.sectionLabel}>Un fil conducteur, du début à la fin</p><h2 id="etapes">Trois étapes.<br /><span>Une longueur d’avance.</span></h2></div>
          <p>Ce qui peut être préparé l’est déjà.<br />Vous avancez à votre rythme, avec vos idées et vos mots.</p>
        </div>
        <ol className={styles.stepGrid}>
          <li className={styles.stepCard}>
            <div className={styles.stepTop}><span>01 <span>AVANT LE JOUR J</span></span><Icon name="palette" /></div>
            <h3><span className="sr-only">Étape 1 : </span>Apparence</h3>
            <p>Couleurs, polices, logo : posez votre style, à la main ou à partir d’une présentation d’exemple.</p>
            <div className={styles.appearanceSketch} aria-hidden="true"><div className={styles.swatches}><i /><i /><i /><i /></div><div className={styles.fontSample}><span>Aa</span><span>Le fond.<br /><strong>Et la forme.</strong></span></div></div>
            <span className={styles.stepFoot}><Icon name="check" /> Votre identité, sans IA</span>
          </li>
          <li className={styles.stepCard}>
            <div className={styles.stepTop}><span>02 <span>AVANT LE JOUR J</span></span><Icon name="layers" /></div>
            <h3><span className="sr-only">Étape 2 : </span>Trame</h3>
            <p>Organisez vos diapos et vos notes. Ajoutez vos sujets si besoin : le fil de votre présentation est prêt.</p>
            <div className={styles.outlineSketch} aria-hidden="true"><div><span>01</span><i /><span>Introduire</span></div><div><span>02</span><i /><span>Développer</span></div><div><span>03</span><i /><span>Conclure</span></div></div>
            <span className={styles.stepFoot}><Icon name="check" /> Vos idées, sans IA</span>
          </li>
          <li className={`${styles.stepCard} ${styles.dayCard}`}>
            <div className={styles.stepTop}><span>03 <span>LE JOUR J</span></span><Icon name="sparkle" /></div>
            <h3><span className="sr-only">Étape 3 : </span>Jour J</h3>
            <p>Saisissez la problématique tirée au sort. Votre trame et vos notes deviennent un diaporama à relire et à ajuster.</p>
            <div className={styles.problemSketch} aria-hidden="true"><span>Votre problématique</span><p>Quels leviers pour engager les PME dans la transition énergétique ?</p><span className={styles.problemArrow}><Icon name="arrow-right" /></span></div>
            <span className={styles.stepFoot}><Icon name="download" /> PowerPoint, Canva, à vous de jouer</span>
          </li>
        </ol>
      </section>

      <section id="jour-j" className={styles.day} aria-labelledby="jour-j-title" data-reveal>
        <div className={styles.timePanel}>
          <p className={styles.timeLabel}>Votre temps de préparation</p>
          <div className={styles.dialWrap}><span className={styles.dialOrbit} /><PrepDial className={styles.dial} /></div>
          <p className={styles.timeValue}><Duration minutes={PREP_MINUTES} /></p>
          <p>Le diaporama n’est que le début.<br />La suite, c’est votre voix.</p>
          <div className={styles.rehearsalHint}><Icon name="play" /><span>Répétition chronométrée<br /><strong>Questions probables du jury</strong></span></div>
        </div>
        <div className={styles.dayContent}>
          <p className={styles.sectionLabel}>Le jour J, chaque minute compte</p>
          <h2 id="jour-j-title">Le support prend forme.<br /><span>Vous prenez la parole.</span></h2>
          <p className={styles.dayIntro}>Une trame déjà prête, moins de décisions à prendre. Gardez du temps pour relire, ajuster et vous approprier votre présentation.</p>
          <ol className={styles.timeline}>
            <li><span className={styles.timelineIcon}><Icon name="edit" /></span><div><h3>Posez la problématique</h3><p>Recopiez le sujet tiré au sort et confirmez le sujet reconnu.</p></div></li>
            <li><span className={styles.timelineIcon}><Icon name="layers" /></span><div><h3>Retrouvez votre fil conducteur</h3><p>Un diaporama construit à partir de votre trame, de vos notes et de votre apparence.</p></div></li>
            <li><span className={styles.timelineIcon}><Icon name="mic" /></span><div><h3>Faites-en votre présentation</h3><p>Relisez, personnalisez, exportez. Et répétez avec vos notes d’orateur.</p></div></li>
          </ol>
          <p className={styles.aiNote}><Icon name="sparkle" /><span>Avec une rédaction IA, le diaporama est rédigé. Sans IA, votre trame devient un diaporama à compléter. Vous gardez la main.</span></p>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="commencer" data-reveal>
        <div className={styles.closingArtwork} aria-hidden="true"><i /><i /><i /></div>
        <p className={styles.sectionLabel}>À vous de lui donner une voix</p>
        <h2 id="commencer">Votre prochain grand oral<br />commence ici<span>.</span></h2>
        <ButtonLink href="/inscription" size="large" className={styles.primaryAction}>Créer un compte <Icon name="arrow-right" /></ButtonLink>
        <p className={styles.closingLogin}>Déjà un compte ? <Link href="/connexion">Retrouvez votre espace <span aria-hidden="true">↗</span></Link></p>
      </section>

      <footer className={styles.footer} role="contentinfo">
        <HomeBrand footer />
        <div><Link href="/notes-de-version">Notes de version <span aria-hidden="true">↗</span></Link><span>© {new Date().getFullYear()} Grand Oral Studio</span></div>
      </footer>
    </LandingMotion>
  );
}
