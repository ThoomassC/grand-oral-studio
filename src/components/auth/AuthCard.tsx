import type { ReactNode } from "react";

/** Carte centrée des pages connexion / inscription, posée sur un papier quadrillé. */
export function AuthCard({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="paper-grid flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
      <div className="card card-bristol w-full max-w-md p-6 pt-8 shadow-raised sm:p-8 sm:pt-10">
        <p className="eyebrow">Grand Oral Studio</p>
        <h1 className="mt-2 text-3xl">{title}</h1>
        <p className="mt-2 text-muted">{intro}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
