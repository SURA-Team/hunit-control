/**
 * Tela Reservas (specs/002, T063; desde a 006, T036, telas 4.1 e 4.3): a lista de cinco colunas na
 * ordem por hotel e check-in, "carregar mais" mantendo a busca e os filtros, o rodapé "Mostrando X de
 * Y", o detalhe pela linha, o estado vazio com "Limpar busca e filtros", o nome anonimizado e o aviso
 * de dados antigos com o servidor indisponível. Busca, painel e filtros rápidos têm arquivos próprios.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReservationsScreen } from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import type { ReservationListInput } from '../../src/shared/ipc-types';
import { expectOnePrimaryPerBlock } from './hierarchy';
import {
  fakeHunit,
  mocked,
  okResult,
  ONLINE_OPERATOR,
  renderWithApp,
  type FakeHunit,
} from './render';
import {
  findRow,
  lastListQuery,
  quickFilterChip,
  reservation,
  searchField,
  serveReservations,
  typeSearch,
} from './reservations-helpers';

let hunit: FakeHunit;

beforeEach(() => {
  hunit = fakeHunit();
  serveReservations(hunit);
});

describe('lista (FR-014, FR-018, FR-021; tela 4.1)', () => {
  it('cinco colunas: hóspede (número · canal), hotel, período (noites), valor e situação', async () => {
    renderWithApp(<ReservationsScreen />, hunit);

    const row = await findRow('7001');
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(['', 'Hóspede', 'Hotel', 'Período', 'Valor', 'Situação da reserva']);
    for (const text of [
      'João Silva',
      '7001 · Booking.com',
      'Hotel Praia',
      '03/11 → 05/11/2026',
      '2 noites',
      'Pendente de cobrança',
    ]) {
      expect(row).toHaveTextContent(text);
    }
    expect(row.textContent?.replace(/\u00a0/g, ' ')).toContain('R$ 1.234,50');
    // "Ativa/Cancelada" saiu da lista e ficou no detalhe (FR-014).
    expect(row).not.toHaveTextContent('Ativa');
  });

  it('pede a lista na ordem por hotel e check-in (FR-014, research R-18)', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    await findRow('7001');
    expect(lastListQuery(hunit)).toMatchObject({ order: 'hotel_check_in' });
  });

  it('valor cobrado na segunda linha da coluna Valor, com a origem (FR-014)', async () => {
    serveReservations(hunit, [
      reservation('7001', {
        treatment: {
          ...reservation('7001').treatment,
          effectiveChargedAmount: '1280.00',
          chargedAmountOrigin: 'hunit',
        },
      }),
    ]);
    renderWithApp(<ReservationsScreen />, hunit);

    const row = await findRow('7001');
    expect(row.textContent?.replace(/\u00a0/g, ' ')).toContain('cobrado R$ 1.280,00 · Hunit');
  });

  it('reserva anonimizada mostra "nome anonimizado" em vez de vazio', async () => {
    serveReservations(hunit, [reservation('7002', { guestName: null, anonymized: true })]);
    renderWithApp(<ReservationsScreen />, hunit);

    expect(await findRow('7002')).toHaveTextContent('nome anonimizado');
  });

  it('"carregar mais" pede a próxima página com a mesma busca e a mesma ordem', async () => {
    mocked(hunit.api.reservations.list).mockImplementation((input: ReservationListInput) =>
      okResult(
        input.cursor === 'c1'
          ? { items: [reservation('7003')], nextCursor: null }
          : { items: [reservation('7001')], nextCursor: 'c1' },
      ),
    );
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');
    await typeSearch(user, 'joao');
    await waitFor(() => expect(lastListQuery(hunit)).toMatchObject({ q: 'joao' }));

    await user.click(await screen.findByRole('button', { name: 'Carregar mais' }));

    await waitFor(() =>
      expect(lastListQuery(hunit)).toMatchObject({
        q: 'joao',
        order: 'hotel_check_in',
        cursor: 'c1',
      }),
    );
    expect(await findRow('7003')).toBeInTheDocument();
  });

  it('rodapé: "Mostrando X de Y reservas · ordenadas por hotel e check-in"', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    expect(
      await screen.findByText('Mostrando 1 de 12 reservas · ordenadas por hotel e check-in'),
    ).toBeInTheDocument();
  });

  it('uma ação principal por bloco (FR-007)', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    await findRow('7001');
    expectOnePrimaryPerBlock();
  });
});

describe('detalhe (FR-018, FR-022 da 002)', () => {
  it('clicar na linha busca o detalhe atualizado no servidor e destaca a linha', async () => {
    mocked(hunit.api.reservations.get).mockImplementation(() =>
      okResult(reservation('7001', { reason: 'motivo atualizado no servidor' })),
    );
    renderWithApp(<ReservationsScreen />, hunit);

    const row = await findRow('7001');
    await userEvent.click(row);

    expect(await screen.findByText('motivo atualizado no servidor')).toBeInTheDocument();
    expect(hunit.api.reservations.get).toHaveBeenCalledWith({
      hotelCode: '31',
      reservationNumber: '7001',
    });
    expect(row).toHaveAttribute('data-opened');
    await userEvent.click(screen.getByRole('button', { name: 'Fechar detalhe' }));
    await waitFor(() => expect(row).not.toHaveAttribute('data-opened'));
  });

  it('a seta é um botão com o número da reserva', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir a reserva 7001' }));
    expect(hunit.api.reservations.get).toHaveBeenCalled();
  });
});

describe('estado vazio (FR-021; tela 4.3)', () => {
  beforeEach(() => {
    mocked(hunit.api.reservations.list).mockImplementation((input: ReservationListInput) =>
      okResult({ items: input.q ? [] : [reservation('7001')], nextCursor: null }),
    );
    mocked(hunit.api.reservations.quickFilterCounts).mockImplementation((filters) =>
      okResult(
        filters.q
          ? { all: 0, pendingCharge: 0, toReview: 0, withError: 0, done: 0 }
          : { all: 1, pendingCharge: 1, toReview: 0, withError: 0, done: 0 },
      ),
    );
  });

  it('com a busca: explica, deixa só "Todas" e "Limpar busca e filtros" volta ao início', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    const user = userEvent.setup();
    await findRow('7001');

    await typeSearch(user, 'Maria Oliveira');

    expect(await screen.findByText('Nenhuma reserva encontrada')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Não há reservas para “Maria Oliveira” com os filtros atuais. Confira o nome ou limpe os filtros.',
      ),
    ).toBeInTheDocument();
    const chips = within(screen.getByRole('group', { name: 'Filtros rápidos' })).getAllByRole(
      'button',
    );
    expect(chips).toHaveLength(1);
    expect(quickFilterChip('Todas')).toHaveTextContent('0');

    await user.click(screen.getByRole('button', { name: 'Limpar busca e filtros' }));

    expect(searchField()).toHaveValue('');
    expect(await findRow('7001')).toBeInTheDocument();
    expect(lastListQuery(hunit)).not.toHaveProperty('q');
  });

  it('sem busca nem filtro, não oferece limpar', async () => {
    serveReservations(hunit, []);
    renderWithApp(<ReservationsScreen />, hunit);

    expect(await screen.findByText('Nenhuma reserva encontrada')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Limpar busca e filtros' }),
    ).not.toBeInTheDocument();
  });
});

describe('servidor indisponível (FR-005 da 002)', () => {
  it('mantém a lista com o horário dos dados', async () => {
    renderWithApp(<ReservationsScreen />, hunit);
    await findRow('7001');

    act(() => hunit.emit.connectionState({ ...ONLINE_OPERATOR, status: 'offline', client: null }));

    expect(
      await screen.findByText(/dados de \d{2}:\d{2} — servidor indisponível/),
    ).toBeInTheDocument();
    expect(await findRow('7001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar para e-mail' })).toBeDisabled();
  });
});

describe('vindo do módulo de Relatórios (specs/007, T018, research R-07)', () => {
  const preset = {
    hotelCodes: ['31'],
    checkInFrom: '2026-11-01',
    checkInTo: '2026-11-30',
    quickFilter: 'pending_charge' as const,
    expectedCount: 2,
  };

  function counts(pendingCharge: number) {
    mocked(hunit.api.reservations.quickFilterCounts).mockImplementation(() =>
      okResult({ all: 10, pendingCharge, toReview: 0, withError: 0, done: 0 }),
    );
  }

  it('abre com o hotel, o período e "Falta cobrar"', async () => {
    counts(2);
    renderWithApp(<ReservationsScreen preset={preset} />, hunit);
    await waitFor(() =>
      expect(lastListQuery(hunit)).toMatchObject({
        hotelCode: ['31'],
        checkInFrom: '2026-11-01',
        checkInTo: '2026-11-30',
        quickFilter: 'pending_charge',
      }),
    );
    await screen.findByText('Check-in de 01/11/2026 a 30/11/2026');
    expect(screen.queryByText(/relatório podem estar desatualizados/)).not.toBeInTheDocument();
  });

  it('outra quantidade em aberto: avisa que o relatório pode estar desatualizado', async () => {
    counts(3);
    renderWithApp(<ReservationsScreen preset={preset} />, hunit);
    expect(
      await screen.findByText(/Os números do relatório podem estar desatualizados/),
    ).toBeInTheDocument();
  });
  it('com os filtros do relatório (FR-005a): o painel e a Origem já aplicados', async () => {
    counts(2);
    renderWithApp(
      <ReservationsScreen
        preset={{
          ...preset,
          filters: {
            situations: ['treatment_sent'],
            status: 'active',
            channel: 'Expedia',
            notFound: false,
          },
          origin: 'legacy',
        }}
      />,
      hunit,
    );
    await waitFor(() =>
      expect(lastListQuery(hunit)).toMatchObject({
        hotelCode: ['31'],
        detailedSituation: ['treatment_sent'],
        reservationStatus: ['active'],
        channel: 'Expedia',
        fromLegacy: true,
        quickFilter: 'pending_charge',
      }),
    );
    await screen.findByText('Canal: Expedia');
    // Mesmos filtros do relatório e mesma quantidade: sem aviso.
    expect(screen.queryByText(/relatório podem estar desatualizados/)).not.toBeInTheDocument();
  });
});
