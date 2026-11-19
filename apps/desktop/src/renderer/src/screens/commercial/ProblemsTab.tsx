/**
 * Aba "Retornos com problema" da área Comercial (specs/005, FR-018): os retornos incompletos ou
 * ilegíveis e os casos que o servidor encontrou na planilha (linha sem envio, repetida ou
 * restaurada), com a mensagem em português e sem dado do hóspede.
 *
 * Desde a 006 (T052; tela 7.9): a lista em card com a reserva e o hotel, o problema num selo âmbar, o
 * que falta ou não foi entendido e quando; a seta abre o detalhe da reserva (quando o problema tem
 * uma reserva). Em conteúdo estreito, o "quando" vai para a linha da mensagem.
 */
import { Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReservationKey } from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';
import { formatDateTime } from '../../presentation/format';
import { SHEET_PROBLEM_NAMES } from '../../presentation/labels';
import {
  AppDrawer,
  ListCard,
  ListCell,
  ListHeader,
  ListRow,
  Notice,
  StatusBadge,
  type ListColumn,
} from '../../ui';
import { ReservationDetailLoader } from '../reservations/ReservationsScreen';
import { useSheetStatus } from './SheetTab';

const COLUMNS: readonly ListColumn[] = [
  { key: 'reservation', label: 'Reserva' },
  { key: 'problem', label: 'Problema' },
  { key: 'message', label: 'O que falta ou não foi entendido' },
  { key: 'when', label: 'Quando' },
];

export function ProblemsTab() {
  const hunit = useHunit();
  const status = useSheetStatus();
  const [opened, setOpened] = useState<ReservationKey | null>(null);
  const hotels = useQuery({ queryKey: ['hotels'], queryFn: () => unwrap(hunit.hotels.list()) });
  const hotel = (code: string | null) =>
    code === null ? '—' : (hotels.data?.find((item) => item.code === code)?.name ?? code);

  if (status.isError) return <Notice tone="red">{messageOf(status.error)}</Notice>;
  const problems = status.data?.problems ?? [];
  if (status.isSuccess && problems.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Nenhum retorno com problema.
      </Text>
    );
  }
  return (
    <>
      <ListCard label="Retornos com problema" header={<ListHeader columns={COLUMNS} />}>
        {problems.map((problem, index) => {
          const { hotelCode, reservationNumber } = problem;
          const key =
            hotelCode !== null && reservationNumber !== null
              ? { hotelCode, reservationNumber }
              : null;
          return (
            <ListRow
              key={`${hotelCode ?? ''}/${reservationNumber ?? ''}/${index}`}
              columns={COLUMNS}
              withArrow
              {...(key && {
                onOpen: () => setOpened(key),
                openLabel: `Abrir a reserva ${key.reservationNumber}`,
              })}
              cells={{
                reservation: (
                  <ListCell
                    strong
                    primary={reservationNumber ?? '—'}
                    secondary={hotel(hotelCode)}
                  />
                ),
                problem: (
                  <StatusBadge tone="amber">{SHEET_PROBLEM_NAMES[problem.kind]}</StatusBadge>
                ),
                message: (
                  <ListCell primary={problem.message} compact={formatDateTime(problem.at)} />
                ),
                when: (
                  <Text size="xs" c="dimmed">
                    {formatDateTime(problem.at)}
                  </Text>
                ),
              }}
            />
          );
        })}
      </ListCard>
      <AppDrawer
        opened={opened !== null}
        onClose={() => setOpened(null)}
        title="Detalhe da reserva"
        closeLabel="Fechar detalhe"
      >
        {opened && <ReservationDetailLoader reservationKey={opened} />}
      </AppDrawer>
    </>
  );
}
