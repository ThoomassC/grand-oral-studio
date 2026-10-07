import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const actions = {
  inviteMember: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  leaveProject: vi.fn(),
};
vi.mock("@/server/actions/members", () => ({
  inviteMember: (...args: unknown[]) => actions.inviteMember(...args),
  changeMemberRole: (...args: unknown[]) => actions.changeMemberRole(...args),
  removeMember: (...args: unknown[]) => actions.removeMember(...args),
  leaveProject: (...args: unknown[]) => actions.leaveProject(...args),
}));
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const { ShareManager } = await import("@/components/projects/ShareManager");

afterEach(() => {
  cleanup();
  for (const fn of Object.values(actions)) fn.mockReset();
  push.mockReset();
  refresh.mockReset();
});

const OWNER = { userId: "u-owner", name: "Claire Martin", email: "claire@lycee.fr" };
const EDITOR = { userId: "u-ed", name: "Hugo Petit", email: "hugo@lycee.fr", role: "editor" as const, addedAt: "2026-10-01T08:00:00.000Z" };
const VIEWER = { userId: "u-vi", name: "Inès Roy", email: "ines@lycee.fr", role: "viewer" as const, addedAt: "2026-10-02T08:00:00.000Z" };

function renderAs(
  myRole: "owner" | "editor" | "viewer",
  currentUserId = myRole === "owner" ? OWNER.userId : myRole === "editor" ? EDITOR.userId : VIEWER.userId,
  emailDeliveryEnabled = true,
) {
  // Comme le serveur (listMembers) : adresses réservées au propriétaire.
  const hide = myRole !== "owner";
  const withoutEmail = <T extends { email: string }>(p: T) => (hide ? { ...p, email: null } : p);
  return render(
    <ShareManager
      programId="p1"
      programName="BTS SIO 2026"
      currentUserId={currentUserId}
      myRole={myRole}
      owner={withoutEmail(OWNER)}
      members={[withoutEmail(EDITOR), withoutEmail(VIEWER)]}
      emailDeliveryEnabled={emailDeliveryEnabled}
    />,
  );
}

const IDENTITY_WARNING = /L'adresse e-mail ne prouve pas l'identité tant que les e-mails ne sont pas activés sur cette instance : vérifiez auprès de votre collègue\./;

function memberList() {
  return screen.getByRole("list", { name: "Membres du projet" });
}

describe("ShareManager — propriétaire", () => {
  it("devrait lister le propriétaire et les membres avec leur adresse et leur rôle", () => {
    renderAs("owner");
    const items = within(memberList()).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Claire Martin");
    expect(items[0]).toHaveTextContent("claire@lycee.fr");
    expect(items[0]).toHaveTextContent("Propriétaire");
    expect(within(items[1]!).getByLabelText("Rôle de Hugo Petit")).toHaveValue("editor");
    expect(within(items[2]!).getByLabelText("Rôle de Inès Roy")).toHaveValue("viewer");
  });

  it("devrait prévenir que l'adresse ne prouve pas l'identité quand les e-mails sont désactivés", () => {
    renderAs("owner", OWNER.userId, false);
    expect(screen.getByText(IDENTITY_WARNING)).toBeInTheDocument();
  });

  it("ne devrait pas afficher cet avertissement quand les e-mails sont actifs (adresse confirmée exigée)", () => {
    renderAs("owner", OWNER.userId, true);
    expect(screen.queryByText(IDENTITY_WARNING)).not.toBeInTheDocument();
  });

  it("devrait expliquer chaque rôle dans le formulaire d'invitation", () => {
    renderAs("owner");
    const group = screen.getByRole("radiogroup", { name: "Rôle" });
    expect(within(group).getByText(/Modifie l'apparence, la trame et les sujets/)).toBeInTheDocument();
    expect(within(group).getByText(/sans rien modifier/)).toBeInTheDocument();
  });

  it("devrait inviter un collègue avec le rôle choisi, puis vider le champ", async () => {
    actions.inviteMember.mockResolvedValue({
      ok: true,
      data: { member: { userId: "u-new", name: "Léa Blanc", email: "lea@lycee.fr", role: "editor", addedAt: "2026-10-07T08:00:00.000Z" } },
    });
    const user = userEvent.setup();
    renderAs("owner");
    await user.type(screen.getByLabelText("Adresse e-mail"), "  Lea@Lycee.fr ");
    await user.click(screen.getByRole("radio", { name: /Éditeur/ }));
    await user.click(screen.getByRole("button", { name: "Ajouter au projet" }));

    expect(actions.inviteMember).toHaveBeenCalledWith("p1", { email: "lea@lycee.fr", role: "editor" });
    expect(await screen.findByText("Léa Blanc a désormais accès au projet (rôle éditeur).")).toBeInTheDocument();
    expect(screen.getByLabelText("Adresse e-mail")).toHaveValue("");
    expect(refresh).toHaveBeenCalled();
  });

  it("devrait refuser une adresse invalide sans appeler le serveur", async () => {
    const user = userEvent.setup();
    renderAs("owner");
    const input = screen.getByLabelText("Adresse e-mail");
    await user.type(input, "pas-une-adresse");
    await user.click(screen.getByRole("button", { name: "Ajouter au projet" }));
    expect(actions.inviteMember).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/adresse e-mail valide/);
  });

  it("devrait afficher sous le champ le refus du serveur (adresse sans compte)", async () => {
    const message = "Aucun compte n'utilise cette adresse : votre collègue doit d'abord créer son compte.";
    actions.inviteMember.mockResolvedValue({ ok: false, error: message, fieldErrors: { email: [message] } });
    const user = userEvent.setup();
    renderAs("owner");
    const input = screen.getByLabelText("Adresse e-mail");
    await user.type(input, "inconnu@lycee.fr");
    await user.click(screen.getByRole("button", { name: "Ajouter au projet" }));
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveAccessibleDescription(/doit d'abord créer son compte/);
    expect(input).toHaveValue("inconnu@lycee.fr");
  });

  it("devrait afficher un refus global (doublon) dans le message du formulaire", async () => {
    actions.inviteMember.mockResolvedValue({ ok: false, error: "Cette personne est déjà membre du projet." });
    const user = userEvent.setup();
    renderAs("owner");
    await user.type(screen.getByLabelText("Adresse e-mail"), "hugo@lycee.fr");
    await user.click(screen.getByRole("button", { name: "Ajouter au projet" }));
    expect(await screen.findByText("Cette personne est déjà membre du projet.")).toBeInTheDocument();
  });

  it("devrait changer le rôle d'un membre", async () => {
    actions.changeMemberRole.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    renderAs("owner");
    await user.selectOptions(screen.getByLabelText("Rôle de Inès Roy"), "editor");
    expect(actions.changeMemberRole).toHaveBeenCalledWith("p1", "u-vi", "editor");
    expect(await screen.findByText("Inès Roy a désormais le rôle éditeur.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("devrait rétablir l'ancien rôle si le serveur refuse le changement", async () => {
    actions.changeMemberRole.mockResolvedValue({ ok: false, error: "Cette personne n'est plus membre du projet. Rechargez la page." });
    const user = userEvent.setup();
    renderAs("owner");
    const select = screen.getByLabelText("Rôle de Inès Roy");
    await user.selectOptions(select, "editor");
    expect(await screen.findByText(/n'est plus membre du projet/)).toBeInTheDocument();
    expect(select).toHaveValue("viewer");
  });

  it("devrait retirer un membre après confirmation", async () => {
    actions.removeMember.mockResolvedValue({ ok: true, data: { removed: true } });
    const user = userEvent.setup();
    renderAs("owner");
    await user.click(screen.getByRole("button", { name: "Retirer Hugo Petit du projet" }));
    const dialog = screen.getByRole("dialog", { name: "Retirer ce membre ?" });
    expect(dialog).toHaveTextContent("Hugo Petit n'aura plus accès au projet « BTS SIO 2026 ».");
    expect(actions.removeMember).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Retirer" }));
    expect(actions.removeMember).toHaveBeenCalledWith("p1", "u-ed");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("ne devrait pas proposer au propriétaire de quitter son projet", () => {
    renderAs("owner");
    expect(screen.queryByRole("button", { name: "Quitter ce projet" })).not.toBeInTheDocument();
  });
});

describe("ShareManager — membres", () => {
  it("devrait montrer la liste en lecture seule à un éditeur", () => {
    renderAs("editor");
    expect(screen.queryByLabelText("Adresse e-mail")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Retirer/ })).not.toBeInTheDocument();
    const items = within(memberList()).getAllByRole("listitem");
    expect(items[1]).toHaveTextContent("Hugo Petit (vous)");
    expect(items[1]).toHaveTextContent("Éditeur");
    expect(items[2]).toHaveTextContent("Lecteur");
  });

  it("ne devrait afficher aucune adresse e-mail à un éditeur ni à un lecteur", () => {
    for (const role of ["editor", "viewer"] as const) {
      renderAs(role);
      const list = memberList();
      expect(within(list).getAllByRole("listitem")).toHaveLength(3);
      expect(list).not.toHaveTextContent("@");
      // Pas de ligne d'adresse vide sous le nom.
      expect(list.querySelectorAll("li p")).toHaveLength(3);
      cleanup();
    }
  });

  it("devrait permettre à un lecteur de quitter le projet, puis revenir à la liste des projets", async () => {
    actions.leaveProject.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    renderAs("viewer");
    await user.click(screen.getByRole("button", { name: "Quitter ce projet" }));
    const dialog = screen.getByRole("dialog", { name: "Quitter ce projet ?" });
    await user.click(within(dialog).getByRole("button", { name: "Quitter le projet" }));
    expect(actions.leaveProject).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projets"));
  });
});
