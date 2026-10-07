import type { Brand, PromptTemplate } from "@/domain/schemas";
import { ModelLibrary } from "@/components/projects/ModelLibrary";
import { BrandEditor } from "./BrandEditor";
import { BrandPreview } from "./BrandPreview";

/**
 * Éditeur de la page Apparence, entièrement modifiable, puis la bibliothèque de
 * l'équipe (publier cette apparence, en appliquer une autre). L'import (partir
 * d'une présentation ou d'un prompt) est le bloc « Partir d'un exemple » posé
 * au-dessus par la page, sur la même page : aucun renvoi ailleurs.
 *
 * `readOnly` (lecteur d'un projet partagé) : l'apparence en lecture seule, sans
 * éditeur ni bibliothèque (le serveur refuse de toute façon ses modifications).
 * `canPublish` (propriétaire seul) : propose de publier dans la bibliothèque.
 */
export function BrandWorkspace({
  programId,
  initialBrand,
  savedAt,
  format,
  readOnly = false,
  canPublish = false,
}: {
  programId: string;
  initialBrand: Brand;
  /** brandSavedAt (ISO ; null = jamais enregistrée) : jeton de concurrence de l'éditeur. */
  savedAt?: string | null;
  format: PromptTemplate["format"];
  readOnly?: boolean;
  /** Propriétaire du projet : seul autorisé à publier l'apparence dans la bibliothèque. */
  canPublish?: boolean;
}) {
  if (readOnly) {
    return (
      <section aria-labelledby="apparence-lecture" className="flex flex-col gap-4">
        <h3 id="apparence-lecture" className="text-2xl">
          {initialBrand.name || "Apparence du projet"}
        </h3>
        <BrandPreview brand={initialBrand} format={format} notes={[]} />
      </section>
    );
  }
  return (
    <>
      <BrandEditor programId={programId} initialBrand={initialBrand} savedAt={savedAt} format={format} />
      <ModelLibrary programId={programId} kind="brand" defaultName={initialBrand.name} canPublish={canPublish} />
    </>
  );
}
