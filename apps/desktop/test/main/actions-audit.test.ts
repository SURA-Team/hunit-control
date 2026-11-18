/**
 * Auditoria das ações no código (specs/006, T040, FR-010, FR-013, research R-06): no código da
 * interface (`renderer/`, fora de `ui/`, que define as variantes), todo `Action` usa uma das seis
 * variantes e todo `DocumentAction` um dos quatro tipos, escritos no próprio código (literal ou
 * condição entre literais), e nenhum botão usa o "Leve" (`variant="light"`).
 *
 * Fica com os testes do Node porque lê os arquivos; a outra metade da T040 (uma principal por bloco
 * nas telas migradas) está em `test/renderer/actions-hierarchy.test.tsx`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RENDERER = path.resolve(import.meta.dirname, '..', '..', 'src', 'renderer', 'src');

const ACTION_VARIANTS = new Set([
  'primary',
  'secondary',
  'text',
  'warning',
  'danger-light',
  'danger',
]);
const DOCUMENT_KINDS = new Set(['download', 'revert', 'undo', 'remove']);
/** Botões do Mantine que ainda existem nas telas não migradas: nenhum pode ser "Leve". */
const MANTINE_BUTTONS = new Set(['Button', 'ActionIcon']);

interface Finding {
  where: string;
  problem: string;
}

/** Os valores possíveis de uma expressão, se ela for literal ou condição entre literais. */
function literalValues(expression: ts.Expression): string[] | null {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isParenthesizedExpression(expression)) return literalValues(expression.expression);
  if (ts.isConditionalExpression(expression)) {
    const whenTrue = literalValues(expression.whenTrue);
    const whenFalse = literalValues(expression.whenFalse);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }
  return null;
}

function attributeValues(attribute: ts.JsxAttribute): string[] | null {
  const value = attribute.initializer;
  if (!value) return null;
  if (ts.isStringLiteral(value)) return [value.text];
  if (ts.isJsxExpression(value) && value.expression) return literalValues(value.expression);
  return null;
}

/** Confere as ações de um arquivo `.tsx`; `name` aparece nas mensagens. */
function auditSource(name: string, text: string): Finding[] {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];

  function check(element: ts.JsxOpeningElement | ts.JsxSelfClosingElement) {
    const tag = element.tagName.getText(source);
    const attributes = new Map<string, ts.JsxAttribute>();
    for (const property of element.attributes.properties) {
      if (ts.isJsxAttribute(property)) attributes.set(property.name.getText(source), property);
    }
    const line = source.getLineAndCharacterOfPosition(element.getStart(source)).line + 1;
    const where = `${name}:${line} <${tag}>`;
    const closed = (prop: string, allowed: ReadonlySet<string>) => {
      const attribute = attributes.get(prop);
      const values = attribute ? attributeValues(attribute) : null;
      if (values === null) {
        findings.push({ where, problem: `${prop} não está escrito no código (literal)` });
        return;
      }
      for (const value of values.filter((candidate) => !allowed.has(candidate))) {
        findings.push({ where, problem: `${prop} "${value}" fora da lista` });
      }
    };

    if (tag === 'Action') closed('variant', ACTION_VARIANTS);
    if (tag === 'DocumentAction') closed('kind', DOCUMENT_KINDS);
    if (MANTINE_BUTTONS.has(tag)) {
      const variant = attributes.get('variant');
      if (variant && attributeValues(variant)?.includes('light')) {
        findings.push({ where, problem: 'botão "Leve" (FR-013)' });
      }
    }
  }

  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) check(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return findings;
}

function screenSources(): Array<{ name: string; text: string }> {
  return readdirSync(RENDERER, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx') && !file.split(path.sep).includes('ui'))
    .map((file) => ({
      name: file.split(path.sep).join('/'),
      text: readFileSync(path.join(RENDERER, file), 'utf8'),
    }));
}

describe('variantes no código (R-06, FR-010, FR-013)', () => {
  const sources = screenSources();

  it('todo Action e DocumentAction usa uma variante da lista; nenhum botão "Leve"', () => {
    const findings = sources.flatMap(({ name, text }) => auditSource(name, text));
    expect(findings.map((finding) => `${finding.where}: ${finding.problem}`)).toEqual([]);
  });

  it('a varredura alcança as telas (não passa à toa)', () => {
    const names = sources.map((source) => source.name);
    expect(names).toContain('screens/reservations/TreatmentSection.tsx');
    expect(names.some((name) => name.startsWith('ui/'))).toBe(false);
    const actions = sources.reduce(
      (total, { text }) => total + (text.match(/<(Action|DocumentAction)\b/g)?.length ?? 0),
      0,
    );
    expect(actions).toBeGreaterThan(30);
  });

  it('acusa variante fora da lista, variante calculada, tipo de documento inválido e o "Leve"', () => {
    const findings = auditSource(
      'exemplo.tsx',
      [
        'export const a = <Action variant="light">Leve</Action>;',
        'export const b = <Action variant={tone}>Calculada</Action>;',
        'export const c = <Action variant={open ? "primary" : "lime"}>Condição</Action>;',
        'export const d = <DocumentAction kind="delete" />;',
        'export const e = <Button color="lime" variant="light">Leve</Button>;',
        'export const f = <Action variant={open ? "primary" : "secondary"}>Certo</Action>;',
        'export const g = <DocumentAction kind="undo" onClick={() => undo()} />;',
      ].join('\n'),
    );
    expect(findings).toEqual([
      { where: 'exemplo.tsx:1 <Action>', problem: 'variant "light" fora da lista' },
      { where: 'exemplo.tsx:2 <Action>', problem: 'variant não está escrito no código (literal)' },
      { where: 'exemplo.tsx:3 <Action>', problem: 'variant "lime" fora da lista' },
      { where: 'exemplo.tsx:4 <DocumentAction>', problem: 'kind "delete" fora da lista' },
      { where: 'exemplo.tsx:5 <Button>', problem: 'botão "Leve" (FR-013)' },
    ]);
  });
});
