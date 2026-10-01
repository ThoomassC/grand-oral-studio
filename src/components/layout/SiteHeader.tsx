import Link from "next/link";
import { getUser } from "@/server/session";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { BrandMark } from "./BrandMark";

/** En-tête global : identité de l'app et état de connexion. */
export async function SiteHeader() {
  const user = await getUser();

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 sm:px-6">
        <Link
          href={user ? "/programmes" : "/"}
          className="flex min-w-0 items-center gap-2 font-display text-lg font-semibold tracking-tight"
        >
          <BrandMark />
          <span>Grand Oral Studio</span>
        </Link>
        <nav aria-label="Compte" className="flex items-center gap-1 sm:gap-2">
          {user ? (
            <>
              <Link href="/programmes" className="btn btn-ghost btn-sm hidden sm:inline-flex">
                Mes programmes
              </Link>
              <span className="hidden max-w-[16rem] truncate text-sm text-muted md:inline" title={user.email}>
                {user.email}
              </span>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/connexion" className="btn btn-ghost btn-sm">
                Connexion
              </Link>
              <Link href="/inscription" className="btn btn-primary btn-sm">
                <span className="sm:hidden">Inscription</span>
                <span className="hidden sm:inline">Créer un compte</span>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
