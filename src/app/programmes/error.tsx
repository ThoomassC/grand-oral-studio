"use client";

import { ErrorPanel } from "@/components/ui/ErrorPanel";

export default function ProgramsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} />;
}
