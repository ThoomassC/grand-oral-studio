import type { Brand, PromptTemplate } from "@/domain/schemas";
import { BrandEditor } from "./BrandEditor";

/**
 * Éditeur de la page Apparence, entièrement modifiable. L'import (partir d'une
 * présentation ou d'un prompt) est le bloc « Partir d'un exemple » posé
 * au-dessus par la page, sur la même page : aucun renvoi ailleurs.
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
  return <BrandEditor programId={programId} initialBrand={initialBrand} format={format} />;
}
