/**
 * Aviso impossível de ignorar quando o Hunit pede o token (specs/002, T041, FR-011, FR-014,
 * research R-07): notificação do Windows com som, janela restaurada e à frente, piscando na barra
 * de tarefas, e o som do app (só com a preferência ligada). A notificação e a janela são simuladas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Attention,
  type AttentionWindow,
  type NotificationOptions,
} from '../../src/main/attention.js';

class FakeWindow implements AttentionWindow {
  minimized = true;
  visible = false;
  focused = false;
  alwaysOnTop: boolean[] = [];
  flashing: boolean[] = [];
  private focusListeners: Array<() => void> = [];

  isDestroyed() {
    return false;
  }
  isMinimized() {
    return this.minimized;
  }
  restore() {
    this.minimized = false;
  }
  show() {
    this.visible = true;
  }
  focus() {
    this.focused = true;
  }
  setAlwaysOnTop(flag: boolean) {
    this.alwaysOnTop.push(flag);
  }
  flashFrame(flag: boolean) {
    this.flashing.push(flag);
  }
  once(_event: 'focus', listener: () => void) {
    this.focusListeners.push(listener);
  }
  emitFocus() {
    const listeners = this.focusListeners;
    this.focusListeners = [];
    for (const listener of listeners) listener();
  }
}

let window: FakeWindow;
let notifications: NotificationOptions[];
let sounds: number;
let soundEnabled: boolean;

function newAttention() {
  return new Attention({
    getWindow: () => window,
    showNotification: (options) => notifications.push(options),
    playSound: () => {
      sounds += 1;
    },
    isSoundEnabled: () => soundEnabled,
    alwaysOnTopMs: 1_500,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window = new FakeWindow();
  notifications = [];
  sounds = 0;
  soundEnabled = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Attention.alertTwoFactor (FR-011)', () => {
  it('mostra a notificação com som, restaura e mostra a janela e pisca', () => {
    newAttention().alertTwoFactor();

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ silent: false });
    expect(notifications[0]?.title).toMatch(/token/i);
    expect(window.minimized).toBe(false);
    expect(window.visible).toBe(true);
    expect(window.focused).toBe(true);
    expect(window.flashing).toEqual([true]);
  });

  it('deixa a janela sempre por cima só por um instante', async () => {
    newAttention().alertTwoFactor();
    expect(window.alwaysOnTop).toEqual([true]);

    await vi.advanceTimersByTimeAsync(1_500);

    expect(window.alwaysOnTop).toEqual([true, false]);
  });

  it('para de piscar quando o operador clica na janela', () => {
    newAttention().alertTwoFactor();

    window.emitFocus();

    expect(window.flashing).toEqual([true, false]);
  });

  it('toca o som do app só com a preferência ligada', () => {
    newAttention().alertTwoFactor();
    expect(sounds).toBe(1);

    soundEnabled = false;
    newAttention().alertTwoFactor();
    expect(sounds).toBe(1);
  });

  it('sem janela (fechando), ainda mostra a notificação', () => {
    const attention = new Attention({
      getWindow: () => null,
      showNotification: (options) => notifications.push(options),
      playSound: () => undefined,
      isSoundEnabled: () => true,
    });

    attention.alertTwoFactor();

    expect(notifications).toHaveLength(1);
  });
});

describe('Attention.test ("Testar aviso")', () => {
  it('faz o mesmo aviso completo', async () => {
    newAttention().test();

    expect(notifications).toHaveLength(1);
    expect(window.visible).toBe(true);
    expect(window.flashing).toEqual([true]);
    expect(sounds).toBe(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(window.alwaysOnTop).toEqual([true, false]);
  });
});

describe('Attention.notifyFinished (FR-014)', () => {
  it('mostra a notificação com o título e o resumo recebidos, sem mexer na janela', () => {
    newAttention().notifyFinished({
      title: 'Execução concluída',
      body: '12 reservas: 3 pendentes de cobrança',
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        title: 'Execução concluída',
        body: '12 reservas: 3 pendentes de cobrança',
      }),
    ]);
    expect(window.visible).toBe(false);
    expect(sounds).toBe(0);
  });
});
