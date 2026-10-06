import { ButtonLink } from "@/components/ui/ButtonLink";
import { Badge } from "@thomascaron/opale-ui";
import { redirect } from "next/navigation";
import { Duration, PREP_MINUTES, PrepDial, PrepTimeBadge } from "@/components/day/PrepClock";
import { SlidePreview, type SlideBrand, type SlidePreviewData } from "@/components/slides/SlidePreview";
import { getUser } from "@/server/session";

/** Le parcours d'un projet : Apparence, Trame, Jour J. L'IA n'intervient qu'à la troisième étape. */
const STEPS = [
  {
    title: "Apparence",
    text: "Couleurs, polices et logo de vos diaporamas : à la main, depuis un prompt ou depuis une présentation d'exemple. Sans IA.",
  },
  {
    title: "Trame",
    text: "La suite des diapos et ce que chacune contient, et si besoin les sujets possibles avec vos notes. Sans IA : rien à générer avant le jour J.",
  },
  {
    title: "Jour J",
    text: "Saisissez la problématique tirée au sort : l'IA reconnaît le sujet et rédige le diaporama à partir de votre trame et de vos notes, avec les notes d'orateur, prêt à exporter vers PowerPoint ou Canva.",
  },
] as const;

const DAY_TIMELINE = [
  { at: "0:00", text: "Vous recopiez la problématique tirée au sort." },
  { at: "0:01", text: "L'IA reconnaît le sujet de la problématique ; vous confirmez d'un clic." },
  { at: "0:03", text: "Le deck complet, notes d'orateur comprises, est prêt à relire et à exporter." },
] as const;

/** Apparence d'exemple dans la palette de la fiche, pour les miniatures de l'accueil. */
const SAMPLE_BRAND: SlideBrand = {
  colors: { primary: "#2A4DB3", secondary: "#55607A", accent: "#C8372D", background: "#FFFFFF", text: "#14213D" },
  fonts: { heading: "Georgia", body: "Arial" },
  logoDataUrl: null,
};

const DECK_TITLE = "Transition énergétique et PME";

const SAMPLE_DECK: SlidePreviewData[] = [
  {
    layout: "conclusion",
    title: "Conclusion",
    bullets: ["Des leviers à la portée des PME", "Un coût d'entrée à mutualiser", "Ouverture : le rôle des régions"],
  },
  {
    layout: "content",
    title: "Trois leviers concrets",
    subtitle: "Ce que font déjà les entreprises pionnières",
    bullets: ["Sobriété : -15 % de consommation en un an", "Autoconsommation solaire", "Achats groupés d'énergie verte"],
  },
  {
    layout: "title",
    title: "Quels leviers pour engager les PME dans la transition énergétique ?",
    subtitle: "Grand oral · Master Management",
  },
];

export default async function HomePage() {
  const user = await getUser();
  if (user) redirect("/projets");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <section aria-labelledby="accroche" className="grid items-center gap-12 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-14">
        <div>
          <h1 id="accroche" className="text-4xl leading-[1.05] sm:text-5xl xl:text-[3.75rem]">
            Une problématique tirée au sort, un diaporama prêt en quelques minutes.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Grand Oral Studio vous aide à préparer l&apos;apparence et la trame de vos diaporamas à l&apos;avance, puis à
            produire le jour J un support fidèle à votre trame, que vous relisez et ajustez pendant votre temps de
            préparation.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/inscription" size="large">
              Créer un compte
            </ButtonLink>
            <ButtonLink href="/connexion" variant="ghost" size="large">
              J&apos;ai déjà un compte
            </ButtonLink>
          </div>
          <div className="mt-8">
            <PrepTimeBadge />
          </div>
        </div>

        {/* Un diaporama prêt : trois diapos empilées, la couverture devant. */}
        <div aria-hidden="true" className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="relative aspect-[16/13] w-full">
            {SAMPLE_DECK.map((slide, i) => {
              const placement = [
                "left-[24%] top-0 w-[74%] rotate-[6deg]",
                "left-[11%] top-[15%] w-[78%] -rotate-[3deg]",
                "left-0 top-[32%] w-[82%] rotate-0",
              ][i];
              return (
                <div key={slide.layout} className={`absolute ${placement}`}>
                  <SlidePreview
                    slide={slide}
                    brand={SAMPLE_BRAND}
                    format="16:9"
                    number={i === 2 ? undefined : 13 - i * 9}
                    deckTitle={DECK_TITLE}
                    decorative
                  />
                </div>
              );
            })}
          </div>
          <Badge tone="neutral" className="num absolute -bottom-2 right-0 shadow-card">
            13 diapos · 20 min
          </Badge>
        </div>
      </section>

      <section aria-labelledby="etapes" className="border-t border-border py-12 sm:py-16">
        <h2 id="etapes" className="text-2xl sm:text-3xl">
          En trois étapes
        </h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3 md:gap-6">
          {STEPS.map((step, i) => (
            <li key={step.title} className="opale-card opale-card--e1 block p-6">
              <h3 className="text-xl">
                <span className="num">{i + 1}.</span> {step.title}
              </h3>
              <p className="mt-3 text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="jour-j" className="opale-card opale-card--e1 mb-16 grid gap-8 p-6 sm:p-10 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-12">
        <div className="flex items-center gap-4 md:flex-col md:items-center">
          <PrepDial className="h-24 w-24 shrink-0 sm:h-32 sm:w-32" />
          <p className="text-sm text-muted md:text-center">
            <span className="block font-title text-2xl font-bold text-text">
              <Duration minutes={PREP_MINUTES} />
            </span>
            de préparation
          </p>
        </div>
        <div>
          <h2 id="jour-j" className="text-2xl sm:text-3xl">
            Le jour J en 3 minutes
          </h2>
          <ol className="mt-6 flex flex-col gap-4">
            {DAY_TIMELINE.map((item) => (
              <li key={item.at} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-baseline gap-3">
                <span className="num rounded-sm bg-surface-2 px-1.5 py-0.5 text-center text-sm font-bold">
                  <span className="sr-only">Minute </span>
                  {item.at}
                </span>
                <span>{item.text}</span>
              </li>
            ))}
          </ol>
          <p className="mt-6 font-semibold">
            Il vous reste environ <Duration minutes={87} className="num" /> pour vous approprier le support et répéter.
          </p>
          <p className="mt-2 text-sm text-muted">
            Sans IA : votre trame remplie avec vos notes, à compléter. Avec Claude : un diaporama rédigé.
          </p>
        </div>
      </section>
    </div>
  );
}
