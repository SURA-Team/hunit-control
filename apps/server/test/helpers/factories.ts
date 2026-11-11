/**
 * Fábricas de registros para testes: inserem linhas válidas com valores padrão, para que cada
 * teste informe só o que importa para ele.
 */
import { randomUUID } from 'node:crypto';
import type { Database } from '../../src/persistence/db.js';
import { apiClients, executions, hotels, reservations } from '../../src/persistence/schema.js';

type NewClient = typeof apiClients.$inferInsert;
type NewExecution = typeof executions.$inferInsert;
type NewHotel = typeof hotels.$inferInsert;
type NewReservation = typeof reservations.$inferInsert;

export async function insertClient(db: Database, overrides: Partial<NewClient> = {}) {
  const unique = randomUUID();
  const [row] = await db
    .insert(apiClients)
    .values({
      name: `cliente-${unique}`,
      role: 'operator',
      keyHash: `hash-${unique}`,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insertClient não devolveu a linha inserida');
  return row;
}

export async function insertHotel(db: Database, overrides: Partial<NewHotel> = {}) {
  const unique = randomUUID().slice(0, 8);
  const [row] = await db
    .insert(hotels)
    .values({ code: `hotel-${unique}`, name: `Hotel ${unique}`, ...overrides })
    .returning();
  if (!row) throw new Error('insertHotel não devolveu a linha inserida');
  return row;
}

/** Insere uma execução; cria um cliente se `clientId` não for informado. */
export async function insertExecution(db: Database, overrides: Partial<NewExecution> = {}) {
  const clientId = overrides.clientId ?? (await insertClient(db)).id;
  const [row] = await db
    .insert(executions)
    .values({
      accountKey: `conta-${randomUUID()}`,
      periodFrom: '2026-11-01',
      periodTo: '2026-11-07',
      ...overrides,
      clientId,
    })
    .returning();
  if (!row) throw new Error('insertExecution não devolveu a linha inserida');
  return row;
}

/** Insere uma reserva; cria o hotel e a execução se não forem informados. */
export async function insertReservation(db: Database, overrides: Partial<NewReservation> = {}) {
  const hotelCode = overrides.hotelCode ?? (await insertHotel(db)).code;
  const lastExecutionId = overrides.lastExecutionId ?? (await insertExecution(db)).id;
  const now = new Date();
  const [row] = await db
    .insert(reservations)
    .values({
      reservationNumber: '1001',
      channel: 'Booking.com',
      checkIn: '2026-11-03',
      checkOut: '2026-11-05',
      stayPeriod: '03/11/2026 - 05/11/2026',
      totalAmount: '1234.56',
      reservationStatus: 'active',
      classification: 'virtual_card_pending_charge',
      reason: 'pré-pagamento sem registro de cobrança',
      prePaymentFound: true,
      chargeActionVisible: true,
      firstVerifiedAt: now,
      lastVerifiedAt: now,
      ...overrides,
      hotelCode,
      lastExecutionId,
    })
    .returning();
  if (!row) throw new Error('insertReservation não devolveu a linha inserida');
  return row;
}
