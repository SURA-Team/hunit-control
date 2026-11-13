/**
 * Tela Reservas (specs/002, T063, FR-020 a FR-021, FR-005): filtros combinados, busca livre,
 * valor no formato brasileiro, "carregar mais" mantendo os filtros, colunas da lista, nome
 * anonimizado e aviso de dados antigos com o servidor indisponível.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReservationsScreen } from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import type { Reservation, ReservationListInput } from '../../src/shared/ipc-types';
import {
  fakeHunit,
  mocked,
  okResult,
  ONLINE_OPERATOR,
  renderWithApp,
  type FakeHunit,
} from './render';

const EXECUTION = '11111111-1111-4111-8111-111111111111';

function reservation(number: string, overrides: Partial<Reservation> = {}): Reservation {
  return {
    hotelCode: '31',
    reservationNumber: number,
    guestName: 'João Silva',
    channel: 'Booking.com',
    checkIn: '2026-11-03',
    checkOut: '2026-11-05',
    totalAmount: '1234.50',
    reservationStatus: 'active',
    classification: 'virtual_card_pending_charge',
    reason: 'pré-pagamento sem cobrança',
    firstVerifiedAt: '2026-11-12T12:00:00.000Z',
    lastVerifiedAt: '2026-11-12T12:00:00.000Z',
    verificationCount: 1,
    ...overrides,
  };
}

let hunit: FakeHunit;

beforeEach(() => {
  hunit = fakeHunit();
  mocked(hunit.api.hotels.list).mockImplementation(() =>
    okResult([
      { code: '31', name: 'Hotel Praia', available: true, lastSeenAt: '' },
      { code: '32', name: 'Pousada Serra', available: true, lastSeenAt: '' },
    ]),
  );
  mocked(hunit.api.reservations.channels).mockImplementation(() =>
    okResult(['Booking.com', 'Expedia']),
  );
  mocked(hunit.api.reservations.list).mockImplementation(() =>
    okResult({ items: [reservation('7001')], nextCursor: null }),
  );
});

function lastQuery(): ReservationListInput {
  const calls = mocked(hunit.api.reservations.list).mock.calls;
  return calls.at(-1)?.[0] ?? {};
}

async function search() {
  await userEvent.click(screen.getByRole('button', { name: /^buscar$/i }));
}

describe('lista (FR-021)', () => {
  it('mostra hotel, número, hóspede, canal, check-in, check-out, valor e as duas situações', async () => {
    renderWithApp(<ReservationsScreen />, hunit);

    const row = (await screen.findAllByRole('row'))[1];
    if (!row) throw new Error('sem linhas');
    for (const text of [
      'Hotel Praia',
      '7001',
      'João Silva',
      'Booking.com',
      '03/11/2026',
      '05/11/2026',
      'Pendente de cobrança',
      'Ativa',
    ]) {
      expect(row).toHaveTextContent(text);
    }
    expect(row.textContent?.replace(/\u00a0/g, ' ')).toContain('R$ 1.234,50');
  });

  it('reserva anonimizada mostra "nome anonimizado" em vez de vazio', async () => {
    mocked(hunit.api.reservations.list).mockImplementation(() =>
      okResult({
        items: [reservation('7002', { guestName: null, anonymized: true })],
        nextCursor: null,
      }),
    );
    renderWithApp(<ReservationsScreen />, hunit);

    expect(await screen.findByText(/nome anonimizado/i)).toBeInTheDocument();
  });

  it('"carregar mais" pede a próxima página com os mesmos filtros', async () => {
    mocked(hunit.api.reservations.list).mockImplementation((input: ReservationListInput) =>
      okResult(
        input.cursor === 'c1'
          ? { items: [reservation('7003')], nextCursor: null }
          : { items: [reservation('7001')], nextCursor: 'c1' },
      ),
    );
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await screen.findByText('7001');
    await user.type(screen.getByLabelText(/busca livre/i), 'joao');
    await search();

    await user.click(await screen.findByRole('button', { name: /carregar mais/i }));

    await waitFor(() => expect(lastQuery()).toMatchObject({ q: 'joao', cursor: 'c1' }));
    expect(await screen.findByText('7003')).toBeInTheDocument();
  });
});

describe('detalhe (FR-022)', () => {
  it('abrir uma reserva busca o detalhe atualizado no servidor', async () => {
    mocked(hunit.api.reservations.get).mockImplementation(() =>
      okResult(reservation('7001', { reason: 'motivo atualizado no servidor' })),
    );
    renderWithApp(<ReservationsScreen />, hunit);

    await userEvent.click(await screen.findByText('7001'));

    expect(await screen.findByText('motivo atualizado no servidor')).toBeInTheDocument();
    expect(hunit.api.reservations.get).toHaveBeenCalledWith({
      hotelCode: '31',
      reservationNumber: '7001',
    });
  });
});

describe('filtros (FR-020 a FR-020b)', () => {
  it('a busca livre vai sem espaços nas pontas e só com 2 ou mais caracteres', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    const field = await screen.findByLabelText(/busca livre/i);

    await user.type(field, ' a ');
    await search();
    expect(await screen.findByText(/ao menos 2 caracteres/i)).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '  aut-0042  ');
    await search();
    await waitFor(() => expect(lastQuery()).toMatchObject({ q: 'aut-0042' }));
  });

  it('o valor "1.234,56" vai como "1234.56"; texto inválido mostra erro', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    const field = await screen.findByLabelText(/valor/i);

    await user.type(field, 'doze reais');
    await search();
    expect(await screen.findByText(/valor inválido/i)).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '1.234,56');
    await search();
    await waitFor(() => expect(lastQuery()).toMatchObject({ amount: '1234.56' }));
  });

  it('combina hotel, situação de cobrança, situação da reserva, canal e "não encontrada"', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await screen.findByText('7001');

    await user.click(screen.getByPlaceholderText(/todos os hotéis/i));
    await user.click(await screen.findByRole('option', { name: /Pousada Serra/ }));
    await user.click(screen.getByPlaceholderText(/todas as situações de cobrança/i));
    await user.click(await screen.findByRole('option', { name: 'Pendente de cobrança' }));
    await user.click(screen.getByPlaceholderText(/ativas e canceladas/i));
    await user.click(await screen.findByRole('option', { name: 'Cancelada' }));
    await user.click(screen.getByPlaceholderText(/todos os canais/i));
    await user.click(await screen.findByRole('option', { name: 'Expedia' }));
    await user.click(screen.getByLabelText(/não encontradas na última verificação/i));
    await search();

    await waitFor(() =>
      expect(lastQuery()).toMatchObject({
        hotelCode: ['32'],
        classification: ['virtual_card_pending_charge'],
        reservationStatus: ['cancelled'],
        channel: 'Expedia',
        notFound: true,
      }),
    );
  });

  it('período de check-in em DD/MM/AAAA vai no formato da API', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/check-in de/i), '01/11/2026');
    await user.type(screen.getByLabelText(/check-in até/i), '07/11/2026');
    await user.click(document.body);
    await search();

    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ checkInFrom: '2026-11-01', checkInTo: '2026-11-07' }),
    );
  });

  it('o filtro de execução vem da tela de execuções e pode ser tirado', async () => {
    renderWithApp(<ReservationsScreen initialExecutionId={EXECUTION} />, hunit);

    await waitFor(() => expect(lastQuery()).toMatchObject({ executionId: EXECUTION }));
    await userEvent.click(screen.getByRole('button', { name: /tirar o filtro da execução/i }));
    await search();
    await waitFor(() => expect(lastQuery().executionId).toBeUndefined());
  });
});

describe('servidor indisponível (FR-005)', () => {
  it('mantém a lista com o horário dos dados', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    await screen.findByText('7001');

    act(() => hunit.emit.connectionState({ ...ONLINE_OPERATOR, status: 'offline', client: null }));

    expect(
      await screen.findByText(/dados de \d{2}:\d{2} — servidor indisponível/),
    ).toBeInTheDocument();
    expect(
      within(screen.getAllByRole('row')[1] as HTMLElement).getByText('7001'),
    ).toBeInTheDocument();
  });
});
