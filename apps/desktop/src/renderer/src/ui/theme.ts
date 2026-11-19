/**
 * Tema do Mantine da nova identidade (specs/006, research R-02), gerado de ui/tokens.ts: a fonte
 * Manrope, o principal preto, os raios e as paletas do design. As variáveis `--hc-*` dos tokens
 * entram na raiz do documento pelo `cssVariablesResolver`, junto com as do Mantine: uma fonte só
 * para os valores, sem cópia em CSS.
 *
 * Os componentes de ui/ usam o Mantine por baixo (acessibilidade, foco, portais, calendário); as
 * paletas servem a eles. Os tons que o design não define são interpolados e não são usados direto.
 */
import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';
import { colors, cssVariables, fontFamily, radii, shadows } from './tokens';

/** Mistura duas cores `#rrggbb` em sRGB: `t = 0` dá `from`, `t = 1` dá `to`. */
function mix(from: string, to: string, t: number): string {
  const channel = (hex: string, start: number) => parseInt(hex.slice(start, start + 2), 16);
  return `#${[1, 3, 5]
    .map((start) =>
      Math.round(channel(from, start) + (channel(to, start) - channel(from, start)) * t),
    )
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Paleta de 10 tons com os tons do design nas posições deles (`{ 1: verde/1, 8: verde/8, 9: verde/9 }`)
 * e os outros interpolados entre os vizinhos. O tom 0 é metade do caminho entre o branco e o
 * primeiro tom do design, quando o design não o define.
 */
function palette(anchors: Record<number, string>): MantineColorsTuple {
  const known = new Map<number, string>(Object.entries(anchors).map(([k, v]) => [Number(k), v]));
  const first = Math.min(...known.keys());
  if (!known.has(0)) known.set(0, mix('#ffffff', known.get(first) ?? '#ffffff', 0.5));
  const indexes = [...known.keys()].sort((a, b) => a - b);
  const shades = Array.from({ length: 10 }, (_, shade) => {
    const exact = known.get(shade);
    if (exact) return exact;
    const before = indexes.filter((i) => i < shade).at(-1) ?? 0;
    const after = indexes.find((i) => i > shade);
    if (after === undefined) return known.get(before) ?? '#000000';
    return mix(
      known.get(before) ?? '#ffffff',
      known.get(after) ?? '#000000',
      (shade - before) / (after - before),
    );
  });
  return shades as unknown as MantineColorsTuple;
}

/** Neutros do design, do fundo sutil ao preto: também a paleta `gray` que o Mantine usa por dentro. */
const cinza = palette({
  0: colors['fundo/sutil'],
  1: colors['cinza/1'],
  2: colors['borda/padrão'],
  3: colors['borda/campo'],
  4: colors['borda/campo'],
  5: colors['texto/placeholder'],
  6: colors['texto/apagado'],
  7: colors['texto/ícone'],
  8: colors['superfície/escura 2'],
  9: colors['cinza/9'],
});

/** O principal: preto no tom 6 (o que o Mantine usa no tema claro), quase preto no 7 (passar o mouse). */
const preto = palette({
  0: colors['fundo/sutil'],
  1: colors['cinza/1'],
  2: colors['borda/padrão'],
  3: colors['borda/campo'],
  4: colors['texto/placeholder'],
  5: colors['texto/apagado'],
  6: colors['superfície/escura'],
  7: colors['superfície/escura 2'],
  8: colors['texto/ícone'],
  9: colors['superfície/escura'],
});

const lima = palette({
  1: colors['destaque/lima suave'],
  6: colors['destaque/lima'],
  9: colors['azul/9'],
});
const verde = palette({ 1: colors['verde/1'], 8: colors['verde/8'], 9: colors['verde/9'] });
const amarelo = palette({ 1: colors['amarelo/1'], 8: colors['amarelo/8'], 9: colors['amarelo/9'] });
const vermelho = palette({
  1: colors['vermelho/1'],
  6: colors['vermelho/6'],
  8: colors['vermelho/8'],
  9: colors['vermelho/9'],
});

export const theme = createTheme({
  fontFamily,
  headings: { fontFamily, fontWeight: '700' },
  black: colors['texto/padrão'],
  white: colors['fundo/padrão'],
  primaryColor: 'preto',
  primaryShade: 6,
  defaultRadius: radii.field,
  shadows: {
    xs: shadows.card,
    sm: shadows.card,
    md: shadows.flutuante,
    lg: shadows.flutuante,
    xl: shadows.flutuante,
  },
  cursorType: 'pointer',
  colors: {
    preto,
    cinza,
    lima,
    verde,
    amarelo,
    vermelho,
    // As cores de nome padrão do Mantine, usadas pelas telas que ainda não migraram, já saem nos
    // tons do design.
    gray: cinza,
    green: verde,
    yellow: amarelo,
    red: vermelho,
  },
});

/** Variáveis `--hc-*` dos tokens e os textos apagados e de placeholder do Mantine nos tons do design. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: cssVariables(),
  light: {
    '--mantine-color-body': colors['fundo/padrão'],
    '--mantine-color-text': colors['texto/padrão'],
    '--mantine-color-dimmed': colors['texto/apagado'],
    '--mantine-color-placeholder': colors['texto/placeholder'],
    '--mantine-color-default-border': colors['borda/padrão'],
    // Botão "Desabilitado" do design, também para os campos desabilitados.
    '--mantine-color-disabled': colors['fundo/desabilitado'],
    '--mantine-color-disabled-color': colors['texto/placeholder'],
    '--mantine-color-disabled-border': colors['borda/padrão'],
  },
  dark: {},
});
