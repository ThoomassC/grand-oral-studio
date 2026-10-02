"use client";

import { useRef } from "react";
import type { Brand, PromptTemplate } from "@/domain/schemas";
import { BrandEditor, type BrandEditorHandle } from "./BrandEditor";
import { BrandImport } from "./BrandImport";

/** Page Charte : l'import (facultatif) au-dessus de l'éditeur, qu'il remplit sans enregistrer. */
export function BrandWorkspace({
  programId,
  initialBrand,
  format,
}: {
  programId: string;
  initialBrand: Brand;
  format: PromptTemplate["format"];
}) {
  const editorRef = useRef<BrandEditorHandle>(null);
  return (
    <div className="flex flex-col gap-8">
      <BrandImport programId={programId} format={format} onApply={(brand) => editorRef.current?.applyImport(brand)} />
      <BrandEditor ref={editorRef} programId={programId} initialBrand={initialBrand} format={format} />
    </div>
  );
}
