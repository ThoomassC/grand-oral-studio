import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FocusOnMount } from "@/components/ui/FocusOnMount";

afterEach(cleanup);

describe("FocusOnMount", () => {
  it("devrait placer le focus sur l'élément visé au montage", async () => {
    render(
      <>
        <h2 id="titre" tabIndex={-1}>
          Mon deck
        </h2>
        <FocusOnMount targetId="titre" />
      </>,
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: "Mon deck" })).toHaveFocus());
  });
});
