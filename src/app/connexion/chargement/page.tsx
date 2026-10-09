import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthTransition } from "@/components/auth/AuthTransition";
import { postLoginDestination, verificationCallbackPath } from "@/components/auth/next-path";
import { getUser } from "@/server/session";

export const metadata: Metadata = { title: "Bienvenue", robots: { index: false, follow: false } };

export default async function AuthLoadingPage({ searchParams }: PageProps<"/connexion/chargement">) {
  const next = postLoginDestination((await searchParams).next);
  if (!(await getUser())) redirect(verificationCallbackPath(next));
  return <AuthTransition next={next} />;
}
