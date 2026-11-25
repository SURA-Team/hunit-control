/**
 * Ranking dos hotéis com mais valor em aberto (specs/007, US3, T016; tela 8.1): numerado, do maior
 * para o menor, barras na mesma escala, valor à direita e a seta para o detalhe; rola dentro do card
 * (FR-019) e oferece "Ver todos os hotéis". Sem nome de rede (clarificação de 2026-11-25).
 */
import { Group, Text } from '@mantine/core';
import type { HotelReportRow } from '../../../../shared/ipc-types';
import { formatMoney } from '../../presentation/format';
import {
  REPORT_BUCKET_LABELS,
  amountValue,
  rankingHotels,
  rankingScale,
} from '../../presentation/report';
import {
  Action,
  Card,
  LegendList,
  RankingList,
  RankingRow,
  SectionTitle,
  StackedBar,
  ValuePlaceholder,
} from '../../ui';
import { openBarLabel } from './ReportCards';

/** Altura da lista do ranking antes de rolar (sete linhas, como no design). */
const RANKING_HEIGHT = 7 * 49;

/** Barra solicitado + pendente de um hotel, na escala comum. */
export function HotelBar({ row, max }: { row: HotelReportRow; max: number }) {
  return (
    <StackedBar
      bare
      max={max}
      label={openBarLabel(row.requested, row.pending)}
      segments={[
        { tone: 'requested', value: amountValue(row.requested) },
        { tone: 'pending', value: amountValue(row.pending) },
      ]}
    />
  );
}

export const OPEN_LEGEND = [
  {
    tone: 'requested' as const,
    name: `${REPORT_BUCKET_LABELS.requested.name} (tratativa enviada)`,
  },
  { tone: 'pending' as const, name: `${REPORT_BUCKET_LABELS.pending.name} (sem tratativa)` },
];

export function HotelRankingCard({
  rows,
  onOpenHotel,
  onOpenAll,
  hotelsDisabled,
}: {
  /** `null` enquanto carrega. */
  rows: readonly HotelReportRow[] | null;
  onOpenHotel: (row: HotelReportRow) => void;
  onOpenAll: () => void;
  hotelsDisabled: boolean;
}) {
  const ranking = rows ? rankingHotels(rows) : [];
  const max = rankingScale(ranking);
  return (
    <Card padding={24} block="hotéis com mais valor em aberto" component="section">
      <Group justify="space-between" align="flex-start" gap={12}>
        <div>
          <SectionTitle>Hotéis com mais valor em aberto</SectionTitle>
          <Text size="xs" c="dimmed">
            Solicitado + pendente · maiores primeiro
          </Text>
        </div>
        <Action variant="text" onClick={onOpenAll} disabled={rows === null || rows.length === 0}>
          Ver todos os hotéis
        </Action>
      </Group>
      {rows === null ? (
        <ValuePlaceholder width={320} />
      ) : ranking.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nenhum hotel com valor em aberto neste período.
        </Text>
      ) : (
        <RankingList label="Hotéis com mais valor em aberto" maxHeight={RANKING_HEIGHT}>
          {ranking.map((row, index) => (
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
    </Card>
  );
}
