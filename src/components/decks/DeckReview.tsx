"use client";

import { Button } from "@thomascaron/opale-ui";
import { useId, useState } from "react";
import { buildCanvaPrompt } from "@/domain/canva";
import { checkDeckAgainstTemplate } from "@/domain/deck";
import type { Brand, DeckSpec, PromptTemplate } from "@/domain/schemas";
import { SlidePreview } from "@/components/slides/SlidePreview";
import { focusLater } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { CanvaPanel } from "./CanvaPanel";
import { isToComplete } from "./EngineBadge";
import { PptxDownloadButton } from "./PptxDownloadButton";
import { SlideEditor } from "./SlideEditor";

const LAYOUT_LABEL = {
  title: "Couverture",
  section: "Intercalaire",
  content: "Contenu",
  "two-columns": "Deux colonnes",
  conclusion: "Conclusion",
} as const;

export function DeckReview({
  deckId,
  initialSpec,
  initialUpdatedAt,
  brand,
  template,
}: {
  deckId: string;
  initialSpec: DeckSpec;
  /** Version ISO du deck, envoyée avec chaque modification (détection de conflit). */
  initialUpdatedAt: string;
  brand: Brand;
  template: PromptTemplate;
}) {
  const baseId = useId();
  const [spec, setSpec] = useState<DeckSpec>(initialSpec);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [editing, setEditing] = useState<number | null>(null);
  const [canvaOpen, setCanvaOpen] = useState(false);
  const [announce, setAnnounce] = useState("");

  // Valeurs dérivées, recalculées à chaque rendu (suivent les modifications locales).
  const issues = checkDeckAgainstTemplate(spec, template);
  const canvaPrompt = buildCanvaPrompt(spec, brand, template);
  const sectionTitle = new Map(template.sections.map((s) => [s.id, s.title]));
  const canvaId = `${baseId}-canva`;
  const editId = (i: number) => `${baseId}-edit-${i}`;

  function closeEditor(index: number) {
    setEditing(null);
    focusLater([editId(index)]);
  }

  return (
    <div className="flex flex-col gap-6">
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
      </div>

      {canvaOpen ? <CanvaPanel id={canvaId} prompt={canvaPrompt} /> : null}

      <LiveRegion className="rounded-lg border border-warning/60 bg-warning-soft p-4">
        {issues.length > 0 ? (
          <>
            <p className="font-semibold text-warning">
              {issues.length} écart{issues.length > 1 ? "s" : ""} au gabarit
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
              <li key={index} className="opale-card opale-card--e1 block p-4 sm:p-5">
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
                        <div className="mt-auto">
                          <Button
                            id={editId(index)}
                            type="button"
                            variant="ghost" size="small"
                            onClick={() => {
                              if (editing === null) setEditing(index);
                            }}
                            aria-disabled={editing !== null || undefined}
                          >
                            Modifier<span className="sr-only"> la diapo {index + 1}</span>
                          </Button>
                        </div>
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
