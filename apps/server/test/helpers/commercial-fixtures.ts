/**
 * Dados fictícios dos testes do envio ao Comercial (specs/005, T003). Nada aqui vem do Hunit real
 * nem de planilha real: hotéis `hml_um` a `hml_quatro`, hóspedes "Hóspede Fictício N", reservas
 * `900001…` e responsáveis "Comercial Fictício N".
 */
import { randomUUID } from 'node:crypto';
import type { CommercialReturnCells } from '@hunit/domain';
import type { Database } from '../../src/persistence/db.js';
import {
  commercialDispatches,
  commercialLines,
  commercialReturns,
  type commercialLineStateEnum,
  type commercialReturnStateEnum,
} from '../../src/persistence/schema.js';
import { insertClient, insertHotel, insertReservation } from './factories.js';

/** Valor-marcador no lugar do nome do hóspede: não pode aparecer na planilha (SC-007). */
export const GUEST_MARKER = 'HOSPEDE-MARCADOR-QUE-NAO-PODE-SAIR';

/** Valor-marcador no lugar da chave e do ID da planilha: não pode aparecer em lugar nenhum (SC-009). */
export const SHEET_SECRET_MARKER = 'CHAVE-DA-PLANILHA-MARCADOR-SECRETO';

export const TEST_HOTELS = [
  { code: 'hml_um', name: 'Hotel Homologação Um' },
  { code: 'hml_dois', name: 'Hotel Homologação Dois' },
  { code: 'hml_tres', name: 'Hotel Homologação Três' },
  { code: 'hml_quatro', name: 'Hotel Homologação Quatro' },
] as const;

/** Cadastra os hotéis fictícios (ignora os que já existem). */
export async function seedTestHotels(db: Database): Promise<void> {
  for (const hotel of TEST_HOTELS) {
    await insertHotel(db, hotel).catch(() => undefined);
  }
}

type NewReservation = Parameters<typeof insertReservation>[1];

/**
 * Reserva fictícia pendente de cobrança no `hml_um`. `number` vira o número da reserva
 * (`900001`, `900002`…) e o hóspede "Hóspede Fictício N".
 */
export async function insertCommercialReservation(
  db: Database,
  number: number,
  overrides: NewReservation = {},
) {
  return insertReservation(db, {
    hotelCode: 'hml_um',
    reservationNumber: String(900_000 + number),
    guestName: `Hóspede Fictício ${number}`,
    classification: 'virtual_card_pending_charge',
    totalAmount: '1234.56',
    ...overrides,
  });
}

/** Envio já encerrado, para as linhas que os testes criam direto no banco. */
export async function insertDispatch(
  db: Database,
  overrides: Partial<typeof commercialDispatches.$inferInsert> = {},
) {
  const clientId = overrides.clientId ?? (await insertClient(db)).id;
  const [row] = await db
    .insert(commercialDispatches)
    .values({
      accountKey: `conta-${randomUUID()}`,
      status: 'completed',
      finishedAt: new Date(),
      ...overrides,
      clientId,
    })
    .returning();
  if (!row) throw new Error('insertDispatch não devolveu a linha inserida');
  return row;
}

type LineState = (typeof commercialLineStateEnum.enumValues)[number];

/** Linha da planilha de uma reserva já gravada. */
export async function insertLine(
  db: Database,
  key: { hotelCode: string; reservationNumber: string },
  options: { state?: LineState; dispatchId?: string; clientId?: string; at?: Date } = {},
) {
  const at = options.at ?? new Date();
  const dispatch = options.dispatchId
    ? { id: options.dispatchId, clientId: options.clientId ?? (await insertClient(db)).id }
    : await insertDispatch(db, options.clientId ? { clientId: options.clientId } : {});
  const state = options.state ?? 'open';
  const [row] = await db
    .insert(commercialLines)
    .values({
      ...key,
      state,
      firstSentAt: at,
      lastSentAt: at,
      lastDispatchId: dispatch.id,
      lastSentByClientId: dispatch.clientId,
      changedAt: at,
      concludedAt: state === 'open' ? null : at,
      cancelledAt: state === 'cancelled' ? at : null,
      cancelledByClientId: state === 'cancelled' ? dispatch.clientId : null,
    })
    .returning();
  if (!row) throw new Error('insertLine não devolveu a linha inserida');
  return row;
}

type ReturnState = (typeof commercialReturnStateEnum.enumValues)[number];

/** Retorno do Comercial de uma reserva já gravada. */
export async function insertReturn(
  db: Database,
  key: { hotelCode: string; reservationNumber: string },
  options: {
    state?: ReturnState;
    chargedAmount?: string;
    readAt?: Date;
    rejectionReason?: string;
  } = {},
) {
  const [row] = await db
    .insert(commercialReturns)
    .values({
      ...key,
      authorizationCode: 'AUT123',
      chargeHotel: 'Estabelecimento Fictício',
      chargedAmount: options.chargedAmount ?? '1234.56',
      chargedBy: 'Comercial Fictício 1',
      readAt: options.readAt ?? new Date(),
      state: options.state ?? 'awaiting_validation',
      rejectionReason: options.rejectionReason ?? null,
    })
    .returning();
  if (!row) throw new Error('insertReturn não devolveu a linha inserida');
  return row;
}

/** As quatro colunas de retorno: completo por padrão. */
export function returnCells(overrides: CommercialReturnCells = {}): CommercialReturnCells {
  return {
    authorizationCode: 'AUT123',
    chargeHotel: 'Estabelecimento Fictício',
    chargedAmount: 1234.56,
    chargedBy: 'Comercial Fictício 1',
    ...overrides,
  };
}
