import { describe, expect, it, vi } from "vitest";
import {
  applyPreferences,
  DEFAULT_PREFERENCES,
  MOTION_ATTRIBUTE,
  parsePreferences,
  PREFERENCES_STORAGE_KEY,
  preferencesScript,
  readStoredPreferences,
  serializePreferences,
  TEXT_SIZE_ATTRIBUTE,
  writeStoredPreferences,
  type PreferencesStorage,
} from "@/components/preferences/preferences";

function memoryStorage(initial: Record<string, string> = {}): PreferencesStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

const throwing: PreferencesStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("parsePreferences", () => {
  it("devrait renvoyer les défauts sans valeur mémorisée", () => {
    expect(parsePreferences(null)).toEqual({ textSize: "standard", motion: "system" });
    expect(parsePreferences(null)).toBe(DEFAULT_PREFERENCES);
  });

  it("devrait relire une valeur valide", () => {
    expect(parsePreferences(JSON.stringify({ textSize: "xlarge", motion: "reduced" }))).toEqual({
      textSize: "xlarge",
      motion: "reduced",
    });
  });

  it("devrait remplacer champ par champ une valeur inconnue par son défaut", () => {
    expect(parsePreferences(JSON.stringify({ textSize: "géant", motion: "reduced" }))).toEqual({
      textSize: "standard",
      motion: "reduced",
    });
    expect(parsePreferences(JSON.stringify({ textSize: "large", motion: 1 }))).toEqual({ textSize: "large", motion: "system" });
  });

  it.each(["{pas du json", "42", "null", "[]", '"large"', JSON.stringify({ textSize: "__proto__" })])(
    "devrait tolérer une valeur corrompue (%s) et renvoyer les défauts",
    (raw) => {
      expect(parsePreferences(raw)).toEqual(DEFAULT_PREFERENCES);
    },
  );

  it("devrait ignorer les champs en trop", () => {
    expect(parsePreferences(JSON.stringify({ textSize: "large", motion: "system", evil: "<script>" }))).toEqual({
      textSize: "large",
      motion: "system",
    });
  });
});

describe("lecture et écriture du stockage", () => {
  it("devrait écrire sous une clé versionnée puis relire la même valeur", () => {
    const storage = memoryStorage();
    expect(PREFERENCES_STORAGE_KEY).toMatch(/:v\d+$/);
    expect(writeStoredPreferences(() => storage, { textSize: "large", motion: "reduced" })).toBe(true);
    expect(storage.getItem(PREFERENCES_STORAGE_KEY)).toBe(serializePreferences({ textSize: "large", motion: "reduced" }));
    expect(readStoredPreferences(() => storage)).toEqual({ available: true, raw: storage.getItem(PREFERENCES_STORAGE_KEY) });
  });

  it("devrait signaler un stockage qui lève, sans lever", () => {
    expect(readStoredPreferences(() => throwing)).toEqual({ available: false });
    expect(writeStoredPreferences(() => throwing, DEFAULT_PREFERENCES)).toBe(false);
  });

  it("devrait signaler un accès au stockage qui lève (window.localStorage refusé)", () => {
    const denied = () => {
      throw new Error("SecurityError");
    };
    expect(readStoredPreferences(denied)).toEqual({ available: false });
    expect(writeStoredPreferences(denied, DEFAULT_PREFERENCES)).toBe(false);
  });
});

describe("applyPreferences", () => {
  it("devrait poser les deux attributs sur la racine", () => {
    const setAttribute = vi.fn();
    applyPreferences({ setAttribute }, { textSize: "xlarge", motion: "reduced" });
    expect(setAttribute).toHaveBeenCalledWith(TEXT_SIZE_ATTRIBUTE, "xlarge");
    expect(setAttribute).toHaveBeenCalledWith(MOTION_ATTRIBUTE, "reduced");
  });
});

describe("preferencesScript (avant la première peinture)", () => {
  function run(getItem: () => string | null) {
    const attrs = new Map<string, string>();
    const document = { documentElement: { setAttribute: (k: string, v: string) => void attrs.set(k, v) } };
    const localStorage = { getItem };
    new Function("document", "localStorage", preferencesScript())(document, localStorage);
    return Object.fromEntries(attrs);
  }

  it("devrait poser les attributs mémorisés", () => {
    const raw = serializePreferences({ textSize: "large", motion: "reduced" });
    expect(run(() => raw)).toEqual({ [TEXT_SIZE_ATTRIBUTE]: "large", [MOTION_ATTRIBUTE]: "reduced" });
  });

  it("devrait poser les défauts sans valeur, avec une valeur corrompue ou inconnue", () => {
    const defaults = { [TEXT_SIZE_ATTRIBUTE]: "standard", [MOTION_ATTRIBUTE]: "system" };
    expect(run(() => null)).toEqual(defaults);
    expect(run(() => "{oups")).toEqual(defaults);
    expect(run(() => JSON.stringify({ textSize: "x\" onload=", motion: "toString" }))).toEqual(defaults);
  });

  it("devrait poser les défauts quand le stockage lève", () => {
    expect(
      run(() => {
        throw new Error("SecurityError");
      }),
    ).toEqual({ [TEXT_SIZE_ATTRIBUTE]: "standard", [MOTION_ATTRIBUTE]: "system" });
  });

  it("devrait lire la même clé que l'application", () => {
    expect(preferencesScript()).toContain(JSON.stringify(PREFERENCES_STORAGE_KEY));
  });
});
