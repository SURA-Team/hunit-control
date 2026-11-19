/**
 * Verificações de layout dos roteiros de larguras e de redimensionamento (specs/006, SC-007,
 * FR-043 a FR-045, research R-16).
 */
import type { Locator, Page } from 'playwright';
import { expect } from 'vitest';

/** Retângulo de um elemento e a área visível da página, em px de CSS (valem com qualquer zoom). */
interface Placement {
  top: number;
  right: number;
  bottom: number;
  left: number;
  viewportWidth: number;
  viewportHeight: number;
}

async function placementOf(locator: Locator): Promise<Placement> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
    };
  });
}

/**
 * A informação ou a ação existe e está ao alcance (SC-007, US9-1): visível depois de rolar até ela
 * e inteira na largura da área visível (nada escondido à direita).
 */
export async function expectReachable(locator: Locator, where = ''): Promise<void> {
  const label = `${locator.toString()} ${where}`.trim();
  await locator.scrollIntoViewIfNeeded();
  expect(await locator.isVisible(), `não visível: ${label}`).toBe(true);
  const place = await placementOf(locator);
  expect(place.left, `fora da área visível, à esquerda: ${label}`).toBeGreaterThanOrEqual(-0.5);
  expect(place.right, `fora da área visível, à direita: ${label}`).toBeLessThanOrEqual(
    place.viewportWidth + 0.5,
  );
}

/**
 * O diálogo cabe na área visível e fica centralizado nela (FR-047, US9-5; o conteúdo rola por
 * dentro quando não cabe).
 */
export async function expectDialogFits(dialog: Locator, where = ''): Promise<void> {
  // A entrada do diálogo desliza alguns px: mede depois das animações (as finitas) terminarem.
  await dialog.evaluate((element) =>
    Promise.all(
      element
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished),
    ),
  );
  const place = await placementOf(dialog);
  const box = JSON.stringify(place);
  expect(
    place.left >= -0.5 && place.top >= -0.5,
    `diálogo fora da área visível ${where}: ${box}`,
  ).toBe(true);
  expect(
    place.right <= place.viewportWidth + 0.5 && place.bottom <= place.viewportHeight + 0.5,
    `diálogo maior que a área visível ${where}: ${box}`,
  ).toBe(true);
  const sides = Math.abs(place.left - (place.viewportWidth - place.right));
  const ends = Math.abs(place.top - (place.viewportHeight - place.bottom));
  expect(sides <= 2 && ends <= 2, `diálogo fora do centro ${where}: ${box}`).toBe(true);
}

/**
 * Os 24 px de espaçamento interno do diálogo, calculados pelo navegador (SC-009, FR-042, research
 * R-14): cabeçalho em cima e dos lados, corpo dos lados e embaixo.
 */
export async function expectDialogSpacing(dialog: Locator, where = ''): Promise<void> {
  const spacing = await dialog.evaluate((element) => {
    const header = element.querySelector('.mantine-Modal-header');
    const body = element.querySelector('.mantine-Modal-body');
    if (!header || !body) return null;
    const h = getComputedStyle(header);
    const b = getComputedStyle(body);
    return [
      h.paddingTop,
      h.paddingLeft,
      h.paddingRight,
      b.paddingLeft,
      b.paddingRight,
      b.paddingBottom,
    ];
  });
  expect(spacing, `espaçamento do diálogo ${where}`.trim()).toEqual(Array(6).fill('24px'));
}

/**
 * O menu lateral (FR-044, US9-4; research R-07): recolhido só com os ícones (o nome fica na dica)
 * ou aberto com os nomes, e a área ativa identificável — em pílula, com o nome acessível, inteira
 * na área visível.
 */
export async function expectSideMenu(
  page: Page,
  expected: { collapsed: boolean; active: string },
  where = '',
): Promise<void> {
  const menu = await page.evaluate(() => {
    const current = document.querySelector<HTMLElement>(
      'nav[aria-label="Áreas do app"] [aria-current="page"]',
    );
    if (!current) return null;
    const rect = current.getBoundingClientRect();
    const name = current.lastElementChild?.getBoundingClientRect();
    return {
      active: current.getAttribute('aria-label'),
      inside:
        rect.width > 0 &&
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= document.documentElement.clientWidth &&
        rect.bottom <= document.documentElement.clientHeight,
      pill: getComputedStyle(current).backgroundColor !== 'rgba(0, 0, 0, 0)',
      nameShown: (name?.width ?? 0) > 1,
      tooltip: getComputedStyle(current, '::after').content,
    };
  });
  expect(menu, `menu sem área ativa ${where}`.trim()).not.toBeNull();
  expect(menu, `menu ${where}`.trim()).toMatchObject({
    active: expected.active,
    inside: true,
    pill: true,
    nameShown: !expected.collapsed,
  });
  if (expected.collapsed) {
    expect(menu?.tooltip, `dica do menu recolhido ${where}`.trim()).toBe(`"${expected.active}"`);
  }
}

/**
 * Células de tabela com conteúdo maior que elas (homologação da 006, T068). As colunas têm largura
 * fixa: um texto que não cabe não alarga a coluna, passa por cima da vizinha. Devolve uma linha por
 * célula, com a coluna, o começo do texto e as larguras.
 */
export async function cellOverflows(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('table th, table td')]
      .filter((cell) => cell.getClientRects().length > 0)
      .flatMap((cell) => {
        // 1 px de folga para o arredondamento com zoom.
        if (cell.scrollWidth <= cell.clientWidth + 1) return [];
        const table = cell.closest('table')?.getAttribute('aria-label') ?? 'tabela';
        const text = (cell.textContent ?? '').trim().slice(0, 40);
        return [
          `${table}, coluna ${cell.dataset['col'] ?? '?'}: "${text}" (${cell.scrollWidth} > ${cell.clientWidth})`,
        ];
      }),
  );
}

/** Nenhuma célula de tabela transborda para a vizinha (`cellOverflows`). */
export async function expectCellsFit(page: Page, where = ''): Promise<void> {
  expect(await cellOverflows(page), `células que transbordam ${where}`.trim()).toEqual([]);
}

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
