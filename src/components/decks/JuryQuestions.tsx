"use client";

import { Badge, Button, Checkbox } from "@thomascaron/opale-ui";
import { useId, useState } from "react";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { focusLater } from "@/components/ui/focus";
import { plural } from "@/components/ui/format";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { generateJuryQuestions, setQuestionReview } from "@/server/actions/practice";
import type { ReviewStatus } from "@/server/repo/questions";

/** Question telle que la page la transmet : texte et statut de l'utilisateur connecté. */
export interface JuryQuestionItem {
  id: string;
  question: string;
  answer: string;
  status: ReviewStatus | null;
}

/** Une question est « à revoir » tant que l'utilisateur ne sait pas y répondre (non marquée comprise). */
const toReview = (q: JuryQuestionItem) => q.status !== "known";

/**
 * Questions probables du jury d'un diaporama : un éditeur les prépare (ou les
 * remplace, après confirmation) ; chacun, lecteur compris, révèle les éléments
 * de réponse et marque « Je sais répondre » / « À revoir » pour lui-même. Le
 * marquage est appliqué tout de suite et annulé si l'enregistrement échoue.
 */
export function JuryQuestions({
  deckId,
  canEdit,
  initialQuestions,
}: {
  deckId: string;
  /** Éditeur ou propriétaire : peut préparer les questions. */
  canEdit: boolean;
  initialQuestions: JuryQuestionItem[];
}) {
  const baseId = useId();
  const [questions, setQuestions] = useState<JuryQuestionItem[]>(initialQuestions);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const [onlyToReview, setOnlyToReview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Valeurs dérivées, recalculées à chaque rendu.
  const remaining = questions.filter(toReview).length;
  const visible = onlyToReview ? questions.filter(toReview) : questions;
  const listTitleId = `${baseId}-liste`;

  /** Lance la préparation ; renvoie le message d'erreur, ou null en cas de succès. */
  async function prepare(): Promise<string | null> {
    setError(null);
    const result = await generateJuryQuestions(deckId);
    if (!result.ok) return result.error;
    setQuestions(result.data.questions);
    setRevealed(new Set());
    setOnlyToReview(false);
    setAnnounce(`${plural(result.data.questions.length, "question préparée", "questions préparées")}.`);
    focusLater([listTitleId]);
    return null;
  }

  async function prepareFirst() {
    if (generating) return;
    setGenerating(true);
    const message = await prepare().catch(() => "La connexion a été interrompue. Réessayez.");
    setGenerating(false);
    if (message) setError(message);
  }

  async function mark(id: string, status: ReviewStatus) {
    const before = questions.find((q) => q.id === id);
    if (!before || before.status === status) return;
    setError(null);
    setQuestions((list) => list.map((q) => (q.id === id ? { ...q, status } : q)));
    const result = await setQuestionReview(id, status).catch(() => null);
    if (result?.ok) return;
    // Échec : on rétablit le statut d'avant (sans écraser un marquage plus récent d'une autre question).
    setQuestions((list) => list.map((q) => (q.id === id ? { ...q, status: before.status } : q)));
    setError(result ? result.error : "La connexion a été interrompue. Réessayez.");
  }

  function toggle(id: string) {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          {questions.length === 0 ? (
            <Button type="button" onClick={prepareFirst} aria-disabled={generating || undefined}>
              <ButtonLabel idle="Préparer les questions" busy="Préparation…" isBusy={generating} />
            </Button>
          ) : (
            <ConfirmAction
              triggerLabel="Préparer de nouvelles questions"
              triggerVariant="ghost"
              size="medium"
              title="Remplacer les questions ?"
              question="Les questions actuelles seront remplacées, et les marquages « Je sais répondre » / « À revoir » de chaque membre du projet effacés."
              confirmLabel="Remplacer les questions"
              pendingLabel="Préparation…"
              onConfirm={prepare}
            />
          )}
        </div>
      ) : null}

      <LiveRegion>{announce}</LiveRegion>
      <LiveRegion role="alert" className="text-sm font-medium text-danger">
        {error}
      </LiveRegion>

      {questions.length === 0 ? (
        <div className="opale-card opale-card--e0 block border-dashed border-border-strong p-6">
          <p className="font-display text-lg font-semibold">Aucune question préparée pour ce diaporama.</p>
          <p className="mt-1 text-muted">
            {canEdit
              ? "Préparez les questions : elles sont tirées de vos diapos, de vos notes d'orateur et des notes du sujet."
              : "Un éditeur du projet peut les préparer ; elles apparaîtront ici."}
          </p>
        </div>
      ) : (
        <section aria-labelledby={listTitleId} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Pas un titre : la page porte le h2, chaque question est un h3. Cible du focus après préparation. */}
            <p id={listTitleId} tabIndex={-1} className="num font-display text-xl font-semibold focus:outline-none">
              {plural(questions.length, "question")}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <p className="num font-semibold">{`${remaining} à revoir`}</p>
              <Checkbox
                label="À revoir seulement"
                checked={onlyToReview}
                onChange={(e) => setOnlyToReview(e.target.checked)}
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="text-muted">Rien à revoir : vous savez répondre à toutes les questions.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {visible.map((q) => {
                const number = questions.indexOf(q) + 1;
                const answerId = `${baseId}-reponse-${q.id}`;
                const open = revealed.has(q.id);
                return (
                  <li key={q.id} className="opale-card opale-card--e1 block p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 text-lg">
                        <span aria-hidden="true" className="num mr-2 text-base text-muted">
                          {String(number).padStart(2, "0")}
                        </span>
                        <span className="sr-only">Question {number} : </span>
                        {q.question}
                      </h3>
                      {q.status === "known" ? (
                        <Badge tone="success">Je sais répondre</Badge>
                      ) : q.status === "to_review" ? (
                        <Badge tone="warning">À revoir</Badge>
                      ) : null}
                    </div>

                    <div className="mt-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="small"
                        aria-expanded={open}
                        aria-controls={open ? answerId : undefined}
                        onClick={() => toggle(q.id)}
                      >
                        {open ? "Masquer les éléments de réponse" : "Voir les éléments de réponse"}
                        <span className="sr-only"> de la question {number}</span>
                      </Button>
                      {open ? (
                        <div id={answerId} className="mt-3 rounded-lg border border-border bg-surface p-4">
                          <p className="whitespace-pre-line">{q.answer}</p>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant={q.status === "known" ? "primary" : "ghost"}
                        size="small"
                        aria-pressed={q.status === "known"}
                        onClick={() => void mark(q.id, "known")}
                      >
                        Je sais répondre<span className="sr-only"> à la question {number}</span>
                      </Button>
                      <Button
                        type="button"
                        variant={q.status === "to_review" ? "primary" : "ghost"}
                        size="small"
                        aria-pressed={q.status === "to_review"}
                        onClick={() => void mark(q.id, "to_review")}
                      >
                        À revoir<span className="sr-only"> : question {number}</span>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
