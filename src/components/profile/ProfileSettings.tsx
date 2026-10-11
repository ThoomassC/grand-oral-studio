"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon, Modal } from "@thomascaron/opale-ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/server/actions/result";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { DeleteAccountDialog } from "./DeleteAccountForm";
import { ProfileNameForm } from "./ProfileNameForm";
import type { DeleteAccountInput, ProfileNameInput } from "./schema";

type Setting = "name" | "password" | "delete";

export function ProfileSettings({
  name,
  email,
  hasPassword,
  canResetPassword,
  sharesProjects,
  updateNameAction,
  deleteAccountAction,
}: {
  name: string;
  email: string;
  hasPassword: boolean;
  canResetPassword: boolean;
  sharesProjects: boolean;
  updateNameAction: (input: ProfileNameInput) => Promise<ActionResult<{ name: string }>>;
  deleteAccountAction: (input: DeleteAccountInput) => Promise<ActionResult<null>>;
}) {
  const [setting, setSetting] = useState<Setting>("name");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || setting === "delete") return;
    const timer = window.setTimeout(() => contentRef.current?.querySelector<HTMLElement>("input, a[href]")?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, setting]);

  function show(next: Setting) {
    setSetting(next);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus({ preventScroll: true }), 0);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger ref={triggerRef} className="opale-button opale-button--ghost opale-button--small min-h-11">
          <Icon name="settings" />
          <span>Paramètres</span>
          <Icon name="chevron-down" />
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="Paramètres du profil" placement="bottom" align="end" className="header-menu min-w-[16rem] max-w-[calc(100vw-2rem)]">
          <DropdownMenuItem className="header-menu__item" value="name" onSelect={() => show("name")}>Modifier le nom</DropdownMenuItem>
          <DropdownMenuItem className="header-menu__item" value="password" onSelect={() => show("password")}>Modifier le mot de passe</DropdownMenuItem>
          <DropdownMenuItem className="header-menu__item text-danger" value="delete" onSelect={() => show("delete")}>Supprimer votre compte</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Modal
        open={open && setting !== "delete"}
        title={setting === "password" ? "Modifier le mot de passe" : "Modifier le nom"}
        description={setting === "password"
          ? (hasPassword ? "Vos autres sessions seront déconnectées." : "Votre compte utilise Google pour se connecter.")
          : "Il s’affiche dans le menu du compte."}
        size="small"
        onOpenChange={(next) => { if (!next) close(); }}
      >
        <div ref={contentRef}>
          {open && setting === "name" ? <ProfileNameForm initialName={name} action={updateNameAction} /> : null}
          {open && setting === "password" ? (hasPassword ? <ChangePasswordForm /> : (
            <div className="flex flex-col gap-4">
              <p className="text-muted">Aucun mot de passe n’est associé à ce compte.</p>
              {canResetPassword ? <Link href="/mot-de-passe-oublie" className="font-medium text-accent-strong underline underline-offset-4">Définir un mot de passe</Link> : null}
            </div>
          )) : null}
        </div>
      </Modal>

      <DeleteAccountDialog
        open={open && setting === "delete"}
        onCancel={close}
        email={email}
        action={deleteAccountAction}
        sharesProjects={sharesProjects}
      />
    </>
  );
}
