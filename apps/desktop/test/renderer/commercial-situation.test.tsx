/**
 * Situação livre do Comercial no app (specs/009, US1 e US2; FR-006 a FR-009, FR-015) — tasks.md, T012
 * a T015 e T023: a linha em "Retornos a validar" (selo "Outra situação", sem caixa de marcar, as três
 * decisões), os diálogos "Confirmar como cobrada" (valor do Comercial ou digitado) e "Confirmar como
 * cancelada sem cobrança", a recusa, o bloco na gaveta e a aba "Aguardando validação do Financeiro".
 * Dados fictícios.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { errorMessage } from '../../src/renderer/src/presentation/labels';
import { CommercialScreen } from '../../src/renderer/src/screens/commercial/CommercialScreen';
import { CommercialSection } from '../../src/renderer/src/screens/reservations/CommercialSection';
import type { CommercialSituationReturn, Reservation } from '../../src/shared/ipc-types';
import { detail, line, sheetStatus } from './commercial-fixtures';
import {
  errorResult,
  fakeHunit,
  mocked,
  okResult,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';
import { pendingReservation, treatment } from './treatment-fixtures';

const SITUATION_ID = '66666666-6666-4666-8666-666666666666';

function situation(overrides: Partial<CommercialSituationReturn> = {}): CommercialSituationReturn {
  return {
    id: SITUATION_ID,
    state: 'awaiting_validation',
    situationText: 'Cobrada pela OTA',
    chargedBy: 'Comercial Fictício',
    authorizationCode: null,
    chargeHotel: null,
    chargedAmount: null,
    chargeDate: null,
    readAt: '2026-11-18T12:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    rejectionReason: null,
    decision: null,
    ...overrides,
  };
}

function withSituation(
  number: string,
  overrides: Partial<CommercialSituationReturn> = {},
): Reservation {
  return pendingReservation(number, {
    totalAmount: '655.00',
    amountToCharge: '655.00',
    treatment: treatment({ status: 'sent', detailedSituation: 'return_pending' }),
    commercial: {
      lineState: 'open',
      inSheet: true,
      lastSentAt: '2026-11-14T12:00:00.000Z',
      lastDispatchId: '44444444-4444-4444-8444-444444444444',
      returnState: 'awaiting_validation',
      currentReturn: null,
      returnProblem: null,
      syncPending: false,
      report: null,
      situationReturn: situation(overrides),
    },
  });
}

let hunit: FakeHunit;

function program(target: FakeHunit, items: Reservation[]) {
  mocked(target.api.commercial.sheetStatus).mockImplementation(() =>
    okResult(sheetStatus({ awaitingValidation: items.length })),
  );
  mocked(target.api.reservations.list).mockImplementation(() =>
    okResult({ items, nextCursor: null }),
  );
  mocked(target.api.commercial.confirmSituationReturn).mockImplementation(() =>
    okResult(items[0] as Reservation),
  );
  mocked(target.api.commercial.rejectReturn).mockImplementation(() =>
    okResult(treatment({ status: 'sent' })),
  );
}

async function openReturnsTab() {
  const user = userEvent.setup();
  renderWithApp(<CommercialScreen />, hunit);
  await user.click(screen.getByRole('tab', { name: 'Retornos a validar' }));
  const table = await screen.findByRole('table', { name: 'Retornos a validar' });
  return { user, table };
}

beforeEach(() => {
  hunit = fakeHunit();
});

describe('"Retornos a validar": a situação livre (FR-006, FR-007)', () => {
  it('linha com o selo "Outra situação", a situação e o responsável, sem caixa de marcar', async () => {
    program(hunit, [withSituation('7101')]);
    const { table } = await openReturnsTab();
    const row = within(table).getByRole('row', { name: /7101/ });
    expect(within(row).getByText('Outra situação')).toBeInTheDocument();
    expect(within(row).getByText('"Cobrada pela OTA"')).toBeInTheDocument();
    expect(row).toHaveTextContent('valor não informado');
    expect(row).toHaveTextContent('Comercial Fictício');
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Marcar todos os retornos listados' }),
    ).toBeDisabled();
  });

  it('"Confirmar como cobrada" sem valor do Comercial pede o valor e manda o digitado', async () => {
    program(hunit, [withSituation('7102')]);
    const { user, table } = await openReturnsTab();
    await user.click(
      within(table).getByRole('button', { name: 'Confirmar como cobrada a reserva 7102' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Confirmar como cobrada?' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar como cobrada' }));
    expect(
      within(dialog).getByText('Informe o valor cobrado, por exemplo 1.234,56.'),
    ).toBeInTheDocument();
    expect(hunit.api.commercial.confirmSituationReturn).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Valor cobrado (R$)'), '1.234,56');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar como cobrada' }));
    expect(hunit.api.commercial.confirmSituationReturn).toHaveBeenCalledWith({
      returnId: SITUATION_ID,
      as: 'charged',
      chargedAmount: '1234.56',
    });
    expect(await screen.findByText('Reserva 7102 confirmada como cobrada.')).toBeInTheDocument();
  });

  it('com o valor do Comercial, mostra o valor e não pede outro', async () => {
    program(hunit, [withSituation('7103', { chargedAmount: '90.00' })]);
    const { user, table } = await openReturnsTab();
    await user.click(
      within(table).getByRole('button', { name: 'Confirmar como cobrada a reserva 7103' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Confirmar como cobrada?' });
    expect(dialog).toHaveTextContent('R$ 90,00 (informado pelo Comercial)');
    expect(within(dialog).queryByLabelText('Valor cobrado (R$)')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar como cobrada' }));
    expect(hunit.api.commercial.confirmSituationReturn).toHaveBeenCalledWith({
      returnId: SITUATION_ID,
      as: 'charged',
    });
  });

  it('"Confirmar como cancelada sem cobrança" mostra o valor indo a R$ 0,00 e manda a observação', async () => {
    program(hunit, [withSituation('7104', { situationText: 'Hóspede não compareceu' })]);
    const { user, table } = await openReturnsTab();
    await user.click(
      within(table).getByRole('button', {
        name: 'Confirmar como cancelada sem cobrança a reserva 7104',
      }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Confirmar como cancelada sem cobrança?',
    });
    expect(dialog).toHaveTextContent('R$ 655,00 → R$ 0,00');
    expect(dialog).toHaveTextContent('"Hóspede não compareceu"');
    await user.type(within(dialog).getByLabelText('Observação (opcional)'), 'Conferido');
    await user.click(within(dialog).getByRole('button', { name: 'Marcar como cancelada' }));
    expect(hunit.api.commercial.confirmSituationReturn).toHaveBeenCalledWith({
      returnId: SITUATION_ID,
      as: 'no_charge',
      note: 'Conferido',
    });
  });

  it('"Recusar" pede o motivo e usa a recusa de sempre', async () => {
    program(hunit, [withSituation('7105')]);
    const { user, table } = await openReturnsTab();
    await user.click(
      within(table).getByRole('button', { name: 'Recusar a situação da reserva 7105' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Recusar a situação informada pelo Comercial',
    });
    await user.type(within(dialog).getByLabelText('Motivo da recusa'), 'Falta o comprovante');
    await user.click(within(dialog).getByRole('button', { name: 'Recusar' }));
    expect(hunit.api.commercial.rejectReturn).toHaveBeenCalledWith({
      returnId: SITUATION_ID,
      reason: 'Falta o comprovante',
    });
  });

  it('erro do servidor aparece com a mensagem do código', async () => {
    program(hunit, [withSituation('7106')]);
    mocked(hunit.api.commercial.confirmSituationReturn).mockImplementation(() =>
      errorResult('charged_amount_required'),
    );
    const { user, table } = await openReturnsTab();
    await user.click(
      within(table).getByRole('button', { name: 'Confirmar como cobrada a reserva 7106' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Confirmar como cobrada?' });
    await user.type(within(dialog).getByLabelText('Valor cobrado (R$)'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar como cobrada' }));
    expect(
      await screen.findByText(errorMessage({ code: 'charged_amount_required' })),
    ).toBeInTheDocument();
  });

  it('perfil consulta vê a situação, sem as ações (FR-009)', async () => {
    hunit = fakeHunit(ONLINE_READER);
    program(hunit, [withSituation('7107')]);
    const { table } = await openReturnsTab();
    const row = within(table).getByRole('row', { name: /7107/ });
    expect(within(row).getByText('Outra situação')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Confirmar como/ })).not.toBeInTheDocument();
  });
});

describe('gaveta da reserva: a situação livre e a aba da linha (FR-008, FR-015)', () => {
  it('bloco com o selo, o que o Comercial preencheu e as três decisões', async () => {
    const reservation = withSituation('7110', {
      chargeDate: '2026-11-03',
      chargeHotel: 'Loja Fictícia',
    });
    mocked(hunit.api.commercial.get).mockImplementation(() =>
      okResult(
        detail({ returns: [], situationReturns: [reservation.commercial!.situationReturn!] }),
      ),
    );
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    const block = await screen.findByTestId('commercial-situation');
    expect(within(block).getByText('Outra situação')).toBeInTheDocument();
    expect(within(block).getByText('Cobrada pela OTA')).toBeInTheDocument();
    expect(within(block).getByText('Loja Fictícia')).toBeInTheDocument();
    expect(block).toHaveTextContent('não informado');
    expect(
      within(block).getByRole('button', { name: 'Confirmar como cobrada a reserva 7110' }),
    ).toBeInTheDocument();
  });

  it('decidida: mostra a decisão, quem decidiu e quando, sem as ações', async () => {
    const reservation = withSituation('7111', {
      state: 'closed',
      decision: 'no_charge',
      decidedAt: '2026-11-19T10:00:00.000Z',
      decidedBy: 'desktop-financeiro',
    });
    mocked(hunit.api.commercial.get).mockImplementation(() =>
      okResult(
        detail({ returns: [], situationReturns: [reservation.commercial!.situationReturn!] }),
      ),
    );
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    const block = await screen.findByTestId('commercial-situation');
    expect(within(block).getAllByText('Confirmada como cancelada sem cobrança')).not.toHaveLength(
      0,
    );
    expect(block).toHaveTextContent('por desktop-financeiro');
    expect(within(block).queryByRole('button', { name: /Confirmar como/ })).not.toBeInTheDocument();
  });

  it('a linha na aba "Aguardando validação do Financeiro" (sheetTab, US2)', async () => {
    const reservation = withSituation('7112');
    mocked(hunit.api.commercial.get).mockImplementation(() =>
      okResult(detail({ line: line({ sheetTab: 'awaiting_validation' }), returns: [] })),
    );
    renderWithApp(<CommercialSection reservation={reservation} />, hunit);
    expect(await screen.findByText('Aguardando validação do Financeiro')).toBeInTheDocument();
  });
});
