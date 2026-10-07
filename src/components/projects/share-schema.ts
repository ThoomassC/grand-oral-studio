import { z } from "zod";

/**
 * Partage d'un projet : schémas communs au formulaire (client) et aux Server
 * Actions (src/server/actions/members.ts), mêmes bornes et mêmes messages.
 * Rôles applicatifs en minuscules ; la base stocke 'EDITOR' | 'VIEWER'.
 */

export const MEMBER_ROLES = ["editor", "viewer"] as const;
export type MemberRoleInput = (typeof MEMBER_ROLES)[number];

/** Plafond de membres d'un projet (même valeur que MAX_MEMBERS_PER_PROGRAM côté serveur). */
export const MAX_MEMBERS = 20;

export const ROLE_LABEL: Record<MemberRoleInput | "owner", string> = {
  owner: "Propriétaire",
  editor: "Éditeur",
  viewer: "Lecteur",
};

/** Une phrase par rôle, sous le choix du rôle. */
export const ROLE_HELP: Record<MemberRoleInput, string> = {
  editor: "Modifie l'apparence, la trame et les sujets, génère et retouche les diaporamas.",
  viewer: "Consulte, exporte et répète les diaporamas, sans rien modifier.",
};

export const MemberRoleSchema = z.enum(MEMBER_ROLES, { error: "Choisissez un rôle : éditeur ou lecteur." });

export const InviteMemberSchema = z.object({
  email: z
    .string({ error: "Saisissez l'adresse e-mail de votre collègue." })
    .trim()
    .toLowerCase()
    .min(1, "Saisissez l'adresse e-mail de votre collègue.")
    .max(254, "L'adresse e-mail ne doit pas dépasser 254 caractères.")
    .pipe(z.email("Saisissez une adresse e-mail valide (ex. prenom.nom@lycee.fr).")),
  role: MemberRoleSchema,
});

export type InviteMemberInput = z.input<typeof InviteMemberSchema>;
