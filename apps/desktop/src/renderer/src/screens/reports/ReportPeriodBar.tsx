/**
 * Período do relatório (specs/007, US2, T013; telas 8.1 e 8.2): o campo de período (o mesmo
 * calendário dos filtros, FR-006), os atalhos aplicados na hora (FR-005) e, à direita, "N reservas no
 * recorte" com a última verificação das reservas (FR-008). Sem "Aplicar filtros" nem "Limpar".
 */
import { Group, Stack, Text } from '@mantine/core';
import { REPORT_PERIOD_SHORTCUTS, reportPeriod, reportShortcutOf } from '@hunit/domain';
import { useState } from 'react';
import {
  REPORT_SHORTCUT_LABELS,
  lastVerificationText,
  localToday,
  reservationsInRange,
} from '../../presentation/report';
import { Card, FilterChip, PeriodPicker, ValuePlaceholder, type Period } from '../../ui';

export interface ReportPeriodBarProps {
  period: { from: string; to: string };
  onChange: (period: { from: string; to: string }) => void;
  /** `null` enquanto carrega. */
  reservations: number | null;
  lastVerifiedAt: string | null;
  disabled?: boolean;
}

export function ReportPeriodBar({
  period,
  onChange,
  reservations,
  lastVerifiedAt,
  disabled = false,
}: ReportPeriodBarProps) {
  const today = localToday();
  // O calendário pode ter só o início escolhido; o relatório só muda com as duas datas.
  const [draft, setDraft] = useState<Period | null>(null);
  const [custom, setCustom] = useState(false);
  const [pickerOpened, setPickerOpened] = useState(false);
  const shortcut = custom ? 'custom' : reportShortcutOf(period, today);
  const verification = lastVerificationText(lastVerifiedAt);

  return (
    <Card padding={24} block="período">
      <Group justify="space-between" align="flex-end" gap={16} wrap="wrap">
        <Group align="flex-end" gap={12} wrap="wrap">
          <PeriodPicker
            label="Período de check-in"
            value={draft ?? period}
            opened={pickerOpened}
            onOpenedChange={(opened) => {
              setPickerOpened(opened);
              // Fechou com só o início escolhido: volta ao período em vigor.
              if (!opened) setDraft(null);
            }}
            onChange={(value) => {
              if (value.from && value.to) {
                setDraft(null);
                setCustom(reportShortcutOf({ from: value.from, to: value.to }, today) === 'custom');
                onChange({ from: value.from, to: value.to });
              } else {
                setDraft(value);
              }
            }}
          />
          <Group gap={8} wrap="wrap" role="group" aria-label="Atalhos do período">
            {REPORT_PERIOD_SHORTCUTS.map((item) => (
              <FilterChip
                key={item}
                label={REPORT_SHORTCUT_LABELS[item]}
                active={shortcut === item}
                disabled={disabled}
                onClick={() => {
                  setDraft(null);
                  setCustom(false);
                  onChange(reportPeriod(item, today));
                }}
              />
            ))}
            <FilterChip
              label={REPORT_SHORTCUT_LABELS.custom}
              active={shortcut === 'custom'}
              disabled={disabled}
              onClick={() => {
                setCustom(true);
                setPickerOpened(true);
              }}
            />
          </Group>
        </Group>
        <Stack gap={2} align="flex-end" style={{ marginLeft: 'auto' }}>
          <Text fw={700} size="sm" data-testid="report-range-count">
            {reservations === null ? (
              <ValuePlaceholder width={140} />
            ) : (
              reservationsInRange(reservations)
            )}
          </Text>
          {verification && (
            <Text size="xs" c="dimmed">
              {verification}
            </Text>
          )}
        </Stack>
      </Group>
    </Card>
  );
}
