/**
 * Barra de progresso da execução e do envio (specs/006; "Progresso da execução", node `26:1648`):
 * trilho de 8 px e preenchimento lima em superfície escura; em superfície clara (o design só desenha
 * a escura), preenchimento preto sobre cinza.
 */
import classes from './status.module.css';
import { useSurface } from './Surface';

export interface ProgressBarProps {
  /** De 0 a 100. */
  value: number;
  /** Nome acessível, ex.: "Hotéis concluídos". */
  label: string;
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const surface = useSurface();
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div
      className={classes.track}
      data-surface={surface}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      <div className={classes.fill} style={{ width: `${percent}%` }} />
    </div>
  );
}
