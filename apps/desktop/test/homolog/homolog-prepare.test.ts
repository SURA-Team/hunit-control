/**
 * Preparação do ambiente de homologação da feature 003 (T056, quickstart §2.1).
 *
 * Não é um teste: fica desligado nas rodadas normais e só roda com `HUNIT_HOMOLOG_DATABASE_URL`
 * (banco da pilha de homologação, publicado só em 127.0.0.1) e `HUNIT_HOMOLOG_FILES_DIR` (pasta
 * fora do repositório) definidas. Grava hotéis e reservas **fictícios** de todas as
 * classificações e gera os arquivos de teste sintéticos, para a homologação nunca tocar no banco
 * de produção nem em documentos reais.
 *
 * Recusa banco que já tenha reservas: só roda num banco de homologação recém-criado.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectDatabase, runMigrations } from '../../../server/src/persistence/db.js';
import { hotels, reservations } from '../../../server/src/persistence/schema.js';
import { insertClient, insertExecution } from '../../../server/test/helpers/factories.js';
import { emlFile, msgFile, pdfFile, pngFile } from '../helpers/synthetic-files.js';

const DATABASE_URL = process.env['HUNIT_HOMOLOG_DATABASE_URL'];
const FILES_DIR = process.env['HUNIT_HOMOLOG_FILES_DIR'];

const MB = 1024 * 1024;
const RESERVATIONS_PER_HOTEL = 500;

const HOTELS = [
  { code: 'HML1', name: 'Hotel Homologação Praia' },
  { code: 'HML2', name: 'Pousada Homologação Serra' },
  { code: 'HML3', name: 'Hotel Homologação Centro' },
  { code: 'HML4', name: 'Resort Homologação Lago' },
];

const GUESTS = [
  'Ana Ribeiro',
  'Bruno Carvalho',
  'Carla Mendes',
  'Diego Fernandes',
  'Elisa Martins',
  'Fábio Rocha',
  'Gabriela Lima',
  'Henrique Alves',
  'Isabela Costa',
  'João Pereira',
];
const CHANNELS = ['Booking.com', 'Expedia', 'Decolar', 'Site próprio', 'Airbnb'];

type NewReservation = typeof reservations.$inferInsert;
type Variant = Pick<
  NewReservation,
  | 'classification'
  | 'reservationStatus'
  | 'reason'
  | 'prePaymentFound'
  | 'chargeActionVisible'
  | 'paymentForm'
>;

const pending: Variant = {
  classification: 'virtual_card_pending_charge',
  reservationStatus: 'active',
  reason: 'pré-pagamento sem registro de cobrança',
  prePaymentFound: true,
  chargeActionVisible: true,
  paymentForm: null,
};

/** Ciclo de 20: metade pendente de cobrança, o resto espalhado pelas outras classificações. */
const CYCLE: Variant[] = [
  ...Array.from({ length: 10 }, () => pending),
  ...Array.from({ length: 3 }, () => ({
    ...pending,
    classification: 'virtual_card_already_charged' as const,
    reason: 'cobrança registrada no Hunit',
    chargeActionVisible: false,
  })),
  {
    ...pending,
    classification: 'virtual_card_charge_error',
    reason: 'erro na cobrança: cartão recusado pela operadora',
  },
  {
    ...pending,
    classification: 'virtual_card_validated_only',
    reason: 'cartão validado, sem cobrança',
  },
  ...Array.from({ length: 2 }, () => ({
    ...pending,
    classification: 'invoiced' as const,
    reason: 'forma de pagamento: faturado',
    prePaymentFound: false,
    chargeActionVisible: false,
    paymentForm: 'Faturado',
  })),
  {
    ...pending,
    classification: 'charge_at_terminal',
    reason: 'sem pré-pagamento; cobrar na maquininha',
    prePaymentFound: false,
    chargeActionVisible: false,
    paymentForm: 'cartão de crédito',
  },
  {
    ...pending,
    classification: 'not_virtual_card',
    reason: 'pagamento sem cartão virtual',
    chargeActionVisible: false,
  },
  {
    ...pending,
    classification: 'cancelled_no_charge',
    reservationStatus: 'cancelled',
    reason: 'reserva cancelada sem cobrança',
    chargeActionVisible: false,
  },
];

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const brDate = (iso: string) => iso.split('-').reverse().join('/');
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

describe.skipIf(!DATABASE_URL || !FILES_DIR)('preparação do ambiente de homologação', () => {
  it('grava os dados fictícios e gera os arquivos de teste', async () => {
    const connection = connectDatabase(DATABASE_URL ?? '');
    try {
      await runMigrations(connection);
      const { db } = connection;

      const existing = await connection.pool.query<{ total: number }>(
        'select count(*)::int as total from reservations',
      );
      expect(
        existing.rows[0]?.total,
        'o banco já tem reservas: a preparação só roda no banco de homologação recém-criado',
      ).toBe(0);

      await db.insert(hotels).values(HOTELS).onConflictDoNothing();
      const client = await insertClient(db, { name: 'carga-homologacao' });
      const today = new Date();
      const execution = await insertExecution(db, {
        clientId: client.id,
        periodFrom: isoDate(addDays(today, -90)),
        periodTo: isoDate(addDays(today, 30)),
        status: 'completed',
        startedAt: today,
        finishedAt: today,
      });

      const listing: string[] = [
        'Reservas fictícias da homologação (número; check-in; classificação)',
      ];
      for (const [hotelIndex, hotel] of HOTELS.entries()) {
        const rows: NewReservation[] = [];
        for (let index = 0; index < RESERVATIONS_PER_HOTEL; index += 1) {
          const variant = CYCLE[index % CYCLE.length] ?? pending;
          const checkIn = addDays(today, -90 + (index % 120));
          const checkOut = addDays(checkIn, 1 + (index % 4));
          const amount = (180 + ((index * 37 + hotelIndex * 11) % 2400)).toFixed(2);
          const charged = variant.classification === 'virtual_card_already_charged';
          rows.push({
            ...variant,
            hotelCode: hotel.code,
            reservationNumber: `${hotelIndex + 1}${String(index + 1).padStart(5, '0')}`,
            guestName: GUESTS[(index + hotelIndex) % GUESTS.length] ?? null,
            channel: CHANNELS[index % CHANNELS.length] ?? 'Booking.com',
            checkIn: isoDate(checkIn),
            checkOut: isoDate(checkOut),
            stayPeriod: `${brDate(isoDate(checkIn))} - ${brDate(isoDate(checkOut))}`,
            totalAmount: amount,
            ...(charged && {
              chargedAt: checkIn,
              chargedAmount: amount,
              authorizationCode: `AUT-${String(index).padStart(4, '0')}`,
            }),
            firstVerifiedAt: today,
            lastVerifiedAt: today,
            lastExecutionId: execution.id,
          });
        }
        for (let start = 0; start < rows.length; start += 250) {
          await db.insert(reservations).values(rows.slice(start, start + 250));
        }

        listing.push('', `${hotel.code} — ${hotel.name}`);
        for (const row of rows.slice(0, 40)) {
          listing.push(`${row.reservationNumber}; ${brDate(row.checkIn)}; ${row.classification}`);
        }
      }

      const dir = FILES_DIR ?? '';
      await mkdir(dir, { recursive: true });
      const files: Array<[string, Buffer]> = [
        ['comprovante-teste.pdf', pdfFile('Comprovante de teste 1')],
        ['comprovante-teste-2.pdf', pdfFile('Comprovante de teste 2')],
        ['comprovante-lote.pdf', pdfFile('Comprovante de teste em lote')],
        ['imagem-teste.png', pngFile()],
        [
          'pedido-teste.eml',
          emlFile({
            subject: 'Pedido de cobranca de teste (homologacao)',
            text: 'Favor cobrar a reserva de teste.',
            html:
              '<p>Favor cobrar a reserva <b>de teste</b>.</p>' +
              '<img src="https://rastreador.exemplo.test/pixel.gif">',
            attachment: { name: 'anexo-teste.txt', content: 'anexo de teste' },
          }),
        ],
        ['pedido-teste.msg', msgFile({ subject: 'Pedido de cobranca de teste (Outlook)' })],
        [
          'grande-26MB.pdf',
          Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(26 * MB, 0x20)]),
        ],
        ['executavel-renomeado.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096, 0)])],
      ];
      for (const [name, content] of files) await writeFile(path.join(dir, name), content);
      await writeFile(path.join(dir, 'reservas.txt'), `${listing.join('\r\n')}\r\n`, 'utf8');
    } finally {
      await connection.close();
    }
  }, 120_000);
});
