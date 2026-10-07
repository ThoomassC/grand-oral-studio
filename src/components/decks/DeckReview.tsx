"use client";

import { Button, Feedback } from "@thomascaron/opale-ui";
import { useId, useState, useTransition } from "react";
import { buildCanvaPrompt } from "@/domain/canva";
import { checkDeckAgainstTemplate } from "@/domain/deck";
import { finalDeckReviewItems } from "@/domain/deck-quality";
import type { Brand, DeckSpec, PromptTemplate } from "@/domain/schemas";
import { insertSlideAfter, moveSlide, regenerateSlide, removeSlide } from "@/server/actions/decks";
import type { ActionResult } from "@/server/actions/result";
import { SlidePreview } from "@/components/slides/SlidePreview";
import { focusLater } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Notice } from "@/components/ui/Notice";
import { CanvaPanel } from "./CanvaPanel";
import { DuplicateDeckButton } from "./DeckActions";
import { isToComplete } from "./EngineBadge";
import { PptxDownloadButton } from "./PptxDownloadButton";
import { SlideActions, slideActionIds } from "./SlideActions";
import { SlideEditor } from "./SlideEditor";

const LAYOUT_LABEL = {
  title: "Couverture",
  section: "Intercalaire",
  content: "Contenu",
  "two-columns": "Deux colonnes",
  conclusion: "Conclusion",
} as const;

type DeckEdit = { spec: DeckSpec; updatedAt: string };

/** Erreur d'une modification de structure, affichée sous la carte concernée. */
interface CardError {
  index: number;
  message: string;
  /** Le deck a changé ailleurs : on propose de recharger. */
  reload: boolean;
}

/** Ancre d'une carte de diapo (liens « Diapo N » de la relecture). */
export const slideAnchor = (n: number) => `diapo-${n}`;

export function DeckReview({
  deckId,
  initialSpec,
  initialUpdatedAt,
  brand,
  template,
  canEdit = true,
  canDuplicate = false,
  aiAvailable = false,
  decksHref,
  reviewProblem = null,
}: {
  deckId: string;
  initialSpec: DeckSpec;
  /** Version ISO du deck, envoyée avec chaque modification (détection de conflit). */
  initialUpdatedAt: string;
  brand: Brand;
  template: PromptTemplate;
  /** Éditeur ou propriétaire : modifier les diapos et la structure. Un lecteur ne fait que relire. */
  canEdit?: boolean;
  /** Proposer « Dupliquer le diaporama » (deck final, éditeur). */
  canDuplicate?: boolean;
  /** Le rédacteur de l'utilisateur est une IA : « Régénérer avec l'IA » sur chaque diapo. */
  aiAvailable?: boolean;
  /** Liste des decks du projet (ouverture de la copie). */
  decksHref?: string;
  /** Problématique d'un deck final IA : points à vérifier avant l'oral, recalculés à chaque modification. */
  reviewProblem?: string | null;
}) {
  const baseId = useId();
  const [spec, setSpec] = useState<DeckSpec>(initialSpec);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [editing, setEditing] = useState<number | null>(null);
  const [canvaOpen, setCanvaOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [cardError, setCardError] = useState<CardError | null>(null);
  const [pending, startTransition] = useTransition();

  // Valeurs dérivées, recalculées à chaque rendu (suivent les modifications locales).
  const issues = checkDeckAgainstTemplate(spec, template);
  const review = reviewProblem ? finalDeckReviewItems(spec, { template, problem: reviewProblem }) : [];
  const canvaPrompt = buildCanvaPrompt(spec, brand, template);
  const sectionTitle = new Map(template.sections.map((s) => [s.id, s.title]));
  const canvaId = `${baseId}-canva`;
  const coverLocked = spec.slides[0]?.layout === "title";
  const ids = (i: number) => slideActionIds(baseId, i);

  function closeEditor(index: number) {
    setEditing(null);
    focusLater([ids(index).edit]);
  }

  function apply(next: DeckEdit, message: string) {
    setSpec(next.spec);
    setUpdatedAt(next.updatedAt);
    setCardError(null);
    setAnnounce(message);
  }

  /** Modification de structure (insertion, déplacement) : une à la fois, erreur affichée sous la carte. */
  function runEdit(index: number, call: () => Promise<ActionResult<DeckEdit>>, onSuccess: (next: DeckEdit) => void) {
    if (pending || editing !== null) return;
    setCardError(null);
    startTransition(async () => {
      try {
        const result = await call();
        if (!result.ok) {
          setCardError({ index, message: result.error, reload: result.code === "CONFLICT" });
          return;
        }
        onSuccess(result.data);
      } catch {
        setCardError({ index, message: "La connexion a été interrompue. Réessayez.", reload: false });
      }
    });
  }

  function insertAfter(index: number) {
    runEdit(index, () => insertSlideAfter(deckId, index, updatedAt), (next) => {
      apply(next, `Diapo ${index + 2} insérée.`);
      setEditing(index + 1);
    });
  }

  function move(index: number, direction: "up" | "down") {
    const target = direction === "up" ? index - 1 : index + 1;
    runEdit(index, () => moveSlide(deckId, index, direction, updatedAt), (next) => {
      apply(next, `Diapo ${index + 1} déplacée en position ${target + 1}.`);
      const t = ids(target);
      focusLater(direction === "up" ? [t.up, t.down, t.edit] : [t.down, t.up, t.edit]);
    });
  }

  async function confirmEdit(call: () => Promise<ActionResult<DeckEdit>>, message: string): Promise<string | null> {
    const result = await call();
    if (!result.ok) return result.error;
    apply(result.data, message);
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      {review.length > 0 ? (
        <Feedback tone="warning" title={`${review.length} point${review.length > 1 ? "s" : ""} à vérifier avant l'oral`}>
          <ul className="list-disc pl-5">
            {review.map((item) => (
              <li key={item.message}>
                {item.message}
                {item.slides.length > 0 ? (
                  <>
                    {" "}
                    {item.slides.map((n, i) => (
                      <span key={n}>
                        {i > 0 ? ", " : ""}
                        <a href={`#${slideAnchor(n)}`} className="font-semibold underline underline-offset-2">
                          Diapo {n}
                        </a>
                      </span>
                    ))}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Feedback>
      ) : null}

      <div className="flex flex-wrap items-start gap-3">
        <PptxDownloadButton href={`/api/decks/${deckId}/pptx`} fallbackName="diaporama.pptx" />
        <Button
          type="button"
          variant="ghost"
          aria-expanded={canvaOpen}
          aria-controls={canvaOpen ? canvaId : undefined}
          onClick={() => setCanvaOpen((v) => !v)}
        >
          {canvaOpen ? "Masquer l'import dans Canva" : "Importer dans Canva"}
        </Button>
        {canEdit && canDuplicate && decksHref ? <DuplicateDeckButton deckId={deckId} decksHref={decksHref} /> : null}
      </div>
      {canEdit && !aiAvailable ? (
        <p className="text-sm text-muted">Régénérer une diapo : disponible avec une rédaction IA (Configuration IA).</p>
      ) : null}

      {canvaOpen ? <CanvaPanel id={canvaId} prompt={canvaPrompt} /> : null}

      <LiveRegion className="rounded-lg border border-warning/60 bg-warning-soft p-4">
        {issues.length > 0 ? (
          <>
            <p className="font-semibold text-warning">
              {issues.length} écart{issues.length > 1 ? "s" : ""} à la trame
            </p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted">Ces écarts n&apos;empêchent pas l&apos;export.</p>
          </>
        ) : null}
      </LiveRegion>

      <LiveRegion>{announce}</LiveRegion>

      <section aria-labelledby={`${baseId}-slides`}>
        <h2 id={`${baseId}-slides`} className="text-xl">
          <span className="num">{spec.slides.length}</span> diapos
        </h2>
        <ol className="mt-3 flex flex-col gap-4">
          {spec.slides.map((slide, index) => {
            const section =
              slide.sectionId === "cover" ? "Couverture" : (sectionTitle.get(slide.sectionId) ?? slide.sectionId);
            return (
              <li key={index} id={slideAnchor(index + 1)} className="opale-card opale-card--e1 block p-4 sm:p-5">
                <h3 className="text-lg">
                  <span aria-hidden="true" className="num mr-2 text-base text-muted">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="sr-only">Diapo {index + 1} — </span>
                  {slide.title}
                </h3>
                <p className="mt-0.5 text-sm text-muted">
                  {section} · {LAYOUT_LABEL[slide.layout]}
                </p>
                <div className="mt-3 grid gap-5 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                  <div>
                    <SlidePreview
                      slide={slide}
                      brand={brand}
                      format={template.format}
                      number={index + 1}
                      deckTitle={spec.title}
                      decorative
                    />
                    {slide.subtitle || slide.bullets.length > 0 ? (
                      <div className="mt-3 text-sm">
                        {slide.subtitle ? <p className="italic text-muted">{slide.subtitle}</p> : null}
                        {slide.bullets.length > 0 ? (
                          <ul className="mt-1 list-disc space-y-0.5 pl-5">
                            {slide.bullets.map((b, i) => (
                              <li key={i}>
                                {isToComplete(b) ? <mark className="rounded-sm bg-highlight-soft px-1 text-text">{b}</mark> : b}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    {editing === index ? (
                      <SlideEditor
                        deckId={deckId}
                        index={index}
                        slide={slide}
                        expectedUpdatedAt={updatedAt}
                        onCancel={() => closeEditor(index)}
                        onSaved={(next) => {
                          setSpec(next.spec);
                          setUpdatedAt(next.updatedAt);
                          setAnnounce(`Diapo ${index + 1} enregistrée.`);
                          closeEditor(index);
                        }}
                      />
                    ) : (
                      <div className="flex h-full flex-col gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-muted">Notes d&apos;orateur</h4>
                          {slide.notes ? (
                            <p className="mt-1 whitespace-pre-line">{slide.notes}</p>
                          ) : (
                            <p className="mt-1 text-muted">Aucune note pour cette diapo.</p>
                          )}
                        </div>
                        {canEdit ? (
                          <SlideActions
                            baseId={baseId}
                            index={index}
                            count={spec.slides.length}
                            coverLocked={coverLocked}
                            disabled={editing !== null || pending}
                            aiAvailable={aiAvailable}
                            onEdit={() => {
                              setCardError(null);
                              setEditing(index);
                            }}
                            onInsert={() => insertAfter(index)}
                            onMove={(direction) => move(index, direction)}
                            onRegenerate={() =>
                              confirmEdit(() => regenerateSlide(deckId, index, updatedAt), `Diapo ${index + 1} régénérée.`)
                            }
                            onRemove={() => confirmEdit(() => removeSlide(deckId, index, updatedAt), `Diapo ${index + 1} supprimée.`)}
                            onRemoved={() => {
                              const neighbour = Math.min(index, spec.slides.length - 1);
                              focusLater([ids(neighbour).edit, ids(neighbour - 1).edit]);
                            }}
                          />
                        ) : null}
                        <LiveRegion role="alert">
                          {cardError?.index === index ? (
                            <Notice tone="error">
                              <p className="font-medium">{cardError.message}</p>
                              {cardError.reload ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="small"
                                  className="mt-2"
                                  onClick={() => window.location.reload()}
                                >
                                  Recharger le diaporama
                                </Button>
                              ) : null}
                            </Notice>
                          ) : null}
                        </LiveRegion>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
