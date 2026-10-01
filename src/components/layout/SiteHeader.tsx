import Link from "next/link";
import { getUser } from "@/server/session";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { BrandMark } from "./BrandMark";

/** En-tête global : identité de l'app et état de connexion. */
export async function SiteHeader() {
  const user = await getUser();

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          href={user ? "/programmes" : "/"}
          className="flex items-center gap-2 font-display text-[1.05rem] font-semibold tracking-tight"
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
                Créer un compte
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
