"use client";

import { useId, useRef, useState, useTransition } from "react";
import { defaultTemplate } from "@/domain/defaults";
import { PromptTemplateSchema, type PromptTemplate, type Section } from "@/domain/schemas";
import { suggestSlideCount, totalSlides } from "@/domain/slides";
import { updateTemplate } from "@/server/actions/programs";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { useUnsavedChanges } from "@/components/layout/UnsavedChanges";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FieldError } from "@/components/ui/FieldError";
import { countFieldErrors, focusFirstInvalid, focusLater, invalidCountMessage } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";

const MAX_SECTIONS = 15;

let sectionCounter = 0;
function newSectionId(): string {
  sectionCounter += 1;
  return `s${Date.now().toString(36)}${sectionCounter}`;
}

function toNumber(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}

export function TemplateEditor({ programId, initialTemplate }: { programId: string; initialTemplate: PromptTemplate }) {
  const [saved, setSaved] = useState<PromptTemplate>(initialTemplate);
  const [template, setTemplate] = useState<PromptTemplate>(initialTemplate);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [announce, setAnnounce] = useState("");
  const [pending, startTransition] = useTransition();
  const baseId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const dirty = JSON.stringify(template) !== JSON.stringify(saved);
  useUnsavedChanges(dirty);
  const durationOk = Number.isFinite(template.durationMinutes) && template.durationMinutes >= 3;
  const slidesOk = template.sections.every((s) => Number.isFinite(s.slides));
  const total = slidesOk ? totalSlides(template) : null;
  const suggested = durationOk ? suggestSlideCount(template.durationMinutes) : null;
  const gap = total !== null && suggested !== null && suggested > 0 ? (total - suggested) / suggested : 0;
  const tooFar = Math.abs(gap) > 0.3;

  function patch(next: Partial<PromptTemplate>) {
    setTemplate((t) => ({ ...t, ...next }));
    setStatus(IDLE);
  }

  function patchSection(index: number, next: Partial<Section>) {
    setTemplate((t) => ({ ...t, sections: t.sections.map((s, i) => (i === index ? { ...s, ...next } : s)) }));
    setStatus(IDLE);
  }

  function moveSection(index: number, dir: -1 | 1) {
    const target = index + dir;
    const moved = template.sections[index];
    if (!moved || target < 0 || target >= template.sections.length) return;
    const sections = [...template.sections];
    sections.splice(index, 1);
    sections.splice(target, 0, moved);
    patch({ sections });
    setAnnounce(`Section « ${moved.title || "sans titre"} » déplacée en position ${target + 1}.`);
    const atEdge = target === 0 || target === sections.length - 1;
    const focusDir = atEdge ? (dir === -1 ? "down" : "up") : dir === -1 ? "up" : "down";
    focusLater([`${baseId}-${focusDir}-${moved.id}`]);
  }

  function removeSection(index: number) {
    const removed = template.sections[index];
    if (!removed) return;
    const sections = template.sections.filter((_, i) => i !== index);
    patch({ sections });
    setAnnounce(`Section « ${removed.title || "sans titre"} » supprimée.`);
    const neighbour = sections[Math.min(index, sections.length - 1)];
    focusLater([neighbour ? `${baseId}-title-${neighbour.id}` : null, `${baseId}-add`]);
  }

  function addSection() {
    const id = newSectionId();
    patch({ sections: [...template.sections, { id, title: "Nouvelle section", guidance: "", slides: 1 }] });
    setAnnounce("Section ajoutée en fin de liste.");
    focusLater([`${baseId}-title-${id}`], { select: true });
  }

  function reset() {
    setTemplate(defaultTemplate());
    setFieldErrors({});
    setStatus({ kind: "success", message: "Gabarit par défaut chargé. Enregistrez pour l'appliquer." });
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const checked = validateWith(PromptTemplateSchema, template);
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setStatus({ kind: "error", message: invalidCountMessage(countFieldErrors(checked.fieldErrors)) });
      focusFirstInvalid(formRef.current);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      try {
        const result = await updateTemplate(programId, checked.data);
        if (!result.ok) {
          const errors = result.fieldErrors ?? {};
          setFieldErrors(errors);
          setStatus({ kind: "error", message: result.error });
          if (countFieldErrors(errors) > 0) focusFirstInvalid(formRef.current);
          return;
        }
        setSaved(checked.data);
        setTemplate(checked.data);
        setStatus({ kind: "success", message: "Gabarit enregistré." });
      } catch {
        setStatus({ kind: "error", message: "La connexion a été interrompue. Vos réglages sont conservés : réessayez." });
      }
    });
  }

  const ids = {
    format: `${baseId}-format`,
    language: `${baseId}-language`,
    duration: `${baseId}-duration`,
    tone: `${baseId}-tone`,
    constraints: `${baseId}-constraints`,
    summary: `${baseId}-summary`,
  };

  return (
    <form ref={formRef} noValidate onSubmit={save} className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl">Gabarit de présentation</h2>
          <p className="max-w-2xl text-sm text-muted">
            Structure imposée à l&apos;IA pour chaque diaporama : format, durée, sections dans l&apos;ordre et
            consignes.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            if (!pending) reset();
          }}
          aria-disabled={pending || undefined}
        >
          Réinitialiser au gabarit par défaut
        </button>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <label htmlFor={ids.format} className="field-label">
            Format
          </label>
          <select
            id={ids.format}
            className="input"
            value={template.format}
            onChange={(e) => patch({ format: e.target.value === "4:3" ? "4:3" : "16:9" })}
          >
            <option value="16:9">16:9 (écran large)</option>
            <option value="4:3">4:3 (standard)</option>
          </select>
        </div>
        <div>
          <label htmlFor={ids.language} className="field-label">
            Langue des diapos
          </label>
          <select
            id={ids.language}
            className="input"
            value={template.language}
            onChange={(e) => patch({ language: e.target.value === "en" ? "en" : "fr" })}
          >
            <option value="fr">Français</option>
            <option value="en">Anglais</option>
          </select>
        </div>
        <div>
          <label htmlFor={ids.duration} className="field-label">
            Durée de l&apos;oral (minutes)
          </label>
          <input
            id={ids.duration}
            type="number"
            inputMode="numeric"
            min={3}
            max={90}
            className="input"
            value={Number.isFinite(template.durationMinutes) ? template.durationMinutes : ""}
            onChange={(e) => patch({ durationMinutes: toNumber(e.target.value) })}
            {...errorProps(fieldErrors, "durationMinutes", `${ids.duration}-err`)}
          />
          <FieldError id={`${ids.duration}-err`} message={firstError(fieldErrors, "durationMinutes")} />
        </div>
      </div>

      <div id={ids.summary} className={`rounded-lg border p-4 ${tooFar ? "border-warning/60 bg-warning-soft" : "border-border bg-surface-2"}`}>
        <p className="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            Total : <strong className="num">{total ?? "—"} diapos</strong>{" "}
            <span className="text-sm text-muted">(couverture comprise)</span>
          </span>
          <span>
            Conseillé pour {durationOk ? `${template.durationMinutes} min` : "cette durée"} :{" "}
            <strong className="num">{suggested ?? "—"}</strong>
          </span>
        </p>
        <LiveRegion className="mt-2 text-sm font-medium text-warning">
          {tooFar && suggested !== null && total !== null
            ? `Attention : ${total > suggested ? "trop" : "pas assez"} de diapos pour la durée (${gap > 0 ? "+" : ""}${Math.round(gap * 100)} %). Ajustez le nombre de diapos par section ou la durée.`
            : null}
        </LiveRegion>
      </div>

      <fieldset>
        <legend className="text-lg font-semibold">Sections</legend>
        <p className="text-sm text-muted">
          Dans l&apos;ordre de la présentation. La couverture est ajoutée automatiquement.
        </p>
        <FieldError id={`${baseId}-sections-err`} message={firstError(fieldErrors, "sections")} />
        <LiveRegion>{announce}</LiveRegion>
        <ol className="mt-4 flex flex-col gap-3">
          {template.sections.map((section, index) => {
            const p = `sections.${index}`;
            const titleId = `${baseId}-title-${section.id}`;
            const slidesId = `${baseId}-slides-${section.id}`;
            const guidanceId = `${baseId}-guidance-${section.id}`;
            const label = section.title || `section ${index + 1}`;
            return (
              <li key={section.id} className="card p-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-start">
                  <span
                    aria-hidden="true"
                    className="num flex h-8 min-w-8 shrink-0 items-center justify-center rounded-sm border border-border-strong px-1 text-sm font-bold"
                  >
                    {index + 1}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <div>
                      <label htmlFor={titleId} className="field-label">
                        Titre de la section {index + 1}
                      </label>
                      <input
                        id={titleId}
                        className="input"
                        value={section.title}
                        maxLength={80}
                        onChange={(e) => patchSection(index, { title: e.target.value })}
                        {...errorProps(fieldErrors, `${p}.title`, `${titleId}-err`)}
                      />
                      <FieldError id={`${titleId}-err`} message={firstError(fieldErrors, `${p}.title`)} />
                    </div>
                    <div>
                      <label htmlFor={slidesId} className="field-label">
                        Diapos
                      </label>
                      <input
                        id={slidesId}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={8}
                        className="input"
                        value={Number.isFinite(section.slides) ? section.slides : ""}
                        onChange={(e) => patchSection(index, { slides: toNumber(e.target.value) })}
                        {...errorProps(fieldErrors, `${p}.slides`, `${slidesId}-err`)}
                      />
                      <FieldError id={`${slidesId}-err`} message={firstError(fieldErrors, `${p}.slides`)} />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor={guidanceId} className="field-label">
                        Consigne pour l&apos;IA <span className="font-normal text-muted">(facultatif)</span>
                      </label>
                      <textarea
                        id={guidanceId}
                        className="input"
                        rows={2}
                        maxLength={600}
                        value={section.guidance}
                        onChange={(e) => patchSection(index, { guidance: e.target.value })}
                        {...errorProps(fieldErrors, `${p}.guidance`, `${guidanceId}-err`)}
                      />
                      <FieldError id={`${guidanceId}-err`} message={firstError(fieldErrors, `${p}.guidance`)} />
                    </div>
                  </div>
                  <div className="flex gap-1 md:flex-col" role="group" aria-label={`Actions pour ${label}`}>
                    <button
                      id={`${baseId}-up-${section.id}`}
                      type="button"
                      className="btn btn-secondary btn-icon"
                      onClick={() => moveSection(index, -1)}
                      disabled={index === 0}
                      aria-label={`Monter ${label}`}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
                        <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      id={`${baseId}-down-${section.id}`}
                      type="button"
                      className="btn btn-secondary btn-icon"
                      onClick={() => moveSection(index, 1)}
                      disabled={index === template.sections.length - 1}
                      aria-label={`Descendre ${label}`}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
                        <path d="M8 3v10M3.5 8.5L8 13l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger-ghost btn-icon"
                      onClick={() => removeSection(index)}
                      disabled={template.sections.length <= 1}
                      aria-label={`Supprimer ${label}`}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
                        <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <button
          id={`${baseId}-add`}
          type="button"
          className="btn btn-secondary mt-3"
          onClick={addSection}
          disabled={template.sections.length >= MAX_SECTIONS}
        >
          Ajouter une section
        </button>
        {template.sections.length >= MAX_SECTIONS ? (
          <p className="field-hint">{MAX_SECTIONS} sections au plus.</p>
        ) : null}
      </fieldset>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label htmlFor={ids.tone} className="field-label">
            Ton
          </label>
          <input
            id={ids.tone}
            className="input"
            value={template.tone}
            maxLength={200}
            placeholder="Ex. clair, argumenté, niveau master"
            onChange={(e) => patch({ tone: e.target.value })}
            {...errorProps(fieldErrors, "tone", `${ids.tone}-err`)}
          />
          <FieldError id={`${ids.tone}-err`} message={firstError(fieldErrors, "tone")} />
        </div>
        <div>
          <label htmlFor={ids.constraints} className="field-label">
            Contraintes
          </label>
          <textarea
            id={ids.constraints}
            className="input"
            rows={3}
            value={template.constraints}
            maxLength={2000}
            placeholder="Ex. six puces au plus par diapo, une source par chiffre"
            onChange={(e) => patch({ constraints: e.target.value })}
            {...errorProps(fieldErrors, "constraints", `${ids.constraints}-err`)}
          />
          <FieldError id={`${ids.constraints}-err`} message={firstError(fieldErrors, "constraints")} />
        </div>
      </div>

      <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t border-border bg-bg/95 px-1 py-3 backdrop-blur">
        <FormStatus state={status} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" aria-disabled={pending || undefined}>
            <ButtonLabel idle="Enregistrer le gabarit" busy="Enregistrement…" isBusy={pending} />
          </button>
          {dirty ? (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  if (pending) return;
                  setTemplate(saved);
                  setFieldErrors({});
                  setStatus(IDLE);
                }}
                aria-disabled={pending || undefined}
              >
                Annuler les modifications
              </button>
              <span className="text-sm text-muted">Modifications non enregistrées</span>
            </>
          ) : null}
        </div>
      </div>
    </form>
  );
}
