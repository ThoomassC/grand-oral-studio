"use client";

import { useId, useRef, useState, useTransition } from "react";
import { LIMITS, SlideSchema, type DeckSpec, type Slide } from "@/domain/schemas";
import { updateDeckSlide } from "@/server/actions/decks";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FieldError } from "@/components/ui/FieldError";
import { countFieldErrors, focusFirstInvalid, focusLater, invalidCountMessage } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { isToComplete } from "./EngineBadge";

const MAX_BULLETS = LIMITS.bullets;
const MAX_BULLET_CHARS = LIMITS.bullet;

let bulletKey = 0;
const nextKey = () => {
  bulletKey += 1;
  return `b${bulletKey}`;
};

interface BulletDraft {
  key: string;
  text: string;
}

/** Édition d'une diapo : titre, sous-titre, puces (une par champ), notes d'orateur. */
export function SlideEditor({
  deckId,
  index,
  slide,
  expectedUpdatedAt,
  onSaved,
  onCancel,
}: {
  deckId: string;
  index: number;
  slide: Slide;
  /** Version du deck sur laquelle porte l'édition (contrôle de conflit côté serveur). */
  expectedUpdatedAt: string;
  onSaved: (next: { spec: DeckSpec; updatedAt: string }) => void;
  onCancel: () => void;
}) {
  const baseId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState(slide.title);
  const [subtitle, setSubtitle] = useState(slide.subtitle);
  const [bullets, setBullets] = useState<BulletDraft[]>(() => slide.bullets.map((text) => ({ key: nextKey(), text })));
  const [notes, setNotes] = useState(slide.notes);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<{ message: string; reload: boolean } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [pending, startTransition] = useTransition();

  const values = bullets.map((b) => b.text.trim()).filter(Boolean);
  const dirty =
    title !== slide.title ||
    subtitle !== slide.subtitle ||
    notes !== slide.notes ||
    JSON.stringify(bullets.map((b) => b.text)) !== JSON.stringify(slide.bullets);
  const full = bullets.length >= MAX_BULLETS;

  const ids = {
    title: `${baseId}-title`,
    subtitle: `${baseId}-subtitle`,
    bullets: `${baseId}-bullets`,
    notes: `${baseId}-notes`,
    add: `${baseId}-add`,
    keep: `${baseId}-keep`,
    bullet: (key: string) => `${baseId}-bullet-${key}`,
  };

  function requestCancel() {
    if (pending) return;
    if (dirty) {
      setConfirmDiscard(true);
      focusLater([ids.keep]);
      return;
    }
    onCancel();
  }

  function addBullet() {
    if (full) return;
    const key = nextKey();
    setBullets((b) => [...b, { key, text: "" }]);
    focusLater([ids.bullet(key)]);
  }

  function removeBullet(i: number) {
    const rest = bullets.filter((_, j) => j !== i);
    setBullets(rest);
    setAnnounce(`Puce ${i + 1} retirée.`);
    const neighbour = rest[Math.min(i, rest.length - 1)];
    focusLater([neighbour ? ids.bullet(neighbour.key) : null, ids.add]);
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const candidate = { ...slide, title, subtitle, bullets: values, notes };
    const checked = validateWith(SlideSchema, candidate);
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setError({ message: invalidCountMessage(countFieldErrors(checked.fieldErrors)), reload: false });
      focusFirstInvalid(formRef.current);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      try {
        const result = await updateDeckSlide(deckId, index, checked.data, expectedUpdatedAt);
        if (!result.ok) {
          const errors = result.fieldErrors ?? {};
          setFieldErrors(errors);
          const hasFieldErrors = countFieldErrors(errors) > 0;
          // Sans erreur de champ, le refus vient de l'état du deck (modifié ailleurs) : on propose de recharger.
          setError({ message: result.error, reload: !hasFieldErrors });
          if (hasFieldErrors) focusFirstInvalid(formRef.current);
          return;
        }
        onSaved({ spec: result.data.spec, updatedAt: result.data.updatedAt });
      } catch {
        setError({ message: "La connexion a été interrompue. Vos modifications sont conservées : réessayez.", reload: false });
      }
    });
  }

  /** Erreur d'une puce : on remappe l'index des valeurs non vides vers les champs. */
  function bulletError(i: number): string | undefined {
    const draft = bullets[i];
    if (!draft || !draft.text.trim()) return undefined;
    const valueIndex = bullets.slice(0, i).filter((b) => b.text.trim()).length;
    if (draft.text.trim().length > MAX_BULLET_CHARS) return `${MAX_BULLET_CHARS} caractères au plus.`;
    return firstError(fieldErrors, `bullets.${valueIndex}`);
  }

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={save}
      className="flex flex-col gap-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          if (confirmDiscard) setConfirmDiscard(false);
          else requestCancel();
        }
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
          maxLength={LIMITS.slideTitle}
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
          maxLength={LIMITS.slideSubtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          {...errorProps(fieldErrors, "subtitle", `${ids.subtitle}-err`)}
        />
        <FieldError id={`${ids.subtitle}-err`} message={firstError(fieldErrors, "subtitle")} />
      </div>

      <fieldset aria-describedby={`${ids.bullets}-hint`}>
        <legend className="field-label">Puces</legend>
        <p id={`${ids.bullets}-hint`} className="field-hint mt-0 mb-2">
          {bullets.length}/{MAX_BULLETS} puces, {MAX_BULLET_CHARS} caractères au plus chacune. Les puces vides sont ignorées.
        </p>
        <ol className="flex flex-col gap-2">
          {bullets.map((b, i) => {
            const err = bulletError(i);
            const id = ids.bullet(b.key);
            const length = b.text.trim().length;
            return (
              <li key={b.key}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <label htmlFor={id} className="sr-only">
                      Puce {i + 1}
                    </label>
                    <input
                      id={id}
                      className={`input ${isToComplete(b.text) ? "bg-highlight-soft" : ""}`}
                      value={b.text}
                      onChange={(e) => {
                        const text = e.target.value;
                        setBullets((all) => all.map((x) => (x.key === b.key ? { ...x, text } : x)));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addBullet();
                        }
                      }}
                      aria-invalid={Boolean(err)}
                      aria-describedby={`${id}-count${err ? ` ${id}-err` : ""}`}
                    />
                    <p
                      id={`${id}-count`}
                      className={`field-hint tabular-nums ${length > MAX_BULLET_CHARS ? "font-semibold text-danger" : ""}`}
                    >
                      {length}/{MAX_BULLET_CHARS} caractères
                    </p>
                    <FieldError id={`${id}-err`} message={err} />
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={() => removeBullet(i)}
                    aria-label={`Retirer la puce ${i + 1}`}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <button
          id={ids.add}
          type="button"
          className="btn btn-secondary btn-sm mt-2"
          onClick={addBullet}
          aria-disabled={full || undefined}
          aria-describedby={full ? `${ids.add}-full` : undefined}
        >
          Ajouter une puce
        </button>
        {full ? (
          <p id={`${ids.add}-full`} className="field-hint">
            Limite de {MAX_BULLETS} puces atteinte.
          </p>
        ) : null}
        <FieldError id={`${ids.bullets}-err`} message={firstError(fieldErrors, "bullets")} />
      </fieldset>

      <div>
        <label htmlFor={ids.notes} className="field-label">
          Notes d&apos;orateur
        </label>
        <textarea
          id={ids.notes}
          className="input"
          rows={5}
          value={notes}
          maxLength={LIMITS.notes}
          onChange={(e) => setNotes(e.target.value)}
          {...errorProps(fieldErrors, "notes", `${ids.notes}-err`)}
        />
        <FieldError id={`${ids.notes}-err`} message={firstError(fieldErrors, "notes")} />
      </div>

      <LiveRegion>{announce}</LiveRegion>
      <LiveRegion role="alert">
        {error ? (
          <div className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
            <p className="font-medium">{error.message}</p>
            {error.reload ? (
              <>
                <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => window.location.reload()}>
                  Recharger le diaporama
                </button>
                <p className="mt-1 text-muted">Le rechargement abandonne les modifications non enregistrées de cette diapo.</p>
              </>
            ) : null}
          </div>
        ) : null}
      </LiveRegion>

      {confirmDiscard ? (
        <div role="alertdialog" aria-labelledby={`${baseId}-discard`} className="rounded-lg border border-warning/60 bg-warning-soft p-3">
          <p id={`${baseId}-discard`} className="text-sm font-medium">
            Abandonner vos modifications de la diapo {index + 1} ?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-danger-ghost btn-sm" onClick={onCancel}>
              Abandonner
            </button>
            <button
              id={ids.keep}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setConfirmDiscard(false);
                focusLater([ids.title]);
              }}
            >
              Continuer l&apos;édition
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" aria-disabled={pending || undefined}>
          <ButtonLabel idle="Enregistrer la diapo" busy="Enregistrement…" isBusy={pending} />
        </button>
        <button type="button" className="btn btn-secondary" onClick={requestCancel} aria-disabled={pending || undefined}>
          Annuler
        </button>
      </div>
    </form>
  );
}
