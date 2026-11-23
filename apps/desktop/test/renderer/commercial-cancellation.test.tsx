/**
 * A "Cancelada" do Comercial (homologação da 008, R-19; spec FR-007c, US2-7): o bloco "Cancelada
 * pelo Comercial" no detalhe da reserva (situação, responsável, valor que vira R$ 0,00, validação,
 * "Confirmar cancelamento" e "Recusar"), o perfil consulta sem ações, e a confirmação em lote a
 * partir da seleção de reservas, que reconhece a "Cancelada" pela lista do estado da planilha.
 * Dados fictícios.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommercialSection } from '../../src/renderer/src/screens/reservations/CommercialSection';
import { ConfirmBatchDialog } from '../../src/renderer/src/screens/reservations/ConfirmBatchDialog';
import { toSelected } from '../../src/renderer/src/state/selection';
import type { CommercialDetail } from '../../src/shared/ipc-types';
import { detail, sheetStatus } from './commercial-fixtures';
import { expectOnePrimaryPerBlock } from './hierarchy';
import {
  fakeHunit,
  mocked,
  okResult,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';
import { pendingReservation } from './treatment-fixtures';

const KEY = { hotelCode: '31', reservationNumber: '7020' };
const reservation = pendingReservation('7020', { totalAmount: '655.00', amountToCharge: '655.00' });

type Validation = NonNullable<NonNullable<CommercialDetail['report']>['validation']>;

function withCancellation(target: FakeHunit, validation: Partial<Validation> = {}) {
  mocked(target.api.commercial.get).mockImplementation(() =>
    okResult(
      detail({
        returns: [],
        report: {
          kind: 'cancelled',
          situationText: 'Cancelada na Expedia',
          chargedBy: null,
          chargeDate: null,
          readAt: '2026-11-18T12:00:00.000Z',
          hunitStatus: null,
          validation: {
            state: 'awaiting_validation',
            decidedAt: null,
            decidedBy: null,
            rejectionReason: null,
            ...validation,
          },
        },
      }),
    ),
  );
}

let hunit: FakeHunit;

beforeEach(() => {
  hunit = fakeHunit();
});

describe('bloco "Cancelada pelo Comercial" no detalhe', () => {
  it('mostra a situação, o valor que vira R$ 0,00 e as ações, com uma principal', async () => {
    withCancellation(hunit);
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    const block = await screen.findByTestId('commercial-cancellation');
    expect(within(block).getByText('Cancelada')).toBeInTheDocument();
    expect(within(block).getByText('Aguardando validação')).toBeInTheDocument();
    expect(within(block).getByText('Cancelada na Expedia')).toBeInTheDocument();
    expect(within(block).getByText('vira R$ 0,00 ao confirmar')).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Confirmar cancelamento' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    expectOnePrimaryPerBlock();
  });

  it('"Confirmar cancelamento" e "Recusar" chamam a ponte', async () => {
    withCancellation(hunit);
    mocked(hunit.api.commercial.confirmCancellation).mockImplementation(() =>
      okResult(reservation),
    );
    mocked(hunit.api.commercial.rejectCancellation).mockImplementation(() => okResult(reservation));
    const user = userEvent.setup();
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    const block = await screen.findByTestId('commercial-cancellation');

    await user.click(within(block).getByRole('button', { name: 'Confirmar cancelamento' }));
    expect(hunit.api.commercial.confirmCancellation).toHaveBeenCalledWith(KEY);
    expect(
      await screen.findByText('Cancelamento confirmado: a reserva ficou "Cancelada sem cobrança".'),
    ).toBeInTheDocument();

    await user.click(within(block).getByRole('button', { name: 'Recusar' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Recusar a "Cancelada" do Comercial',
    });
    await user.type(within(dialog).getByLabelText('Motivo da recusa'), 'Hóspede fez check-in');
    await user.click(within(dialog).getByRole('button', { name: 'Recusar' }));
    expect(hunit.api.commercial.rejectCancellation).toHaveBeenCalledWith({
      key: KEY,
      reason: 'Hóspede fez check-in',
    });
  });

  it('recusada: mostra quem recusou e o motivo, sem ações', async () => {
    withCancellation(hunit, {
      state: 'rejected',
      decidedAt: '2026-11-19T10:00:00.000Z',
      decidedBy: 'desktop-financeiro',
      rejectionReason: 'Hóspede fez check-in',
    });
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    const block = await screen.findByTestId('commercial-cancellation');
    expect(within(block).getByText('Recusada')).toBeInTheDocument();
    expect(block).toHaveTextContent('por desktop-financeiro: Hóspede fez check-in');
    expect(within(block).queryByRole('button')).not.toBeInTheDocument();
  });

  it('o perfil consulta vê o bloco sem ações', async () => {
    hunit = fakeHunit(ONLINE_READER);
    withCancellation(hunit);
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    const block = await screen.findByTestId('commercial-cancellation');
    await waitFor(() => expect(hunit.api.connection.getState).toHaveBeenCalled());
    expect(within(block).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('confirmação em lote a partir da seleção (tela 7.12, US2-7)', () => {
  it('reconhece a "Cancelada" pela lista da planilha e manda includeCancellations', async () => {
    mocked(hunit.api.commercial.sheetStatus).mockImplementation(() =>
      okResult(
        sheetStatus({
          reports: [
            {
              ...KEY,
              situationText: 'Cancelada',
              chargedBy: null,
              chargeDate: null,
              readAt: '2026-11-18T12:00:00.000Z',
              totalAmount: '655.00',
            },
          ],
        }),
      ),
    );
    mocked(hunit.api.commercial.confirmReturns).mockImplementation(() =>
      okResult({
        batchId: '66666666-6666-4666-8666-666666666666',
        items: [{ ...KEY, outcome: 'confirmed', reason: null }],
        countsByClassification: {},
      }),
    );
    const user = userEvent.setup();
    renderWithApp(
      <ConfirmBatchDialog
        kind="returns"
        items={[toSelected(reservation), toSelected(pendingReservation('7021'))]}
        hotelNames={new Map([['31', 'Hotel Praia']])}
        onClose={() => undefined}
      />,
      hunit,
    );

    const summary = await screen.findByTestId('batch-summary');
    await waitFor(() =>
      expect(summary).toHaveTextContent('1 reserva "Cancelada" pelo Comercial — 1 fica de fora'),
    );
    expect(summary).not.toHaveTextContent('retornos aguardando');
    await user.click(screen.getByRole('button', { name: 'Confirmar 1' }));
    expect(hunit.api.commercial.confirmReturns).toHaveBeenCalledWith({
      reservations: [KEY, { hotelCode: '31', reservationNumber: '7021' }],
      includeCancellations: true,
    });
  });
});
