import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";
import { safeNextPath } from "@/components/auth/next-path";
import { getUser } from "@/server/session";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: PageProps<"/connexion">) {
  const next = safeNextPath((await searchParams).next);
  if (await getUser()) redirect(next);

  return (
    <AuthCard title="Connexion" intro="Retrouvez vos programmes, vos squelettes et vos decks.">
      <AuthForm mode="signin" next={next} />
    </AuthCard>
  );
}
