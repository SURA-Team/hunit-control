/**
 * Indicadores do relatório (specs/007, US1, T012; tela 8.1): volume (Reservas, Tratativas enviadas,
 * Hotéis com dados), o card escuro do valor em aberto, o card do valor já cobrado e a distribuição
 * dos valores. Com `report = null`, os números aparecem carregando (FR-009), nunca zerados.
 */
import { SimpleGrid, Text } from '@mantine/core';
import type { ReportOverview } from '../../../../shared/ipc-types';
import { formatInteger, formatMoney } from '../../presentation/format';
import {
  REPORT_BUCKET_LABELS,
  amountValue,
  distributionTotal,
  formatShare,
  formatWholeShare,
  hotelsWithData,
  valueDistribution,
} from '../../presentation/report';
import {
  Action,
  AmountCard,
  Card,
  IndicatorCard,
  LegendList,
  SectionTitle,
  StackedBar,
  ValuePlaceholder,
} from '../../ui';

export function VolumeCards({ report }: { report: ReportOverview | null }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing={16}>
      <IndicatorCard
        label="Reservas"
        value={report ? formatInteger(report.reservations) : <ValuePlaceholder />}
        help="Reservas com cartão virtual no período"
      />
      <IndicatorCard
        label="Tratativas enviadas"
        value={report ? formatInteger(report.treatmentsSent) : <ValuePlaceholder />}
        help="Reservas com tratativa anexada"
      />
      <IndicatorCard
        label="Hotéis com dados"
        value={report ? hotelsWithData(report) : <ValuePlaceholder />}
        help="Hotéis com reservas no período"
      />
    </SimpleGrid>
  );
}

/** "Solicitado R$ 73.888,15 e pendente R$ 137.232,32", o nome da barra para o leitor de tela. */
export function openBarLabel(requested: string, pending: string): string {
  return `Solicitado ${formatMoney(requested)} e pendente ${formatMoney(pending)}`;
}

export function OpenValueCard({
  report,
  onOpenReservations,
  disabled,
}: {
  report: ReportOverview | null;
  onOpenReservations: () => void;
  disabled: boolean;
}) {
  const open = report?.open ?? null;
  const total = amountValue(open?.amount);
  const nothingOpen = open !== null && total <= 0;
  return (
    <AmountCard
      dark
      label="Valor em aberto"
      amount={open ? formatMoney(open.amount) : <ValuePlaceholder width={260} />}
      description="Ainda precisa de ação: cobranças solicitadas e pendentes"
      action={
        <Action
          variant="primary"
          onClick={onOpenReservations}
          disabled={disabled || open === null || nothingOpen}
          title={nothingOpen ? 'Nada em aberto neste período' : undefined}
        >
          Ver reservas em aberto
        </Action>
      }
    >
      {open && (
        <>
          <StackedBar
            size="md"
            label={openBarLabel(open.requested, open.pending)}
            segments={[
              { tone: 'requested', value: amountValue(open.requested) },
              { tone: 'pending', value: amountValue(open.pending) },
            ]}
          />
          {nothingOpen && (
            <Text size="sm" c="var(--hc-texto-inverso-apagado)">
              Nada em aberto neste período
            </Text>
          )}
          <LegendList
            variant="split"
            label="Partes do valor em aberto"
            items={[
              {
                tone: 'requested',
                name: REPORT_BUCKET_LABELS.requested.name,
                value: formatMoney(open.requested),
                detail: `${REPORT_BUCKET_LABELS.requested.detail} · ${formatWholeShare(amountValue(open.requested), total)}`,
              },
              {
                tone: 'pending',
                name: REPORT_BUCKET_LABELS.pending.name,
                value: formatMoney(open.pending),
                detail: `${REPORT_BUCKET_LABELS.pending.detail} · ${formatWholeShare(amountValue(open.pending), total)}`,
              },
            ]}
          />
        </>
      )}
    </AmountCard>
  );
}

export function ChargedValueCard({ report }: { report: ReportOverview | null }) {
  const charged = report?.charged ?? null;
  return (
    <AmountCard
      label="Valor já cobrado"
      amount={charged ? formatMoney(charged.amount) : <ValuePlaceholder width={260} />}
      description="Cobranças concluídas no período"
    >
      {charged && (
        <LegendList
          variant="boxes"
          label="Partes do valor já cobrado"
          items={[
            {
              tone: 'previous',
              name: REPORT_BUCKET_LABELS.previous.name,
              detail: REPORT_BUCKET_LABELS.previous.detail,
              value: formatMoney(charged.previous),
            },
            {
              tone: 'recovered',
              name: REPORT_BUCKET_LABELS.recovered.name,
              detail: REPORT_BUCKET_LABELS.recovered.detail,
              value: formatMoney(charged.recovered),
            },
          ]}
        />
      )}
    </AmountCard>
  );
}

export function ValueDistributionCard({ report }: { report: ReportOverview | null }) {
  const items = report ? valueDistribution(report) : [];
  return (
    <Card padding={24} block="distribuição dos valores" component="section">
      <div>
        <SectionTitle>Distribuição dos valores</SectionTitle>
        <Text size="xs" c="dimmed">
          {report ? (
            `Do total de ${distributionTotal(report)} em cartão virtual`
          ) : (
            <ValuePlaceholder />
          )}
        </Text>
      </div>
      {report && (
        <>
          <StackedBar
            size="md"
            label={items
              .map((item) => `${REPORT_BUCKET_LABELS[item.tone].name} ${formatShare(item.share)}`)
              .join(', ')}
            segments={items.map((item) => ({ tone: item.tone, value: amountValue(item.amount) }))}
          />
          <LegendList
            variant="rows"
            label="Distribuição dos valores"
            items={items.map((item) => ({
              tone: item.tone,
              name: REPORT_BUCKET_LABELS[item.tone].name,
              value: formatMoney(item.amount),
              percent: formatShare(item.share),
            }))}
          />
        </>
      )}
    </Card>
  );
}
