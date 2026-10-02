"use client";

import { ErrorPanel } from "@/components/ui/ErrorPanel";

export default function SettingsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel title="Les paramètres n'ont pas pu être chargés" error={error} retry={retry} />;
}
