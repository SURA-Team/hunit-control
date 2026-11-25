/**
 * Uma ação principal por bloco (specs/006, FR-007, research R-06): cada botão `primary`
 * (`[data-variant="primary"]`) pertence ao bloco mais próximo que o contém — um card ou área com
 * `data-block`, ou um diálogo — e cada bloco tem no máximo um.
 */
import { expect } from 'vitest';

const BLOCK = '[data-block], [role="dialog"]';

function describeBlock(block: Element): string {
  const name =
    block.getAttribute('data-block') ||
    block.getAttribute('aria-label') ||
    block.querySelector('h1, h2, h3, h4, [role="heading"]')?.textContent?.trim() ||
    block.tagName.toLowerCase();
  return `${block.matches('[role="dialog"]') ? 'diálogo' : 'bloco'} "${name}"`;
}

export function expectOnePrimaryPerBlock(container: ParentNode = document.body): void {
  const primariesByBlock = new Map<Element, string[]>();
  for (const primary of container.querySelectorAll('[data-variant="primary"]')) {
    const block = primary.closest(BLOCK);
    if (!block) continue;
    primariesByBlock.set(block, [
      ...(primariesByBlock.get(block) ?? []),
      primary.textContent?.trim() || (primary.getAttribute('aria-label') ?? '?'),
    ]);
  }
  const offenders = [...primariesByBlock]
    .filter(([, labels]) => labels.length > 1)
    .map(([block, labels]) => `${describeBlock(block)}: ${labels.join(', ')}`);
  expect(offenders.join('; '), 'blocos com mais de uma ação principal').toBe('');
}
