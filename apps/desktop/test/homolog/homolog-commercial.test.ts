/**
 * Preparação da homologação do envio ao Comercial (specs/005, T060, quickstart §3).
 *
 * Não é um teste: fica desligado nas rodadas normais e só roda com `HUNIT_HOMOLOG_DATABASE_URL`
 * (banco da pilha de homologação, publicado só em 127.0.0.1) e `HUNIT_HOMOLOG_COMMERCIAL=1`.
 *
 * A homologação não acessa o Hunit (o endereço é inválido de propósito), então o envio pelo app não
 * consegue verificar as reservas e nada chega à planilha. Este script grava, no banco de
 * homologação já preparado pelo `homolog-prepare`, o resultado de um envio fictício — o envio, as
 * reservas enviadas, o histórico e as linhas da planilha —, como o servidor gravaria depois de
 * verificar no Hunit. O servidor da homologação escreve as linhas na planilha de teste na rodada
 * seguinte (em até 30 s); daí em diante, retornos, validação, recusa, desfazer, "Concluídas",
 * planilha fora do ar, cópia para e-mail e lotes funcionam como na produção.
 *
 * - Por hotel: 12 reservas "A cobrar" (das que exigem cobrança e não têm documento) e 3 que o
 *   Hunit passou a mostrar como cobradas depois do envio (linha em "Concluídas" e o alerta
 *   "Verificar").
 * - Recusa um banco que não seja o da homologação (hotéis diferentes de HML1 a HML4) ou que já
 *   tenha linhas da planilha. Tudo numa transação: ou grava tudo, ou nada.
 * - Com `HUNIT_HOMOLOG_FILES_DIR`, grava `envios.txt` com os hotéis e números enviados, para quem
 *   faz o papel do Comercial preencher os retornos.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectDatabase, runMigrations } from '../../../server/src/persistence/db.js';

const DATABASE_URL = process.env['HUNIT_HOMOLOG_DATABASE_URL'];
const ENABLED = process.env['HUNIT_HOMOLOG_COMMERCIAL'] === '1';
const FILES_DIR = process.env['HUNIT_HOMOLOG_FILES_DIR'];

/** Os hotéis fictícios do `homolog-prepare`: nenhum outro banco é aceito. */
const HOMOLOG_HOTELS = ['HML1', 'HML2', 'HML3', 'HML4'];
const OPEN_PER_HOTEL = 12;
const REVIEW_PER_HOTEL = 3;
const CLIENT_NAME = 'envio-homologacao';
/** As que aceitam o envio (specs/005, FR-001), menos "A revisar (sistema anterior)". */
const DISPATCHABLE = [
  'virtual_card_pending_charge',
  'virtual_card_charge_error',
  'virtual_card_validated_only',
  'charge_at_terminal',
];
const HOUR_MS = 3_600_000;

const WITHOUT_DOCUMENT = `not exists (select 1 from treatment_documents d
  where d.hotel_code = r.hotel_code and d.reservation_number = r.reservation_number)`;

interface Sent {
  hotel_code: string;
  reservation_number: string;
  classification: string;
  concluded: boolean;
}

describe.skipIf(!DATABASE_URL || !ENABLED)(
  'preparação da homologação do envio ao Comercial',
  () => {
    it('grava um envio fictício e as linhas da planilha', async () => {
      const connection = connectDatabase(DATABASE_URL ?? '');
      const listing = ['Reservas enviadas ao Comercial na homologação (hotel; reserva; aba)'];
      try {
        await runMigrations(connection);
        const client = await connection.pool.connect();
        try {
          await client.query('begin');
          const catalog = await client.query<{ code: string; name: string }>(
            'select code, name from hotels order by code',
          );
          expect(
            catalog.rows.length,
            'rode antes o homolog-prepare (quickstart §2.1 da 003)',
          ).toBeGreaterThan(0);
          expect(
            catalog.rows.map((row) => row.code).filter((code) => !HOMOLOG_HOTELS.includes(code)),
            'o banco tem hotéis que não são os da homologação: este script só roda na homologação',
          ).toEqual([]);
          const lines = await client.query<{ total: number }>(
            'select count(*)::int as total from commercial_lines',
          );
          expect(lines.rows[0]?.total, 'a preparação do envio já foi feita neste banco').toBe(0);

          const now = new Date();
          const sentAt = new Date(now.getTime() - 2 * HOUR_MS);
          const changedAt = new Date(sentAt.getTime() + HOUR_MS);

          // Cliente da API que "fez" o envio: sem chave utilizável (o hash não corresponde a nenhuma).
          const existing = await client.query<{ id: string }>(
            'select id from api_clients where name = $1',
            [CLIENT_NAME],
          );
          let clientId = existing.rows[0]?.id;
          if (!clientId) {
            const created = await client.query<{ id: string }>(
              `insert into api_clients (name, role, key_hash) values ($1, 'operator', $2) returning id`,
              [CLIENT_NAME, randomBytes(32).toString('hex')],
            );
            clientId = created.rows[0]?.id;
          }

          const dispatchId = randomUUID();
          await client.query(
            `insert into commercial_dispatches
               (id, account_key, client_id, status, created_at, started_at, finished_at)
             values ($1, 'homologacao-sem-hunit', $2, 'completed', $3, $3, $4)`,
            [dispatchId, clientId, sentAt, new Date(sentAt.getTime() + 5 * 60_000)],
          );

          const names = new Map(catalog.rows.map((row) => [row.code, row.name]));
          let position = 0;
          for (const hotel of HOMOLOG_HOTELS) {
            const open = await client.query<Sent>(
              `select hotel_code, reservation_number, classification::text, false as concluded
               from reservations r
               where hotel_code = $1 and classification::text = any($2) and ${WITHOUT_DOCUMENT}
                 and not exists (select 1 from reservation_manual_amounts m
                   where m.hotel_code = r.hotel_code and m.reservation_number = r.reservation_number)
               order by reservation_number limit $3`,
              [hotel, DISPATCHABLE, OPEN_PER_HOTEL],
            );
            const charged = await client.query<Sent>(
              `select hotel_code, reservation_number, classification::text, true as concluded
               from reservations r
               where hotel_code = $1 and classification = 'virtual_card_already_charged'
                 and ${WITHOUT_DOCUMENT}
               order by reservation_number limit $2`,
              [hotel, REVIEW_PER_HOTEL],
            );

            for (const row of [...open.rows, ...charged.rows]) {
              position += 1;
              // Quando foi enviada, a reserva ainda exigia cobrança.
              const before = row.concluded ? 'virtual_card_pending_charge' : row.classification;
              await client.query(
                `insert into commercial_dispatch_items
                   (dispatch_id, hotel_code, reservation_number, position, outcome,
                    classification_before, classification_after, processed_at)
                 values ($1, $2, $3, $4, 'sent', $5, $5, $6)`,
                [dispatchId, row.hotel_code, row.reservation_number, position, before, sentAt],
              );
              await client.query(
                `insert into commercial_events
                   (hotel_code, reservation_number, type, dispatch_id, client_id, at)
                 values ($1, $2, 'dispatched', $3, $4, $5)`,
                [row.hotel_code, row.reservation_number, dispatchId, clientId, sentAt],
              );
              await client.query(
                `insert into commercial_lines
                   (hotel_code, reservation_number, state, first_sent_at, last_sent_at,
                    last_dispatch_id, last_sent_by_client_id, concluded_at, changed_at)
                 values ($1, $2, $3, $4, $4, $5, $6, $7, $8)`,
                [
                  row.hotel_code,
                  row.reservation_number,
                  row.concluded ? 'concluded' : 'open',
                  sentAt,
                  dispatchId,
                  clientId,
                  row.concluded ? now : null,
                  now,
                ],
              );
              // A verificação do envio é a última da reserva; as cobradas mudaram depois dela.
              await client.query(
                row.concluded
                  ? `update reservations set last_dispatch_id = $3,
                       previous_classification = 'virtual_card_pending_charge', status_changed_at = $4
                     where hotel_code = $1 and reservation_number = $2`
                  : `update reservations set last_dispatch_id = $3
                     where hotel_code = $1 and reservation_number = $2`,
                row.concluded
                  ? [row.hotel_code, row.reservation_number, dispatchId, changedAt]
                  : [row.hotel_code, row.reservation_number, dispatchId],
              );
              listing.push(
                `${names.get(hotel) ?? hotel}; ${row.reservation_number}; ${
                  row.concluded
                    ? 'Concluídas (o Hunit mostrou cobrada: alerta "Verificar")'
                    : 'A cobrar'
                }`,
              );
            }
          }
          expect(position, 'nenhuma reserva fictícia aceitou o envio').toBeGreaterThan(0);
          await client.query('commit');
        } catch (error) {
          await client.query('rollback');
          throw error;
        } finally {
          client.release();
        }
        if (FILES_DIR) {
          await writeFile(
            path.join(FILES_DIR, 'envios.txt'),
            `${listing.join('\r\n')}\r\n`,
            'utf8',
          );
        }
      } finally {
        await connection.close();
      }
    }, 120_000);
  },
);
