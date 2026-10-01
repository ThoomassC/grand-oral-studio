"use client";

import { useId, useState } from "react";
import { buildCanvaPrompt } from "@/domain/canva";
import { checkDeckAgainstTemplate } from "@/domain/deck";
import type { Brand, DeckSpec, PromptTemplate } from "@/domain/schemas";
import { SlidePreview } from "@/components/slides/SlidePreview";
import { CanvaPanel } from "./CanvaPanel";
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
  brand,
  template,
}: {
  deckId: string;
  initialSpec: DeckSpec;
  brand: Brand;
  template: PromptTemplate;
}) {
  const baseId = useId();
  const [spec, setSpec] = useState<DeckSpec>(initialSpec);
  const [editing, setEditing] = useState<number | null>(null);
  const [canvaOpen, setCanvaOpen] = useState(false);
  const [announce, setAnnounce] = useState("");

  // Valeurs dérivées, recalculées à chaque rendu (suivent les modifications locales).
  const issues = checkDeckAgainstTemplate(spec, template);
  const canvaPrompt = buildCanvaPrompt(spec, brand, template);
  const pptxHref = `/api/decks/${deckId}/pptx`;
  const sectionTitle = new Map(template.sections.map((s) => [s.id, s.title]));
  const canvaId = `${baseId}-canva`;

  function closeEditor(index: number) {
    setEditing(null);
    requestAnimationFrame(() => document.getElementById(`${baseId}-edit-${index}`)?.focus());
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <a href={pptxHref} download className="btn btn-primary">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
            <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Télécharger le .pptx
        </a>
        <button
          type="button"
          className="btn btn-secondary"
          aria-expanded={canvaOpen}
          aria-controls={canvaId}
          onClick={() => setCanvaOpen((v) => !v)}
        >
          {canvaOpen ? "Masquer les instructions Canva" : "Ouvrir dans Canva"}
        </button>
      </div>

      {canvaOpen ? <CanvaPanel id={canvaId} prompt={canvaPrompt} pptxHref={pptxHref} /> : null}

      {issues.length > 0 ? (
        <section aria-labelledby={`${baseId}-issues`} className="rounded-lg border border-warning/60 bg-warning-soft p-4">
          <h2 id={`${baseId}-issues`} className="font-semibold text-warning">
            {issues.length} écart{issues.length > 1 ? "s" : ""} au gabarit
          </h2>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">Ces écarts n&apos;empêchent pas l&apos;export.</p>
        </section>
      ) : null}

      <p role="status" className="sr-only">
        {announce}
      </p>

      <section aria-labelledby={`${baseId}-slides`}>
        <h2 id={`${baseId}-slides`} className="text-lg font-semibold">
          {spec.slides.length} diapos
        </h2>
        <ol className="mt-3 flex flex-col gap-4">
          {spec.slides.map((slide, index) => {
            const section = slide.sectionId === "cover" ? "Couverture" : (sectionTitle.get(slide.sectionId) ?? slide.sectionId);
            return (
              <li key={index} className="card p-4 sm:p-5">
                <div className="grid gap-5 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                  <div>
                    <SlidePreview slide={slide} brand={brand} format={template.format} number={index + 1} maxBullets={8} />
                    <p className="mt-2 text-sm text-muted">
                      Diapo {index + 1} · {section} · {LAYOUT_LABEL[slide.layout]}
                    </p>
                  </div>
                  <div className="min-w-0">
                    {editing === index ? (
                      <SlideEditor
                        deckId={deckId}
                        index={index}
                        slide={slide}
                        onCancel={() => closeEditor(index)}
                        onSaved={(next) => {
                          setSpec(next);
                          setAnnounce(`Diapo ${index + 1} enregistrée.`);
                          closeEditor(index);
                        }}
                      />
                    ) : (
                      <div className="flex h-full flex-col gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-muted">Notes d&apos;orateur</h3>
                          {slide.notes ? (
                            <p className="mt-1 whitespace-pre-line">{slide.notes}</p>
                          ) : (
                            <p className="mt-1 text-muted">Aucune note pour cette diapo.</p>
                          )}
                        </div>
                        <div className="mt-auto">
                          <button
                            id={`${baseId}-edit-${index}`}
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditing(index)}
                            disabled={editing !== null}
                          >
                            Modifier<span className="sr-only"> la diapo {index + 1}</span>
                          </button>
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
