/**
 * Reservas no app com o envio ao Comercial (specs/005, T051, T053, T056): a coluna "Valor
 * cobrado" com a origem (FR-024), "Selecionar todas do filtro" (FR-030), "Confirmar 'Verificar'"
 * em lote (FR-029) e "Copiar para e-mail" (FR-027, FR-028). Dados fictícios. Desde a 006 (T036):
 * o valor cobrado na segunda linha da coluna Valor, os filtros rápidos e o menu "Confirmar ▾".
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReservationsScreen } from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import type { CopyReservationsInput } from '../../src/shared/ipc-types';
import { selectionItem } from './commercial-fixtures';
import {
  fakeHunit,
  mocked,
  okResult,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';
import { chooseFromMenu, findRow, quickFilterChip } from './reservations-helpers';
import { pendingReservation, treatment } from './treatment-fixtures';

let hunit: FakeHunit;
const GUEST_MARKER = 'HOSPEDE-MARCADOR-FICTICIO';

function serve(items = [pendingReservation('7001'), pendingReservation('7002')]) {
  mocked(hunit.api.reservations.list).mockImplementation(() =>
    okResult({ items, nextCursor: null }),
  );
}

beforeEach(() => {
  hunit = fakeHunit();
  mocked(hunit.api.hotels.list).mockImplementation(() =>
    okResult([{ code: '31', name: 'Hotel Praia', available: true, lastSeenAt: '' }]),
  );
  serve();
});

describe('valor cobrado na coluna Valor (FR-024; specs/006, FR-014)', () => {
  it('mostra o valor com a origem e fica vazio sem valor', async () => {
    serve([
      pendingReservation('7001', {
        treatment: treatment({
          status: 'charged',
          effectiveChargedAmount: '90.00',
          chargedAmountOrigin: 'commercial',
        }),
      }),
      pendingReservation('7002'),
    ]);
    renderWithApp(<ReservationsScreen />, hunit);
    const row = await findRow('7001');
    expect(row.textContent?.replace(/\u00a0/g, ' ')).toContain('cobrado R$ 90,00 · Comercial');
    expect(await findRow('7002')).not.toHaveTextContent('cobrado');
    expect(screen.queryByRole('columnheader', { name: 'Valor cobrado' })).not.toBeInTheDocument();
  });
});

describe('"Selecionar todas do filtro" (FR-030)', () => {
  it('soma à seleção as 2 000 primeiras, avisa as que ficaram de fora e não conta duas vezes', async () => {
    const items = Array.from({ length: 2000 }, (_unused, index) =>
      selectionItem(String(7001 + index)),
    );
    mocked(hunit.api.reservations.selectAll).mockImplementation(() =>
      okResult({ total: 5000, truncated: true, items }),
    );
    const user = userEvent.setup();
    renderWithApp(<ReservationsScreen />, hunit);
    // A 7001 já estava marcada: não conta de novo.
    await user.click(await screen.findByRole('checkbox', { name: 'Selecionar a reserva 7001' }));
    await user.click(screen.getByRole('button', { name: 'Selecionar todas do filtro' }));

    expect(await screen.findByText(/1.999 reservas selecionadas do filtro/)).toBeInTheDocument();
    expect(screen.getByText(/o filtro tem 5.000/)).toHaveTextContent('3.000 ficaram de fora');
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('2000 reservas selecionadas');
    expect(hunit.api.reservations.selectAll).toHaveBeenCalledWith({ order: 'hotel_check_in' });
  });

  it('o perfil consulta não seleciona', async () => {
    hunit = fakeHunit(ONLINE_READER);
    serve();
    renderWithApp(<ReservationsScreen />, hunit);
    await findRow('7001');
    expect(
      screen.queryByRole('button', { name: 'Selecionar todas do filtro' }),
    ).not.toBeInTheDocument();
  });
});

describe('"Confirmar \'Verificar\'" em lote (FR-029)', () => {
  it('mostra quantas têm o alerta, quantas ficam de fora e a contagem por status do Hunit', async () => {
    serve([
      pendingReservation('7001', {
        classification: 'virtual_card_already_charged',
        treatment: treatment({
          status: 'sent',
          situation: 'virtual_card_already_charged',
          needsReview: true,
        }),
      }),
      pendingReservation('7002'),
    ]);
    mocked(hunit.api.treatments.confirmReviews).mockImplementation(() =>
      okResult({
        batchId: 'b',
        items: [
          { hotelCode: '31', reservationNumber: '7001', outcome: 'confirmed', reason: null },
          {
            hotelCode: '31',
            reservationNumber: '7002',
            outcome: 'ignored',
            reason: 'no_review_alert',
          },
        ],
        countsByClassification: { virtual_card_already_charged: 1 },
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<ReservationsScreen />, hunit);
    await user.click(
      await screen.findByRole('checkbox', { name: 'Selecionar todas as reservas listadas' }),
    );
    await chooseFromMenu(user, 'Confirmar', 'Confirmar "Verificar"');

    expect(await screen.findByTestId('batch-summary')).toHaveTextContent(
      '1 reserva com o alerta "Verificar" — 1 fica de fora (sem o alerta).',
    );
    const counts = screen.getByRole('table', { name: 'Contagem por status do Hunit' });
    expect(within(counts).getByText('Já cobrada')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmar 1' }));
    expect(hunit.api.treatments.confirmReviews).toHaveBeenCalledWith({
      reservations: [
        { hotelCode: '31', reservationNumber: '7001' },
        { hotelCode: '31', reservationNumber: '7002' },
      ],
    });
    expect(await screen.findByTestId('batch-result')).toHaveTextContent('1 reserva confirmada');
    // Nenhuma falhou: a seleção fica vazia depois do lote.
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument());
  });
});

describe('"Copiar para e-mail" (FR-027, FR-028)', () => {
  it('com seleção, pergunta o que copiar; a seleção vai sem o nome do hóspede', async () => {
    serve([pendingReservation('7001', { guestName: GUEST_MARKER }), pendingReservation('7002')]);
    mocked(hunit.api.clipboard.copyReservations).mockImplementation(() =>
      okResult({ copied: 1, total: 1, truncated: false }),
    );
    const user = userEvent.setup();
    renderWithApp(<ReservationsScreen />, hunit);
    await user.click(await screen.findByRole('checkbox', { name: 'Selecionar a reserva 7001' }));
    await user.click(screen.getByRole('button', { name: 'Copiar para e-mail' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('As reservas selecionadas (1)')).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Copiar' }));

    const input = mocked(hunit.api.clipboard.copyReservations).mock
      .calls[0]?.[0] as CopyReservationsInput;
    expect(input).toEqual({
      source: 'selection',
      rows: [
        {
          hotelName: 'Hotel Praia',
          reservationNumber: '7001',
          checkIn: '2026-11-03',
          channel: 'Booking.com',
          totalAmount: '100.00',
          classification: 'virtual_card_pending_charge',
          reservationStatus: 'active',
          detailedSituation: 'virtual_card_pending_charge',
        },
      ],
    });
    expect(JSON.stringify(input)).not.toContain(GUEST_MARKER);
    expect(await within(dialog).findByTestId('copy-result')).toHaveTextContent(
      '1 reserva copiada.',
    );
  });

  it('o perfil consulta copia o resultado da pesquisa, com os filtros na descrição', async () => {
    hunit = fakeHunit(ONLINE_READER);
    serve();
    mocked(hunit.api.clipboard.copyReservations).mockImplementation(() =>
      okResult({ copied: 2000, total: 2600, truncated: true }),
    );
    const user = userEvent.setup();
    renderWithApp(<ReservationsScreen />, hunit);
    await findRow('7001');
    await user.click(quickFilterChip('Falta cobrar'));
    await user.click(screen.getByRole('button', { name: 'Copiar para e-mail' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Copiar' }));

    expect(hunit.api.clipboard.copyReservations).toHaveBeenCalledWith({
      source: 'filter',
      // A cópia segue o filtro rápido e a ordem da lista (specs/006, FR-014, FR-016).
      filters: { quickFilter: 'pending_charge', order: 'hotel_check_in' },
      description: 'Filtros: Falta cobrar',
    });
    expect(await within(dialog).findByTestId('copy-result')).toHaveTextContent(
      'A pesquisa tem 2.600 reservas; foram copiadas as 2.000 primeiras.',
    );
  });

  it('sem resultado, a cópia fica indisponível', async () => {
    serve([]);
    renderWithApp(<ReservationsScreen />, hunit);
    await screen.findByText('Nenhuma reserva encontrada');
    expect(screen.getByRole('button', { name: 'Copiar para e-mail' })).toBeDisabled();
  });
});
