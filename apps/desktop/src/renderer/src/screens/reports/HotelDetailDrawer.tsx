/**
 * Detalhe do hotel (specs/007, US3, T017; tela 8.3): o valor em aberto com a barra, o resumo do hotel
 * (reservas, tratativas enviadas, recuperado) e as reservas em aberto, maiores valores primeiro, com
 * "Ver as N reservas em Reservas". As reservas vêm da lista de Reservas ("Falta cobrar" do hotel no
 * período, ordem `amount_desc`), a mesma que os dois perfis já veem (FR-027).
 */
import { Group, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { HotelReportRow } from '../../../../shared/ipc-types';
import { unwrap, useHunit } from '../../hunit';
import { formatDate, formatInteger, formatMoney } from '../../presentation/format';
import { amountValue, periodRange } from '../../presentation/report';
import { situationBadges } from '../../presentation/reservations';
import {
  Action,
  AmountCard,
  AppDrawer,
  CompactReservationRow,
  DataTile,
  DataTiles,
  LegendList,
  RowList,
  SectionTitle,
  SituationBadges,
  StackedBar,
  ValuePlaceholder,
} from '../../ui';
import { openBarLabel } from './ReportCards';

/** Reservas da gaveta; o resto fica em "Ver as N reservas em Reservas". */
const DRAWER_PAGE = 50;

/** "03/11 → 08/11/2026". */
function stay(checkIn: string | null | undefined, checkOut: string | null | undefined): string {
  const start = formatDate(checkIn).slice(0, 5);
  return checkOut ? `${start} → ${formatDate(checkOut)}` : formatDate(checkIn);
}

export function HotelDetailDrawer({
  row,
  period,
  position,
  onClose,
  onOpenReservations,
  disabled,
}: {
  row: HotelReportRow | null;
  period: { from: string; to: string };
  /** Posição no ranking; `null` sem valor em aberto. */
  position: number | null;
  onClose: () => void;
  onOpenReservations: (row: HotelReportRow) => void;
  disabled: boolean;
}) {
  const hunit = useHunit();
  const open = useQuery({
    queryKey: ['reservations', 'report-hotel', row?.hotelCode ?? '', period.from, period.to],
    queryFn: () =>
      unwrap(
        hunit.reservations.list({
          hotelCode: [row?.hotelCode ?? ''],
          checkInFrom: period.from,
          checkInTo: period.to,
          quickFilter: 'pending_charge',
          order: 'amount_desc',
          limit: DRAWER_PAGE,
        }),
      ),
    enabled: row !== null && row.openCount > 0,
    staleTime: Infinity,
  });

  const subtitle = [
    position !== null ? `${position}º com mais valor em aberto` : null,
    `check-in de ${periodRange(period.from, period.to)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <AppDrawer
      opened={row !== null}
      onClose={onClose}
      title={row?.hotelName ?? ''}
      data-testid="report-hotel-drawer"
    >
      {row && (
        <Stack gap={20}>
          <Text size="sm" c="dimmed">
            {subtitle}
          </Text>
          <AmountCard dark label="Valor em aberto" amount={formatMoney(row.openAmount)}>
            <StackedBar
              label={openBarLabel(row.requested, row.pending)}
              segments={[
                { tone: 'requested', value: amountValue(row.requested) },
                { tone: 'pending', value: amountValue(row.pending) },
              ]}
            />
            <LegendList
              variant="split"
              label="Partes do valor em aberto"
              items={[
                {
                  tone: 'requested',
                  name: 'Solicitado · tratativa enviada',
                  value: formatMoney(row.requested),
                },
                {
                  tone: 'pending',
                  name: 'Pendente · sem tratativa',
                  value: formatMoney(row.pending),
                },
              ]}
            />
          </AmountCard>

          <DataTiles label={`Resumo de ${row.hotelName}`}>
            <DataTile label="Reservas">
              {formatInteger(row.reservations)}
              <Text size="xs" c="dimmed" component="span" display="block">
                com cartão virtual
              </Text>
            </DataTile>
            <DataTile label="Tratativas enviadas">
              {formatInteger(row.treatmentsSent)}
              <Text size="xs" c="dimmed" component="span" display="block">
                reservas com tratativa
              </Text>
            </DataTile>
            <DataTile label="Recuperado">
              {formatMoney(row.recovered)}
              <Text size="xs" c="dimmed" component="span" display="block">
                cobrado após tratativa
              </Text>
            </DataTile>
          </DataTiles>

          <Stack gap={8}>
            <Group justify="space-between" align="baseline">
              <SectionTitle>Reservas em aberto ({formatInteger(row.openCount)})</SectionTitle>
              {row.openCount > 0 && (
                <Text size="xs" c="dimmed">
                  maiores valores primeiro
                </Text>
              )}
            </Group>
            {row.openCount === 0 ? (
              <Text size="sm" c="dimmed">
                Nada em aberto neste hotel no período.
              </Text>
            ) : open.data ? (
              <RowList label={`Reservas em aberto de ${row.hotelName}`}>
                {open.data.items.map((item) => (
                  <CompactReservationRow
                    key={item.reservationNumber}
                    guestName={item.guestName ?? 'nome anonimizado'}
                    detail={`${item.reservationNumber} · ${stay(item.checkIn, item.checkOut)}`}
                    amount={formatMoney(item.amountToCharge)}
                    situation={<SituationBadges items={situationBadges(item)} />}
                  />
                ))}
              </RowList>
            ) : open.isError ? (
              <Text size="sm" c="dimmed">
                Não foi possível carregar as reservas agora.
              </Text>
            ) : (
              <ValuePlaceholder width={320} />
            )}
          </Stack>

          {row.openCount > 0 && (
            <Group>
              <Action
                variant="secondary"
                disabled={disabled}
                onClick={() => onOpenReservations(row)}
              >
                {row.openCount === 1
                  ? 'Ver a reserva em Reservas'
                  : `Ver as ${formatInteger(row.openCount)} reservas em Reservas`}
              </Action>
            </Group>
          )}
        </Stack>
      )}
    </AppDrawer>
  );
}
