import { Card } from "@thomascaron/opale-ui";
import type { ReactNode } from "react";

/** Même papier et même typographie pour l’inscription et la récupération du compte. */
export function AuthCard({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="studio-auth flex flex-1 items-start justify-center px-4">
      <Card elevation={2} className="studio-auth__card w-full max-w-md p-6 sm:p-8">
        <h1 className="text-3xl">{title}</h1>
        <p className="mt-2 text-muted">{intro}</p>
        <div className="mt-6">{children}</div>
      </Card>
    </div>
  );
}
