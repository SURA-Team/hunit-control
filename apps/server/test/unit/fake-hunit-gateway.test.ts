import { describe, expect, it } from 'vitest';
import {
  HunitUnavailableError,
  InvalidCredentialsError,
  InvalidTokenError,
  ScreenNotRecognizedError,
} from '../../src/hunit/errors.js';
import type { HunitGateway } from '../../src/hunit/gateway.js';
import { FakeHunit, fakeListing, reservationDetails } from '../helpers/fake-hunit-gateway.js';

const credentials = { username: 'operador@hotel.test', password: 'senha-de-teste' };
const week = { from: '2026-11-01', to: '2026-11-07' };

/** Lê o detalhe de uma reserva do hotel H1 a partir do id interno. */
async function read(gateway: HunitGateway, bookingId: string) {
  const item = {
    bookingId,
    reservationNumber: '',
    reservationStatus: 'active' as const,
    listing: fakeListing(),
  };
  return (await gateway.readReservation('H1', item)).snapshot;
}

async function authenticated(hunit: FakeHunit) {
  const gateway = await hunit.createGateway({ executionId: 'e-1' });
  await gateway.login(credentials);
  await gateway.submitToken('123456');
  return gateway;
}

describe('FakeHunit — acesso (T019)', () => {
  it('pede o token por padrão e conclui o acesso com o token correto', async () => {
    const hunit = new FakeHunit({ hotels: [{ code: 'H1', name: 'Hotel Um' }, { code: 'H2' }] });
    const gateway = await hunit.createGateway({ executionId: 'e-1' });

    expect(await gateway.login(credentials)).toBe('two_factor_required');
    await gateway.submitToken('123456');

    expect(await gateway.listHotels()).toEqual([
      { code: 'H1', name: 'Hotel Um' },
      { code: 'H2', name: 'Hotel H2' },
    ]);
  });

  it('recusa token diferente do esperado', async () => {
    const hunit = new FakeHunit({ validToken: '654321' });
    const gateway = await hunit.createGateway({ executionId: 'e-1' });
    await gateway.login(credentials);

    await expect(gateway.submitToken('123456')).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(gateway.submitToken('654321')).resolves.toBeUndefined();
  });

  it('lança os erros definidos no roteiro', async () => {
    const loginFails = new FakeHunit({ login: new InvalidCredentialsError() });
    const gateway = await loginFails.createGateway({ executionId: 'e-1' });
    await expect(gateway.login(credentials)).rejects.toBeInstanceOf(InvalidCredentialsError);

    const catalogFails = new FakeHunit({
      listHotelsError: new HunitUnavailableError('fora do ar'),
    });
    await expect((await authenticated(catalogFails)).listHotels()).rejects.toThrow(
      'O Hunit está indisponível: fora do ar',
    );
  });

  it('conclui o acesso sem token quando o roteiro diz que o Hunit não pede', async () => {
    const hunit = new FakeHunit({ login: 'authenticated', hotels: [{ code: 'H1' }] });
    const gateway = await hunit.createGateway({ executionId: 'e-1' });

    expect(await gateway.login(credentials)).toBe('authenticated');
    await expect(gateway.listHotels()).resolves.toHaveLength(1);
  });

  it('acusa uso fora de ordem (protege contra erros do executor)', async () => {
    const hunit = new FakeHunit({ hotels: [{ code: 'H1' }] });
    const gateway = await hunit.createGateway({ executionId: 'e-1' });

    await expect(gateway.listHotels()).rejects.toThrow('antes de o acesso ser concluído');
    await expect(gateway.submitToken('123456')).rejects.toThrow('sem o Hunit ter pedido o token');

    await gateway.login(credentials);
    await expect(gateway.login(credentials)).rejects.toThrow('login chamado duas vezes');
    await expect(gateway.searchReservations('H1', week, 1)).rejects.toThrow(
      'antes de o acesso ser concluído',
    );
  });

  it('cria uma sessão independente por execução e registra as chamadas de todas', async () => {
    const hunit = new FakeHunit({ hotels: [{ code: 'H1' }] });
    const first = await authenticated(hunit);
    const second = await hunit.createGateway({ executionId: 'e-2' });

    await expect(second.listHotels()).rejects.toThrow('antes de o acesso ser concluído');
    await first.listHotels();

    expect(hunit.sessions).toHaveLength(2);
    expect(hunit.calls.map((call) => `${call.session}:${call.method}`)).toEqual([
      '1:login',
      '1:submitToken',
      '2:listHotels',
      '1:listHotels',
    ]);
    expect(hunit.callsTo('login')[0]?.credentials).toEqual(credentials);
  });
});

describe('FakeHunit — reservas (T019)', () => {
  const hotel = {
    code: 'H1',
    pageSize: 2,
    reservations: [
      { reservationNumber: '1001', listing: { checkIn: '2026-11-01' } },
      { reservationNumber: '1002', listing: { checkIn: '2026-11-03' } },
      { reservationNumber: '1003', listing: { checkIn: '2026-11-07' } },
      { reservationNumber: '1004', listing: { checkIn: '2026-11-08' } },
      { reservationNumber: '0999', listing: { checkIn: '2026-10-31' } },
    ],
  };

  it('devolve só as reservas com check-in dentro do período, paginadas', async () => {
    const gateway = await authenticated(new FakeHunit({ hotels: [hotel] }));

    const first = await gateway.searchReservations('H1', week, 1);
    const second = await gateway.searchReservations('H1', week, 2);

    expect(first).toMatchObject({ page: 1, totalPages: 2, totalItems: 3 });
    expect(first.items.map((item) => item.reservationNumber)).toEqual(['1001', '1002']);
    expect(second.items.map((item) => item.reservationNumber)).toEqual(['1003']);
    expect(first.items[0]).toMatchObject({
      bookingId: 'booking-1001',
      reservationStatus: 'active',
      listing: { checkIn: '2026-11-01', channel: 'Booking.com' },
    });
  });

  it('devolve zero páginas quando não há reservas no período', async () => {
    const gateway = await authenticated(new FakeHunit({ hotels: [hotel] }));

    expect(
      await gateway.searchReservations('H1', { from: '2026-12-01', to: '2026-12-07' }, 1),
    ).toEqual({ page: 1, totalPages: 0, totalItems: 0, items: [] });
  });

  it('devolve páginas exatas quando o roteiro as define (ex.: reserva repetida entre páginas)', async () => {
    const repeated = { reservationNumber: '2001' };
    const gateway = await authenticated(
      new FakeHunit({
        hotels: [{ code: 'H1', pages: [[repeated, { reservationNumber: '2002' }], [repeated]] }],
      }),
    );

    const second = await gateway.searchReservations('H1', week, 2);

    expect(second).toMatchObject({ page: 2, totalPages: 2, totalItems: 3 });
    expect(second.items.map((item) => item.reservationNumber)).toEqual(['2001']);
  });

  it('lê o detalhe: pendente de cobrança por padrão, ou o que o roteiro definir', async () => {
    const gateway = await authenticated(
      new FakeHunit({
        hotels: [
          {
            code: 'H1',
            reservations: [
              { reservationNumber: '1001' },
              {
                reservationNumber: '1002',
                reservationStatus: 'cancelled',
                detail: reservationDetails.alreadyCharged({ chargedAmount: '750.00' }),
              },
              { reservationNumber: '1003', detail: reservationDetails.unrecognized() },
              {
                reservationNumber: '1004',
                detail: new ScreenNotRecognizedError('detalhe sem o campo de pré-pagamento'),
              },
            ],
          },
        ],
      }),
    );

    expect(await read(gateway, 'booking-1001')).toMatchObject({
      reservationNumber: '1001',
      structureRecognized: true,
      prePaymentPresent: true,
      chargeRecordPresent: false,
      chargeActionVisible: true,
      chargeFailed: false,
      validationOnly: false,
      reservationStatus: 'active',
      payment: { prePaymentState: 'Unprocessed', chargedAt: null },
    });
    expect(await read(gateway, 'booking-1002')).toMatchObject({
      chargeRecordPresent: true,
      reservationStatus: 'cancelled',
      payment: { chargedAmount: '750.00', chargedBy: 'Operador de Teste' },
    });
    expect(await read(gateway, 'booking-1003')).toMatchObject({
      structureRecognized: false,
      prePaymentPresent: null,
      reservationStatus: 'unknown',
    });
    await expect(read(gateway, 'booking-1004')).rejects.toBeInstanceOf(ScreenNotRecognizedError);
  });

  it('falha ao consultar um hotel quando o roteiro define o erro', async () => {
    const gateway = await authenticated(
      new FakeHunit({
        hotels: [{ code: 'H1', searchError: new HunitUnavailableError() }, { code: 'H2' }],
      }),
    );

    await expect(gateway.searchReservations('H1', week, 1)).rejects.toBeInstanceOf(
      HunitUnavailableError,
    );
    await expect(gateway.searchReservations('H2', week, 1)).resolves.toMatchObject({
      totalItems: 0,
    });
  });
});

describe('FakeHunit — intervenções do teste (T019)', () => {
  it('permite pausar ou derrubar uma chamada específica', async () => {
    const hunit = new FakeHunit({
      hotels: [{ code: 'H1', reservations: [{ reservationNumber: '1001' }] }, { code: 'H2' }],
    });
    hunit.before('searchReservations', (call) => {
      if (call.hotelCode === 'H2') throw new HunitUnavailableError('falha injetada');
    });
    const gateway = await authenticated(hunit);

    await expect(gateway.searchReservations('H1', week, 1)).resolves.toMatchObject({
      totalItems: 1,
    });
    await expect(gateway.searchReservations('H2', week, 1)).rejects.toThrow('falha injetada');
  });

  it('faz as chamadas em andamento falharem quando a sessão é fechada', async () => {
    const hunit = new FakeHunit({ hotels: [{ code: 'H1' }] });
    let started = false;
    hunit.before('listHotels', () => {
      started = true;
      return new Promise<void>(() => undefined); // nunca termina sozinha
    });
    const gateway = await authenticated(hunit);

    const pending = gateway.listHotels();
    await Promise.resolve();
    expect(started).toBe(true);

    await gateway.close();
    await gateway.close(); // fechar duas vezes não causa erro

    await expect(pending).rejects.toThrow('O navegador foi fechado.');
    await expect(gateway.listHotels()).rejects.toThrow('O navegador foi fechado.');
    expect(hunit.sessions[0]?.closed).toBe(true);
  });
});
