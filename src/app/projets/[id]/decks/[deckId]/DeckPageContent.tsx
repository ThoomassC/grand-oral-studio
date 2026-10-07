import { Feedback } from "@thomascaron/opale-ui";
import { DeckNotice } from "@/components/day/DeckNotice";
import { DeleteDeckButton } from "@/components/decks/DeckActions";
import { DeckReview } from "@/components/decks/DeckReview";
import { EngineBadge } from "@/components/decks/EngineBadge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { FocusOnMount } from "@/components/ui/FocusOnMount";
import { formatDateTime } from "@/components/ui/format";
import { decksHref } from "@/components/projects/steps";
import { getWriter } from "@/server/queries";
import { requireUser } from "@/server/session";
import { loadDeck, loadProgram } from "../../../_lib/load";

const toIso = (value: Date | string): string => (typeof value === "string" ? value : value.toISOString());
const normalize = (s: string) => s.trim().toLocaleLowerCase("fr");

/** Écran de relecture d'un deck : final (jour J) ou ancien squelette (version 1.0), tous deux sous Decks. */
export async function DeckPageContent({
  programId: id,
  deckId,
  isNewParam,
  isCopyParam = false,
}: {
  programId: string;
  deckId: string;
  isNewParam: boolean;
  /** Arrivée sur la copie qui vient d'être créée (« Dupliquer le diaporama »). */
  isCopyParam?: boolean;
}) {
  // Lectures indépendantes en parallèle (deck et projet dédoublonnés avec le layout).
  const [deck, program, writer] = await Promise.all([
    loadDeck(id, deckId),
    loadProgram(id),
    requireUser().then((user) => getWriter(user.id)),
  ]);
  const canEdit = program.role !== "viewer";
  const isSkeleton = deck.kind === "SKELETON";
  const isNew = isNewParam && !isSkeleton;
  const backHref = decksHref(id);
  const deckHref = `${backHref}/${deck.id}`;
  const updatedAt = toIso(deck.updatedAt);
  const showSubtitle = deck.spec.subtitle && normalize(deck.spec.subtitle) !== normalize(deck.program.name);
  const showProblem = deck.problem && !normalize(deck.spec.title).includes(normalize(deck.problem));
  // Points à vérifier : recalculés par DeckReview à chaque modification (un point corrigé disparaît).
  // Un squelette (version 1.0) n'est plus comparé à la trame : il n'est plus utilisé le jour J.
  const reviewProblem = !isSkeleton && deck.engine !== "free" && deck.problem ? deck.problem : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Avertissements de la génération qui vient de produire ce diaporama (une fois, côté client). */}
      <DeckNotice deckId={deck.id} />
      <div>
        <h2
          id="titre-deck"
          tabIndex={-1}
          aria-describedby={isNew ? "deck-pret" : undefined}
          className="text-2xl focus:outline-none sm:text-3xl">
          {deck.spec.title}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {isSkeleton ? "Squelette (version 1.0)" : "Deck final"} · {deck.themeName ?? "Sans sujet"}
        </p>
        {/* Arrivée après génération : le focus quitte <body> pour le titre du deck. */}
        {isNew ? <FocusOnMount targetId="titre-deck" /> : null}
        {deck.engine ? (
          <p className="mt-2">
            <EngineBadge engine={deck.engine} />
          </p>
        ) : null}
        {showSubtitle ? <p className="mt-1 text-lg text-muted">{deck.spec.subtitle}</p> : null}
        {showProblem ? (
          <p className="mt-2">
            <span className="text-muted">Problématique : </span>
            {deck.problem}
          </p>
        ) : null}
        <p className="mt-1 text-sm text-muted">Mis à jour le {formatDateTime(new Date(updatedAt))}</p>
      </div>

      {/* Entraînement (lecteur compris) : répétition chronométrée, questions du jury, fiche d'orateur imprimable. */}
      {isSkeleton ? null : (
        <nav aria-label="S'entraîner" className="flex flex-wrap items-center gap-3">
          <ButtonLink href={`${deckHref}/repetition`} variant="ghost">
            Répéter
          </ButtonLink>
          <ButtonLink href={`${deckHref}/questions`} variant="ghost">
            Questions du jury
          </ButtonLink>
          <ButtonLink href={`${deckHref}/notes`} variant="ghost">
            Imprimer les notes
          </ButtonLink>
        </nav>
      )}

      {isSkeleton ? (
        <Feedback tone="info" title="Ancien squelette">
          Ce squelette date de la version 1.0 : il n&apos;est plus utilisé le jour J. Vous pouvez encore le relire,
          l&apos;exporter ou le supprimer.
        </Feedback>
      ) : null}

      {deck.engine === "free" && !isSkeleton ? (
        <Feedback tone="neutral" title="Construit sans IA">
          Ce diaporama a été construit sans IA, à partir de votre trame
          {deck.themeName ? " et des notes du sujet" : " et de la problématique"} : rien n&apos;a été inventé. Les puces{" "}
          <mark className="rounded-sm bg-highlight-soft px-1 text-text">« À compléter »</mark> sont à remplacer par vos
          contenus.
        </Feedback>
      ) : null}

      {isNew ? (
        <Feedback
          id="deck-pret"
          tone="success"
          title={
            deck.engine === "free"
              ? `Votre diaporama est prêt : ${deck.spec.slides.length} diapos à compléter.`
              : `Votre diaporama est prêt : ${deck.spec.slides.length} diapos avec notes d'orateur.`
          }
        >
          Relisez-le, puis téléchargez le .pptx pour Canva.
        </Feedback>
      ) : null}

      {isCopyParam && !isSkeleton ? (
        <Feedback tone="success" title="Copie créée.">
          Vous êtes sur la copie : vos modifications ne touchent pas le diaporama d&apos;origine.
        </Feedback>
      ) : null}

      <DeckReview
        deckId={deck.id}
        initialSpec={deck.spec}
        initialUpdatedAt={updatedAt}
        brand={deck.program.brand}
        template={deck.program.template}
        canEdit={canEdit}
        canDuplicate={!isSkeleton}
        aiAvailable={writer.engine !== "free"}
        decksHref={backHref}
        reviewProblem={reviewProblem}
      />

      {canEdit ? (
        <section aria-labelledby="zone-suppression" className="border-t border-border pt-6">
          <h2 id="zone-suppression" className="text-lg font-semibold">
            {isSkeleton ? "Supprimer ce squelette" : "Supprimer ce deck"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {isSkeleton
              ? "Le diaporama et ses notes seront définitivement effacés."
              : "Le diaporama et ses notes seront effacés. Vous pourrez annuler pendant quelques secondes."}
          </p>
          <div className="mt-3">
            <DeleteDeckButton deckId={deck.id} label={deck.spec.title} redirectTo={backHref} undoable={!isSkeleton} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
