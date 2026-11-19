/**
 * Marca o que está na tela quando o servidor está indisponível (specs/002, FR-005, research R-08):
 * os dados ficam visíveis, com o horário em que foram obtidos (`dataUpdatedAt` da consulta).
 * Desde a 006 (T017), um aviso âmbar compacto, legível ao lado do título da página (tela 5.1).
 */
import { formatTime } from '../presentation/format';
import { Notice } from '../ui';

interface Props {
  /** `dataUpdatedAt` da consulta (milissegundos); 0 = nada carregado. */
  updatedAt: number;
  offline: boolean;
}

export function StaleDataNotice({ updatedAt, offline }: Props) {
  if (!offline || updatedAt <= 0) return null;
  return (
    <Notice tone="amber" role="status" compact>
      {`dados de ${formatTime(updatedAt)} — servidor indisponível`}
    </Notice>
  );
}
