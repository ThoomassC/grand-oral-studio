import Link from "next/link";
import { redirect } from "next/navigation";
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

export default async function HomePage() {
  const user = await getUser();
  if (user) redirect("/programmes");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-accent-strong">Préparation du grand oral</p>
        <h1 className="mt-3 text-3xl font-bold">
          Une problématique tirée au sort, un diaporama prêt en quelques minutes.
        </h1>
        <p className="mt-5 text-lg text-muted">
          Grand Oral Studio vous aide à préparer chaque thème à l&apos;avance, puis à produire le jour J un support
          fidèle à votre charte, que vous relisez et ajustez pendant votre temps de préparation.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/inscription" className="btn btn-primary">
            Créer un compte
          </Link>
          <Link href="/connexion" className="btn btn-secondary">
            J&apos;ai déjà un compte
          </Link>
        </div>
      </div>

      <section aria-labelledby="etapes" className="mt-16">
        <h2 id="etapes" className="text-xl font-semibold">
          En trois étapes
        </h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="card p-5">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft font-display font-bold text-accent-strong"
              >
                {i + 1}
              </span>
              <h3 className="mt-4 text-lg font-semibold">
                <span className="sr-only">Étape {i + 1} : </span>
                {step.title}
              </h3>
              <p className="mt-2 text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
