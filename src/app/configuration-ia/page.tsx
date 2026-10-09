import type { Metadata } from "next";
import { AiSetup } from "@/components/settings/AiSetup";
import { PageHeading } from "@/components/layout/PageHeading";
import { toAiSetupStatus } from "@/components/settings/ai-status";
import { formatDateTime } from "@/components/ui/format";
import { getAiSettings } from "@/server/queries";
import { requireUser } from "@/server/session";
import { SETTINGS_CONTAINER } from "./container";

export const metadata: Metadata = { title: "Rédaction IA" };

export default async function AiConfigurationPage() {
  const user = await requireUser();
  const settings = await getAiSettings(user.id);
  // DTO explicite : seulement ce que l'interface affiche (d'une clé, ses 4 derniers caractères et ses dates).
  const status = toAiSetupStatus(settings, (iso) => formatDateTime(new Date(iso)));

  return (
    <div className={SETTINGS_CONTAINER}>
      <PageHeading title="Rédaction IA" kicker="Votre rédacteur">
        L&apos;IA n&apos;intervient qu&apos;au jour J, pour rédiger le diaporama : tout le reste se prépare sans elle.
        Mode clair ou sombre, taille du texte et animations se règlent dans Réglages, depuis l&apos;en-tête.
      </PageHeading>
      <div className="mt-8">
        <AiSetup status={status} />
      </div>
    </div>
  );
}
