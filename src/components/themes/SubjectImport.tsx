import { Tabs, TabsContent, TabsList, TabsTrigger } from "@thomascaron/opale-ui";
import type { Brand, PromptTemplate } from "@/domain/schemas";
import { IMPORT_ANCHORS } from "@/components/projects/steps";
import { CurrentLogoProvider } from "./current-logo";
import { SubjectFileImport } from "./SubjectFileImport";
import { SubjectPromptImport } from "./SubjectPromptImport";

const TITLE_ID = "importer-votre-sujet-titre";

/**
 * Bloc principal de l'onglet Thèmes : « Importer votre sujet », en deux modes
 * (`Tabs` d'Opale, parties nommées : ce composant reste un Server Component,
 * seuls les deux panneaux sont des feuilles client).
 *
 * - Depuis un fichier : la charte déduite d'une présentation, enregistrée ;
 * - Depuis un prompt : les thèmes et la charte repérés dans un texte.
 *
 * Seul le logo de la charte actuelle traverse la frontière, une fois
 * (`CurrentLogoProvider`) : il est conservé quand l'import n'en trouve pas.
 */
export function SubjectImport({
  programId,
  currentBrand,
  format,
}: {
  programId: string;
  currentBrand: Pick<Brand, "logoDataUrl">;
  format: PromptTemplate["format"];
}) {
  return (
    <section
      id={IMPORT_ANCHORS.subject}
      aria-labelledby={TITLE_ID}
      className="subject-import opale-card opale-card--e2 block scroll-mt-4 p-4 sm:p-6"
    >
      <p className="eyebrow">Démarrage rapide</p>
      <h2 id={TITLE_ID} className="mt-1 text-2xl">
        Importer votre sujet
      </h2>
      <p className="mt-1 max-w-3xl text-muted">
        Partez de ce que vous avez déjà : une présentation pour la charte graphique, ou l&apos;énoncé de votre oral pour
        les thèmes et la charte. Vous vérifiez un aperçu avant d&apos;importer ; tout reste modifiable ensuite.
      </p>
      <CurrentLogoProvider logo={currentBrand.logoDataUrl}>
        <Tabs defaultValue="fichier" className="mt-4">
          <TabsList aria-label="Mode d'import">
            <TabsTrigger value="fichier">Depuis un fichier</TabsTrigger>
            <TabsTrigger value="prompt">Depuis un prompt</TabsTrigger>
          </TabsList>
          <TabsContent value="fichier" className="pt-4">
            <SubjectFileImport programId={programId} format={format} />
          </TabsContent>
          <TabsContent value="prompt" className="pt-4">
            <SubjectPromptImport programId={programId} format={format} />
          </TabsContent>
        </Tabs>
      </CurrentLogoProvider>
    </section>
  );
}
