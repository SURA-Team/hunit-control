/**
 * Período de check-in em DD/MM/AAAA (specs/002, FR-009, FR-010). Dois campos digitáveis: o
 * operador digita as datas ou escolhe no calendário. Os valores ficam no formato da API (AAAA-MM-DD).
 */
import { Group } from '@mantine/core';
import { DateInput } from '@mantine/dates';

/** "07/11/2026" → "2026-11-07"; texto que não é uma data → `null`. */
export function parseBrazilianDate(text: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, day = '', month = '', year = ''] = match;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

interface Props {
  from: string | null;
  to: string | null;
  onChange: (period: { from: string | null; to: string | null }) => void;
  error: string | null;
}

export function PeriodPicker({ from, to, onChange, error }: Props) {
  return (
    <Group grow align="flex-start">
      <DateInput
        label="Check-in de"
        value={from}
        onChange={(value) => onChange({ from: value, to })}
        valueFormat="DD/MM/YYYY"
        dateParser={parseBrazilianDate}
        placeholder="DD/MM/AAAA"
        locale="pt-br"
      />
      <DateInput
        label="Check-in até"
        value={to}
        onChange={(value) => onChange({ from, to: value })}
        valueFormat="DD/MM/YYYY"
        dateParser={parseBrazilianDate}
        placeholder="DD/MM/AAAA"
        locale="pt-br"
        error={error}
      />
    </Group>
  );
}
