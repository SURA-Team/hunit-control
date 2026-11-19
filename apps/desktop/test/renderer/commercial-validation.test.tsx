/**
 * Validação do retorno do Comercial no app (specs/005, US2, T045; FR-016, FR-016a, FR-017, FR-020,
 * FR-023): a seção "Comercial" do detalhe mostra a linha e o retorno — com o hotel da cobrança ao
 * lado do hotel da reserva, destacado quando diferem —, confirma, recusa com motivo e desfaz; a
 * confirmação em lote mostra antes a lista de revisão; e o histórico do Comercial entra no da
 * tratativa, por data. Dados fictícios. Desde a 006 (T051; telas 7.5 e 7.6): o card "Comercial"
 * com as variantes do design e a recusa num diálogo estreito com os motivos em pílulas.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectOnePrimaryPerBlock } from './hierarchy';
import { CommercialSection } from '../../src/renderer/src/screens/reservations/CommercialSection';
import { ConfirmBatchDialog } from '../../src/renderer/src/screens/reservations/ConfirmBatchDialog';
import { TreatmentSection } from '../../src/renderer/src/screens/reservations/TreatmentSection';
import { toSelected } from '../../src/renderer/src/state/selection';
import {
  commercialEvent,
  commercialReturn,
  detail,
  line,
  RETURN_ID,
  returnBrief,
} from './commercial-fixtures';
import {
  fakeHunit,
  mocked,
  okResult,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';
import { NO_TREATMENT, pendingReservation } from './treatment-fixtures';

let hunit: FakeHunit;
const reservation = pendingReservation('7001');

beforeEach(() => {
  hunit = fakeHunit();
  mocked(hunit.api.hotels.list).mockImplementation(() =>
    okResult([{ code: '31', name: 'Hotel Praia', available: true, lastSeenAt: '' }]),
  );
  mocked(hunit.api.commercial.get).mockImplementation(() => okResult(detail()));
  mocked(hunit.api.commercial.confirmReturn).mockImplementation(() => okResult(NO_TREATMENT));
  mocked(hunit.api.commercial.rejectReturn).mockImplementation(() => okResult(NO_TREATMENT));
  mocked(hunit.api.commercial.undoConfirmation).mockImplementation(() => okResult(NO_TREATMENT));
  mocked(hunit.api.commercial.cancelLine).mockImplementation(() =>
    okResult(line({ state: 'cancelled' })),
  );
});

describe('visual novo do card "Comercial" e da recusa (specs/006, T051; telas 7.5 e 7.6)', () => {
  it('"Confirmar" principal; "Recusar" e "Desfazer envio" em vermelho suave; um bloco por card', async () => {
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    const section = await screen.findByTestId('commercial-section');
    const found = await screen.findByTestId('commercial-return');

    expect(within(found).getByRole('button', { name: 'Confirmar' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    expect(within(found).getByRole('button', { name: 'Recusar' })).toHaveAttribute(
      'data-variant',
      'danger-light',
    );
    expect(within(section).getByRole('button', { name: 'Desfazer envio' })).toHaveAttribute(
      'data-variant',
      'danger-light',
    );
    expect(within(found).getByText('Aguardando validação')).toHaveAttribute('data-tone', 'amber');
    // O que destoa em âmbar: o selo do hotel diferente e a diferença de valor (FR-038).
    expect(within(found).getByText('Diferente do hotel da reserva')).toHaveAttribute(
      'data-tone',
      'amber',
    );
    expect(within(found).getByText(/-R\$\s*10,00/)).toHaveStyle({ fontWeight: '700' });
    expectOnePrimaryPerBlock();
  });

  it('a recusa: diálogo estreito, motivos em pílulas, contador e "Recusar retorno" em vermelho', async () => {
    const user = userEvent.setup();
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    await user.click(await screen.findByRole('button', { name: 'Recusar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recusar o retorno do Comercial' });

    expect(dialog).toHaveAttribute('data-size', 'sm');
    const suggestions = within(dialog).getByRole('group', { name: 'Motivos mais comuns' });
    const chip = within(suggestions).getByRole('button', { name: 'Valor diferente' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(within(dialog).getByText('0/500')).toBeInTheDocument();

    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByLabelText('Motivo da recusa')).toHaveValue('Valor diferente');
    expect(within(dialog).getByText('15/500')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Voltar' })).toHaveAttribute(
      'data-variant',
      'text',
    );
    expect(within(dialog).getByRole('button', { name: 'Recusar retorno' })).toHaveAttribute(
      'data-variant',
      'danger',
    );
  });
});

describe('seção "Comercial" do detalhe (FR-023)', () => {
  it('mostra a aba, o último envio e o retorno com o hotel da cobrança destacado', async () => {
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    const section = await screen.findByTestId('commercial-section');
    expect(within(section).getByText('A cobrar', { selector: 'dd' })).toBeInTheDocument();
    expect(within(section).getByText(/por desktop-financeiro/)).toBeInTheDocument();

    const found = await screen.findByTestId('commercial-return');
    expect(within(found).getByText('AUT987')).toBeInTheDocument();
    expect(within(found).getByText('Maquininha Centro')).toBeInTheDocument();
    expect(await within(found).findByText('Hotel da reserva: Hotel Praia')).toBeInTheDocument();
    expect(within(found).getByText('Diferente do hotel da reserva')).toBeInTheDocument();
    expect(within(found).getByText(/R\$\s*90,00/)).toBeInTheDocument();
    expect(within(found).getByText(/R\$\s*100,00/)).toBeInTheDocument();
    expect(within(found).getByText(/-R\$\s*10,00/)).toBeInTheDocument();
  });

  it('mesmo nome, com maiúsculas e acentos diferentes, não é destacado', async () => {
    mocked(hunit.api.commercial.get).mockImplementation(() =>
      okResult(detail({ returns: [commercialReturn({ chargeHotel: 'HOTEL  praia' })] })),
    );
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    const found = await screen.findByTestId('commercial-return');
    await within(found).findByText('Hotel da reserva: Hotel Praia');
    expect(within(found).queryByText('Diferente do hotel da reserva')).not.toBeInTheDocument();
  });

  it('confirmar chama a API com o retorno', async () => {
    const user = userEvent.setup();
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }));
    expect(hunit.api.commercial.confirmReturn).toHaveBeenCalledWith(RETURN_ID);
    expect(await screen.findByText(/vale como comprovante/)).toBeInTheDocument();
  });

  it('recusar exige motivo, sugere os mais comuns e avisa que o Comercial vê na planilha', async () => {
    const user = userEvent.setup();
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    await user.click(await screen.findByRole('button', { name: 'Recusar' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/aparece para o Comercial na planilha/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Recusar retorno' }));
    expect(within(dialog).getByText('Informe o motivo da recusa.')).toBeInTheDocument();
    expect(hunit.api.commercial.rejectReturn).not.toHaveBeenCalled();

    for (const suggestion of [
      'Código de autorização errado',
      'Valor diferente',
      'Pagamento não encontrado',
    ]) {
      expect(within(dialog).getByText(suggestion)).toBeInTheDocument();
    }
    await user.click(within(dialog).getByText('Valor diferente'));
    await user.click(within(dialog).getByRole('button', { name: 'Recusar retorno' }));
    expect(hunit.api.commercial.rejectReturn).toHaveBeenCalledWith({
      returnId: RETURN_ID,
      reason: 'Valor diferente',
    });
  });

  it('retorno confirmado: "Desfazer confirmação"', async () => {
    mocked(hunit.api.commercial.get).mockImplementation(() =>
      okResult(
        detail({
          returns: [
            commercialReturn({
              state: 'confirmed',
              decidedAt: '2026-11-16T12:00:00.000Z',
              decidedBy: 'desktop-financeiro',
            }),
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    await user.click(await screen.findByRole('button', { name: 'Desfazer confirmação' }));
    expect(hunit.api.commercial.undoConfirmation).toHaveBeenCalledWith(RETURN_ID);
  });

  it('desfazer o envio pede confirmação antes', async () => {
    const user = userEvent.setup();
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    await user.click(await screen.findByRole('button', { name: 'Desfazer envio' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Pedido cancelado pelo Financeiro/)).toBeInTheDocument();
    expect(hunit.api.commercial.cancelLine).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Desfazer envio' }));
    expect(hunit.api.commercial.cancelLine).toHaveBeenCalledWith({
      hotelCode: '31',
      reservationNumber: '7001',
    });
  });

  it('o perfil consulta vê o retorno, mas não tem ações', async () => {
    hunit = fakeHunit(ONLINE_READER);
    mocked(hunit.api.commercial.get).mockImplementation(() => okResult(detail()));
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    await screen.findByTestId('commercial-return');
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recusar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desfazer envio' })).not.toBeInTheDocument();
  });

  it('reserva nunca enviada pela planilha: a seção não aparece', async () => {
    mocked(hunit.api.commercial.get).mockImplementation(() =>
      okResult({ line: null, returns: [], events: [] }),
    );
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    await waitFor(() => expect(hunit.api.commercial.get).toHaveBeenCalled());
    expect(screen.queryByTestId('commercial-section')).not.toBeInTheDocument();
  });
});

describe('histórico mesclado com o da tratativa (FR-020)', () => {
  it('envios e retornos aparecem com quem fez, por data', async () => {
    mocked(hunit.api.commercial.get).mockImplementation(() =>
      okResult(
        detail({
          events: [
            commercialEvent({
              id: 2,
              type: 'return_received',
              actor: { kind: 'commercial_sheet', name: 'Comercial' },
              at: '2026-11-15T12:00:00.000Z',
            }),
            commercialEvent({ id: 1 }),
          ],
        }),
      ),
    );
    renderWithApp(<TreatmentSection reservation={reservation} />, hunit);
    const history = await screen.findByRole('list', { name: 'Histórico da tratativa' });
    const items = within(history).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Retorno do Comercial recebido — Comercial (planilha)');
    expect(items[1]).toHaveTextContent('Enviou ao Comercial — desktop-financeiro');
  });
});

describe('confirmação de retornos em lote (FR-016a)', () => {
  it('lista de revisão antes; as sem retorno aguardando validação ficam de fora', async () => {
    mocked(hunit.api.commercial.confirmReturns).mockImplementation(() =>
      okResult({
        batchId: 'b',
        items: [
          { hotelCode: '31', reservationNumber: '7001', outcome: 'confirmed', reason: null },
          {
            hotelCode: '31',
            reservationNumber: '7002',
            outcome: 'ignored',
            reason: 'no_return_awaiting_validation',
          },
        ],
        countsByClassification: {},
      }),
    );
    const items = [
      toSelected(
        pendingReservation('7001', {
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
      ),
      toSelected(pendingReservation('7002')),
    ];
    const user = userEvent.setup();
    renderWithApp(
      <ConfirmBatchDialog
        kind="returns"
        items={items}
        hotelNames={new Map([['31', 'Hotel Praia']])}
        onClose={() => undefined}
      />,
      hunit,
    );

    expect(screen.getByTestId('batch-summary')).toHaveTextContent(
      '1 retorno aguardando validação — 1 fica de fora (sem retorno aguardando validação).',
    );
    const review = screen.getByRole('table', { name: 'Revisão dos retornos' });
    expect(within(review).getByText('AUT987')).toBeInTheDocument();
    expect(within(review).getByText('Maquininha Centro')).toBeInTheDocument();
    expect(within(review).getByText('Hotel da reserva: Hotel Praia')).toBeInTheDocument();
    // A diferença fica na coluna e, no conteúdo estreito, na linha dos valores (o CSS mostra uma).
    expect(within(review).getAllByText(/-R\$\s*10,00/).length).toBeGreaterThan(0);

    // Tela 7.12: "Confirmar N retornos".
    await user.click(screen.getByRole('button', { name: 'Confirmar 1 retorno' }));
    expect(hunit.api.commercial.confirmReturns).toHaveBeenCalledWith({
      reservations: [
        { hotelCode: '31', reservationNumber: '7001' },
        { hotelCode: '31', reservationNumber: '7002' },
      ],
    });
    expect(await screen.findByTestId('batch-result')).toHaveTextContent(
      '1 reserva confirmada; 1 ficaram de fora.',
    );
    expect(screen.getByText('Sem retorno do Comercial aguardando validação.')).toBeInTheDocument();
  });
});
