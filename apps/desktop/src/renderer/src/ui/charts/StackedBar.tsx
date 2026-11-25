/**
 * Barra horizontal em segmentos (specs/007, research R-10; telas 8.1, 8.3 e 8.7): o valor em aberto
 * (solicitado + pendente), a distribuição dos valores (100 %) e as barras do ranking, todas na mesma
 * escala quando `max` é informado (FR-018). Toda barra tem legenda em texto ao lado (FR-017); a barra
 * em si é uma imagem com nome acessível.
 */
import { useSurface } from '../Surface';
import classes from './charts.module.css';

export type ChartTone = 'requested' | 'pending' | 'previous' | 'recovered';

export interface StackedBarSegment {
  value: number;
  tone: ChartTone;
}

export interface StackedBarProps {
  segments: readonly StackedBarSegment[];
  /** Escala comum (o maior valor entre as barras); sem ela, a soma dos segmentos (100 %). */
  max?: number;
  size?: 'sm' | 'md';
  /** Nome acessível: "Solicitado R$ 73.888,15 e pendente R$ 137.232,32". */
  label: string;
  /** Sem o fundo cinza (as barras do ranking). */
  bare?: boolean;
}

export function StackedBar({ segments, max, size = 'sm', label, bare = false }: StackedBarProps) {
  const surface = useSurface();
  const total = segments.reduce((sum, segment) => sum + Math.max(segment.value, 0), 0);
  const scale = max !== undefined && max > 0 ? max : total;
  return (
    <div
      className={classes.track}
      data-size={size}
      data-surface={surface}
      data-bare={bare || undefined}
      role="img"
      aria-label={label}
    >
      {scale > 0 &&
        segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <span
              key={segment.tone}
              className={classes.segment}
              data-tone={segment.tone}
              style={{ width: `${(segment.value / scale) * 100}%` }}
            />
          ))}
    </div>
  );
}
