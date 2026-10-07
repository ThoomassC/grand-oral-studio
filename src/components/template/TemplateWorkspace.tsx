"use client";

import { useRef, useState } from "react";
import type { PromptTemplate } from "@/domain/schemas";
import { formatSeconds, totalSlides } from "@/domain/slides";
import { ModelLibrary } from "@/components/projects/ModelLibrary";
import { plural } from "@/components/ui/format";
import { TemplateEditor, type TemplateEditorHandle } from "./TemplateEditor";
import { TemplatePromptImport } from "./TemplatePromptImport";

/**
 * Page Trame : le préremplissage par prompt (facultatif) au-dessus de l'éditeur,
 * qu'il remplit sans enregistrer, puis la bibliothèque de l'équipe (publier cette
 * trame, en appliquer une autre).
 *
 * Un modèle appliqué remplace la trame ENREGISTRÉE : l'éditeur, qui ne reprend
 * pas de lui-même une trame venue du serveur, est remonté (`key`) dès que la page
 * rafraîchie apporte la nouvelle version (`savedAt` différent de celle d'avant
 * l'application). Un enregistrement fait dans l'éditeur, lui, ne le remonte pas.
 *
 * `readOnly` (lecteur d'un projet partagé) : la trame en lecture seule, sans
 * import, éditeur ni bibliothèque (le serveur refuse de toute façon).
 */
export function TemplateWorkspace({
  programId,
  initialTemplate,
  savedAt,
  readOnly = false,
}: {
  programId: string;
  initialTemplate: PromptTemplate;
  /** templateSavedAt (ISO ; null = jamais enregistrée) : jeton de concurrence de l'éditeur. */
  savedAt?: string | null;
  readOnly?: boolean;
}) {
  const editorRef = useRef<TemplateEditorHandle>(null);
  const [editorKey, setEditorKey] = useState(0);
  /** Version de la trame au moment d'une application de modèle, en attente du rafraîchissement. */
  const [applyingFrom, setApplyingFrom] = useState<{ version: string | null | undefined } | null>(null);
  if (applyingFrom && savedAt !== applyingFrom.version) {
    setApplyingFrom(null);
    setEditorKey((k) => k + 1);
  }

  if (readOnly) return <TemplateReadOnly template={initialTemplate} />;

  return (
    <div className="flex flex-col gap-8">
      <TemplatePromptImport programId={programId} onApply={(template) => editorRef.current?.applyImport(template)} />
      <TemplateEditor
        key={editorKey}
        ref={editorRef}
        programId={programId}
        initialTemplate={initialTemplate}
        savedAt={savedAt}
      />
      <ModelLibrary
        programId={programId}
        kind="template"
        onApplied={() => setApplyingFrom({ version: savedAt })}
      />
    </div>
  );
}

/** La trame en lecture : réglages, puis les lignes et leurs diapos (même présentation que l'aperçu d'import). */
function TemplateReadOnly({ template }: { template: PromptTemplate }) {
  const total = totalSlides(template);
  return (
    <section aria-labelledby="trame-lecture" className="opale-card opale-card--e1 block p-5">
      <h3 id="trame-lecture" className="text-2xl">
        Diapos de la trame
      </h3>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] content-start gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Durée</dt>
          <dd className="num">{template.durationMinutes} min</dd>
          <dt className="text-muted">Format</dt>
          <dd>{template.format === "16:9" ? "16:9 (écran large)" : "4:3 (standard)"}</dd>
          <dt className="text-muted">Langue</dt>
          <dd>{template.language === "fr" ? "Français" : "Anglais"}</dd>
          <dt className="text-muted">Ton</dt>
          <dd>{template.tone || "—"}</dd>
          {template.constraints ? (
            <>
              <dt className="text-muted">Contraintes</dt>
              <dd className="whitespace-pre-line">{template.constraints}</dd>
            </>
          ) : null}
        </dl>
        <div>
          <h4 id="trame-lecture-lignes" className="opale-field__label">
            Lignes <span className="font-normal text-muted">({plural(total, "diapo")}, couverture comprise)</span>
          </h4>
          <ol aria-labelledby="trame-lecture-lignes" className="list-decimal space-y-1 pl-6 text-sm">
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
                {section.guidance ? <p className="text-muted whitespace-pre-line">{section.guidance}</p> : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
