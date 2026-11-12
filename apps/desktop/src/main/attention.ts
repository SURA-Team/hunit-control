/**
 * Aviso do pedido de token (specs/002, FR-011, FR-014, research R-07).
 *
 * No mesmo instante: notificação do Windows com som; janela restaurada, mostrada e "sempre por
 * cima" por um instante; botão piscando na barra de tarefas até o operador clicar na janela; e o
 * som do app, tocado pela interface, só com a preferência ligada. O Windows pode não deixar um
 * programa em segundo plano tomar o foco do teclado; o efeito garantido é a janela à frente e
 * piscando (R-07, "A verificar").
 */

/** O que o aviso usa da janela do Electron (simulada nos testes). */
export interface AttentionWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  setAlwaysOnTop(flag: boolean): void;
  flashFrame(flag: boolean): void;
  once(event: 'focus', listener: () => void): void;
}

export interface NotificationOptions {
  title: string;
  body: string;
  /** `false` = com o som do Windows. */
  silent: boolean;
}

export interface AttentionOptions {
  getWindow(): AttentionWindow | null;
  showNotification(options: NotificationOptions): void;
  /** Pede à interface que toque o som do aviso. */
  playSound(): void;
  isSoundEnabled(): boolean;
  /** Quanto tempo a janela fica "sempre por cima". Padrão: 1,5 s. */
  alwaysOnTopMs?: number;
}

export class Attention {
  private readonly alwaysOnTopMs: number;

  constructor(private readonly options: AttentionOptions) {
    this.alwaysOnTopMs = options.alwaysOnTopMs ?? 1_500;
  }

  /** O Hunit pediu o token numa execução desta máquina. */
  alertTwoFactor(): void {
    this.alert({
      title: 'O Hunit pediu o token',
      body: 'Abra o HUNIT Control e informe o token do autenticador antes que o prazo termine.',
      silent: false,
    });
  }

  /** "Testar aviso" da configuração: o aviso completo, para o operador conferir. */
  test(): void {
    this.alert({
      title: 'Teste do aviso do HUNIT Control',
      body: 'É assim que o app avisa quando o Hunit pedir o token.',
      silent: false,
    });
  }

  /** Fim de uma execução desta máquina, com o resultado resumido (FR-014). */
  notifyFinished(summary: { title: string; body: string }): void {
    this.options.showNotification({ ...summary, silent: false });
  }

  private alert(notification: NotificationOptions): void {
    this.options.showNotification(notification);
    this.bringWindowForward();
    if (this.options.isSoundEnabled()) this.options.playSound();
  }

  private bringWindowForward(): void {
    const window = this.options.getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.setAlwaysOnTop(true);
    setTimeout(() => {
      if (!window.isDestroyed()) window.setAlwaysOnTop(false);
    }, this.alwaysOnTopMs);
    window.flashFrame(true);
    window.once('focus', () => {
      if (!window.isDestroyed()) window.flashFrame(false);
    });
  }
}
