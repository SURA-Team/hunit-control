/**
 * Som do aviso do pedido de token (specs/002, R-07; specs/008, FR-002 e FR-003): o único som do
 * aviso, tocado pela interface no volume escolhido (0 a 100). A notificação do Windows vai sem som.
 * Falha ao tocar (máquina sem dispositivo de áudio) é ignorada: o aviso visual e a notificação
 * continuam (edge case da spec).
 */
import alertSound from '../../../resources/sounds/token-alert.wav';

export function playAlertSound(volume: number): void {
  if (!(volume > 0)) return;
  try {
    const audio = new Audio(alertSound);
    audio.volume = Math.min(1, volume / 100);
    // O jsdom dos testes não implementa `play` (devolve undefined).
    void (audio.play() as Promise<void> | undefined)?.catch(() => undefined);
  } catch {
    // Sem dispositivo de áudio: segue sem som.
  }
}
