import { afterEach, describe, expect, it, vi } from "vitest";
import { focusFirstInvalid, focusLater } from "@/components/ui/focus";

/**
 * Les nouvelles tentatives de focus survivent au composant qui les a lancées
 * (~1,5 s). Si l'environnement disparaît entre-temps (fin d'un fichier de test
 * jsdom, observé en CI : « ReferenceError: document is not defined »), elles ne
 * doivent pas dépendre du `document` global.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("focusLater", () => {
  it("ne devrait pas lever quand le document global disparaît pendant les nouvelles tentatives", () => {
    vi.useFakeTimers();
    focusLater(["absent"]);
    vi.advanceTimersByTime(100);
    vi.stubGlobal("document", undefined);
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});

describe("focusLater — window disparu", () => {
  // Observé en CI : « ReferenceError: window is not defined » dans tryFocus (ThemeManager.test).
  it("ne devrait pas lever quand le window global disparaît pendant les nouvelles tentatives", () => {
    vi.useFakeTimers();
    focusLater(["absent"]);
    vi.advanceTimersByTime(100);
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("HTMLInputElement", undefined);
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});

describe("focusFirstInvalid", () => {
  it("ne devrait pas lever quand le window global disparaît pendant les nouvelles tentatives", () => {
    vi.useFakeTimers();
    const form = window.document.createElement("form");
    focusFirstInvalid(form);
    vi.advanceTimersByTime(70);
    vi.stubGlobal("window", undefined);
    expect(() => vi.runAllTimers()).not.toThrow();
  });

  it("ne devrait pas lever quand le document global disparaît pendant les nouvelles tentatives", () => {
    vi.useFakeTimers();
    const form = window.document.createElement("form");
    focusFirstInvalid(form);
    vi.advanceTimersByTime(70);
    vi.stubGlobal("document", undefined);
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});
