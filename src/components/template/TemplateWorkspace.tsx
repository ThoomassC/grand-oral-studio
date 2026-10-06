"use client";

import { useRef } from "react";
import type { PromptTemplate } from "@/domain/schemas";
import { TemplateEditor, type TemplateEditorHandle } from "./TemplateEditor";
import { TemplatePromptImport } from "./TemplatePromptImport";

/** Page Trame : le préremplissage par prompt (facultatif) au-dessus de l'éditeur, qu'il remplit sans enregistrer. */
export function TemplateWorkspace({ programId, initialTemplate }: { programId: string; initialTemplate: PromptTemplate }) {
  const editorRef = useRef<TemplateEditorHandle>(null);
  return (
    <div className="flex flex-col gap-8">
      <TemplatePromptImport programId={programId} onApply={(template) => editorRef.current?.applyImport(template)} />
      <TemplateEditor ref={editorRef} programId={programId} initialTemplate={initialTemplate} />
    </div>
  );
}
