import { chromium, type Browser, type BrowserContext } from 'playwright';

/**
 * Abre o Chromium de uma execução. Cada execução tem o seu navegador, então sessões, cookies e
 * falhas de uma não afetam as outras.
 */
export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

/**
 * Contexto (perfil) do navegador para falar com o Hunit:
 * - service workers bloqueados: eles fariam requisições fora do alcance da proteção de somente
 *   leitura (`read-only-guard.ts`);
 * - idioma e fuso do Brasil, como um operador veria a tela.
 */
export async function newHunitContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    serviceWorkers: 'block',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 900 },
  });
}
