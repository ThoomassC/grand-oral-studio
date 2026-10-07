import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Glossaire 1.2.0 : un seul mot par notion dans les textes visibles.
 *  - « diaporama » (jamais « deck ») ;
 *  - « Sans IA » (jamais « moteur gratuit ») ;
 *  - « Rédaction IA » (jamais « Configuration IA ») ;
 *  - « vos consignes » (jamais « prompt »).
 *
 * Le test lit l'arbre syntaxique de chaque fichier .ts/.tsx de src (hors tests,
 * hors code Prisma généré, hors historique des notes de version) : les
 * commentaires sont ignorés d'office, seuls les textes JSX et les chaînes
 * littérales sont examinés. Les chaînes qui ressemblent à du code (identifiant
 * seul, chemin, nom de fichier, attribut technique, type littéral, import) sont
 * écartées ; le reste est considéré comme visible.
 */

const SRC = path.resolve(process.cwd(), "src");

const FORBIDDEN: readonly { label: string; pattern: RegExp }[] = [
  { label: "deck", pattern: /\bdecks?\b/gi },
  { label: "moteur gratuit", pattern: /moteurs? gratuits?/gi },
  { label: "Configuration IA", pattern: /configuration IA/gi },
  { label: "prompt", pattern: /\bprompts?\b/gi },
];

/**
 * Liste blanche explicite (chemins relatifs à src). Chaque entrée dit pourquoi
 * ses chaînes ne sont jamais lues par l'utilisateur.
 */
const ALLOWLIST: readonly { file: string; reason: string }[] = [
  {
    file: "domain/releases.ts",
    reason: "Historique des notes de version : les versions publiées (1.0, 1.1) gardent les mots de leur époque.",
  },
  {
    file: "domain/prompts.ts",
    reason: "Consignes envoyées au modèle d'IA (« deck », « slide decks ») : jamais affichées, seul le diaporama produit l'est.",
  },
  {
    file: "domain/task-prompts.ts",
    reason: "Consignes envoyées au modèle d'IA pour une diapo ou les questions du jury : jamais affichées.",
  },
];

/** Fichiers jamais examinés : tests, code Prisma généré, liste blanche. */
function isExcludedFile(rel: string): boolean {
  return (
    rel.includes("__tests__/") ||
    /\.test\.tsx?$/.test(rel) ||
    rel.startsWith("test/") ||
    rel.startsWith("server/db/generated/") ||
    ALLOWLIST.some((a) => a.file === rel)
  );
}

/** Attributs JSX qui ne sont jamais lus par l'utilisateur. */
const TECHNICAL_ATTRIBUTES = new Set([
  "className",
  "href",
  "id",
  "key",
  "htmlFor",
  "name",
  "type",
  "role",
  "src",
  "rel",
  "target",
  "method",
  "autoComplete",
  "form",
  "accept",
  "action",
  "variant",
  "size",
  "as",
  "lang",
]);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Vrai si la chaîne littérale occupe une place de code, pas de texte. */
function isStructural(node: ts.Node): boolean {
  for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
    if (
      ts.isImportDeclaration(cur) ||
      ts.isExportDeclaration(cur) ||
      ts.isExternalModuleReference(cur) ||
      ts.isLiteralTypeNode(cur) ||
      ts.isImportTypeNode(cur) ||
      ts.isTaggedTemplateExpression(cur)
    ) {
      return true;
    }
    if (ts.isCallExpression(cur) && cur.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isJsxAttribute(cur)) {
      const name = cur.name.getText();
      return TECHNICAL_ATTRIBUTES.has(name) || name.startsWith("data-");
    }
    // On ne remonte pas au-delà de l'expression qui porte la chaîne.
    if (ts.isStatement(cur) || ts.isJsxElement(cur) || ts.isJsxSelfClosingElement(cur)) break;
  }
  const parent = node.parent;
  if (parent && (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent))) {
    if (parent.name === node) return true;
  }
  if (parent && ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  return false;
}

/** Identifiant, clé, nom de fichier ou chemin seul : ce n'est pas une phrase. */
function looksLikeCode(text: string): boolean {
  const t = text.trim();
  return /^[a-z][\w.-]*$/.test(t) || /^[@./~][^\s]*$/.test(t) || /^[A-Z][A-Za-z]+[A-Z]\w*$/.test(t);
}

interface Hit {
  file: string;
  line: number;
  term: string;
  text: string;
}

/** Textes visibles d'un source qui sortent du glossaire. */
function scanSource(rel: string, source: string): Hit[] {
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: Hit[] = [];

  const check = (node: ts.Node, text: string) => {
    if (!text.trim() || looksLikeCode(text)) return;
    for (const { label, pattern } of FORBIDDEN) {
      for (const match of text.matchAll(pattern)) {
        const end = match.index + match[0].length;
        const before = text.slice(Math.max(0, match.index - 2), match.index).padStart(2, " ");
        const after = text.slice(end, end + 2).padEnd(2, " ");
        // Segment de chemin, nom de fichier, clé composée : du code dans une phrase
        // (« /decks/ », « deck-editor », « deck.ts », « prompt_id »). Un point ou un
        // tiret suivi d'une espace reste de la ponctuation.
        if (/[/_@#$]$/.test(before) || /\w[.\-:]$/.test(before)) continue;
        if (/^[/_=(]/.test(after) || /^[.\-:]\w/.test(after)) continue;
        hits.push({
          file: rel,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          term: label,
          text: text.trim().slice(0, 160),
        });
      }
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      check(node, node.text);
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (!isStructural(node)) check(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function scanFile(full: string): Hit[] {
  const rel = path.relative(SRC, full).split(path.sep).join("/");
  return isExcludedFile(rel) ? [] : scanSource(rel, readFileSync(full, "utf8"));
}

describe("glossaire des textes visibles", () => {
  const files = listSourceFiles(SRC);

  it("devrait examiner les fichiers de src", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("ne devrait contenir ni « deck », ni « moteur gratuit », ni « Configuration IA », ni « prompt »", () => {
    const hits = files.flatMap(scanFile);
    const report = hits.map((h) => `${h.file}:${h.line} [${h.term}] ${h.text}`).join("\n");
    expect(hits, `Textes visibles hors glossaire :\n${report}`).toEqual([]);
  });

  it("devrait signaler un texte JSX, un attribut lisible et un message d'erreur", () => {
    const sample = [
      'const a = <p title="Mon prompt">Mes decks</p>;',
      'throw new Error(`Choisissez le moteur gratuit dans la Configuration IA.`);',
      'const b = { label: "Deck final." };',
    ].join("\n");
    expect(scanSource("sample.tsx", sample).map((h) => h.term).sort()).toEqual(
      ["Configuration IA", "deck", "deck", "moteur gratuit", "prompt"].sort(),
    );
  });

  it("devrait ignorer commentaires, imports, chemins, identifiants, types et attributs techniques", () => {
    const sample = [
      "// un deck en commentaire, un prompt aussi",
      "/** Configuration IA : moteur gratuit. */",
      'import x from "@/components/deck/Deck";',
      "type K = \"deck\" | \"prompt\";",
      'const b = `/projets/${x}/decks/1`;',
      'const c = { deck: "deckId", prompt: "prompt" };',
      'const d = <a href="/decks" className="deck-card" data-testid="deck list">ok</a>;',
      'const e = "src/domain/prompts.ts";',
    ].join("\n");
    expect(scanSource("sample.tsx", sample)).toEqual([]);
  });

  it("devrait justifier chaque entrée de la liste blanche par un fichier existant", () => {
    for (const entry of ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(files.map((f) => path.relative(SRC, f).split(path.sep).join("/"))).toContain(entry.file);
    }
  });
});
