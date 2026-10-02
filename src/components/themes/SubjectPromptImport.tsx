"use client";

import { Badge, Button, Checkbox, Dropzone, FileCard } from "@thomascaron/opale-ui";
import { useId, useRef, useState, useTransition } from "react";
import type { Brand, PromptTemplate, ThemeInput } from "@/domain/schemas";
import { analyzeThemePrompt, importThemeList } from "@/server/actions/imports";
import { updateBrand } from "@/server/actions/programs";
import { BrandPreview, mergeImportedBrand } from "@/components/brand/BrandPreview";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { pageHref } from "@/components/projects/steps";
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

type Outcome = {
  /** Null quand aucun thème n'était coché (charte seule). */
  themes: { created: number; skipped: number } | null;
  /** `true` appliquée, une chaîne : la raison de l'échec, `null` : pas demandée. */
  brand: true | string | null;
};

type Phase =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "preview"; result: ThemePromptData }
  | { kind: "done"; outcome: Outcome };

type LoadedFile = { name: string; size: number };

/** Un fichier texte de 20 000 caractères pèse au plus ~80 Ko (UTF-8) : au-delà, inutile de le lire. */
const TEXT_FILE_MAX_BYTES = 256 * 1024;

const SOURCE_TEXT: Record<ThemePromptData["source"], string> = {
  ai: "Analysé par l'IA",
  free: "Analyse sans IA (mots-clés)",
};

const EXAMPLE =
  "Grand oral de master. Thèmes : 1. Cybersécurité 2. Transformation numérique 3. Intelligence artificielle. Couleurs : bleu marine #1F3A5F et jaune #F4AD15, police Georgia.";

function themesWord(n: number): string {
  return `${n} thème${n > 1 ? "s" : ""}`;
}

/** « 9 thèmes importés, 1 déjà présent. Charte appliquée. » */
function outcomeSentence({ themes, brand }: Outcome): string {
  const parts: string[] = [];
  if (themes) {
    const { created, skipped } = themes;
    let sentence = created === 0 ? "Aucun nouveau thème importé" : `${themesWord(created)} importé${created > 1 ? "s" : ""}`;
    if (skipped > 0) sentence += `, ${skipped} déjà présent${skipped > 1 ? "s" : ""}`;
    parts.push(`${sentence}.`);
  }
  if (brand === true) parts.push("Charte appliquée.");
  return parts.join(" ");
}

function submitLabel(count: number, withBrand: boolean): string {
  if (count > 0 && withBrand) return `Importer ${themesWord(count)} et appliquer la charte`;
  if (count > 0) return `Importer ${themesWord(count)}`;
  if (withBrand) return "Appliquer la charte";
  return "Importer les thèmes";
}

/**
 * Mode « Depuis un prompt » : un texte (collé, ou lu d'un .txt / .md côté
 * client) → `analyzeThemePrompt` → aperçu (thèmes à cocher, charte déduite)
 * → `importThemeList` avec les thèmes cochés, puis `updateBrand` si la charte
 * est retenue. Les thèmes déjà présents sont ignorés par le serveur.
 */
export function SubjectPromptImport({
  programId,
  format,
}: {
  programId: string;
  format: PromptTemplate["format"];
}) {
  const currentLogo = useCurrentLogo();
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
        next = result.ok
          ? { kind: "preview", result: result.data }
          : { kind: "error", message: result.error };
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
              Votre sujet ou vos consignes
            </label>
            <p id={ids.hint} className="opale-field__helper mb-1.5">
              Collez la liste des thèmes, l&apos;énoncé du grand oral ou les consignes de votre établissement : les thèmes,
              les couleurs (#1F3A5F…) et les polices sont repérés. Analyse par l&apos;IA si votre moteur le permet, sinon
              par mots-clés (gratuit).
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
              placeholder={`Ex. ${EXAMPLE}`}
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
              if (text === "") changeText(EXAMPLE);
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
        <ThemePromptPreview
          titleId={ids.preview}
          programId={programId}
          currentLogo={currentLogo}
          format={format}
          result={phase.result}
          onBack={backToText}
          onDone={(outcome) => setPhase({ kind: "done", outcome })}
        />
      ) : null}

      <LiveRegion>
        {phase.kind === "done" ? <ImportOutcome id={ids.done} programId={programId} outcome={phase.outcome} /> : null}
      </LiveRegion>
    </div>
  );
}

function ThemePromptPreview({
  titleId,
  programId,
  currentLogo,
  format,
  result,
  onBack,
  onDone,
}: {
  titleId: string;
  programId: string;
  currentLogo: string | null;
  format: PromptTemplate["format"];
  result: ThemePromptData;
  onBack: () => void;
  onDone: (outcome: Outcome) => void;
}) {
  const { themes, brand, brandNotes, found, source, fallbackReason } = result;
  const [selected, setSelected] = useState<boolean[]>(() => themes.map(() => true));
  const [withBrand, setWithBrand] = useState(brand !== null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const baseId = useId();
  const blockedHintId = `${baseId}-blocked`;
  const chosen: ThemeInput[] = themes.filter((_, i) => selected[i]);
  const applyBrand = brand !== null && withBrand;
  const nothingFound = themes.length === 0 && brand === null;
  const blocked = chosen.length === 0 && !applyBrand;

  function run() {
    if (pending || blocked) return;
    setError(null);
    startTransition(async () => {
      let themesOutcome: Outcome["themes"] = null;
      if (chosen.length > 0) {
        try {
          const imported = await importThemeList(programId, { themes: chosen });
          if (!imported.ok) {
            setError({ message: imported.error, details: Object.values(imported.fieldErrors ?? {}).flat() });
            return;
          }
          themesOutcome = { created: imported.data.created, skipped: imported.data.skipped };
        } catch {
          setError({ message: "La connexion a été interrompue. Rien n'a été importé : réessayez.", details: [] });
          return;
        }
      }
      let brandOutcome: Outcome["brand"] = null;
      if (applyBrand && brand) {
        try {
          const saved = await updateBrand(programId, mergeImportedBrand(brand, currentLogo));
          brandOutcome = saved.ok ? true : saved.error;
        } catch {
          brandOutcome = "la connexion a été interrompue.";
        }
        // Charte seule refusée : on reste sur l'aperçu pour réessayer.
        if (brandOutcome !== true && !themesOutcome) {
          setError({ message: `La charte n'a pas été appliquée : ${brandOutcome}`, details: [] });
          return;
        }
      }
      onDone({ themes: themesOutcome, brand: brandOutcome });
    });
  }

  return (
    <section aria-labelledby={titleId} className="border-t border-border pt-5">
      <FocusOnMount targetId={titleId} />
      <div className="flex flex-wrap items-center gap-3">
        <h3 id={titleId} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
          Ce que nous avons trouvé
        </h3>
        <Badge tone={source === "ai" ? "info" : "neutral"} size="small">
          {SOURCE_TEXT[source]}
        </Badge>
      </div>
      {fallbackReason ? (
        <Notice tone="warning" className="mt-3">
          L&apos;IA n&apos;a pas été utilisée : {fallbackReason} Le résultat vient de l&apos;analyse par mots-clés.
        </Notice>
      ) : null}

      {nothingFound ? (
        <div className="mt-3">
          <p className="font-semibold">Aucun thème ni charte reconnus dans ce texte.</p>
          <p className="mt-1 text-sm text-muted">
            Listez les thèmes (« Thèmes : 1. Cybersécurité 2. … », un par ligne ou numérotés), et indiquez les couleurs
            en hexadécimal (#1F3A5F) ou les polices, puis relancez l&apos;analyse. Vous pouvez aussi ajouter les thèmes
            à la main ci-dessous.
          </p>
          <div className="mt-4">
            <Button type="button" variant="ghost" onClick={onBack}>
              Modifier le texte
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">Rien n&apos;est encore importé ni enregistré.</p>
          {found.length > 0 ? (
            <div className="mt-4">
              <h4 className="opale-field__label">Éléments reconnus</h4>
              <ul className="flex flex-wrap gap-1.5" aria-label="Éléments reconnus">
                {found.map((item) => (
                  <li key={item} className="rounded-sm bg-surface-2 px-2 py-0.5 text-sm ring-1 ring-inset ring-border">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {themes.length > 0 ? (
            <fieldset className="mt-5">
              <legend className="opale-field__label">
                Thèmes trouvés <span className="num font-normal text-muted">({chosen.length} cochés sur {themes.length})</span>
              </legend>
              <p className="mb-2 text-sm text-muted">Décochez ceux à ne pas importer. Les thèmes déjà présents seront ignorés.</p>
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
          ) : (
            <p className="mt-5 text-sm">
              <strong>Aucun thème reconnu</strong> : ajoutez-les à la main ci-dessous, ou complétez le texte.
            </p>
          )}

          {brand ? (
            <BrandSection
              brand={brand}
              notes={brandNotes}
              format={format}
              withBrand={withBrand}
              onToggle={setWithBrand}
            />
          ) : (
            <p className="mt-5 text-sm text-muted">
              Aucune couleur ni police reconnue : la charte actuelle ne change pas.
            </p>
          )}

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

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={run}
              aria-disabled={pending || blocked || undefined}
              aria-describedby={blocked ? blockedHintId : undefined}
            >
              <ButtonLabel idle={submitLabel(chosen.length, applyBrand)} busy="Import…" isBusy={pending} />
            </Button>
            <Button type="button" variant="text" onClick={onBack} aria-disabled={pending || undefined}>
              Annuler
            </Button>
            {blocked ? (
              <p id={blockedHintId} className="text-sm text-muted">
                Cochez au moins un thème{brand ? ", ou la charte," : ""} pour importer.
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function BrandSection({
  brand,
  notes,
  format,
  withBrand,
  onToggle,
}: {
  brand: Brand;
  notes: string[];
  format: PromptTemplate["format"];
  withBrand: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div className="mt-6 border-t border-border pt-5">
      <h4 className="text-base font-semibold">Charte déduite</h4>
      <p className="mb-4 text-sm text-muted">Les éléments non précisés reprennent la charte par défaut.</p>
      <BrandPreview brand={brand} format={format} notes={notes} headingLevel={5} />
      <div className="mt-4">
        <Checkbox
          label="Appliquer aussi la charte"
          description="Elle remplace la charte actuelle et reste modifiable dans l'onglet Charte."
          checked={withBrand}
          onChange={(e) => onToggle(e.target.checked)}
        />
      </div>
    </div>
  );
}

function ImportOutcome({ id, programId, outcome }: { id: string; programId: string; outcome: Outcome }) {
  const sentence = outcomeSentence(outcome);
  const brandFailed = typeof outcome.brand === "string" ? outcome.brand : null;
  const hasThemes = outcome.themes !== null && outcome.themes.created + outcome.themes.skipped > 0;
  return (
    <div id={id} tabIndex={-1} className="flex flex-col gap-3 focus:outline-none">
      <FocusOnMount targetId={id} />
      <Notice tone="success">
        <p className="font-semibold text-success">{sentence}</p>
        {hasThemes ? (
          <p className="mt-3">
            <ButtonLink href={pageHref(programId, "skeletons")} size="small">
              Passer aux squelettes<span aria-hidden="true"> →</span>
            </ButtonLink>
          </p>
        ) : null}
      </Notice>
      {brandFailed ? (
        <Notice tone="warning">
          La charte n&apos;a pas été appliquée : {brandFailed} Vous pouvez la régler dans l&apos;onglet Charte.
        </Notice>
      ) : null}
    </div>
  );
}
