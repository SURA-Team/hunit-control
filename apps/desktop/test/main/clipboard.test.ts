/**
 * "Copiar para e-mail" (specs/005, US5, T054; FR-027, FR-028): a tabela tem as 8 colunas da
 * planilha na ordem, a linha de total, os filtros e o momento dos dados, em HTML (estilos
 * embutidos) e em texto com tabulação; nenhum nome de hóspede aparece; acima de 2 000, recusa; e
 * nada é gravado em disco. Dados fictícios.
 */
import fs from 'node:fs';
import { COPY_HEADERS } from '@hunit/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCopy, toCopySource, type CopyContent } from '../../src/main/clipboard.js';
import {
  createCommercialHandlers,
  type CommercialServices,
} from '../../src/main/commercial-handlers.js';
import { INVOKE } from '../../src/shared/ipc-channels.js';
import type { CopyRow, Result, SelectionItem } from '../../src/shared/ipc-types.js';

const GUEST_MARKER = 'HOSPEDE-MARCADOR-FICTICIO';
const AT = new Date('2026-11-17T13:15:00Z');

const row = (n: number, overrides: Partial<CopyRow> = {}): CopyRow => ({
  hotelName: 'Hotel Homologação Um',
  reservationNumber: String(900_000 + n),
  checkIn: '2026-11-03',
  channel: 'Booking.com',
  totalAmount: '1234.56',
  classification: 'virtual_card_pending_charge',
  reservationStatus: 'active',
  detailedSituation: 'treatment_sent',
  ...overrides,
});

function selectionItem(n: number): SelectionItem {
  return {
    hotelCode: 'hml_um',
    hotelName: 'Hotel Homologação Um',
    reservationNumber: String(900_000 + n),
    guestName: `${GUEST_MARKER} ${n}`,
    channel: 'Expedia',
    checkIn: '2026-11-04',
    totalAmount: '100.00',
    reservationStatus: 'cancelled',
    classification: 'charge_at_terminal',
    treatmentStatus: 'sent',
    situation: 'treatment_sent',
    detailedSituation: 'return_pending',
    needsReview: false,
    effectiveChargedAmount: null,
    chargedAmountOrigin: null,
    currentReturn: null,
  };
}

function handlersWith(items: SelectionItem[], total = items.length) {
  let written: CopyContent | null = null;
  const api = {
    selectReservations: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { total, truncated: total > items.length, items },
      }),
    ),
  };
  const handlers = createCommercialHandlers({
    getApi: () => api as unknown as ReturnType<CommercialServices['getApi']>,
    vault: { take: vi.fn() },
    watcher: { track: vi.fn(), watch: vi.fn(), unwatch: vi.fn(), noteTokenSent: vi.fn() },
    reportFailure: vi.fn(),
    writeClipboard: (content) => {
      written = content;
      return Promise.resolve();
    },
    now: () => AT,
  });
  const copy = (input: unknown) =>
    handlers[INVOKE.clipboardCopyReservations]?.(input) as Promise<Result<unknown>>;
  return { copy, api, written: () => written };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tabela da cópia (FR-027)', () => {
  it('8 colunas na ordem da planilha, valores formatados e o total', () => {
    const sources = [row(1), row(2, { totalAmount: '100.00', checkIn: null, channel: null })].map(
      (item) => toCopySource(item),
    );
    const { html, text } = buildCopy(sources as NonNullable<(typeof sources)[number]>[], {
      description: 'Filtros: Falta cobrar',
      at: AT,
    });

    const lines = text.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Filtros: Falta cobrar — 2 reservas — dados de 17/11/2026 10:15');
    expect(lines[1]?.split('\t')).toEqual([...COPY_HEADERS]);
    expect(COPY_HEADERS).toEqual([
      'Hotel',
      'Reserva',
      'Check-in',
      'Canal',
      'Valor a cobrar',
      'Motivo',
      'Ativa ou cancelada',
      'Situação',
    ]);
    expect(lines[2]?.split('\t')).toEqual([
      'Hotel Homologação Um',
      '900001',
      '03/11/2026',
      'Booking.com',
      'R$ 1.234,56',
      'Pendente de cobrança',
      'Ativa',
      'Tratativa enviada',
    ]);
    expect(lines[3]?.split('\t').slice(0, 5)).toEqual([
      'Hotel Homologação Um',
      '900002',
      '',
      '',
      'R$ 100,00',
    ]);
    expect(lines[4]?.split('\t')[0]).toBe('Total');
    expect(lines[4]?.split('\t')[4]).toBe('R$ 1.334,56');

    expect(html).toContain('<table style="border-collapse:collapse;">');
    expect(html).toContain('style="border:1px solid');
    for (const header of COPY_HEADERS) expect(html).toContain(`>${header}</th>`);
    expect(html).toContain('R$ 1.334,56');
    expect(html).toContain('dados de 17/11/2026 10:15');
  });

  it('escapa HTML e tira tabulação e quebra de linha das células', () => {
    const source = toCopySource(row(1, { channel: '<b>Canal\tcom\ntab</b>' }));
    const { html, text } = buildCopy(source ? [source] : [], { description: 'x', at: AT });
    expect(html).toContain('&lt;b&gt;Canal');
    expect(html).not.toContain('<b>Canal');
    expect(text.split('\r\n')[2]?.split('\t')).toHaveLength(8);
  });

  it('código de situação desconhecido não vira linha', () => {
    expect(toCopySource({ ...row(1), detailedSituation: 'inventada' })).toBeNull();
  });
});

describe('canal clipboard.copyReservations (FR-027, FR-028)', () => {
  it('da seleção: só as colunas da cópia; um campo de hóspede é recusado', async () => {
    const { copy, written } = handlersWith([]);
    const refused = await copy({
      source: 'selection',
      rows: [{ ...row(1), guestName: GUEST_MARKER }],
    });
    expect(refused).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(written()).toBeNull();

    const result = await copy({ source: 'selection', rows: [row(1), row(2)] });
    expect(result).toEqual({ ok: true, data: { copied: 2, total: 2, truncated: false } });
    expect(written()?.text).toContain('Reservas selecionadas — 2 reservas');
  });

  it('do filtro: o nome do hóspede que vem da seleção do servidor não entra na cópia', async () => {
    const { copy, api, written } = handlersWith([selectionItem(1), selectionItem(2)]);
    const result = await copy({
      source: 'filter',
      filters: { pendingCharge: true },
      description: 'Filtros: Falta cobrar',
    });
    expect(result).toEqual({ ok: true, data: { copied: 2, total: 2, truncated: false } });
    expect(api.selectReservations).toHaveBeenCalledWith({ pendingCharge: true });
    const content = written();
    expect(content?.html).not.toContain(GUEST_MARKER);
    expect(content?.text).not.toContain(GUEST_MARKER);
    expect(content?.text).toContain('Validar comprovante');
    expect(content?.text).toContain('Cancelada');
  });

  it('filtro com mais de 2 000: copia as 2 000 primeiras e avisa', async () => {
    const items = Array.from({ length: 2000 }, (_unused, index) => selectionItem(index));
    const { copy, written } = handlersWith(items, 3500);
    const result = await copy({ source: 'filter', filters: {} });
    expect(result).toEqual({ ok: true, data: { copied: 2000, total: 3500, truncated: true } });
    expect(written()?.text.split('\r\n')[0]).toContain('(as 2000 primeiras de 3500)');
  });

  it('acima de 2 000 na seleção, recusa', async () => {
    const { copy } = handlersWith([]);
    const rows = Array.from({ length: 2001 }, (_unused, index) => row(index));
    expect(await copy({ source: 'selection', rows })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
  });

  it('nada é gravado em disco', async () => {
    const writes = [
      vi.spyOn(fs, 'writeFileSync'),
      vi.spyOn(fs, 'writeFile'),
      vi.spyOn(fs.promises, 'writeFile'),
      vi.spyOn(fs, 'createWriteStream'),
    ];
    const { copy } = handlersWith([selectionItem(1)]);
    await copy({ source: 'filter', filters: {} });
    await copy({ source: 'selection', rows: [row(1)] });
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
  });
});
