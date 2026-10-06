import { Card } from "@thomascaron/opale-ui";
import type { ReactNode } from "react";

/** Carte centrée des pages connexion / inscription (`Card` d'Opale, élévation 2). */
export function AuthCard({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
      <Card elevation={2} className="w-full max-w-md p-6 sm:p-8">
        <h1 className="text-3xl">{title}</h1>
        <p className="mt-2 text-muted">{intro}</p>
        <div className="mt-6">{children}</div>
      </Card>
    </div>
  );
}
