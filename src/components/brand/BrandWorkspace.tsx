"use client";

import Link from "next/link";
import type { Brand, PromptTemplate } from "@/domain/schemas";
import { useGuardedNavigation } from "@/components/layout/useGuardedNavigation";
import { importHref } from "@/components/projects/steps";
import { BrandEditor } from "./BrandEditor";

/**
 * Page Charte : l'éditeur, entièrement modifiable. L'import (déduire la charte
 * d'une présentation ou d'un prompt) vit dans l'onglet Thèmes, bloc
 * « Importer votre sujet » : une ligne discrète y renvoie.
 */
export function BrandWorkspace({
  programId,
  initialBrand,
  format,
}: {
  programId: string;
  initialBrand: Brand;
  format: PromptTemplate["format"];
}) {
  const { onLinkClick } = useGuardedNavigation();
  const importLink = importHref(programId, "subject");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Vous pouvez aussi{" "}
        <Link href={importLink} className="opale-link underline hover:no-underline" onClick={(e) => onLinkClick(e, importLink)}>
          déduire la charte d&apos;une présentation depuis l&apos;onglet Thèmes
        </Link>
        .
      </p>
      <BrandEditor programId={programId} initialBrand={initialBrand} format={format} />
    </div>
  );
}
