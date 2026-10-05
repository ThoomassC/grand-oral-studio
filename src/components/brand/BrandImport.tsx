import { Tabs, TabsContent, TabsList, TabsTrigger } from "@thomascaron/opale-ui";
import type { Brand, PromptTemplate } from "@/domain/schemas";
import { CurrentLogoProvider } from "@/components/themes/current-logo";
import { SubjectPromptImport } from "@/components/themes/SubjectPromptImport";
import { BrandFileImport } from "./BrandFileImport";

/** Ancre du bloc (contrat `IMPORT_ANCHORS.brand` de steps.ts). */
const ANCHOR = "importer-apparence";
const TITLE_ID = "importer-apparence-titre";

/**
 * Bloc « Partir d'un exemple » de la page Apparence, en deux modes (`Tabs`
 * d'Opale, parties nommées : ce composant reste un Server Component, seuls les
 * deux panneaux sont des feuilles client). Les deux lisent sans IA :
 *
 * - Depuis un fichier .pptx : l'apparence d'une présentation (.pptx, .potx,
 *   .thmx), enregistrée après aperçu ;
 * - Depuis un prompt : les couleurs et polices décrites dans un texte.
 *
 * Seul le logo de l'apparence actuelle traverse la frontière, une fois
 * (`CurrentLogoProvider`) : il est conservé quand l'import n'en trouve pas.
 */
export function BrandImport({
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
      id={ANCHOR}
      aria-labelledby={TITLE_ID}
      className="opale-card opale-card--e2 block scroll-mt-4 p-4 sm:p-6"
    >
      <p className="eyebrow">Facultatif</p>
      <h2 id={TITLE_ID} className="mt-1 text-2xl">
        Partir d&apos;un exemple
      </h2>
      <p className="mt-1 max-w-3xl text-muted">
        Reprenez les couleurs, les polices et le logo d&apos;une présentation existante, ou décrivez-les dans un texte.
        Vous vérifiez un aperçu avant d&apos;appliquer ; tout reste modifiable ensuite. Rien n&apos;est envoyé à une IA.
      </p>
      <CurrentLogoProvider logo={currentBrand.logoDataUrl}>
        <Tabs defaultValue="fichier" className="mt-4">
          <TabsList aria-label="Façon d'importer l'apparence">
            <TabsTrigger value="fichier">Depuis un fichier .pptx</TabsTrigger>
            <TabsTrigger value="prompt">Depuis un prompt</TabsTrigger>
          </TabsList>
          <TabsContent value="fichier" className="pt-4">
            <BrandFileImport programId={programId} format={format} />
          </TabsContent>
          <TabsContent value="prompt" className="pt-4">
            <SubjectPromptImport programId={programId} format={format} scope="appearance" />
          </TabsContent>
        </Tabs>
      </CurrentLogoProvider>
    </section>
  );
}
