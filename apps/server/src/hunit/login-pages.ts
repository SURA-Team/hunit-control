import type { Locator, Page } from 'playwright';

/**
 * Mensagens de erro do login (Keycloak). O texto e a marcação das mensagens ainda não foram
 * observados no Hunit real (tasks.md, T020): estes são os lugares onde o Keycloak costuma
 * mostrá-las. Por isso aqui se usa CSS, e não papel/rótulo como no resto das telas
 * (constitution, princípio II). Confirmar com as telas reais de senha e token errados.
 */
const ERROR_MESSAGE = [
  '#input-error',
  '#input-error-otp-code',
  '.kc-feedback-text',
  '.alert-error',
  '[role="alert"]',
].join(', ');

function visible(locator: Locator): Promise<boolean> {
  return locator
    .filter({ visible: true })
    .count()
    .then((count) => count > 0);
}

/**
 * Tela de entrada do Hunit (`/login`): mostra só o botão "Login único", que leva ao login
 * (Keycloak). Observada no primeiro acesso real (2026-11-11).
 */
export class HunitEntryPage {
  constructor(private readonly page: Page) {}

  get singleSignOnButton(): Locator {
    return this.page.getByRole('button', { name: /login único/i });
  }

  async isShown(): Promise<boolean> {
    return visible(this.singleSignOnButton);
  }

  async continueToLogin(): Promise<void> {
    await this.singleSignOnButton.click();
  }
}

/**
 * Tela de usuário e senha (Keycloak do Hunit, research R-13): rótulos "Endereço de e-mail" e
 * "Senha".
 */
export class LoginPage {
  constructor(private readonly page: Page) {}

  get usernameField(): Locator {
    return this.page.getByLabel('Endereço de e-mail', { exact: true });
  }

  get passwordField(): Locator {
    return this.page.getByLabel('Senha', { exact: true });
  }

  /** A tela de usuário e senha está aberta. */
  async isShown(): Promise<boolean> {
    return (await visible(this.usernameField)) && (await visible(this.passwordField));
  }

  /** A tela de usuário e senha está aberta e mostra uma mensagem de erro. */
  async isShowingError(): Promise<boolean> {
    return (await this.isShown()) && (await visible(this.page.locator(ERROR_MESSAGE)));
  }

  /** Preenche usuário e senha e envia (Enter no campo de senha, como uma pessoa faria). */
  async submit(username: string, password: string): Promise<void> {
    await this.usernameField.fill(username);
    await this.passwordField.fill(password);
    await this.passwordField.press('Enter');
  }
}

/**
 * Rótulo do campo do token. No primeiro login real (2026-11-11) a tela mostrou "Código do
 * Autenticador"; o HAR anterior tinha "Código de uso único" (o Keycloak muda o texto conforme a
 * configuração). Os dois são aceitos.
 */
const TOKEN_FIELD_LABEL = /^\s*(código do autenticador|código de uso único)\s*$/i;

/**
 * Tela do token de verificação em duas etapas (research R-13). A tela mostra o usuário por
 * extenso; quem capturar evidência dela deve informá-lo como texto sensível.
 */
export class TwoFactorPage {
  constructor(private readonly page: Page) {}

  get tokenField(): Locator {
    return this.page.getByLabel(TOKEN_FIELD_LABEL);
  }

  async isShown(): Promise<boolean> {
    return visible(this.tokenField);
  }

  /** A tela do token está aberta e mostra uma mensagem de erro (token recusado). */
  async isShowingError(): Promise<boolean> {
    return (await this.isShown()) && (await visible(this.page.locator(ERROR_MESSAGE)));
  }

  async submit(token: string): Promise<void> {
    await this.tokenField.fill(token);
    await this.tokenField.press('Enter');
  }
}

/** Página de "sessão de login expirada" do Keycloak (título com "expir"). */
export async function isLoginExpiredPage(page: Page): Promise<boolean> {
  return visible(page.getByRole('heading', { name: /expir/i }));
}
