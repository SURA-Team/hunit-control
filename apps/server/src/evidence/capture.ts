import type { Locator, Page } from 'playwright';
import type { EvidenceMaterial } from './material.js';
import { sanitizeHtml } from './sanitize.js';

export interface CaptureOptions {
  /**
   * Textos que não podem aparecer na captura além do conteúdo dos campos — por exemplo o
   * usuário, que a tela do token exibe por extenso. Os elementos que os contêm são cobertos.
   */
  sensitiveTexts?: readonly string[];
  /** Tempo máximo de cada etapa da captura, em milissegundos. */
  timeoutMs?: number;
}

/** Tudo em que o usuário (ou a automação) pode ter digitado algo. */
const INPUT_FIELDS = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

const DEFAULT_TIMEOUT_MS = 10_000;
const MASK_COLOR = '#000000';

/**
 * Registra o que a tela mostra no momento de uma falha (FR-024), sem levar credenciais junto
 * (FR-025; research R-12):
 *
 * - a captura de tela cobre todos os campos de entrada e os textos sensíveis informados;
 * - o HTML sai sem o valor dos campos de entrada.
 *
 * Textos que fazem parte da própria página (como o usuário exibido na tela do token) continuam
 * no HTML devolvido; eles são apagados na gravação, pelo registro de segredos (`EvidenceStore`).
 *
 * Nunca lança erro: se a página já foi fechada ou travou, devolve só o que conseguiu obter —
 * a falha original, que motivou a captura, é a que importa.
 */
export async function capturePageEvidence(
  page: Page,
  options: CaptureOptions = {},
): Promise<EvidenceMaterial> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const material: EvidenceMaterial = {};

  // O HTML vem antes: a captura de tela altera a página por um instante para aplicar a máscara.
  try {
    material.html = sanitizeHtml(await withTimeout(page.content(), timeout));
  } catch {
    // Página fechada, navegando ou travada: segue sem o HTML.
  }

  const masks: Locator[] = [page.locator(INPUT_FIELDS)];
  for (const text of options.sensitiveTexts ?? []) {
    const trimmed = text.trim();
    if (trimmed !== '') masks.push(page.getByText(trimmed));
  }

  try {
    material.screenshot = await page.screenshot({
      fullPage: true,
      mask: masks,
      maskColor: MASK_COLOR,
      animations: 'disabled',
      caret: 'hide',
      timeout,
    });
  } catch {
    // Idem: segue sem a captura de tela.
  }

  return material;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('tempo esgotado')), timeoutMs);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}
