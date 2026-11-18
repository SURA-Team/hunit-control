/**
 * Verificações de layout dos roteiros de larguras e de redimensionamento (specs/006, SC-007,
 * FR-043 a FR-045, research R-16).
 */
import type { Page } from 'playwright';
import { expect } from 'vitest';

/** A página não rola na horizontal: o documento cabe na largura da janela. */
export async function expectNoHorizontalScroll(page: Page, where = ''): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `rolagem horizontal ${where}`.trim()).toBeLessThanOrEqual(clientWidth);
}

/**
 * Nada marcado como "não cortar" (`data-no-truncate`: valores em reais, selos, rótulos de ação)
 * está cortado: a largura do conteúdo cabe na caixa do elemento. Um elemento `inline` não tem
 * largura medível, então também é apontado: a marca vai numa caixa (`inline-block`, `flex`…).
 */
export async function expectNothingTruncated(page: Page, where = ''): Promise<void> {
  const problems = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-no-truncate]')]
      .filter((element) => element.getClientRects().length > 0)
      .flatMap((element) => {
        const text = (element.textContent ?? '').trim().slice(0, 60);
        if (getComputedStyle(element).display === 'inline') return [`"${text}" (inline)`];
        // 1 px de folga para o arredondamento com zoom.
        return element.scrollWidth > element.clientWidth + 1
          ? [`"${text}" (${element.scrollWidth} > ${element.clientWidth})`]
          : [];
      }),
  );
  expect(problems, `elementos cortados ${where}`.trim()).toEqual([]);
}
