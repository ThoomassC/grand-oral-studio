import type { Metadata } from "next";
import { RehearsalPlayer, type RehearsalSlide } from "@/components/rehearsal/RehearsalPlayer";
import { decksHref } from "@/components/projects/steps";
import { formatDateTime } from "@/components/ui/format";
import { formatDelta, plannedSecondsPerSlide } from "@/domain/rehearsal";
import { formatSeconds } from "@/domain/slides";
import { listRehearsals } from "@/server/repo/rehearsals";
import { requireUser } from "@/server/session";
import { loadDeck } from "../../../../_lib/load";

type Params = { params: Promise<{ id: string; deckId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, deckId } = await params;
  const deck = await loadDeck(id, deckId);
  return { title: `Répétition — ${deck.spec.title}` };
}

/**
 * Mode répétition (lecteur et plus) : le lecteur chronométré, puis les
 * dernières répétitions de l'utilisateur sur ce diaporama. Le minutage prévu
 * est calculé ici (trame actuelle du projet) : seules les diapos, la charte
 * d'affichage et les secondes prévues traversent vers le client.
 */
export default async function RehearsalPage({ params }: Params) {
  const [{ id, deckId }, user] = await Promise.all([params, requireUser()]);
  // Lectures indépendantes en parallèle ; loadDeck vérifie l'accès (404 sinon).
  const [deck, recent] = await Promise.all([loadDeck(id, deckId), listRehearsals(user.id, deckId)]);
  const planned = plannedSecondsPerSlide(deck.spec, deck.program.template);
  const plannedTotal = planned.reduce((a, b) => a + b, 0);
  const slides: RehearsalSlide[] = deck.spec.slides.map((s) => ({
    layout: s.layout,
    title: s.title,
    subtitle: s.subtitle,
    bullets: s.bullets,
    notes: s.notes,
  }));
  const { colors, fonts, logoDataUrl } = deck.program.brand;
  const deckHref = `${decksHref(id)}/${deck.id}`;

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="repetition-titre" className="flex flex-col gap-5">
        <div>
          <h2 id="repetition-titre" className="text-2xl">
            Répétition
          </h2>
          <p className="text-muted">
            {deck.spec.title} · <span className="num">{formatSeconds(plannedTotal)}</span> prévues pour{" "}
            <span className="num">{slides.length}</span> diapos
          </p>
        </div>
        <RehearsalPlayer
          deckId={deck.id}
          deckTitle={deck.spec.title}
          slides={slides}
          planned={planned}
          brand={{ colors, fonts, logoDataUrl }}
          format={deck.program.template.format}
          backHref={deckHref}
        />
      </section>

      <section aria-labelledby="repetitions-recentes" className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 id="repetitions-recentes" className="text-lg font-semibold">
          Vos dernières répétitions
        </h2>
        {recent.length === 0 ? (
          <p className="text-muted">
            Aucune répétition enregistrée pour ce diaporama : lancez-vous avec « Commencer la répétition », le bilan
            s&apos;enregistre quand vous terminez.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3 text-sm">
                <span>{formatDateTime(new Date(r.createdAt))}</span>
                <span>
                  Durée <span className="num font-semibold">{formatSeconds(r.totalSeconds)}</span>
                </span>
                <span className="text-muted">
                  Écart au prévu <span className="num">{formatDelta(r.totalSeconds - plannedTotal)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
