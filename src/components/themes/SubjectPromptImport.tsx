"use client";

import { Button, Checkbox, Dropzone, FileCard } from "@thomascaron/opale-ui";
import { useId, useRef, useState, useTransition } from "react";
import type { Brand, PromptTemplate, ThemeInput } from "@/domain/schemas";
import { analyzeThemePrompt, importThemeList } from "@/server/actions/imports";
import { updateBrand } from "@/server/actions/programs";
import { BrandPreview, mergeImportedBrand } from "@/components/brand/BrandPreview";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { stepHref } from "@/components/projects/steps";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { TextArea } from "@/components/ui/Field";
import { FieldError } from "@/components/ui/FieldError";
import { FocusOnMount } from "@/components/ui/FocusOnMount";
import { formatCount, formatFileSize } from "@/components/ui/format";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Notice } from "@/components/ui/Notice";
import { useCurrentLogo } from "./current-logo";
import { THEME_PROMPT_MAX_CHARS as PROMPT_MAX_CHARS, ThemePromptTextSchema } from "./prompt-schema";

type ThemePromptData = Extract<Awaited<ReturnType<typeof analyzeThemePrompt>>, { ok: true }>["data"];

/** Ce que l'import retient du texte : les sujets (page Sujets) ou l'apparence (page Apparence). */
export type ImportScope = "subjects" | "appearance";

type Phase =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "preview"; result: ThemePromptData }
  | { kind: "done"; outcome: Outcome };

type Outcome = { scope: "subjects"; created: number; skipped: number } | { scope: "appearance" };

type LoadedFile = { name: string; size: number };

/** Un fichier texte de 20 000 caractères pèse au plus ~80 Ko (UTF-8) : au-delà, inutile de le lire. */
const TEXT_FILE_MAX_BYTES = 256 * 1024;

const COPY: Record<
  ImportScope,
  { label: string; hint: string; example: string; previewTitle: string }
> = {
  subjects: {
    label: "Vos sujets ou vos consignes",
    hint:
      "Collez la liste de vos sujets, l'énoncé du grand oral ou les consignes de votre établissement : les sujets " +
      "sont repérés (numérotés, un par ligne, ou après « Sujets : »). Rien n'est envoyé à une IA.",
    example: "Grand oral de master. Sujets : 1. Cybersécurité 2. Transformation numérique 3. Intelligence artificielle.",
    previewTitle: "Sujets proposés",
  },
  appearance: {
    label: "Description de l'apparence",
    hint:
      "Collez un texte qui décrit vos couleurs (#1F3A5F, « bleu marine »…) et vos polices : elles sont repérées et " +
      "proposées dans un aperçu. Rien n'est envoyé à une IA.",
    example: "Couleurs : bleu marine #1F3A5F et jaune #F4AD15, fond blanc. Police des titres : Georgia, police du texte : Verdana.",
    previewTitle: "Apparence proposée",
  },
};

function subjectsWord(n: number): string {
  return `${n} sujet${n > 1 ? "s" : ""}`;
}

/** « 9 sujets importés, 1 déjà présent. » */
function subjectsSentence(created: number, skipped: number): string {
  let sentence = created === 0 ? "Aucun nouveau sujet importé" : `${subjectsWord(created)} importé${created > 1 ? "s" : ""}`;
  if (skipped > 0) sentence += `, ${skipped} déjà présent${skipped > 1 ? "s" : ""}`;
  return `${sentence}.`;
}

/**
 * « Depuis un prompt » : un texte (collé, ou lu d'un .txt / .md côté client)
 * → `analyzeThemePrompt` (lecture sans IA) → aperçu restreint au `scope` :
 *
 * - `subjects` : les sujets repérés, à cocher → `importThemeList` (les sujets
 *   déjà présents sont ignorés par le serveur) ;
 * - `appearance` : l'apparence repérée (couleurs, polices) → `updateBrand`,
 *   logo actuel conservé.
 *
 * Ce qui sort du `scope` n'est ni montré ni importé.
 */
export function SubjectPromptImport({
  programId,
  format,
  scope,
}: {
  programId: string;
  format: PromptTemplate["format"];
  scope: ImportScope;
}) {
  const copy = COPY[scope];
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [analyzing, startAnalyzing] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);
  /** Une réponse arrivée après une modification du texte ou « Annuler » est ignorée. */
  const requestRef = useRef(0);
  const baseId = useId();
  const ids = {
    text: `${baseId}-text`,
    hint: `${baseId}-hint`,
    count: `${baseId}-count`,
    preview: `${baseId}-preview-title`,
    done: `${baseId}-done`,
  };
  const tooLong = text.length > PROMPT_MAX_CHARS;

  function changeText(next: string) {
    requestRef.current += 1;
    setText(next);
    setFieldErrors({});
    setPhase({ kind: "idle" });
  }

  async function readFile(files: FileList) {
    const file = files[0];
    setFileError(null);
    if (!file) return;
    let content: string;
    try {
      content = await file.text();
    } catch {
      setFileError(`« ${file.name} » n'a pas pu être lu. Réessayez, ou collez son contenu dans le champ.`);
      return;
    }
    if (content.trim() === "") {
      setFileError(`« ${file.name} » est vide.`);
      return;
    }
    if (content.length > PROMPT_MAX_CHARS) {
      setFileError(
        `« ${file.name} » compte ${formatCount(content.length)} caractères : la limite est de ${formatCount(PROMPT_MAX_CHARS)}. Raccourcissez-le, ou collez-en un extrait.`,
      );
      return;
    }
    changeText(content);
    setLoaded({ name: file.name, size: file.size });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (analyzing) return;
    const checked = validateWith(ThemePromptTextSchema, { text });
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      textRef.current?.focus();
      return;
    }
    setFieldErrors({});
    const request = ++requestRef.current;
    setPhase({ kind: "idle" });
    startAnalyzing(async () => {
      let next: Phase;
      try {
        const result = await analyzeThemePrompt(programId, checked.data);
        if (!result.ok && result.fieldErrors?.text) {
          if (request !== requestRef.current) return;
          setFieldErrors({ text: result.fieldErrors.text });
          textRef.current?.focus();
          return;
        }
        next = result.ok ? { kind: "preview", result: result.data } : { kind: "error", message: result.error };
      } catch {
        next = { kind: "error", message: "La connexion a été interrompue. Votre texte est conservé : réessayez." };
      }
      if (request === requestRef.current) setPhase(next);
    });
  }

  function backToText() {
    requestRef.current += 1;
    setPhase({ kind: "idle" });
    textRef.current?.focus();
  }

  const textError = firstError(fieldErrors, "text");

  return (
    <div className="flex flex-col gap-4">
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <div>
            <label htmlFor={ids.text} className="opale-field__label">
              {copy.label}
            </label>
            <p id={ids.hint} className="opale-field__helper mb-1.5">
              {copy.hint}
            </p>
            <TextArea
              ref={textRef}
              id={ids.text}
              rows={6}
              value={text}
              onChange={(e) => {
                setLoaded(null);
                changeText(e.target.value);
              }}
              placeholder={`Ex. ${copy.example}`}
              {...errorProps(fieldErrors, "text", `${ids.text}-err`, `${ids.hint} ${ids.count}`)}
            />
            <p id={ids.count} className={`opale-field__helper num ${tooLong ? "font-semibold text-danger" : ""}`}>
              {formatCount(text.length)} / {formatCount(PROMPT_MAX_CHARS)} caractères
            </p>
            <FieldError id={`${ids.text}-err`} message={textError} />
          </div>
          <div className="flex flex-col gap-2">
            <Dropzone
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              multiple={false}
              maxSizeBytes={TEXT_FILE_MAX_BYTES}
              className="min-h-28 md:mt-7"
              onFiles={(files) => void readFile(files)}
              onError={() => setFileError(null)}
              labels={{
                select: "choisir un fichier",
                tooManyFiles: () => "Déposez un seul fichier à la fois.",
                fileTooLarge: () => "Le fichier est trop lourd pour un texte (256 Ko au plus).",
                typeRejected: "Seuls les fichiers texte .txt et .md sont acceptés.",
              }}
            >
              Ou déposez un fichier .txt ou .md
            </Dropzone>
            {loaded ? <FileCard name={loaded.name} fileSize={formatFileSize(loaded.size)} /> : null}
          </div>
        </div>
        <LiveRegion role="alert">{fileError ? <Notice tone="error">{fileError}</Notice> : null}</LiveRegion>
        <LiveRegion className="text-sm text-muted">
          {loaded && !fileError ? `Fichier « ${loaded.name} » chargé dans le champ.` : null}
        </LiveRegion>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" aria-disabled={analyzing || undefined}>
            <ButtonLabel idle="Analyser le prompt" busy="Analyse…" isBusy={analyzing} />
          </Button>
          <Button
            type="button"
            variant="text"
            aria-disabled={text !== "" || undefined}
            aria-describedby={text !== "" ? `${ids.text}-example-hint` : undefined}
            onClick={() => {
              if (text === "") changeText(copy.example);
            }}
          >
            Insérer un exemple
          </Button>
          {text !== "" ? (
            <span id={`${ids.text}-example-hint`} className="sr-only">
              Disponible quand le champ est vide.
            </span>
          ) : null}
          <LiveRegion className="text-sm font-medium">{analyzing ? "Analyse du texte…" : null}</LiveRegion>
        </div>
        <LiveRegion role="alert">
          {phase.kind === "error" ? <Notice tone="error">Analyse impossible : {phase.message}</Notice> : null}
        </LiveRegion>
      </form>

      {phase.kind === "preview" ? (
        <section aria-labelledby={ids.preview} className="border-t border-border pt-5">
          <FocusOnMount targetId={ids.preview} />
          <h3 id={ids.preview} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
            {copy.previewTitle}
          </h3>
          {scope === "subjects" ? (
            <SubjectsPreview
              programId={programId}
              themes={phase.result.themes}
              onBack={backToText}
              onDone={(created, skipped) => setPhase({ kind: "done", outcome: { scope, created, skipped } })}
            />
          ) : (
            <AppearancePreview
              programId={programId}
              format={format}
              result={phase.result}
              onBack={backToText}
              onDone={() => setPhase({ kind: "done", outcome: { scope: "appearance" } })}
            />
          )}
        </section>
      ) : null}

      <LiveRegion>
        {phase.kind === "done" ? <ImportOutcome id={ids.done} programId={programId} outcome={phase.outcome} /> : null}
      </LiveRegion>
    </div>
  );
}

function NothingFound({ title, help, onBack }: { title: string; help: string; onBack: () => void }) {
  return (
    <div className="mt-3">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{help}</p>
      <div className="mt-4">
        <Button type="button" variant="ghost" onClick={onBack}>
          Modifier le texte
        </Button>
      </div>
    </div>
  );
}

function ErrorNotice({ error }: { error: { message: string; details: string[] } | null }) {
  return (
    <LiveRegion role="alert" className="mt-4">
      {error ? (
        <Notice tone="error">
          <p>{error.message}</p>
          {error.details.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
    </LiveRegion>
  );
}

function SubjectsPreview({
  programId,
  themes,
  onBack,
  onDone,
}: {
  programId: string;
  themes: ThemeInput[];
  onBack: () => void;
  onDone: (created: number, skipped: number) => void;
}) {
  const [selected, setSelected] = useState<boolean[]>(() => themes.map(() => true));
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const baseId = useId();
  const blockedHintId = `${baseId}-blocked`;
  const chosen = themes.filter((_, i) => selected[i]);
  const blocked = chosen.length === 0;

  if (themes.length === 0) {
    return (
      <NothingFound
        title="Aucun sujet reconnu dans ce texte."
        help="Listez les sujets (« Sujets : 1. Cybersécurité 2. … », un par ligne ou numérotés), puis relancez l'analyse. Vous pouvez aussi les ajouter à la main ci-dessous."
        onBack={onBack}
      />
    );
  }

  function run() {
    if (pending || blocked) return;
    setError(null);
    startTransition(async () => {
      try {
        const imported = await importThemeList(programId, { themes: chosen });
        if (!imported.ok) {
          setError({ message: imported.error, details: Object.values(imported.fieldErrors ?? {}).flat() });
          return;
        }
        onDone(imported.data.created, imported.data.skipped);
      } catch {
        setError({ message: "La connexion a été interrompue. Rien n'a été importé : réessayez.", details: [] });
      }
    });
  }

  return (
    <>
      <p className="mt-1 text-sm text-muted">Rien n&apos;est encore importé.</p>
      <fieldset className="mt-4">
        <legend className="opale-field__label">
          Sujets trouvés <span className="num font-normal text-muted">({chosen.length} cochés sur {themes.length})</span>
        </legend>
        <p className="mb-2 text-sm text-muted">Décochez ceux à ne pas importer. Les sujets déjà présents seront ignorés.</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {themes.map((theme, i) => (
            <li key={`${theme.name}-${i}`} className="rounded-md border border-border p-2.5">
              <Checkbox
                label={theme.name}
                description={theme.description || undefined}
                checked={selected[i] ?? false}
                onChange={(e) => {
                  const value = e.target.checked;
                  setSelected((prev) => prev.map((v, j) => (j === i ? value : v)));
                }}
              />
            </li>
          ))}
        </ul>
      </fieldset>

      <ErrorNotice error={error} />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={run}
          aria-disabled={pending || blocked || undefined}
          aria-describedby={blocked ? blockedHintId : undefined}
        >
          <ButtonLabel idle={blocked ? "Importer les sujets" : `Importer ${subjectsWord(chosen.length)}`} busy="Import…" isBusy={pending} />
        </Button>
        <Button type="button" variant="text" onClick={onBack} aria-disabled={pending || undefined}>
          Annuler
        </Button>
        {blocked ? (
          <p id={blockedHintId} className="text-sm text-muted">
            Cochez au moins un sujet pour importer.
          </p>
        ) : null}
      </div>
    </>
  );
}

function AppearancePreview({
  programId,
  format,
  result,
  onBack,
  onDone,
}: {
  programId: string;
  format: PromptTemplate["format"];
  result: ThemePromptData;
  onBack: () => void;
  onDone: () => void;
}) {
  const currentLogo = useCurrentLogo();
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const { brand, brandNotes, brandFound } = result;

  if (brand === null) {
    return (
      <NothingFound
        title="Aucune couleur ni police reconnue dans ce texte."
        help="Indiquez les couleurs en hexadécimal (#1F3A5F) ou par leur nom (« bleu marine »), et les polices (« Police des titres : Georgia »), puis relancez l'analyse."
        onBack={onBack}
      />
    );
  }

  function run(target: Brand) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const saved = await updateBrand(programId, mergeImportedBrand(target, currentLogo));
        if (!saved.ok) {
          setError({ message: `L'apparence n'a pas été appliquée : ${saved.error}`, details: [] });
          return;
        }
        onDone();
      } catch {
        setError({ message: "L'apparence n'a pas été appliquée : la connexion a été interrompue. Réessayez.", details: [] });
      }
    });
  }

  return (
    <>
      <p className="mt-1 text-sm text-muted">
        Les éléments non précisés reprennent l&apos;apparence actuelle. Rien n&apos;est encore enregistré.
      </p>
      {brandFound.length > 0 ? (
        <div className="mt-4">
          <h4 className="opale-field__label">
            Éléments reconnus
          </h4>
          <ul className="flex flex-wrap gap-1.5" aria-label="Éléments reconnus">
            {brandFound.map((item) => (
              <li key={item} className="rounded-sm bg-surface-2 px-2 py-0.5 text-sm ring-1 ring-inset ring-border">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-5">
        <BrandPreview brand={brand} format={format} notes={brandNotes} />
      </div>

      <ErrorNotice error={error} />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => run(brand)} aria-disabled={pending || undefined}>
          <ButtonLabel idle="Appliquer l'apparence" busy="Application…" isBusy={pending} />
        </Button>
        <Button type="button" variant="text" onClick={onBack} aria-disabled={pending || undefined}>
          Annuler
        </Button>
      </div>
    </>
  );
}

function ImportOutcome({ id, programId, outcome }: { id: string; programId: string; outcome: Outcome }) {
  return (
    <div id={id} tabIndex={-1} className="flex flex-col gap-3 focus:outline-none">
      <FocusOnMount targetId={id} />
      {outcome.scope === "subjects" ? (
        <Notice tone="success">
          <p className="font-semibold text-success">{subjectsSentence(outcome.created, outcome.skipped)}</p>
          {outcome.created + outcome.skipped > 0 ? (
            <p className="mt-3">
              <ButtonLink href={stepHref(programId, "day")} size="small">
                Passer au Jour J<span aria-hidden="true"> →</span>
              </ButtonLink>
            </p>
          ) : null}
        </Notice>
      ) : (
        <Notice tone="success">
          <p className="font-semibold text-success">Apparence appliquée et enregistrée.</p>
          <p className="mt-1">Elle reste modifiable dans l&apos;éditeur ci-dessous.</p>
        </Notice>
      )}
    </div>
  );
}
