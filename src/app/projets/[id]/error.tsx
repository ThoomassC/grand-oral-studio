"use client";

import { ErrorPanel } from "@/components/ui/ErrorPanel";

export default function ProgramSectionError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPanel level={2} title="Cette section n'a pas pu être chargée" error={error} retry={retry} />;
}
