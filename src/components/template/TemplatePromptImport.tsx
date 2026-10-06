"use client";

import { Button, Dropzone, FileCard } from "@thomascaron/opale-ui";
import { useId, useRef, useState, useTransition } from "react";
import type { PromptTemplate } from "@/domain/schemas";
import { formatSeconds, totalSlides } from "@/domain/slides";
import { analyzeTemplatePrompt } from "@/server/actions/imports";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { IMPORT_ANCHORS } from "@/components/projects/steps";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { TextArea } from "@/components/ui/Field";
import { FieldError } from "@/components/ui/FieldError";
import { FocusOnMount } from "@/components/ui/FocusOnMount";
import { formatCount, formatFileSize, plural } from "@/components/ui/format";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Notice } from "@/components/ui/Notice";
import { PROMPT_MAX_CHARS, PromptTextSchema } from "./prompt-schema";

type TemplateImportData = Extract<Awaited<ReturnType<typeof analyzeTemplatePrompt>>, { ok: true }>["data"];

type LoadedFile = { name: string; size: number };

type Phase =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "preview"; result: TemplateImportData };

/** Un fichier texte de 20 000 caractères pèse au plus ~80 Ko (UTF-8) : au-delà, inutile de le lire. */
const TEXT_FILE_MAX_BYTES = 256 * 1024;

/**
 * « Préremplir avec un prompt » : des consignes (collées ou lues d'un .txt /
 * .md, côté client), lues sans IA → une trame proposée (aperçu), appliquée au
 * formulaire ou abandonnée. Rien n'est enregistré ici.
 */
export function TemplatePromptImport({
  programId,
  onApply,
}: {
  programId: string;
  onApply: (template: PromptTemplate) => void;
}) {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);
  /** Une réponse arrivée après une modification du texte ou « Annuler » est ignorée. */
  const requestRef = useRef(0);
  const baseId = useId();
  const ids = {
    title: `${baseId}-title`,
    text: `${baseId}-text`,
    hint: `${baseId}-hint`,
    count: `${baseId}-count`,
    fileError: `${baseId}-file-error`,
    preview: `${baseId}-preview-title`,
  };
  const length = text.length;
  const tooLong = length > PROMPT_MAX_CHARS;

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
    if (pending) return;
    const checked = validateWith(PromptTextSchema, { text });
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      textRef.current?.focus();
      return;
    }
    setFieldErrors({});
    const request = ++requestRef.current;
    setPhase({ kind: "idle" });
    startTransition(async () => {
      let next: Phase;
      try {
        const result = await analyzeTemplatePrompt(programId, checked.data);
        if (!result.ok && result.fieldErrors?.text) {
          if (request !== requestRef.current) return;
          setFieldErrors({ text: result.fieldErrors.text });
          textRef.current?.focus();
          return;
        }
        next = result.ok ? { kind: "preview", result: result.data } : { kind: "error", message: result.error };
      } catch {
        next = { kind: "error", message: "La connexion a été interrompue. Vos consignes sont conservées : réessayez." };
      }
      if (request === requestRef.current) setPhase(next);
    });
  }

  function cancel() {
    requestRef.current += 1;
    setPhase({ kind: "idle" });
    textRef.current?.focus();
  }

  function apply(template: PromptTemplate) {
    requestRef.current += 1;
    setPhase({ kind: "idle" });
    onApply(template);
  }

  const textError = firstError(fieldErrors, "text");

  return (
    <section
      id={IMPORT_ANCHORS.template}
      aria-labelledby={ids.title}
      className="opale-card opale-card--e2 block scroll-mt-4 p-4 sm:p-6"
    >
      <h2 id={ids.title} className="text-xl">
        Préremplir avec un prompt
      </h2>
      <p id={ids.hint} className="mt-1 max-w-3xl text-sm text-muted">
        Facultatif. Collez les consignes de votre oral (ou celles de votre établissement) : durée, format, langue,
        lignes de la trame (un tableau « Diapo | Titre | Contenu | Durée » est lu tel quel), ton et contraintes sont
        repérés et proposés dans un aperçu, que vous appliquez au formulaire avant d&apos;enregistrer. Rien n&apos;est
        envoyé à une IA.
      </p>

      <form noValidate onSubmit={submit} className="mt-4 flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <div>
            <label htmlFor={ids.text} className="opale-field__label">
              Consignes ou prompt
            </label>
            <TextArea
              ref={textRef}
              id={ids.text}
              rows={5}
              value={text}
              onChange={(e) => {
                setLoaded(null);
                changeText(e.target.value);
              }}
              placeholder="Ex. Oral de 20 minutes en 16:9. Plan : 1. Introduction (1 diapo) 2. Problématique (1 diapo)… Ton : professionnel."
              {...errorProps(fieldErrors, "text", `${ids.text}-err`, ids.count)}
            />
            <p id={ids.count} className={`opale-field__helper num ${tooLong ? "font-semibold text-danger" : ""}`}>
              {formatCount(length)} / {formatCount(PROMPT_MAX_CHARS)} caractères
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
                fileTooLarge: () => "Le fichier est trop lourd pour des consignes (256 Ko au plus).",
                typeRejected: "Seuls les fichiers texte .txt et .md sont acceptés.",
              }}
            >
              Ou déposez un fichier .txt ou .md
            </Dropzone>
            {loaded ? <FileCard name={loaded.name} fileSize={formatFileSize(loaded.size)} /> : null}
          </div>
        </div>
        <LiveRegion role="alert">
          {fileError ? (
            <Notice tone="error" id={ids.fileError}>
              {fileError}
            </Notice>
          ) : null}
        </LiveRegion>
        <LiveRegion className="text-sm text-muted">
          {loaded && !fileError ? `Fichier « ${loaded.name} » chargé dans le champ.` : null}
        </LiveRegion>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="ghost" aria-disabled={pending || undefined}>
            <ButtonLabel idle="Analyser le prompt" busy="Analyse…" isBusy={pending} />
          </Button>
          <LiveRegion className="text-sm font-medium">{pending ? "Analyse du prompt…" : null}</LiveRegion>
        </div>
        <LiveRegion role="alert">
          {phase.kind === "error" ? (
            <Notice tone="error">
              Analyse impossible : {phase.message}
            </Notice>
          ) : null}
        </LiveRegion>
      </form>

      {phase.kind === "preview" ? (
        <TemplateImportPreview
          titleId={ids.preview}
          result={phase.result}
          onApply={() => apply(phase.result.template)}
          onCancel={cancel}
        />
      ) : null}
    </section>
  );
}

/** Valeur non trouvée dans le texte : celle de la trame actuelle. */
function DefaultMark({ show }: { show: boolean }) {
  return show ? <span className="ml-2 text-xs text-muted">(par défaut)</span> : null;
}

function TemplateImportPreview({
  titleId,
  result,
  onApply,
  onCancel,
}: {
  titleId: string;
  result: TemplateImportData;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { template, recognized } = result;
  // Deux avertissements identiques n'apportent rien et donneraient des clés React en double.
  const warnings = [...new Set(result.warnings)];
  const found = [...new Set(result.found)];
  const nothing = found.length === 0;
  const isRecognized = (field: TemplateImportData["recognized"][number]) => recognized.includes(field);
  const total = totalSlides(template);
  return (
    <section aria-labelledby={titleId} className="mt-5 border-t border-border pt-5">
      <FocusOnMount targetId={titleId} />
      <h3 id={titleId} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
        Trame proposée
      </h3>

      {nothing ? (
        <div className="mt-3">
          <p className="font-semibold">Aucun réglage reconnu dans ce texte.</p>
          <p className="mt-1 text-sm text-muted">
            Précisez par exemple la durée (« 20 minutes »), le format (« 16:9 »), la langue ou la liste des lignes
            avec leur nombre de diapos (un tableau « Diapo | Titre | Contenu | Durée » convient), puis relancez
            l&apos;analyse.
          </p>
          <div className="mt-4">
            <Button type="button" variant="text" onClick={onCancel}>
              Modifier le texte
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">
            Rien n&apos;est encore appliqué ni enregistré. Les valeurs marquées « par défaut » ne figurent pas dans le
            texte : ce sont celles de votre trame actuelle.
          </p>
          {warnings.length > 0 ? (
            <Notice tone="warning" className="mt-3">
              <p className="font-semibold">À vérifier avant d&apos;appliquer :</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <h4 id={`${titleId}-found`} className="opale-field__label">
                Trouvé dans le texte
              </h4>
              <ul aria-labelledby={`${titleId}-found`} className="list-disc space-y-0.5 pl-5 text-sm">
                {found.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Durée</dt>
                <dd>
                  <span className="num">{template.durationMinutes} min</span>
                  <DefaultMark show={!isRecognized("durationMinutes")} />
                </dd>
                <dt className="text-muted">Format</dt>
                <dd>
                  <span>{template.format === "16:9" ? "16:9 (écran large)" : "4:3 (standard)"}</span>
                  <DefaultMark show={!isRecognized("format")} />
                </dd>
                <dt className="text-muted">Langue</dt>
                <dd>
                  <span>{template.language === "fr" ? "Français" : "Anglais"}</span>
                  <DefaultMark show={!isRecognized("language")} />
                </dd>
                <dt className="text-muted">Ton</dt>
                <dd>
                  <span>{template.tone || "—"}</span>
                  <DefaultMark show={!isRecognized("tone")} />
                </dd>
                {template.constraints ? (
                  <>
                    <dt className="text-muted">Contraintes</dt>
                    <dd>
                      <span className="whitespace-pre-line">{template.constraints}</span>
                      <DefaultMark show={!isRecognized("constraints")} />
                    </dd>
                  </>
                ) : null}
              </dl>
            </div>
            <div>
              <h4 id={`${titleId}-lines`} className="opale-field__label">
                Lignes <span className="font-normal text-muted">({plural(total, "diapo")}, couverture comprise)</span>
                <DefaultMark show={!isRecognized("sections")} />
              </h4>
              <ol aria-labelledby={`${titleId}-lines`} className="list-decimal space-y-0.5 pl-6 text-sm">
                {template.sections.map((section) => (
                  <li key={section.id}>
                    {section.title}{" "}
                    <span className="text-muted">
                      — {plural(section.slides, "diapo")}
                      {section.seconds === undefined ? null : (
                        <>
                          {" · "}
                          <span className="num">{formatSeconds(section.seconds)}</span>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" onClick={onApply}>
              Appliquer à la trame
            </Button>
            <Button type="button" variant="text" onClick={onCancel}>
              Annuler
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
