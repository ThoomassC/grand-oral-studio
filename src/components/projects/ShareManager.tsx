"use client";

import { Badge, Button, Card, RadioGroup } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { SelectInput, TextInput } from "@/components/ui/Field";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid, focusLater } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { changeMemberRole, inviteMember, leaveProject, removeMember } from "@/server/actions/members";
import type { ProgramRole } from "@/server/repo/access";
import type { MemberView } from "@/server/repo/members";
import {
  InviteMemberSchema,
  MAX_MEMBERS,
  MEMBER_ROLES,
  ROLE_HELP,
  ROLE_LABEL,
  type MemberRoleInput,
} from "./share-schema";

const INTERRUPTED = "La connexion a été interrompue. Réessayez.";
const LIST_HEADING_ID = "membres-du-projet";

const roleName = (role: MemberRoleInput) => ROLE_LABEL[role].toLowerCase();

/**
 * Page « Partage » d'un projet. Tout membre voit la liste (propriétaire, puis
 * membres : nom, adresse, rôle). Le propriétaire invite un collègue (compte
 * existant), change un rôle ou retire un membre ; un éditeur ou un lecteur peut
 * quitter le projet. Le serveur revérifie chaque droit ; après chaque action,
 * `router.refresh()` relit la liste (l'action revalide le projet).
 */
export function ShareManager({
  programId,
  programName,
  currentUserId,
  myRole,
  owner,
  members,
}: {
  programId: string;
  programName: string;
  currentUserId: string;
  myRole: ProgramRole;
  owner: { userId: string; name: string; email: string };
  members: MemberView[];
}) {
  const router = useRouter();
  const isOwner = myRole === "owner";
  const [status, setStatus] = useState<FormStatusState>(IDLE);

  return (
    <div className="flex flex-col gap-6">
      {isOwner ? (
        <Card elevation={1} className="p-5 sm:p-6">
          <h3 className="text-xl">Ajouter un collègue</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Votre collègue doit déjà avoir un compte sur Grand Oral Studio. {MAX_MEMBERS} membres au plus par projet.
          </p>
          <div className="mt-5">
            <InviteForm programId={programId} onInvited={() => router.refresh()} />
          </div>
        </Card>
      ) : null}

      <Card elevation={1} className="p-5 sm:p-6">
        <h3 id={LIST_HEADING_ID} tabIndex={-1} className="text-xl">
          Membres du projet
        </h3>
        <p className="num mt-1 text-sm text-muted">
          {members.length} / {MAX_MEMBERS} membres invités
        </p>
        <FormStatus state={status} className="mt-3" />
        <ul aria-labelledby={LIST_HEADING_ID} className="mt-3 flex flex-col">
          <MemberLine name={owner.name} email={owner.email} isMe={owner.userId === currentUserId}>
            <Badge tone="primary">{ROLE_LABEL.owner}</Badge>
          </MemberLine>
          {members.map((m) => (
            <MemberLine key={`${m.userId}:${m.role}`} name={m.name} email={m.email} isMe={m.userId === currentUserId}>
              {isOwner ? (
                <MemberControls
                  programId={programId}
                  programName={programName}
                  member={m}
                  onStatus={setStatus}
                  onChanged={() => router.refresh()}
                />
              ) : (
                <Badge tone="neutral">{ROLE_LABEL[m.role]}</Badge>
              )}
            </MemberLine>
          ))}
        </ul>
      </Card>

      {!isOwner ? (
        <Card elevation={1} className="p-5 sm:p-6">
          <h3 className="text-xl">Quitter ce projet</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Le projet disparaîtra de votre liste. {owner.name}, son propriétaire, pourra vous y ajouter à nouveau.
          </p>
          <div className="mt-4">
            <ConfirmAction
              triggerLabel="Quitter ce projet"
              title="Quitter ce projet ?"
              question={`Vous n'aurez plus accès à « ${programName} ».`}
              confirmLabel="Quitter le projet"
              pendingLabel="En cours…"
              onConfirm={async () => {
                const result = await leaveProject(programId);
                return result.ok ? null : result.error;
              }}
              onDone={() => {
                router.push("/projets");
                router.refresh();
              }}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function MemberLine({
  name,
  email,
  isMe,
  children,
}: {
  name: string;
  email: string;
  isMe: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="font-semibold break-words">
          {name}
          {isMe ? <span className="font-normal text-muted"> (vous)</span> : null}
        </p>
        <p className="text-sm break-all text-muted">{email}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </li>
  );
}

/** Rôle (liste déroulante) et retrait d'un membre, pour le propriétaire. */
function MemberControls({
  programId,
  programName,
  member,
  onStatus,
  onChanged,
}: {
  programId: string;
  programName: string;
  member: MemberView;
  onStatus: (state: FormStatusState) => void;
  onChanged: () => void;
}) {
  const selectId = useId();
  const [role, setRole] = useState<MemberRoleInput>(member.role);
  const [pending, startTransition] = useTransition();

  function change(next: MemberRoleInput) {
    if (pending || next === role) return;
    const previous = role;
    setRole(next);
    onStatus(IDLE);
    startTransition(async () => {
      try {
        const result = await changeMemberRole(programId, member.userId, next);
        if (!result.ok) {
          setRole(previous);
          onStatus({ kind: "error", message: result.error });
          return;
        }
        onStatus({ kind: "success", message: `${member.name} a désormais le rôle ${roleName(next)}.` });
        onChanged();
      } catch {
        setRole(previous);
        onStatus({ kind: "error", message: INTERRUPTED });
      }
    });
  }

  return (
    <>
      <SelectInput
        id={selectId}
        aria-label={`Rôle de ${member.name}`}
        value={role}
        aria-busy={pending || undefined}
        onChange={(e) => {
          const next = MEMBER_ROLES.find((r) => r === e.target.value);
          if (next) change(next);
        }}
      >
        {MEMBER_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </SelectInput>
      <ConfirmAction
        triggerLabel="Retirer"
        triggerAccessibleLabel={`Retirer ${member.name} du projet`}
        title="Retirer ce membre ?"
        question={`${member.name} n'aura plus accès au projet « ${programName} ».`}
        confirmLabel="Retirer"
        pendingLabel="Retrait…"
        onConfirm={async () => {
          const result = await removeMember(programId, member.userId);
          return result.ok ? null : result.error;
        }}
        onDone={() => {
          onStatus({ kind: "success", message: `${member.name} n'a plus accès au projet.` });
          onChanged();
          // La ligne disparaît : le focus va au titre de la liste.
          focusLater([LIST_HEADING_ID]);
        }}
      />
    </>
  );
}

/** Formulaire d'invitation : adresse e-mail d'un compte existant et rôle. */
function InviteForm({ programId, onInvited }: { programId: string; onInvited: () => void }) {
  const baseId = useId();
  const emailId = `${baseId}-email`;
  const emailErrorId = `${emailId}-err`;
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRoleInput>("viewer");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const checked = validateWith(InviteMemberSchema, { email, role });
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setStatus(IDLE);
      focusFirstInvalid(formRef.current);
      return;
    }
    setFieldErrors({});
    setStatus(IDLE);
    startTransition(async () => {
      try {
        const result = await inviteMember(programId, checked.data);
        if (!result.ok) {
          const errors = result.fieldErrors ?? {};
          if (firstError(errors, "email")) {
            setFieldErrors(errors);
            focusFirstInvalid(formRef.current);
          } else {
            setStatus({ kind: "error", message: result.error });
          }
          return;
        }
        const { member } = result.data;
        setEmail("");
        setStatus({ kind: "success", message: `${member.name} a désormais accès au projet (rôle ${roleName(member.role)}).` });
        onInvited();
      } catch {
        setStatus({ kind: "error", message: INTERRUPTED });
      }
    });
  }

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label htmlFor={emailId} className="opale-field__label">
          Adresse e-mail
        </label>
        <TextInput
          id={emailId}
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...errorProps(fieldErrors, "email", emailErrorId)}
        />
        <FieldError id={emailErrorId} message={firstError(fieldErrors, "email")} />
      </div>
      <RadioGroup
        label="Rôle"
        name="role"
        value={role}
        onValueChange={(value) => {
          const next = MEMBER_ROLES.find((r) => r === value);
          if (next) setRole(next);
        }}
        error={firstError(fieldErrors, "role")}
        options={MEMBER_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r], description: ROLE_HELP[r] }))}
      />
      <FormStatus state={status} />
      <div>
        <Button type="submit" aria-disabled={pending || undefined}>
          <ButtonLabel idle="Ajouter au projet" busy="Ajout…" isBusy={pending} />
        </Button>
      </div>
    </form>
  );
}
