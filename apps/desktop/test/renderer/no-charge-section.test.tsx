/**
 * "Cancelada sem cobrança" no detalhe da reserva (specs/008, T031; US4, FR-018 a FR-023; telas 7.17
 * e 7.18): o card e o diálogo de confirmação (valor → R$ 0,00, observação opcional com contador,
 * "Voltar" sem gravar), a reserva marcada (valor e o anterior, quem marcou, onde está, observação,
 * aviso do Hunit e "Desfazer" com confirmação), as recusas do servidor, o histórico, o perfil
 * consulta e a linha da lista ("R$ 0,00 · antes R$ …"). Dados fictícios.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { reservationRowText } from '../../src/renderer/src/presentation/reservations';
import { ReservationDetail } from '../../src/renderer/src/screens/reservations/ReservationDetail';
import type { NoChargeMark, Reservation, ReservationTreatment } from '../../src/shared/ipc-types';
import { expectOnePrimaryPerBlock } from './hierarchy';
import {
  errorResult,
  fakeHunit,
  mocked,
  okResult,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';
import { detail, pendingReservation, treatment } from './treatment-fixtures';

const KEY = { hotelCode: '31', reservationNumber: '7001' };
const MARK_ID = '66666666-6666-4666-8666-666666666666';

const MARK: NoChargeMark = {
  id: MARK_ID,
  markedAt: new Date(2026, 10, 17, 16, 50).toISOString(),
  markedBy: 'desktop-financeiro',
  note: 'hóspede cancelou antes do check-in',
  previousAmount: '655.00',
  undoneAt: null,
  undoneBy: null,
};

/** Reserva marcada como cancelada sem cobrança, como o servidor devolve (tela 7.18). */
function markedReservation(overrides: Partial<NonNullable<Reservation['noCharge']>> = {}) {
  const current = treatment({
    situation: 'cancelled_no_charge',
    detailedSituation: 'cancelled_no_charge',
    acceptsDocuments: false,
    noChargeHistory: [MARK],
  });
  return pendingReservation('7001', {
    totalAmount: '655.00',
    amountToCharge: '0.00',
    treatment: current,
    noCharge: { ...MARK, hunitShowsCharge: false, ...overrides },
  });
}

let hunit: FakeHunit;

beforeEach(() => {
  hunit = fakeHunit();
});

/** Mostra o detalhe e espera o perfil da conexão chegar (as ações dependem dele). */
async function show(reservation: Reservation) {
  mocked(hunit.api.treatments.get).mockImplementation(() =>
    okResult(detail({ treatment: reservation.treatment })),
  );
  renderWithApp(<ReservationDetail reservation={reservation} />, hunit);
  await waitFor(() => expect(hunit.api.connection.getState).toHaveBeenCalled());
  await act(() => Promise.resolve());
}

const section = () => within(screen.getByTestId('no-charge-section'));
const pending = (current: Partial<ReservationTreatment> = {}) =>
  pendingReservation('7001', {
    totalAmount: '655.00',
    amountToCharge: '655.00',
    treatment: treatment(current),
  });

async function openDialog() {
  await userEvent.click(
    await section().findByRole('button', { name: 'Marcar como cancelada sem cobrança' }),
  );
  return screen.findByRole('dialog', { name: 'Marcar como cancelada sem cobrança?' });
}

describe('reserva que aceita a marcação (tela 7.17, FR-018 e FR-019)', () => {
  it('mostra o card com o texto e a ação', async () => {
    await show(pending());

    expect(await section().findByText('Reserva cancelada sem nada a cobrar?')).toBeInTheDocument();
    expect(section().getByText(/O valor a cobrar fica R\$ 0,00/)).toBeInTheDocument();
    expectOnePrimaryPerBlock();
  });

  it('o diálogo mostra o aviso, a reserva, o valor → R$ 0,00 e a observação com contador', async () => {
    await show(pending());
    const dialog = within(await openDialog());

    expect(dialog.getByText(/Use só quando a reserva foi cancelada/)).toBeInTheDocument();
    expect(dialog.getByText('7001 · Hóspede Fictício')).toBeInTheDocument();
    expect(dialog.getByText('R$ 655,00 → R$ 0,00')).toBeInTheDocument();
    expect(
      dialog.getByText('Concluídas, com a situação “Cancelada sem cobrança”'),
    ).toBeInTheDocument();
    const note = dialog.getByRole('textbox', { name: 'Observação (opcional)' });
    expect(note).toHaveAttribute('placeholder', 'Ex.: hóspede cancelou antes do check-in');
    expect(dialog.getByText('0/500')).toBeInTheDocument();
    await userEvent.type(note, 'Cancelou');
    expect(dialog.getByText('8/500')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Marcar como cancelada' })).toHaveAttribute(
      'data-variant',
      'danger',
    );
    expect(dialog.getByRole('button', { name: 'Voltar' })).toHaveAttribute('data-variant', 'text');
  });

  it('"Voltar" fecha sem gravar nada', async () => {
    await show(pending());
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Marcar como cancelada sem cobrança?' }),
      ).not.toBeInTheDocument(),
    );
    expect(hunit.api.reservations.markNoCharge).not.toHaveBeenCalled();
  });

  it('confirma com a situação vista e a observação sem espaços nas pontas', async () => {
    mocked(hunit.api.reservations.markNoCharge).mockImplementation(() =>
      okResult(markedReservation()),
    );
    await show(pending());
    const dialog = within(await openDialog());
    await userEvent.type(
      dialog.getByRole('textbox', { name: 'Observação (opcional)' }),
      '  hóspede cancelou  ',
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Marcar como cancelada' }));

    await waitFor(() =>
      expect(hunit.api.reservations.markNoCharge).toHaveBeenCalledWith({
        key: KEY,
        expectedSituation: 'virtual_card_pending_charge',
        note: 'hóspede cancelou',
      }),
    );
    expect(
      await section().findByText('Reserva marcada como cancelada sem cobrança.'),
    ).toBeInTheDocument();
  });

  it('sem observação, o campo não vai ao servidor', async () => {
    mocked(hunit.api.reservations.markNoCharge).mockImplementation(() =>
      okResult(markedReservation()),
    );
    await show(pending({ status: 'sent', situation: 'treatment_sent' }));
    const dialog = within(await openDialog());
    await userEvent.click(dialog.getByRole('button', { name: 'Marcar como cancelada' }));

    await waitFor(() =>
      expect(hunit.api.reservations.markNoCharge).toHaveBeenCalledWith({
        key: KEY,
        expectedSituation: 'treatment_sent',
      }),
    );
  });

  it.each([
    ['a situação mudou', 'reservation_changed', undefined, /A situação da reserva mudou/],
    [
      'o servidor recusa com o motivo',
      'no_charge_not_accepted',
      'A reserva já tem comprovante.',
      /não aceita a marcação .*A reserva já tem comprovante\./,
    ],
  ] as const)('409 — %s: mostra a mensagem e nada é marcado', async (_, code, reason, text) => {
    mocked(hunit.api.reservations.markNoCharge).mockImplementation(() => errorResult(code, reason));
    await show(pending());
    const dialog = within(await openDialog());
    await userEvent.click(dialog.getByRole('button', { name: 'Marcar como cancelada' }));

    expect(await section().findByRole('alert')).toHaveTextContent(text);
  });
});

describe('quem não vê a ação (FR-018 e FR-022)', () => {
  it('perfil consulta: sem o card', async () => {
    hunit = fakeHunit(ONLINE_READER);
    await show(pending());
    expect(screen.queryByTestId('no-charge-section')).not.toBeInTheDocument();
  });

  it.each([
    ['com comprovante', { status: 'charged' as const, situation: 'proof_sent' as const }],
    ['que não exige cobrança', { acceptsDocuments: false }],
  ])('reserva %s: sem o card', async (_, current) => {
    await show(pending(current));
    expect(screen.queryByTestId('no-charge-section')).not.toBeInTheDocument();
  });

  it('retorno do Comercial aguardando validação: botão desabilitado com o motivo', async () => {
    await show(
      pending({
        status: 'sent',
        situation: 'treatment_sent',
        detailedSituation: 'return_pending',
      }),
    );

    expect(
      await section().findByRole('button', { name: 'Marcar como cancelada sem cobrança' }),
    ).toBeDisabled();
    expect(section().getByTestId('no-charge-blocked')).toHaveTextContent(
      'Há retorno do Comercial aguardando validação',
    );
  });
});

describe('reserva marcada (tela 7.18, FR-020, FR-021 e FR-023)', () => {
  it('mostra o selo, o valor e o anterior, quem marcou, onde está e a observação', async () => {
    await show(markedReservation());

    const header = screen.getAllByText('Cancelada sem cobrança');
    expect(header.length).toBeGreaterThan(1);
    expect(section().getByText('R$ 0,00')).toBeInTheDocument();
    expect(section().getByText('antes R$ 655,00')).toBeInTheDocument();
    expect(section().getByText('17/11/2026 16:50')).toBeInTheDocument();
    expect(section().getByText('por desktop-financeiro')).toBeInTheDocument();
    expect(section().getByText('Concluídas')).toBeInTheDocument();
    expect(section().getByText('não vai mais ao Comercial')).toBeInTheDocument();
    expect(section().getByTestId('no-charge-note')).toHaveTextContent(
      'Observação: hóspede cancelou antes do check-in',
    );
    expect(section().queryByTestId('no-charge-hunit-charged')).not.toBeInTheDocument();
    expect(section().getByRole('button', { name: 'Desfazer' })).toHaveAttribute(
      'data-variant',
      'danger-light',
    );
    expectOnePrimaryPerBlock();
  });

  it('o Hunit mostra cobrança: aviso, e a marcação continua', async () => {
    await show(markedReservation({ hunitShowsCharge: true }));
    expect(section().getByTestId('no-charge-hunit-charged')).toHaveTextContent(
      'o Hunit passou a mostrar esta reserva como cobrada',
    );
    expect(section().getByRole('button', { name: 'Desfazer' })).toBeInTheDocument();
  });

  it('"Desfazer" pede confirmação; "Manter" não grava nada', async () => {
    await show(markedReservation());
    await userEvent.click(section().getByRole('button', { name: 'Desfazer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desfazer a marcação?' });
    expect(dialog).toHaveTextContent('volta ao valor a cobrar de R$ 655,00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Manter' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Desfazer a marcação?' }),
      ).not.toBeInTheDocument(),
    );
    expect(hunit.api.reservations.undoNoCharge).not.toHaveBeenCalled();
  });

  it('confirmado, desfaz a marcação ativa', async () => {
    mocked(hunit.api.reservations.undoNoCharge).mockImplementation(() => okResult(pending()));
    await show(markedReservation());
    await userEvent.click(section().getByRole('button', { name: 'Desfazer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desfazer a marcação?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desfazer' }));

    await waitFor(() =>
      expect(hunit.api.reservations.undoNoCharge).toHaveBeenCalledWith({
        key: KEY,
        markId: MARK_ID,
      }),
    );
  });

  it('marcação já desfeita por outra pessoa: mostra a mensagem', async () => {
    mocked(hunit.api.reservations.undoNoCharge).mockImplementation(() =>
      errorResult('no_charge_not_active'),
    );
    await show(markedReservation());
    await userEvent.click(section().getByRole('button', { name: 'Desfazer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desfazer a marcação?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desfazer' }));

    expect(await section().findByRole('alert')).toHaveTextContent('Esta marcação já foi desfeita.');
  });

  it('perfil consulta: vê a marcação, sem "Desfazer"', async () => {
    hunit = fakeHunit(ONLINE_READER);
    await show(markedReservation());
    expect(section().getByText('antes R$ 655,00')).toBeInTheDocument();
    expect(section().queryByRole('button', { name: 'Desfazer' })).not.toBeInTheDocument();
  });

  it('o histórico mostra quem marcou e quem desfez (FR-021)', async () => {
    const undone: NoChargeMark = {
      ...MARK,
      id: '77777777-7777-4777-8777-777777777777',
      markedAt: new Date(2026, 10, 15, 9, 0).toISOString(),
      undoneAt: new Date(2026, 10, 16, 10, 0).toISOString(),
      undoneBy: 'desktop-gerencia',
    };
    const reservation = markedReservation();
    await show({
      ...reservation,
      treatment: { ...reservation.treatment, noChargeHistory: [MARK, undone] },
    });

    const history = await screen.findByRole('list', { name: 'Histórico da tratativa' });
    const lines = within(history)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(lines).toEqual([
      '17/11/2026 16:50 — Marcou como cancelada sem cobrança — desktop-financeiro',
      '16/11/2026 10:00 — Desfez a marcação “Cancelada sem cobrança” — desktop-gerencia',
      '15/11/2026 09:00 — Marcou como cancelada sem cobrança — desktop-financeiro',
    ]);
  });
});

describe('linha da lista (FR-020)', () => {
  // O Intl separa "R$" do valor com um espaço que não quebra a linha.
  const amounts = (reservation: Reservation) => {
    const text = reservationRowText(reservation, 'Hotel Fictício');
    const plain = (value: string | null) => value?.replace(/\s/g, ' ') ?? null;
    return { amount: plain(text.amount), chargedAmount: plain(text.chargedAmount) };
  };

  it('marcada: "R$ 0,00" e "antes R$ …"; sem marcação, o valor total', () => {
    expect(amounts(markedReservation())).toEqual({
      amount: 'R$ 0,00',
      chargedAmount: 'antes R$ 655,00',
    });
    expect(amounts(pending())).toEqual({ amount: 'R$ 655,00', chargedAmount: null });
  });
});
