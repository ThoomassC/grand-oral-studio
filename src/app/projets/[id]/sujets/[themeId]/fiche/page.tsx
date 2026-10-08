import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PrintSheet } from "@/components/print/PrintSheet";
import { decksHref, pageHref, stepHref } from "@/components/projects/steps";
import { formatDateTime } from "@/components/ui/format";
import type { ThemeRef } from "@/domain/contracts";
import { buildRevisionSheet } from "@/domain/revision-sheet";
import { listFinalDecks, NotFoundError, type FinalDeckSummary, type ProgramDetail } from "@/server/queries";
import { requireUser } from "@/server/session";
import { loadDeck, loadProgram } from "../../../../_lib/load";

type Params = { params: Promise<{ id: string; themeId: string }> };

/** Sujet du projet (404 s'il n'en fait pas partie). */
function subjectOf(program: ProgramDetail, themeId: string): ThemeRef {
  const theme = program.themes.find((t) => t.id === themeId);
  if (!theme) notFound();
  return { id: theme.id, name: theme.name, description: theme.description, keywords: theme.keywords, notes: theme.notes };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, themeId } = await params;
  const subject = subjectOf(await loadProgram(id), themeId);
  return { title: `Fiche de révision — ${subject.name}` };
}

/**
 * Fiche de révision imprimable d'un sujet (lecteur et plus) : mots-clés,
 * chiffres clés et sources relevés dans les notes du sujet et dans son dernier
 * diaporama, plan de ce diaporama. Rien n'est inventé : une rubrique vide le dit.
 */
export default async function RevisionSheetPage({ params }: Params) {
  const [{ id, themeId }, user] = await Promise.all([params, requireUser()]);
  // Lectures indépendantes en parallèle ; loadProgram vérifie l'accès (404 sinon).
  const [program, decks] = await Promise.all([
    loadProgram(id),
    listFinalDecks(user.id, id).catch((error: unknown): FinalDeckSummary[] => {
      if (error instanceof NotFoundError) return [];
      throw error;
    }),
  ]);
  const subject = subjectOf(program, themeId);
  // Liste triée du plus récent au plus ancien : le premier du sujet est le dernier produit.
  const last = decks.find((d) => d.themeId === themeId) ?? null;
  const lastDeck = last ? await loadDeck(id, last.id) : null;
  const sheet = buildRevisionSheet(subject, lastDeck?.spec ?? null);
  const canEdit = program.role !== "viewer";
  const subjectsHref = pageHref(id, "subjects");

  return (
    <PrintSheet
      heading="Fiche de révision"
      intro={<p>Chiffres, sources et plan du sujet, à imprimer ou à enregistrer en PDF.</p>}
      backHref={subjectsHref}
      backLabel="Retour aux sujets"
    >
      <header>
        <h3 className="text-xl font-semibold">{sheet.title}</h3>
        {subject.description ? <p className="text-muted">{subject.description}</p> : null}
        <p className="mt-1 text-sm text-muted">
          {lastDeck && last ? (
            <>
              D&apos;après les notes du sujet et le diaporama{" "}
              <Link href={`${decksHref(id)}/${lastDeck.id}`} className="opale-link">
                {lastDeck.spec.title}
              </Link>{" "}
              du {formatDateTime(last.createdAt)}.
            </>
          ) : (
            "D'après les notes du sujet (aucun diaporama pour ce sujet)."
          )}
        </p>
      </header>

      <section aria-labelledby="fiche-mots-cles" className="break-inside-avoid">
        <h3 id="fiche-mots-cles" className="text-lg font-semibold">
          Mots-clés
        </h3>
        {sheet.keywords.length > 0 ? (
          <p className="mt-1">{sheet.keywords.join(" · ")}</p>
        ) : (
          <p className="mt-1 text-muted">Aucun mot-clé pour ce sujet.</p>
        )}
      </section>

      <section aria-labelledby="fiche-chiffres" className="break-inside-avoid">
        <h3 id="fiche-chiffres" className="text-lg font-semibold">
          Chiffres clés
        </h3>
        {sheet.keyFigures.length > 0 ? (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {sheet.keyFigures.map((figure, i) => (
              <li key={i}>{figure}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted">
            Aucun chiffre relevé : un chiffre compte s&apos;il porte une unité (31 %, 12 millions, 4 ans…).{" "}
            {canEdit ? (
              <Link href={subjectsHref} className="opale-link print:hidden">
                Compléter les notes du sujet
              </Link>
            ) : null}
          </p>
        )}
      </section>

      <section aria-labelledby="fiche-sources" className="break-inside-avoid">
        <h3 id="fiche-sources" className="text-lg font-semibold">
          Sources
        </h3>
        {sheet.sources.length > 0 ? (
          <ul className="mt-1 list-disc space-y-1 pl-5 break-words">
            {sheet.sources.map((source, i) => (
              <li key={i}>{source}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted">
            Aucune source relevée : écrivez « Source : … » dans les notes du sujet ou du diaporama.
          </p>
        )}
      </section>

      <section aria-labelledby="fiche-plan" className="break-inside-avoid">
        <h3 id="fiche-plan" className="text-lg font-semibold">
          Plan
        </h3>
        {sheet.outline.length > 0 ? (
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {sheet.outline.map((entry, i) => (
              <li key={i}>
                {entry.title}
                {entry.minutes !== undefined ? (
                  <span className="num text-muted"> · {entry.minutes.toLocaleString("fr-FR")} min</span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-1 text-muted">
            Pas encore de plan : il vient du dernier diaporama du sujet.{" "}
            {canEdit ? (
              <Link href={stepHref(id, "day")} className="opale-link print:hidden">
                Générer un diaporama au Jour J
              </Link>
            ) : null}
          </p>
        )}
      </section>
    </PrintSheet>
  );
}
