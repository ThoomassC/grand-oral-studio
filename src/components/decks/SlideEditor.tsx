"use client";

import { useId, useState, useTransition } from "react";
import { SlideSchema, type DeckSpec, type Slide } from "@/domain/schemas";
import { updateDeckSlide } from "@/server/actions/decks";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { FieldError } from "@/components/ui/FieldError";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";

const MAX_BULLETS = 8;

/** Édition d'une diapo : titre, sous-titre, puces (une par ligne), notes d'orateur. */
export function SlideEditor({
  deckId,
  index,
  slide,
  onSaved,
  onCancel,
}: {
  deckId: string;
  index: number;
  slide: Slide;
  onSaved: (spec: DeckSpec) => void;
  onCancel: () => void;
}) {
  const baseId = useId();
  const [title, setTitle] = useState(slide.title);
  const [subtitle, setSubtitle] = useState(slide.subtitle);
  const [bulletsText, setBulletsText] = useState(slide.bullets.join("\n"));
  const [notes, setNotes] = useState(slide.notes);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [pending, startTransition] = useTransition();

  const bullets = bulletsText
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);
  const bulletError =
    firstError(fieldErrors, "bullets") ??
    Object.entries(fieldErrors)
      .filter(([k]) => k.startsWith("bullets."))
      .map(([k, v]) => `Puce ${Number(k.split(".")[1]) + 1} : ${v[0]}`)[0];

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const candidate = { ...slide, title, subtitle, bullets, notes };
    const checked = validateWith(SlideSchema, candidate);
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setStatus({ kind: "error", message: "Corrigez les champs signalés." });
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateDeckSlide(deckId, index, checked.data);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setStatus({ kind: "error", message: result.error });
        return;
      }
      onSaved(result.data.spec);
    });
  }

  const ids = {
    title: `${baseId}-title`,
    subtitle: `${baseId}-subtitle`,
    bullets: `${baseId}-bullets`,
    notes: `${baseId}-notes`,
  };

  return (
    <form
      noValidate
      onSubmit={save}
      className="flex flex-col gap-4"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) onCancel();
      }}
    >
      <div>
        <label htmlFor={ids.title} className="field-label">
          Titre
        </label>
        <input
          id={ids.title}
          className="input"
          value={title}
          maxLength={140}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          {...errorProps(fieldErrors, "title", `${ids.title}-err`)}
        />
        <FieldError id={`${ids.title}-err`} message={firstError(fieldErrors, "title")} />
      </div>
      <div>
        <label htmlFor={ids.subtitle} className="field-label">
          Sous-titre <span className="font-normal text-muted">(facultatif)</span>
        </label>
        <input
          id={ids.subtitle}
          className="input"
          value={subtitle}
          maxLength={200}
          onChange={(e) => setSubtitle(e.target.value)}
          {...errorProps(fieldErrors, "subtitle", `${ids.subtitle}-err`)}
        />
        <FieldError id={`${ids.subtitle}-err`} message={firstError(fieldErrors, "subtitle")} />
      </div>
      <div>
        <label htmlFor={ids.bullets} className="field-label">
          Puces <span className="font-normal text-muted">(une par ligne)</span>
        </label>
        <textarea
          id={ids.bullets}
          className="input"
          rows={Math.min(8, Math.max(3, bullets.length + 1))}
          value={bulletsText}
          onChange={(e) => setBulletsText(e.target.value)}
          aria-invalid={Boolean(bulletError)}
          aria-describedby={`${ids.bullets}-hint${bulletError ? ` ${ids.bullets}-err` : ""}`}
        />
        <p id={`${ids.bullets}-hint`} className={`field-hint ${bullets.length > MAX_BULLETS ? "font-semibold text-danger" : ""}`}>
          {bullets.length}/{MAX_BULLETS} puces, 300 caractères au plus chacune.
        </p>
        <FieldError id={`${ids.bullets}-err`} message={bulletError} />
      </div>
      <div>
        <label htmlFor={ids.notes} className="field-label">
          Notes d&apos;orateur
        </label>
        <textarea
          id={ids.notes}
          className="input"
          rows={5}
          value={notes}
          maxLength={3000}
          onChange={(e) => setNotes(e.target.value)}
          {...errorProps(fieldErrors, "notes", `${ids.notes}-err`)}
        />
        <FieldError id={`${ids.notes}-err`} message={firstError(fieldErrors, "notes")} />
      </div>
      <FormStatus state={status} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer la diapo"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
          Annuler
        </button>
      </div>
    </form>
  );
}
