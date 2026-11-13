/**
 * Período de check-in num único campo seletor de intervalo, com as datas em DD/MM/AAAA (specs/002,
 * FR-009, FR-010, research R-09). O seletor sempre ordena o intervalo: clicar primeiro no dia maior
 * não gera um fim antes do início. Os valores ficam no formato da API (AAAA-MM-DD).
 */
import { DatePickerInput } from '@mantine/dates';

export interface Period {
  from: string | null;
  to: string | null;
}

interface Props {
  value: Period;
  onChange: (period: Period) => void;
  error?: string | null;
  label?: string;
  placeholder?: string;
  /** Permite limpar o período (filtros); na execução o período é obrigatório. */
  clearable?: boolean;
}

export function PeriodPicker({
  value,
  onChange,
  error = null,
  label = 'Período de check-in',
  placeholder = 'Escolha o início e o fim',
  clearable = false,
}: Props) {
  return (
    <DatePickerInput
      type="range"
      label={label}
      placeholder={placeholder}
      value={[value.from, value.to]}
      onChange={([from, to]) => onChange({ from, to })}
      valueFormat="DD/MM/YYYY"
      labelSeparator="a"
      locale="pt-br"
      allowSingleDateInRange
      numberOfColumns={2}
      clearable={clearable}
      error={error}
      maw={360}
    />
  );
}
