import type { ReactNode } from "react";

export function AuthCard({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-muted">{intro}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
