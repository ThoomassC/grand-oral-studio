import type { Brand, PromptTemplate } from "@/domain/schemas";
import { IMPORT_ANCHORS } from "@/components/projects/steps";
import { SubjectPromptImport } from "./SubjectPromptImport";

const ANCHOR = IMPORT_ANCHORS.subjects;
const TITLE_ID = `${ANCHOR}-titre`;

/**
 * Bloc « Importer des sujets depuis un texte » de la page Sujets : la liste des
 * sujets, l'énoncé de l'oral ou les consignes de l'établissement, lus sans IA ;
 * les sujets repérés sont proposés à cocher avant l'import. Server Component :
 * seul le panneau est une feuille client.
 *
 * L'apparence n'est plus importée ici (bloc « Partir d'un exemple » de la page
 * Apparence). `currentBrand` est accepté pour ne pas casser la page actuelle,
 * mais n'est plus utilisé.
 */
export function SubjectImport({
  programId,
  format,
}: {
  programId: string;
  format: PromptTemplate["format"];
  /** @deprecated Inutilisé depuis la 1.1.0 (l'apparence s'importe sur sa page). */
  currentBrand?: Pick<Brand, "logoDataUrl">;
}) {
  return (
    <section id={ANCHOR} aria-labelledby={TITLE_ID} className="opale-card opale-card--e2 block scroll-mt-4 p-4 sm:p-6">
      {/* Sous-bloc de la page Sujets (h2) : h3. */}
      <h3 id={TITLE_ID} className="text-xl">
        Importer des sujets depuis un texte
      </h3>
      <p className="mt-1 max-w-3xl text-muted">
        Partez de ce que vous avez déjà : la liste des sujets ou l&apos;énoncé de votre oral. Vous cochez les sujets à
        importer dans un aperçu ; tout reste modifiable ensuite. Rien n&apos;est envoyé à une IA.
      </p>
      <div className="mt-4">
        <SubjectPromptImport programId={programId} format={format} scope="subjects" />
      </div>
    </section>
  );
}
