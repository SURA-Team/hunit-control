/**
 * Todos os hotéis do período (specs/007, US4, T024; tela 8.7): busca pelo nome (sem acento e sem
 * maiúsculas), as ordenações "Maior valor", "Mais pendente" e "Nome A-Z", e cada hotel na linha do
 * ranking, inclusive os de R$ 0,00 (no fim). Clicar abre o detalhe do hotel.
 */
import { Group, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import type { HotelReportRow } from '../../../../shared/ipc-types';
import { formatInteger, formatMoney } from '../../presentation/format';
import {
  HOTEL_ORDERS,
  HOTEL_ORDER_LABELS,
  periodRange,
  rankingScale,
  searchHotels,
  sortHotels,
  type HotelOrder,
} from '../../presentation/report';
import {
  AppDrawer,
  EmptyState,
  FilterChip,
  LegendList,
  RankingList,
  Field,
  RankingRow,
} from '../../ui';
import { HotelBar, OPEN_LEGEND } from './HotelRankingCard';

export function AllHotelsDrawer({
  opened,
  rows,
  period,
  totalOpen,
  onClose,
  onOpenHotel,
  hotelsDisabled,
}: {
  opened: boolean;
  rows: readonly HotelReportRow[];
  period: { from: string; to: string };
  /** "R$ 211.120,47". */
  totalOpen: string;
  onClose: () => void;
  onOpenHotel: (row: HotelReportRow) => void;
  hotelsDisabled: boolean;
}) {
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<HotelOrder>('open');
  const shown = sortHotels(searchHotels(rows, search), order);
  const max = rankingScale(rows);
  const count = rows.length;

  return (
    <AppDrawer
      opened={opened}
      onClose={onClose}
      title="Todos os hotéis"
      data-testid="report-all-hotels"
    >
      <Stack gap={16}>
        <Text size="sm" c="dimmed">
          {`${formatInteger(count)} ${count === 1 ? 'hotel' : 'hotéis'} · check-in de ${periodRange(period.from, period.to)} · total em aberto ${totalOpen}`}
        </Text>
        <Group gap={8} wrap="wrap" align="flex-end">
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <Field
              aria-label="Buscar hotel pelo nome"
              placeholder="Buscar hotel pelo nome"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </div>
          <Group gap={8} role="group" aria-label="Ordenar hotéis">
            {HOTEL_ORDERS.map((item) => (
              <FilterChip
                key={item}
                label={HOTEL_ORDER_LABELS[item]}
                active={order === item}
                aria-pressed={order === item}
                onClick={() => setOrder(item)}
              />
            ))}
          </Group>
        </Group>
        {shown.length === 0 ? (
          <EmptyState
            title="Nenhum hotel encontrado"
            description={`Nenhum hotel do período tem "${search.trim()}" no nome.`}
            onClear={() => setSearch('')}
            clearLabel="Limpar busca"
          />
        ) : (
          <RankingList label="Todos os hotéis">
            {shown.map((row, index) => (
              <RankingRow
                key={row.hotelCode}
                position={index + 1}
                name={row.hotelName}
                bar={<HotelBar row={row} max={max} />}
                value={formatMoney(row.openAmount)}
                onOpen={() => onOpenHotel(row)}
                disabled={hotelsDisabled}
              />
            ))}
          </RankingList>
        )}
        <LegendList variant="inline" label="Legenda das barras" items={OPEN_LEGEND} />
      </Stack>
    </AppDrawer>
  );
}
