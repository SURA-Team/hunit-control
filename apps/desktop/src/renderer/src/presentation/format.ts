/**
 * Formatos da interface (specs/002, FR-009, FR-020b, FR-023): reais e datas em pt-BR. A conversão
 * do campo de valor é só de formato ("1.234,56" → "1234.56"), não regra de negócio.
 */

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DASH = '—';

/** Valor da API ("1234.50") em reais. */
export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return DASH;
  const number = Number(value);
  return Number.isFinite(number) ? money.format(number) : DASH;
}

const two = (value: number) => String(value).padStart(2, '0');

/** Data da API (YYYY-MM-DD) em DD/MM/AAAA, sem passar pelo fuso horário. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return DASH;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : DASH;
}

/** Data e hora (ISO 8601) no horário da máquina: DD/MM/AAAA HH:MM. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${formatTime(value)}`;
}

/** Hora (ISO 8601 ou milissegundos) no horário da máquina: HH:MM. */
export function formatTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Tempo restante do token: M:SS, nunca negativo. */
export function formatRemaining(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(total / 60)}:${two(total % 60)}`;
}

/** Duração em segundos: "45 s", "12 min 30 s", "1 h 1 min". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH;
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${rest} s`;
  return `${rest} s`;
}

/**
 * Campo de valor da busca para o formato da API ("1234.56"). Aceita "1.234,56", "1234,5",
 * "R$ 10" e também "10.50" (ponto com uma ou duas casas = decimal). Texto inválido → `null`.
 */
export function parseAmountInput(input: string): string | null {
  const text = input.replace(/R\$/gi, '').replace(/\s/g, '');
  if (text === '') return null;

  let integer: string;
  let decimals = '';
  if (text.includes(',')) {
    const match = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/.exec(text);
    if (!match) return null;
    integer = (match[1] ?? '').replace(/\./g, '');
    decimals = match[2] ?? '';
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) {
    integer = text.replace(/\./g, '');
  } else {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) return null;
    integer = match[1] ?? '';
    decimals = match[2] ?? '';
  }

  const normalized = integer.replace(/^0+(?=\d)/, '');
  return `${normalized}.${decimals.padEnd(2, '0')}`;
}
