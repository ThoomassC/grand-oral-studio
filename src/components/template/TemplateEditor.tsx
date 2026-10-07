"use client";

import { SelectInput, TextArea, TextInput } from "@/components/ui/Field";
import { Button } from "@thomascaron/opale-ui";
import { useId, useImperativeHandle, useRef, useState, useTransition, type Ref } from "react";
import { defaultTemplate } from "@/domain/defaults";
import { LIMITS, PromptTemplateSchema, type PromptTemplate, type Section } from "@/domain/schemas";
import { formatSeconds, slideBudgetWarning, suggestSlideCount, totalSlides } from "@/domain/slides";
import { updateTemplate } from "@/server/actions/programs";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { useUnsavedChanges } from "@/components/layout/UnsavedChanges";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FieldError } from "@/components/ui/FieldError";
import { countFieldErrors, focusFirstInvalid, focusLater, invalidCountMessage } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import {
  draftSignature,
  durationSummary,
  durationTexts,
  lineRangeLabels,
  withDurations,
  type DurationTexts,
} from "./lines";

const MAX_SECTIONS = LIMITS.maxSections;

let sectionCounter = 0;
function newSectionId(): string {
  sectionCounter += 1;
  return `s${Date.now().toString(36)}${sectionCounter}`;
}

function toNumber(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}

/** Pilotage de l'éditeur depuis l'import (« Appliquer à la trame »). */
export interface TemplateEditorHandle {
  /**
   * Remplit le formulaire avec une trame importée (durées comprises), SANS
   * l'enregistrer : le formulaire devient « modifié » (garde de navigation)
   * et le focus va au titre de l'éditeur.
   */
  applyImport(imported: PromptTemplate): void;
}

/** Libellé d'une ligne pour les annonces et les boutons : « ligne 2 (Contexte) ». */
function lineName(index: number, section: Section): string {
  const title = section.title.trim();
  return title ? `la ligne ${index + 1} (${title})` : `la ligne ${index + 1}`;
}

export function TemplateEditor({
  programId,
  initialTemplate,
  savedAt,
  ref,
}: {
  programId: string;
  initialTemplate: PromptTemplate;
  /**
   * Version enregistrée reçue du serveur (templateSavedAt, ISO ; null = jamais enregistrée),
   * renvoyée à chaque enregistrement pour détecter une trame modifiée entre-temps
   * (autre onglet, autre membre). Absente : pas de contrôle.
   */
  savedAt?: string | null;
  ref?: Ref<TemplateEditorHandle>;
}) {
  const [saved, setSaved] = useState<PromptTemplate>(initialTemplate);
  // Jeton de concurrence optimiste : la version reçue au chargement, puis celle que renvoie
  // chaque enregistrement. Une nouvelle version venue du serveur n'est reprise que si son
  // contenu est celui que l'éditeur tient pour enregistré ; sinon l'enregistrement suivant
  // est refusé (conflit) au lieu d'écraser l'autre version.
  const [version, setVersion] = useState(savedAt);
  const [serverVersion, setServerVersion] = useState(savedAt);
  if (savedAt !== serverVersion) {
    setServerVersion(savedAt);
    if (JSON.stringify(initialTemplate) === JSON.stringify(saved)) setVersion(savedAt);
  }
  const [template, setTemplate] = useState<PromptTemplate>(initialTemplate);
  /** Saisie des champs « Durée », convertie en secondes à l'enregistrement seulement. */
  const [durations, setDurations] = useState<DurationTexts>(() => durationTexts(initialTemplate));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [announce, setAnnounce] = useState("");
  const [pending, startTransition] = useTransition();
  const baseId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  const dirty = draftSignature(template, durations) !== draftSignature(saved, durationTexts(saved));
  useUnsavedChanges(dirty);
  const durationOk = Number.isFinite(template.durationMinutes) && template.durationMinutes >= 3;
  const slidesOk = template.sections.every((s) => Number.isFinite(s.slides));
  const total = slidesOk ? totalSlides(template) : null;
  const suggested = durationOk ? suggestSlideCount(template.durationMinutes) : null;
  const budgetWarning = total !== null && durationOk ? slideBudgetWarning(total, template.durationMinutes) : null;
  const ranges = lineRangeLabels(template.sections);
  const timing = durationSummary(template, durations);

  /** Pied : « 13 diapos · 20 min », puis les durées fixées si au moins une ligne en a. */
  const footerParts = [
    `${total ?? "—"} diapos`,
    `${Number.isFinite(template.durationMinutes) ? template.durationMinutes : "—"} min`,
  ];
  if (timing) {
    const over = Number.isFinite(timing.total) && timing.fixed > timing.total;
    footerParts.push(
      `Durées fixées : ${formatSeconds(timing.fixed)} sur ${Number.isFinite(timing.total) ? formatSeconds(timing.total) : "—"}` +
        (over ? " (dépasse la durée de l'oral)" : ""),
    );
  }

  useImperativeHandle(ref, () => ({
    applyImport(imported) {
      setTemplate(imported);
      setDurations(durationTexts(imported));
      setFieldErrors({});
      setAnnounce("");
      setStatus({ kind: "success", message: "Trame importée dans le formulaire : vérifiez puis enregistrez." });
      // Après le rendu : l'aperçu d'import, au-dessus, disparaît dans le même lot et décalerait la page.
      window.setTimeout(() => headingRef.current?.focus(), 0);
    },
  }));

  function patch(next: Partial<PromptTemplate>) {
    setTemplate((t) => ({ ...t, ...next }));
    setStatus(IDLE);
  }

  function patchSection(index: number, next: Partial<Section>) {
    setTemplate((t) => ({ ...t, sections: t.sections.map((s, i) => (i === index ? { ...s, ...next } : s)) }));
    setStatus(IDLE);
  }

  function setDuration(sectionId: string, text: string) {
    setDurations((d) => ({ ...d, [sectionId]: text }));
    setStatus(IDLE);
  }

  function moveSection(index: number, dir: -1 | 1) {
    const target = index + dir;
    const moved = template.sections[index];
    if (!moved || target < 0 || target >= template.sections.length) return;
    const sections = [...template.sections];
    sections.splice(index, 1);
    sections.splice(target, 0, moved);
    // Les erreurs sont indexées par position : elles ne suivraient pas la ligne déplacée.
    setFieldErrors({});
    patch({ sections });
    setAnnounce(`Ligne « ${moved.title || "sans titre"} » déplacée en position ${target + 1}.`);
    const atEdge = target === 0 || target === sections.length - 1;
    const focusDir = atEdge ? (dir === -1 ? "down" : "up") : dir === -1 ? "up" : "down";
    focusLater([`${baseId}-${focusDir}-${moved.id}`]);
  }

  function removeSection(index: number) {
    const removed = template.sections[index];
    if (!removed) return;
    const sections = template.sections.filter((_, i) => i !== index);
    setFieldErrors({});
    patch({ sections });
    setAnnounce(`Ligne « ${removed.title || "sans titre"} » supprimée.`);
    const neighbour = sections[Math.min(index, sections.length - 1)];
    focusLater([neighbour ? `${baseId}-title-${neighbour.id}` : null, `${baseId}-add`]);
  }

  function addSection() {
    const id = newSectionId();
    patch({ sections: [...template.sections, { id, title: "Nouvelle ligne", guidance: "", slides: 1 }] });
    setDurations((d) => ({ ...d, [id]: "" }));
    setAnnounce("Ligne ajoutée en fin de trame.");
    focusLater([`${baseId}-title-${id}`], { select: true });
  }

  /**
   * Revient à la trame enregistrée. Le bouton « Annuler » disparaît avec les
   * modifications : le focus passe à « Enregistrer la trame », juste à côté,
   * plutôt que de retomber sur la page, et l'annulation est annoncée.
   */
  function discardChanges() {
    if (pending) return;
    setTemplate(saved);
    setDurations(durationTexts(saved));
    setFieldErrors({});
    setAnnounce("");
    setStatus({ kind: "success", message: "Modifications annulées." });
    saveRef.current?.focus();
  }

  function reset() {
    const fresh = defaultTemplate();
    setTemplate(fresh);
    setDurations(durationTexts(fresh));
    setFieldErrors({});
    setStatus({ kind: "success", message: "Trame par défaut chargée. Enregistrez pour l'appliquer." });
  }

  /** Erreurs affichées : focus sur le premier champ invalide, sinon sur le message d'ensemble des lignes. */
  function showErrors(errors: FieldErrors) {
    setFieldErrors(errors);
    const fieldKeys = Object.keys(errors).filter((k) => k !== "sections" && k !== "_form");
    if (fieldKeys.length > 0) focusFirstInvalid(formRef.current);
    else if (firstError(errors, "sections")) focusLater([`${baseId}-sections-err-box`]);
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const { template: candidate, errors: durationErrors } = withDurations(template, durations);
    const checked = validateWith(PromptTemplateSchema, candidate);
    const errors: FieldErrors = { ...(checked.ok ? {} : checked.fieldErrors), ...durationErrors };
    if (!checked.ok || countFieldErrors(durationErrors) > 0) {
      setStatus({ kind: "error", message: invalidCountMessage(countFieldErrors(errors)) });
      showErrors(errors);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      try {
        const result = await updateTemplate(programId, checked.data, version);
        if (!result.ok) {
          const serverErrors = result.fieldErrors ?? {};
          setStatus({ kind: "error", message: result.error });
          if (countFieldErrors(serverErrors) > 0) showErrors(serverErrors);
          else setFieldErrors(serverErrors);
          return;
        }
        setVersion(result.data.templateSavedAt);
        setSaved(checked.data);
        setTemplate(checked.data);
        // « 3 min » devient « 3:00 » : l'écriture enregistrée, sans changer la valeur.
        setDurations(durationTexts(checked.data));
        setStatus({ kind: "success", message: "Trame enregistrée." });
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
    guidanceHint: `${baseId}-guidance-hint`,
    durationHint: `${baseId}-duration-hint`,
  };

  return (
    <form ref={formRef} noValidate onSubmit={save} className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* Sous-bloc de la page Trame (h2) : h3. */}
          <h3 ref={headingRef} tabIndex={-1} className="text-2xl focus:outline-none">
            Diapos de la trame
          </h3>
          <p className="max-w-2xl text-sm text-muted">
            Format et durée de l&apos;oral, puis les lignes de la trame dans l&apos;ordre : titre, nombre de diapos,
            contenu type et durée.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost" size="small"
          onClick={() => {
            if (!pending) reset();
          }}
          aria-disabled={pending || undefined}
        >
          Revenir à la trame par défaut
        </Button>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <label htmlFor={ids.format} className="opale-field__label">
            Format
          </label>
          <SelectInput
            id={ids.format}
            value={template.format}
            onChange={(e) => patch({ format: e.target.value === "4:3" ? "4:3" : "16:9" })}
          >
            <option value="16:9">16:9 (écran large)</option>
            <option value="4:3">4:3 (standard)</option>
          </SelectInput>
        </div>
        <div>
          <label htmlFor={ids.language} className="opale-field__label">
            Langue des diapos
          </label>
          <SelectInput
            id={ids.language}
            value={template.language}
            onChange={(e) => patch({ language: e.target.value === "en" ? "en" : "fr" })}
          >
            <option value="fr">Français</option>
            <option value="en">Anglais</option>
          </SelectInput>
        </div>
        <div>
          <label htmlFor={ids.duration} className="opale-field__label">
            Durée de l&apos;oral (minutes)
          </label>
          <TextInput
            id={ids.duration}
            type="number"
            inputMode="numeric"
            min={3}
            max={90}
            value={Number.isFinite(template.durationMinutes) ? template.durationMinutes : ""}
            onChange={(e) => patch({ durationMinutes: toNumber(e.target.value) })}
            {...errorProps(fieldErrors, "durationMinutes", `${ids.duration}-err`)}
          />
          <FieldError id={`${ids.duration}-err`} message={firstError(fieldErrors, "durationMinutes")} />
        </div>
      </div>

      <div id={ids.summary} className={`rounded-lg border p-4 ${budgetWarning ? "border-warning/60 bg-warning-soft" : "border-border bg-surface-2"}`}>
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
          {budgetWarning ? `Attention — ${budgetWarning}` : null}
        </LiveRegion>
      </div>

      <fieldset>
        <legend className="text-lg font-semibold">Lignes</legend>
        <p className="text-sm text-muted">
          Une ligne par partie de l&apos;oral, dans l&apos;ordre. Pour donner un contenu différent à deux diapos, faites
          deux lignes.
        </p>
        <ul className="mt-1 flex flex-col gap-0.5 text-sm text-muted">
          <li>
            <span className="font-semibold">Contenu type</span> :{" "}
            <span id={ids.guidanceHint}>
              Ce que disent ces diapos ; le jour J, ce contenu est développé pour la problématique.
            </span>
          </li>
          <li>
            <span className="font-semibold">Durée</span> :{" "}
            <span id={ids.durationHint}>
              facultative, au format minutes:secondes (3:30) ; vide, la ligne reçoit une part égale du temps restant.
            </span>
          </li>
        </ul>
        <div id={`${baseId}-sections-err-box`} tabIndex={-1} className="focus:outline-none">
          <FieldError id={`${baseId}-sections-err`} message={firstError(fieldErrors, "sections")} />
        </div>
        <LiveRegion>{announce}</LiveRegion>
        <ol className="mt-4 flex flex-col gap-3">
          <li className="opale-card opale-card--e0 block border-dashed p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="num shrink-0 text-sm font-bold">Diapo 1</span>
              <p>
                <span className="font-semibold">Couverture</span>
                <span className="text-muted">
                  {" — "}La problématique tirée et le titre du sujet. Ajoutée automatiquement.
                </span>
              </p>
            </div>
          </li>
          {template.sections.map((section, index) => {
            const p = `sections.${index}`;
            const n = index + 1;
            const titleId = `${baseId}-title-${section.id}`;
            const slidesId = `${baseId}-slides-${section.id}`;
            const guidanceId = `${baseId}-guidance-${section.id}`;
            const secondsId = `${baseId}-seconds-${section.id}`;
            const range = ranges[index];
            const name = lineName(index, section);
            return (
              <li key={section.id} className="opale-card opale-card--e1 block p-4">
                <fieldset className="flex flex-col gap-4 md:flex-row md:items-start">
                  <legend className="sr-only">
                    Ligne {n}
                    {range ? `, ${range.toLowerCase()}` : ""}
                  </legend>
                  <span
                    aria-hidden="true"
                    className="num flex h-8 shrink-0 items-center justify-center rounded-sm border border-border-strong px-2 text-sm font-bold md:min-w-24"
                  >
                    {range ?? `Ligne ${n}`}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
                    <div>
                      <label htmlFor={titleId} className="opale-field__label">
                        Titre<span className="sr-only"> de la ligne {n}</span>
                      </label>
                      <TextInput
                        id={titleId}
                        value={section.title}
                        maxLength={80}
                        onChange={(e) => patchSection(index, { title: e.target.value })}
                        {...errorProps(fieldErrors, `${p}.title`, `${titleId}-err`)}
                      />
                      <FieldError id={`${titleId}-err`} message={firstError(fieldErrors, `${p}.title`)} />
                    </div>
                    <div>
                      <label htmlFor={slidesId} className="opale-field__label">
                        Nombre de diapos<span className="sr-only"> de la ligne {n}</span>
                      </label>
                      <TextInput
                        id={slidesId}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={LIMITS.maxSlidesPerSection}
                        value={Number.isFinite(section.slides) ? section.slides : ""}
                        onChange={(e) => patchSection(index, { slides: toNumber(e.target.value) })}
                        {...errorProps(fieldErrors, `${p}.slides`, `${slidesId}-err`)}
                      />
                      <FieldError id={`${slidesId}-err`} message={firstError(fieldErrors, `${p}.slides`)} />
                    </div>
                    <div>
                      <label htmlFor={secondsId} className="opale-field__label">
                        Durée<span className="sr-only"> de la ligne {n}</span>
                      </label>
                      <TextInput
                        id={secondsId}
                        inputMode="text"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="auto"
                        className="num"
                        value={durations[section.id] ?? ""}
                        onChange={(e) => setDuration(section.id, e.target.value)}
                        {...errorProps(fieldErrors, `${p}.seconds`, `${secondsId}-err`, ids.durationHint)}
                      />
                      <FieldError id={`${secondsId}-err`} message={firstError(fieldErrors, `${p}.seconds`)} />
                    </div>
                    <div className="sm:col-span-3">
                      <label htmlFor={guidanceId} className="opale-field__label">
                        Contenu type<span className="sr-only"> de la ligne {n}</span>
                      </label>
                      <TextArea
                        id={guidanceId}
                        rows={2}
                        maxLength={600}
                        value={section.guidance}
                        onChange={(e) => patchSection(index, { guidance: e.target.value })}
                        {...errorProps(fieldErrors, `${p}.guidance`, `${guidanceId}-err`, ids.guidanceHint)}
                      />
                      <FieldError id={`${guidanceId}-err`} message={firstError(fieldErrors, `${p}.guidance`)} />
                    </div>
                  </div>
                  <div className="flex gap-1 md:flex-col" role="group" aria-label={`Actions pour ${name}`}>
                    <Button
                      id={`${baseId}-up-${section.id}`}
                      type="button"
                      variant="ghost" className="opale-icon-action-button"
                      onClick={() => moveSection(index, -1)}
                      disabled={index === 0}
                      aria-label={`Monter ${name}`}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
                        <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Button>
                    <Button
                      id={`${baseId}-down-${section.id}`}
                      type="button"
                      variant="ghost" className="opale-icon-action-button"
                      onClick={() => moveSection(index, 1)}
                      disabled={index === template.sections.length - 1}
                      aria-label={`Descendre ${name}`}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
                        <path d="M8 3v10M3.5 8.5L8 13l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost" className="danger-outline opale-icon-action-button"
                      onClick={() => removeSection(index)}
                      disabled={template.sections.length <= 1}
                      aria-label={`Supprimer ${name}`}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
                        <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Button>
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ol>
        <Button
          id={`${baseId}-add`}
          type="button"
          variant="ghost" className="mt-3"
          onClick={addSection}
          disabled={template.sections.length >= MAX_SECTIONS}
        >
          Ajouter une ligne
        </Button>
        {template.sections.length >= MAX_SECTIONS ? (
          <p className="opale-field__helper">{MAX_SECTIONS} lignes au plus.</p>
        ) : null}
      </fieldset>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label htmlFor={ids.tone} className="opale-field__label">
            Ton
          </label>
          <TextInput
            id={ids.tone}
            value={template.tone}
            maxLength={200}
            placeholder="Ex. clair, argumenté, niveau master"
            onChange={(e) => patch({ tone: e.target.value })}
            {...errorProps(fieldErrors, "tone", `${ids.tone}-err`)}
          />
          <FieldError id={`${ids.tone}-err`} message={firstError(fieldErrors, "tone")} />
        </div>
        <div>
          <label htmlFor={ids.constraints} className="opale-field__label">
            Contraintes
          </label>
          <TextArea
            id={ids.constraints}
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
        <p className="num text-sm text-muted">{footerParts.join(" · ")}</p>
        <FormStatus state={status} />
        <div className="flex flex-wrap items-center gap-3">
          <Button ref={saveRef} type="submit" aria-disabled={pending || undefined}>
            <ButtonLabel idle="Enregistrer la trame" busy="Enregistrement…" isBusy={pending} />
          </Button>
          {dirty ? (
            <>
              <Button
                type="button"
                variant="text"
                onClick={discardChanges}
                aria-disabled={pending || undefined}
              >
                Annuler les modifications
              </Button>
              <span className="text-sm text-muted">Modifications non enregistrées</span>
            </>
          ) : null}
        </div>
      </div>
    </form>
  );
}
