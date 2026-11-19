/**
 * Contagem regressiva do pedido de token (specs/006; tela 2.4): o rótulo à esquerda e o tempo no
 * estilo "Cronômetro" à direita, em lima na superfície escura; com pouco tempo (`urgent`), em
 * vermelho. O tempo é anunciado ao leitor de tela sem interromper.
 */
import classes from './status.module.css';
import { useSurface } from './Surface';

export interface CountdownProps {
  label: string;
  /** Tempo já formatado ("1:59"). */
  value: string;
  urgent?: boolean;
}

export function Countdown({ label, value, urgent = false }: CountdownProps) {
  const surface = useSurface();
  return (
    <div className={classes.countdown} data-surface={surface}>
      <span className={classes.countdownLabel}>{label}</span>
      <span
        className={classes.countdownValue}
        data-urgent={urgent || undefined}
        data-no-truncate=""
        aria-live="polite"
      >
        {value}
      </span>
    </div>
  );
}
