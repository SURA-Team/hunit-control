/**
 * Verificação de uma reserva pelo número (specs/005, FR-004; research R-02) — tasks.md, T027.
 * Hunit simulado; a lista de rotas permitidas não muda.
 */
import { describe, expect, it } from 'vitest';
import { ScreenNotRecognizedError } from '../../src/hunit/errors.js';
import { findReservation } from '../../src/hunit/find-reservation.js';
import { API_CLIENT_ALLOWED_ROUTES } from '../../src/hunit/read-only-guard.js';
import { FakeHunit, reservationDetails } from '../helpers/fake-hunit-gateway.js';

async function signedIn(hunit: FakeHunit) {
  const gateway = await hunit.createGateway({ executionId: 'envio-de-teste' });
  await gateway.login({ username: 'operador@hotel.test', password: 'senha' });
  await gateway.submitToken('123456');
  return gateway;
}

const atCheckIn = (reservationNumber: string, checkIn: string) => ({
  reservationNumber,
  listing: { checkIn },
});

describe('findReservation (T027)', () => {
  it('lê a listagem do dia do check-in, percorre as páginas e abre o detalhe', async () => {
    const reservations = Array.from({ length: 4 }, (_unused, index) =>
      atCheckIn(String(900_001 + index), '2026-11-03'),
    );
    const hunit = new FakeHunit({
      hotels: [
        {
          code: 'hml_um',
          pageSize: 2,
          reservations: [
            ...reservations,
            { ...atCheckIn('900005', '2026-11-03'), detail: reservationDetails.alreadyCharged() },
          ],
        },
      ],
    });
    const gateway = await signedIn(hunit);
    const found = await findReservation(gateway, {
      hotelCode: 'hml_um',
      reservationNumber: '900005',
      checkIn: '2026-11-03',
    });

    expect(found?.item.reservationNumber).toBe('900005');
    expect(found?.detail.snapshot.chargeRecordPresent).toBe(true);
    const searches = hunit.calls.filter((call) => call.method === 'searchReservations');
    expect(searches).toEqual([
      expect.objectContaining({ period: { from: '2026-11-03', to: '2026-11-03' }, page: 1 }),
      expect.objectContaining({ page: 2 }),
      expect.objectContaining({ page: 3 }),
    ]);
    expect(hunit.calls.filter((call) => call.method === 'readReservation')).toHaveLength(1);
  });

  it('devolve null quando a reserva não está no dia do check-in', async () => {
    const hunit = new FakeHunit({
      hotels: [{ code: 'hml_um', reservations: [atCheckIn('900001', '2026-11-04')] }],
    });
    const gateway = await signedIn(hunit);
    expect(
      await findReservation(gateway, {
        hotelCode: 'hml_um',
        reservationNumber: '900001',
        checkIn: '2026-11-03',
      }),
    ).toBeNull();
    expect(hunit.calls.some((call) => call.method === 'readReservation')).toBe(false);
  });

  it('detalhe não reconhecido chega como ScreenNotRecognizedError, com a evidência', async () => {
    const hunit = new FakeHunit({
      hotels: [
        {
          code: 'hml_um',
          reservations: [
            {
              ...atCheckIn('900001', '2026-11-03'),
              detail: new ScreenNotRecognizedError('detalhe desconhecido', {
                evidence: { response: '{"fake":true}' },
              }),
            },
          ],
        },
      ],
    });
    const gateway = await signedIn(hunit);
    await expect(
      findReservation(gateway, {
        hotelCode: 'hml_um',
        reservationNumber: '900001',
        checkIn: '2026-11-03',
      }),
    ).rejects.toBeInstanceOf(ScreenNotRecognizedError);
  });

  it('não acrescenta rota à lista de permissão (research R-02)', () => {
    expect([...API_CLIENT_ALLOWED_ROUTES]).toEqual([
      '/api/Account/GetCurrentUser',
      '/api/Account/GetCurrentUserCompanies',
      '/api/Entity/GetBookings',
      '/api/Company/BookingDetail',
    ]);
  });
});
