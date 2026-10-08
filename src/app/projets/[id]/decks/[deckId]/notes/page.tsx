import type { Metadata } from "next";
import { PrintSheet } from "@/components/print/PrintSheet";
import { decksHref } from "@/components/projects/steps";
import { buildDeckNotesSheet } from "@/domain/revision-sheet";
import { loadDeck } from "../../../../_lib/load";

type Params = { params: Promise<{ id: string; deckId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, deckId } = await params;
  const deck = await loadDeck(id, deckId);
  return { title: `Notes d'orateur — ${deck.spec.title}` };
}

/**
 * Fiche d'orateur imprimable (lecteur et plus) : plan minuté, puis chaque diapo
 * avec son minutage, ses puces et ses notes. Minutage selon la trame actuelle du
 * projet (repères « [m:ss–m:ss] » des notes d'abord).
 */
export default async function DeckNotesPage({ params }: Params) {
  const { id, deckId } = await params;
  const deck = await loadDeck(id, deckId);
  const sheet = buildDeckNotesSheet(deck.spec, deck.program.template);
  const deckHref = `${decksHref(id)}/${deck.id}`;

  return (
    <PrintSheet
      heading="Notes d'orateur"
      intro={<p>Plan minuté et notes de chaque diapo, à imprimer ou à enregistrer en PDF.</p>}
      backHref={deckHref}
      backLabel="Retour au diaporama"
    >
      <header>
        <h3 className="text-xl font-semibold">{sheet.title}</h3>
        {sheet.subtitle ? <p className="text-muted">{sheet.subtitle}</p> : null}
        <p className="mt-1 text-sm text-muted">
          Durée prévue : <span className="num">{sheet.durationMinutes} min</span> ·{" "}
          <span className="num">{sheet.slides.length}</span> diapos
        </p>
      </header>

      <section aria-labelledby="notes-plan" className="break-inside-avoid">
        <h3 id="notes-plan" className="text-lg font-semibold">
          Plan
        </h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-1.5 pr-4 font-semibold">
                  Partie
                </th>
                <th scope="col" className="py-1.5 font-semibold">
                  Minutage
                </th>
              </tr>
            </thead>
            <tbody>
              {sheet.plan.map((entry, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="py-1.5 pr-4">{entry.title}</td>
                  <td className="num py-1.5 whitespace-nowrap">{entry.timing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="notes-diapos" className="flex flex-col gap-4">
        <h3 id="notes-diapos" className="text-lg font-semibold">
          Diapos
        </h3>
        <ol className="flex flex-col gap-4">
          {sheet.slides.map((slide) => (
            <li key={slide.number} className="opale-card opale-card--e0 block break-inside-avoid p-4 sm:p-5">
              <p className="text-sm text-muted">
                <span className="num">Diapo {slide.number}</span> · {slide.sectionTitle} ·{" "}
                <span className="num">{slide.timing}</span>
              </p>
              <h4 className="mt-0.5 text-lg font-semibold">{slide.title}</h4>
              {slide.bullets.length > 0 ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-5">
                  {slide.bullets.map((bullet, i) => (
                    <li key={i}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
              {slide.notes ? (
                <p className="mt-3 whitespace-pre-line">{slide.notes}</p>
              ) : (
                <p className="mt-3 text-muted">Aucune note pour cette diapo.</p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </PrintSheet>
  );
}
