/**
 * Período de check-in num único campo seletor de intervalo, com as datas em DD/MM/AAAA (specs/002,
 * FR-009, FR-010, research R-09). O seletor sempre ordena o intervalo: clicar primeiro no dia maior
 * não gera um fim antes do início. Os valores ficam no formato da API (AAAA-MM-DD).
 *
 * Desde a 006 (T010), o calendário do design ("Calendário — período", node `134:255`): dois meses, o
 * resumo do período escolhido e "Ir para hoje" no rodapé. O campo continua com o rótulo ligado e o
 * texto "DD/MM/AAAA a DD/MM/AAAA"; os dias continuam rotulados por extenso ("3 novembro 2026").
 */
import { InputBase, Popover } from '@mantine/core';
import { DatePicker } from '@mantine/dates';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Action } from './Action';
import { inputClassNames } from './fields/shared';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons';
import classes from './PeriodPicker.module.css';

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

const DISPLAY = 'DD/MM/YYYY';
const today = () => dayjs().format('YYYY-MM-DD');

/** Resumo do rodapé: "13/11 → 19/11/2026 · 6 noites" (com os dois anos quando mudam). */
export function describePeriod({ from, to }: Period): string {
  if (!from) return 'Escolha a data inicial';
  if (!to) return 'Escolha a data final';
  const start = dayjs(from);
  const end = dayjs(to);
  const nights = end.diff(start, 'day');
  if (nights === 0) return end.format(DISPLAY);
  const startText = start.year() === end.year() ? start.format('DD/MM') : start.format(DISPLAY);
  return `${startText} → ${end.format(DISPLAY)} · ${nights === 1 ? '1 noite' : `${nights} noites`}`;
}

export function PeriodPicker({
  value,
  onChange,
  error = null,
  label = 'Período de check-in',
  placeholder = 'Escolha o início e o fim',
  clearable = false,
}: Props) {
  const [opened, setOpened] = useState(false);
  const [month, setMonth] = useState(() => value.from ?? today());
  const text = value.from
    ? `${dayjs(value.from).format(DISPLAY)} a ${value.to ? dayjs(value.to).format(DISPLAY) : '…'}`
    : '';

  const toggle = () => {
    if (!opened) setMonth(value.from ?? today());
    setOpened(!opened);
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      offset={6}
      trapFocus
      returnFocus
      classNames={{ dropdown: classes.dropdown }}
    >
      <Popover.Target>
        <InputBase
          component="button"
          type="button"
          label={label}
          error={error}
          pointer
          classNames={{ ...inputClassNames, input: `${inputClassNames.input} ${classes.target}` }}
          onClick={toggle}
          rightSectionPointerEvents="all"
          rightSection={
            clearable && value.from ? (
              <button
                type="button"
                className={classes.clear}
                aria-label="Limpar o período"
                onClick={() => onChange({ from: null, to: null })}
              >
                <CloseIcon size={16} />
              </button>
            ) : undefined
          }
        >
          {text || <span className={classes.placeholder}>{placeholder}</span>}
        </InputBase>
      </Popover.Target>
      <Popover.Dropdown>
        <DatePicker
          type="range"
          value={[value.from, value.to]}
          onChange={([from, to]) => {
            onChange({ from, to });
            if (from && to) setOpened(false);
          }}
          date={month}
          onDateChange={setMonth}
          numberOfColumns={2}
          allowSingleDateInRange
          locale="pt-br"
          highlightToday
          withCellSpacing={false}
          previousIcon={<ChevronLeftIcon />}
          nextIcon={<ChevronRightIcon />}
          classNames={{
            levelsGroup: classes.levelsGroup,
            calendarHeader: classes.calendarHeader,
            calendarHeaderLevel: classes.calendarHeaderLevel,
            calendarHeaderControl: classes.calendarHeaderControl,
            month: classes.month,
            weekday: classes.weekday,
            monthCell: classes.monthCell,
            day: classes.day,
          }}
        />
        <div className={classes.footer}>
          <span className={classes.summary}>{describePeriod(value)}</span>
          <Action variant="text" size="xs" onClick={() => setMonth(today())}>
            Ir para hoje
          </Action>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
