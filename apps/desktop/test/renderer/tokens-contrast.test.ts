/**
 * Contraste dos pares de cor de texto do design (specs/006, SC-005, research R-16): todo par usado
 * nas telas tem pelo menos 4,5:1, menos as exceções conhecidas do design (research UX-1). As
 * exceções têm de continuar abaixo de 4,5:1: quando a UX ajustar uma cor, o teste pede para tirar o
 * par da lista.
 */
import { describe, expect, it } from 'vitest';
import {
  colors,
  CONTRAST_EXCEPTIONS,
  TEXT_COLOR_PAIRS,
  type ColorToken,
  type TextColorPair,
} from '../../src/renderer/src/ui/tokens';

/** Luminância relativa da WCAG 2.x de uma cor `#rrggbb`. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(text: ColorToken, background: ColorToken): number {
  const [lighter = 0, darker = 0] = [luminance(colors[text]), luminance(colors[background])].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const isException = (pair: Pick<TextColorPair, 'text' | 'background'>) =>
  CONTRAST_EXCEPTIONS.some(
    (exception) => exception.text === pair.text && exception.background === pair.background,
  );

const named = (pairs: readonly Pick<TextColorPair, 'text' | 'background'>[]) =>
  pairs.map((pair) => [`${pair.text} em ${pair.background}`, pair] as const);

describe('contraste dos pares de texto do design (SC-005)', () => {
  it.each(named(TEXT_COLOR_PAIRS.filter((pair) => !isException(pair))))(
    '%s tem 4,5:1 ou mais',
    (_, pair) => {
      expect(contrast(pair.text, pair.background)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(named(CONTRAST_EXCEPTIONS))(
    'a exceção %s continua abaixo de 4,5:1 (se a UX ajustou a cor, tire o par da lista)',
    (_, pair) => {
      expect(contrast(pair.text, pair.background)).toBeLessThan(4.5);
    },
  );

  it('toda exceção é um par usado nas telas', () => {
    for (const exception of CONTRAST_EXCEPTIONS) {
      expect(
        TEXT_COLOR_PAIRS.some(
          (pair) => pair.text === exception.text && pair.background === exception.background,
        ),
      ).toBe(true);
    }
  });

  it('a conta confere com o levantamento da research (UX-1)', () => {
    expect(contrast('texto/apagado', 'fundo/padrão')).toBeCloseTo(4.23, 1);
    expect(contrast('texto/apagado', 'fundo/app')).toBeCloseTo(3.62, 1);
    expect(contrast('texto/apagado', 'fundo/sutil')).toBeCloseTo(3.88, 1);
    expect(contrast('texto/placeholder', 'fundo/sutil')).toBeCloseTo(2.16, 1);
    expect(contrast('texto/inverso', 'amarelo/8')).toBeCloseTo(3.12, 1);
  });
});
