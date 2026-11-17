/**
 * Área "Comercial" do app (specs/005, US3, T050; FR-013, FR-018, FR-020, FR-021): as abas
 * "Envios", "Retornos a validar", "Retornos com problema" e "Planilha", com as ações só para o
 * perfil operador. Dados fictícios.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommercialScreen } from '../../src/renderer/src/screens/commercial/CommercialScreen';
import { dispatchFixture } from '../helpers/commercial-fixtures';
import { RETURN_ID, returnBrief, sheetStatus } from './commercial-fixtures';
import {
  fakeHunit,
  mocked,
  okResult,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';
import { NO_TREATMENT, pendingReservation, treatment } from './treatment-fixtures';

let hunit: FakeHunit;

function program(target: FakeHunit) {
  mocked(target.api.hotels.list).mockImplementation(() =>
    okResult([{ code: '31', name: 'Hotel Praia', available: true, lastSeenAt: '' }]),
  );
  mocked(target.api.dispatches.list).mockImplementation(() =>
    okResult({
      items: [
        {
          ...dispatchFixture({ status: 'completed' }),
          counts: { total: 10, pending: 0, sent: 7, withdrawn: 2, notVerified: 1, ignored: 0 },
        },
      ],
      nextCursor: null,
    }),
  );
  mocked(target.api.dispatches.get).mockImplementation(() =>
    okResult(dispatchFixture({ status: 'completed' })),
  );
  mocked(target.api.commercial.sheetStatus).mockImplementation(() =>
    okResult(
      sheetStatus({
        status: 'failing',
        lastError: {
          code: 'sheet_unavailable',
          message: 'Planilha indisponível.',
          at: '2026-11-17T12:00:00.000Z',
        },
        nextAttemptAt: '2026-11-17T12:05:00.000Z',
        pending: { count: 3, oldestChangeAt: '2026-11-17T11:00:00.000Z' },
        problems: [
          {
            hotelCode: '31',
            reservationNumber: '7009',
            kind: 'incomplete',
            message: 'Retorno incompleto: falta o valor cobrado',
            at: '2026-11-17T12:00:00.000Z',
          },
        ],
      }),
    ),
  );
  mocked(target.api.commercial.readNow).mockImplementation(() =>
    okResult({
      sheet: sheetStatus(),
      round: { returnsReceived: 2, returnsChanged: 1, problems: 0, linesWritten: 4 },
    }),
  );
  mocked(target.api.reservations.list).mockImplementation(() =>
    okResult({
      items: [
        pendingReservation('7001', {
          treatment: treatment({ status: 'sent', detailedSituation: 'return_pending' }),
          commercial: {
            lineState: 'open',
            inSheet: true,
            lastSentAt: '2026-11-14T12:00:00.000Z',
            lastDispatchId: '44444444-4444-4444-8444-444444444444',
            returnState: 'awaiting_validation',
            currentReturn: returnBrief(),
            returnProblem: null,
            syncPending: false,
          },
        }),
      ],
      nextCursor: null,
    }),
  );
  mocked(target.api.commercial.confirmReturn).mockImplementation(() => okResult(NO_TREATMENT));
}

beforeEach(() => {
  hunit = fakeHunit();
  program(hunit);
});

describe('aba "Envios" (FR-020)', () => {
  it('lista os envios com as contagens e abre o resultado de cada um', async () => {
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    const table = await screen.findByRole('table', { name: 'Envios ao Comercial' });
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    expect(row).toHaveTextContent('desktop-financeiro');
    expect(row).toHaveTextContent('Concluído');
    await user.click(row);
    expect(await screen.findByTestId('dispatch-view')).toBeInTheDocument();
  });
});

describe('aba "Retornos a validar" (FR-016, FR-016a, FR-017)', () => {
  it('lista as reservas com retorno aguardando validação e confirma uma a uma', async () => {
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    await user.click(screen.getByRole('tab', { name: 'Retornos a validar' }));
    const table = await screen.findByRole('table', { name: 'Retornos a validar' });
    expect(within(table).getByText('AUT987')).toBeInTheDocument();
    expect(within(table).getByText('Diferente do hotel da reserva')).toBeInTheDocument();
    expect(hunit.api.reservations.list).toHaveBeenCalledWith(
      expect.objectContaining({ detailedSituation: ['return_pending'] }),
    );

    await user.click(await within(table).findByRole('button', { name: 'Confirmar' }));
    expect(hunit.api.commercial.confirmReturn).toHaveBeenCalledWith(RETURN_ID);
  });

  it('o perfil consulta vê os retornos sem ações', async () => {
    hunit = fakeHunit(ONLINE_READER);
    program(hunit);
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    await user.click(screen.getByRole('tab', { name: 'Retornos a validar' }));
    const table = await screen.findByRole('table', { name: 'Retornos a validar' });
    expect(within(table).getByText('AUT987')).toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: 'Recusar' })).not.toBeInTheDocument();
  });
});

describe('aba "Retornos com problema" (FR-018)', () => {
  it('mostra o que falta, sem dado do hóspede', async () => {
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    await user.click(screen.getByRole('tab', { name: 'Retornos com problema' }));
    const table = await screen.findByRole('table', { name: 'Retornos com problema' });
    expect(
      within(table).getByText('Retorno incompleto: falta o valor cobrado'),
    ).toBeInTheDocument();
    expect(within(table).getByText('7009')).toBeInTheDocument();
    expect(within(table).getByText('Hotel Praia')).toBeInTheDocument();
  });
});

describe('aba "Planilha" (FR-013)', () => {
  it('falha atual com mensagem genérica, pendências e desde quando; "Ler retornos agora"', async () => {
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    await user.click(screen.getByRole('tab', { name: 'Planilha' }));
    const panel = await screen.findByTestId('sheet-status');
    expect(within(panel).getByRole('alert')).toHaveTextContent('Planilha indisponível.');
    expect(within(panel).getByText('Com falha')).toBeInTheDocument();
    expect(within(panel).getByText(/desde/)).toBeInTheDocument();

    await user.click(await within(panel).findByRole('button', { name: 'Ler retornos agora' }));
    expect(
      await within(panel).findByText(
        'Leitura concluída: 2 retorno(s) novo(s), 1 alterado(s), 0 com problema e 4 linha(s) atualizada(s).',
      ),
    ).toBeInTheDocument();
  });

  it('o perfil consulta não pede leitura', async () => {
    hunit = fakeHunit(ONLINE_READER);
    program(hunit);
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    await user.click(screen.getByRole('tab', { name: 'Planilha' }));
    await screen.findByTestId('sheet-status');
    expect(screen.queryByRole('button', { name: 'Ler retornos agora' })).not.toBeInTheDocument();
  });

  it('sem planilha configurada no servidor', async () => {
    mocked(hunit.api.commercial.sheetStatus).mockImplementation(() =>
      okResult(sheetStatus({ configured: false, status: 'not_configured' })),
    );
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    await user.click(screen.getByRole('tab', { name: 'Planilha' }));
    expect(await screen.findByText('Planilha do Comercial não configurada')).toBeInTheDocument();
  });
});
