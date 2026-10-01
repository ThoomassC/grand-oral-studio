"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { signOut } from "@/lib/auth-client";
import { ButtonLabel } from "@/components/ui/ButtonLabel";

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function handleClick() {
    setFailed(false);
    startTransition(async () => {
      try {
        const { error } = await signOut();
        if (error) {
          setFailed(true);
          return;
        }
      } catch {
        setFailed(true);
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          if (!pending) handleClick();
        }}
        aria-disabled={pending || undefined}
      >
        <ButtonLabel idle="Se déconnecter" busy="Déconnexion…" isBusy={pending} />
      </button>
      <span role="status" className={failed ? "text-sm text-danger" : "sr-only"}>
        {failed ? "Échec, réessayez." : ""}
      </span>
    </>
  );
}
