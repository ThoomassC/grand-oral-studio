import Link from "next/link";
import { redirect } from "next/navigation";
import { Duration, PREP_MINUTES, PrepDial, PrepTimeBadge } from "@/components/day/PrepClock";
import { SlidePreview, type SlideBrand, type SlidePreviewData } from "@/components/slides/SlidePreview";
import { getUser } from "@/server/session";

const STEPS = [
  {
    title: "Configurer le programme",
    text: "Listez les thèmes de votre programme, puis réglez la charte graphique et le gabarit : format, durée de l'oral, sections attendues.",
  },
  {
    title: "Réviser les squelettes",
    text: "L'IA prépare un diaporama squelette par thème. Vous les relisez et les complétez avant le jour J.",
  },
  {
    title: "Le jour J",
    text: "Saisissez la problématique tirée au sort : l'IA reconnaît le thème, vous confirmez, et le deck complet avec notes d'orateur est prêt à exporter vers PowerPoint ou Canva.",
  },
] as const;

const DAY_TIMELINE = [
  { at: "0:00", text: "Vous recopiez la problématique tirée au sort." },
  { at: "0:01", text: "L'IA reconnaît le thème du programme ; vous confirmez d'un clic." },
  { at: "0:03", text: "Le deck complet, notes d'orateur comprises, est prêt à relire et à exporter." },
] as const;

/** Charte d'exemple aux couleurs de l'app, pour les miniatures de l'accueil. */
const SAMPLE_BRAND: SlideBrand = {
  colors: { primary: "#1B2A4A", secondary: "#55627A", accent: "#FFE14D", background: "#FFFFFF", text: "#1B2333" },
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
  if (user) redirect("/programmes");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <section aria-labelledby="accroche" className="grid items-center gap-12 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-14">
        <div>
          <p className="eyebrow">Préparation du grand oral · bac+5</p>
          <h1 id="accroche" className="mt-4 text-4xl leading-[1.05] sm:text-5xl xl:text-[3.75rem]">
            Une problématique <span className="marker">tirée au sort</span>, un diaporama{" "}
            <span className="marker">prêt</span> en quelques minutes.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Grand Oral Studio vous aide à préparer chaque thème à l&apos;avance, puis à produire le jour J un support
            fidèle à votre charte, que vous relisez et ajustez pendant votre temps de préparation.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/inscription" className="btn btn-primary min-h-12 px-6 text-lg">
              Créer un compte
            </Link>
            <Link href="/connexion" className="btn btn-secondary min-h-12 px-6 text-lg">
              J&apos;ai déjà un compte
            </Link>
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
          <p className="num absolute -bottom-2 right-0 rounded-sm bg-surface px-2 py-1 text-sm font-semibold shadow-card ring-1 ring-border">
            13 diapos · 20 min
          </p>
        </div>
      </section>

      <section aria-labelledby="etapes" className="border-t border-border py-12 sm:py-16">
        <p className="eyebrow">Avant le jour J, puis le jour J</p>
        <h2 id="etapes" className="mt-2 text-2xl sm:text-3xl">
          En trois étapes
        </h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3 md:gap-6">
          {STEPS.map((step, i) => (
            <li key={step.title} className="card card-bristol p-6 pt-8">
              <span aria-hidden="true" className="num text-sm font-bold text-muted">
                Étape {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 text-xl">
                <span className="sr-only">Étape {i + 1} : </span>
                {step.title}
              </h3>
              <p className="mt-3 text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="jour-j" className="mb-16 grid gap-8 rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-card sm:p-10 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-12">
        <div className="flex items-center gap-4 md:flex-col md:items-center">
          <PrepDial className="h-24 w-24 shrink-0 sm:h-32 sm:w-32" />
          <p className="text-sm text-muted md:text-center">
            <span className="block text-2xl font-bold text-text">
              <Duration minutes={PREP_MINUTES} className="num" />
            </span>
            de préparation
          </p>
        </div>
        <div>
          <h2 id="jour-j" className="text-2xl sm:text-3xl">
            Le jour J en <span className="marker">3 minutes</span>
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
            Sans clé API : une trame gratuite à compléter. Avec Claude : un diaporama rédigé.
          </p>
        </div>
      </section>
    </div>
  );
}
