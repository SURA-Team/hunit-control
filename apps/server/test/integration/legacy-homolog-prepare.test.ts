/**
 * Preparação da homologação da importação do histórico (specs/004, quickstart §2) — tasks.md,
 * T039. Não é um teste: fica desligado nas rodadas normais e só roda com as duas variáveis:
 *
 *   $env:HUNIT_HOMOLOG_DATABASE_URL = "postgres://hunit:<senha>@127.0.0.1:55432/hunit"
 *   $env:HUNIT_LEGACY_HOMOLOG_DIR = "C:\hunit-homolog\importacao"
 *   pnpm test --project server-db legacy-homolog-prepare
 *
 * Gera `planilha.xlsx` e `anexos\` fictícios para os hotéis HML1 a HML4 da homologação da 003 (o
 * banco precisa já ter esses hotéis), com um caso de cada situação do relatório. Não grava nada no
 * banco: a importação é feita depois, pelo comando, como na produção.
 */
import path from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  legacyAttachmentPath,
  legacyFile,
  legacyReservationRow,
  legacyTreatmentRow,
  wallClock,
  writeLegacyAttachments,
  writeLegacyWorkbook,
  type LegacyReservationRow,
  type LegacyTreatmentRow,
} from '../helpers/legacy-fixtures.js';

const DATABASE_URL = process.env['HUNIT_HOMOLOG_DATABASE_URL'];
const OUT_DIR = process.env['HUNIT_LEGACY_HOMOLOG_DIR'];

/** Hotéis do sistema anterior: os quatro com nome igual ao da homologação e um sem par. */
const LEGACY_HOTELS = [
  { key: 'hml_praia', name: 'Hotel Homologação Praia', number: 1 },
  { key: 'hml_serra', name: 'Pousada Homologação Serra', number: 2 },
  { key: 'hml_centro', name: 'Hotel Homologação Centro', number: 3 },
  { key: 'hml_lago', name: 'Resort Homologação Lago', number: 4 },
];
const UNMATCHED = { key: 'hml_desativado', name: 'Hotel Homologação Desativado' };

const CODES = [
  'virtual_card_pending_charge',
  'virtual_card_already_charged',
  'virtual_card_charge_error',
  'analysis_error',
  'not_virtual_card',
  'ignored_hotelbeds_258',
];
const GUESTS = ['Ana Fictícia', 'Bruno Fictício', 'Carla Fictícia', 'Diego Fictício'];

describe.skipIf(!DATABASE_URL || !OUT_DIR)('preparação da homologação da importação', () => {
  it('gera a planilha e os anexos fictícios', async () => {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    let existing: string[];
    try {
      const hotels = await client.query<{ code: string }>(
        "select code from hotels where code like 'HML%' order by code",
      );
      expect(
        hotels.rows.map((row) => row.code),
        'o banco precisa ser o da homologação, com os hotéis HML1 a HML4 (quickstart da 003, §2.1)',
      ).toEqual(['HML1', 'HML2', 'HML3', 'HML4']);
      const rows = await client.query<{ reservation_number: string }>(
        "select reservation_number from reservations where hotel_code = 'HML1' order by reservation_number limit 3",
      );
      existing = rows.rows.map((row) => row.reservation_number);
    } finally {
      await client.end();
    }

    const out = OUT_DIR ?? '';
    const reservations: LegacyReservationRow[] = [];
    const treatments: LegacyTreatmentRow[] = [];
    const attachments: Record<string, Buffer> = {};
    const file = (name: string, content: Buffer) => {
      attachments[legacyAttachmentPath(name)] = content;
      return legacyAttachmentPath(name);
    };

    // 40 reservas por hotel, de todas as classificações do sistema anterior.
    for (const hotel of LEGACY_HOTELS) {
      for (let i = 0; i < 40; i++) {
        const number = `9${hotel.number}${String(i + 1).padStart(4, '0')}`;
        reservations.push(
          legacyReservationRow(
            {
              'Codigo hotel': hotel.key,
              Hotel: hotel.name,
              Reserva: number,
              Hospede: GUESTS[i % GUESTS.length] ?? null,
              'Codigo status': CODES[i % CODES.length] ?? null,
              'Total da reserva': 300 + i * 12.5,
            },
            i,
          ),
        );
      }
    }
    const first = (hotel: number, i: number) => `9${hotel}${String(i).padStart(4, '0')}`;

    // Linhas com problema (uma de cada motivo), no hotel "Praia", e o hotel sem correspondência.
    const praiaRow = (overrides: LegacyReservationRow) =>
      legacyReservationRow({
        'Codigo hotel': 'hml_praia',
        Hotel: 'Hotel Homologação Praia',
        ...overrides,
      });
    reservations.push(
      praiaRow({ Reserva: '980001', Entrada: 'data ilegível' }),
      praiaRow({ Reserva: '980002', 'Total da reserva': 'valor ilegível' }),
      praiaRow({ Reserva: '980003', Saida: null }),
      praiaRow({ Reserva: '980004', Saida: wallClock('2026-05-01T00:00:00') }),
      praiaRow({ Reserva: '980005', 'Quantidade de verificacoes': 0 }),
      praiaRow({
        Reserva: '980006',
        'Ultima verificacao': wallClock('2026-05-02T10:00:00'),
      }),
      praiaRow({ Reserva: '980006' }),
      praiaRow({
        Reserva: '980007',
        Entrada: wallClock('2020-01-10T00:00:00'),
        Saida: wallClock('2020-01-12T00:00:00'),
      }),
      legacyReservationRow({
        'Codigo hotel': UNMATCHED.key,
        Hotel: UNMATCHED.name,
        Reserva: '980008',
      }),
      praiaRow({ Reserva: '980009', 'Codigo status': 'codigo_desconhecido' }),
    );
    // Reservas que a homologação já tem: o HUNIT Control prevalece (FR-010).
    for (const number of existing) {
      reservations.push(
        legacyReservationRow({
          'Codigo hotel': 'hml_praia',
          Hotel: 'Hotel Homologação Praia',
          Reserva: number,
        }),
      );
    }

    const praia = { 'Codigo hotel': 'hml_praia' };
    treatments.push(
      legacyTreatmentRow(first(1, 1), {
        ...praia,
        'Tratativa - arquivo no Dropbox': file('pedido_1.eml', legacyFile.eml('1')),
        'Tratativa - nome original': 'Pedido de cobrança 1.eml',
        'Tratativa anexada em': '2026-05-02T09:30:00',
        'Comprovante - arquivo no Dropbox': file('comprovante_1.pdf', legacyFile.pdf('1')),
        'Comprovante - nome original': 'Comprovante 1.pdf',
        'Comprovante anexado em': '2026-05-05T16:00:00',
        'Valor manual': '310.00',
        'Valor manual alterado em': '2026-05-05T16:05:00',
      }),
      legacyTreatmentRow(first(1, 7), {
        ...praia,
        'Anexo antigo - arquivo no Dropbox': file('antigo_7.pdf', legacyFile.pdf('7')),
      }),
      legacyTreatmentRow(first(1, 3), {
        ...praia,
        'Anexo antigo - arquivo no Dropbox': file('antigo_3.png', legacyFile.png('3')),
      }),
      legacyTreatmentRow(first(1, 5), {
        ...praia,
        'Tratativa - arquivo no Dropbox': file('pedido_5.pdf', legacyFile.pdf('5')),
      }),
      legacyTreatmentRow(first(1, 2), {
        ...praia,
        'Tratativa - arquivo no Dropbox': file('pedido_2.pdf', legacyFile.pdf('2')),
      }),
      legacyTreatmentRow(first(1, 13), {
        ...praia,
        'Comprovante - arquivo no Dropbox': legacyAttachmentPath('nao_existe.pdf'),
      }),
      legacyTreatmentRow(first(1, 19), {
        ...praia,
        'Tratativa - arquivo no Dropbox': file('renomeado.pdf', legacyFile.executable()),
      }),
      legacyTreatmentRow(first(1, 25), {
        ...praia,
        'Comprovante - arquivo no Dropbox': file('grande.pdf', legacyFile.tooLarge()),
      }),
      legacyTreatmentRow(first(1, 31), {
        ...praia,
        'Tratativa - arquivo no Dropbox': file('vazio.pdf', legacyFile.empty()),
      }),
      legacyTreatmentRow(first(1, 37), {
        ...praia,
        'Tratativa - arquivo no Dropbox': file('planilha.xlsx', Buffer.from('PK')),
        'Valor manual': '50.00',
      }),
      legacyTreatmentRow('980001', {
        ...praia,
        'Tratativa - arquivo no Dropbox': file('pedido_recusada.pdf', legacyFile.pdf('r')),
      }),
      legacyTreatmentRow('999999', {
        ...praia,
        'Tratativa - arquivo no Dropbox': file('pedido_sem_reserva.pdf', legacyFile.pdf('s')),
      }),
      legacyTreatmentRow('980007', {
        ...praia,
        'Tratativa - arquivo no Dropbox': file('pedido_antiga.pdf', legacyFile.pdf('a')),
      }),
    );
    if (existing[0]) {
      treatments.push(
        legacyTreatmentRow(existing[0], {
          ...praia,
          'Tratativa - arquivo no Dropbox': file('pedido_existente.pdf', legacyFile.pdf('e')),
        }),
      );
    }
    file('sobra.pdf', legacyFile.pdf('sobra'));

    await writeLegacyWorkbook(path.join(out, 'planilha.xlsx'), { reservations, treatments });
    writeLegacyAttachments(path.join(out, 'anexos'), attachments);
  }, 120_000);
});
