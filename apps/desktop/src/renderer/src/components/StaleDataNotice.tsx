/**
 * Marca o que está na tela quando o servidor está indisponível (specs/002, FR-005, research R-08):
 * os dados ficam visíveis, com o horário em que foram obtidos (`dataUpdatedAt` da consulta).
 */
import { Text } from '@mantine/core';
import { formatTime } from '../presentation/format';

interface Props {
  /** `dataUpdatedAt` da consulta (milissegundos); 0 = nada carregado. */
  updatedAt: number;
  offline: boolean;
}

export function StaleDataNotice({ updatedAt, offline }: Props) {
  if (!offline || updatedAt <= 0) return null;
  return (
    <Text size="sm" c="yellow.8" fw={500} role="status">
      {`dados de ${formatTime(updatedAt)} — servidor indisponível`}
    </Text>
  );
}
