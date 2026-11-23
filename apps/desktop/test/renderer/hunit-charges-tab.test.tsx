/**
 * Aba "Cobradas no Hunit" (specs/008, US3, T025; tela 7.15; research R-07 e R-13): a fila com a
 * situação derivada que o servidor informa, "Verificar agora" só para o operador (com o acesso ao
 * Hunit do cofre, como o envio) e a falha da verificação sem mudar as situações. Dados fictícios.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommercialScreen } from '../../src/renderer/src/screens/commercial/CommercialScreen';
import {
  HunitChargesTab,
  hunitStatusDetail,
} from '../../src/renderer/src/screens/commercial/HunitChargesTab';
import type { HunitChargeItem, HunitChargeQueue } from '../../src/shared/ipc-types';
import { dispatchFixture } from '../helpers/commercial-fixtures';
import { sheetStatus } from './commercial-fixtures';
import {
  errorResult,
  fakeHunit,
  mocked,
  okResult,
  ONLINE_READER,
  renderWithApp,
  type FakeHunit,
} from './render';

function item(overrides: Partial<HunitChargeItem> = {}): HunitChargeItem {
  return {
    hotelCode: '31',
    hotelName: 'Hotel Praia Azul',
    reservationNumber: '7101',
    guestName: 'Ana Ribeiro',
    channel: 'Booking.com',
    amountToCharge: '655.00',
    situationText: 'Cobrada no Hunit',
    chargedBy: 'Paula (Comercial)',
    chargeDate: '2026-11-18',
    readAt: '2026-11-18T13:00:00.000Z',
    status: 'awaiting',
    checkedAt: null,
    classification: 'virtual_card_pending_charge',
    requiresCharge: true,
    ...overrides,
  };
}

const QUEUE: HunitChargeQueue = {
  items: [
    item(),
    item({
      reservationNumber: '7102',
      status: 'not_found',
      checkedAt: '2026-11-19T09:00:00.000Z',
    }),
    item({
      reservationNumber: '7103',
      status: 'not_found',
      requiresCharge: false,
      classification: 'cancelled_no_charge',
      checkedAt: '2026-11-19T09:00:00.000Z',
    }),
    item({
      reservationNumber: '7104',
      status: 'confirmed',
      requiresCharge: false,
      classification: 'virtual_card_already_charged',
      checkedAt: '2026-11-19T09:00:00.000Z',
    }),
  ],
  counts: { awaiting: 1, notFound: 2, confirmed: 1 },
};

let hunit: FakeHunit;

function program(target: FakeHunit, queue: HunitChargeQueue = QUEUE) {
  mocked(target.api.commercial.hunitCharges).mockImplementation(() => okResult(queue));
  mocked(target.api.dispatches.list).mockImplementation(() =>
    okResult({ items: [], nextCursor: null }),
  );
  mocked(target.api.commercial.checkHunitCharges).mockImplementation(() =>
    okResult(dispatchFixture({ purpose: 'hunit_check' })),
  );
}

beforeEach(() => {
  hunit = fakeHunit();
  program(hunit);
});

const rowOf = async (number: string) =>
  (await screen.findByText(number)).closest('tr') as HTMLElement;

describe('a fila (tela 7.15)', () => {
  it('mostra a explicação, as colunas e a situação de cada reserva com a segunda linha', async () => {
    renderWithApp(<HunitChargesTab />, hunit);
    const table = await screen.findByRole('table', { name: 'Cobradas no Hunit' });
    // A explicação e "Verificar agora" ficam na faixa do topo do card (tela 7.15).
    expect(
      screen.getByText(/O Comercial marcou estas reservas como “Cobrada no Hunit” na planilha/),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Verificar agora' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
    for (const column of [
      'Reserva',
      'Hóspede e hotel',
      'Valor a cobrar',
      'Marcada pelo Comercial',
      'Verificação no Hunit',
    ]) {
      expect(within(table).getByText(column)).toBeInTheDocument();
    }

    const awaiting = await rowOf('7101');
    expect(within(awaiting).getByText('Aguardando verificação')).toBeInTheDocument();
    expect(within(awaiting).getByText('confere na próxima execução')).toBeInTheDocument();
    expect(within(awaiting).getByText('Paula (Comercial)')).toBeInTheDocument();
    const cell = (row: HTMLElement, column: string) =>
      row.querySelector(`td[data-col="${column}"]`) as HTMLElement;
    expect(within(cell(awaiting, 'toCharge')).getByText(/R\$\s*655,00/)).toBeInTheDocument();
    // Em conteúdo estreito (só o CSS decide), quem marcou e o valor vão para a segunda linha.
    expect(
      within(cell(awaiting, 'guest')).getByText(/^marcada por Paula \(Comercial\) · lido em/),
    ).toBeInTheDocument();
    expect(within(cell(awaiting, 'reservation')).getByText(/R\$\s*655,00/)).toBeInTheDocument();
    expect(within(await rowOf('7102')).getByText('continua pendente')).toBeInTheDocument();
    expect(
      within(await rowOf('7103')).getByText('Cancelada sem cobrança no Hunit'),
    ).toBeInTheDocument();
    const confirmed = await rowOf('7104');
    expect(within(confirmed).getByText('Confirmada no Hunit')).toBeInTheDocument();
    expect(within(confirmed).getByText('foi para Concluídas')).toBeInTheDocument();
    expect(
      within(confirmed).getByRole('button', { name: 'Abrir a reserva 7104' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/A verificação roda a cada execução/)).toBeInTheDocument();
  });

  it('fila vazia: o estado vazio com a explicação', async () => {
    program(hunit, { items: [], counts: { awaiting: 0, notFound: 0, confirmed: 0 } });
    renderWithApp(<HunitChargesTab />, hunit);
    expect(
      await screen.findByText('Nenhuma reserva cobrada no Hunit para conferir'),
    ).toBeInTheDocument();
  });

  it('a segunda linha segue a situação e a classificação do Hunit (research R-13)', () => {
    expect(
      hunitStatusDetail(
        item({ status: 'not_found', classification: 'invoiced', requiresCharge: false }),
      ),
    ).toBe('Faturada no Hunit');
  });
});

describe('"Verificar agora" (FR-014)', () => {
  it('com o acesso guardado: inicia a verificação e abre o acompanhamento', async () => {
    mocked(hunit.api.credentials.status).mockImplementation(() =>
      okResult({ username: 'operador@exemplo.com.br', hasPassword: true }),
    );
    const user = userEvent.setup();
    renderWithApp(<HunitChargesTab />, hunit);
    await screen.findByRole('table', { name: 'Cobradas no Hunit' });
    await waitFor(() => expect(hunit.api.credentials.status).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Verificar agora' }));
    await waitFor(() => expect(hunit.api.commercial.checkHunitCharges).toHaveBeenCalled());
    expect(await screen.findByRole('dialog', { name: 'Verificação no Hunit' })).toBeInTheDocument();
  });

  it('sem o acesso guardado: pede usuário e senha antes, no mesmo formulário do envio', async () => {
    const user = userEvent.setup();
    renderWithApp(<HunitChargesTab />, hunit);
    await screen.findByRole('table', { name: 'Cobradas no Hunit' });
    await user.click(screen.getByRole('button', { name: 'Verificar agora' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verificar no Hunit' });
    expect(within(dialog).getByLabelText('Usuário do Hunit')).toBeInTheDocument();
    expect(hunit.api.commercial.checkHunitCharges).not.toHaveBeenCalled();
  });

  it('a verificação recusada mostra a mensagem e as situações ficam como estavam', async () => {
    mocked(hunit.api.credentials.status).mockImplementation(() =>
      okResult({ username: 'operador@exemplo.com.br', hasPassword: true }),
    );
    mocked(hunit.api.commercial.checkHunitCharges).mockImplementation(() =>
      errorResult('account_busy'),
    );
    const user = userEvent.setup();
    renderWithApp(<HunitChargesTab />, hunit);
    await screen.findByRole('table', { name: 'Cobradas no Hunit' });
    await waitFor(() => expect(hunit.api.credentials.status).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Verificar agora' }));
    expect(await screen.findByText('Não foi possível verificar')).toBeInTheDocument();
    expect(screen.getByText(/As situações da fila continuam como estavam/)).toBeInTheDocument();
    expect(within(await rowOf('7101')).getByText('Aguardando verificação')).toBeInTheDocument();
  });

  it('o perfil consulta vê a fila sem "Verificar agora"', async () => {
    hunit = fakeHunit(ONLINE_READER);
    program(hunit);
    renderWithApp(<HunitChargesTab />, hunit);
    await screen.findByRole('table', { name: 'Cobradas no Hunit' });
    expect(screen.queryByRole('button', { name: 'Verificar agora' })).not.toBeInTheDocument();
  });
});

describe('aba na área Comercial (tela 7.7)', () => {
  it('"Cobradas no Hunit" com a contagem da fila; as "Cancelada" não contam nos problemas', async () => {
    mocked(hunit.api.commercial.sheetStatus).mockImplementation(() =>
      okResult(
        sheetStatus({
          hunitQueueCount: 4,
          reports: [
            {
              hotelCode: '31',
              reservationNumber: '7020',
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
    mocked(hunit.api.dispatches.list).mockImplementation(() =>
      okResult({ items: [], nextCursor: null }),
    );
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    const tab = await screen.findByRole('tab', { name: /^Cobradas no Hunit/ });
    await waitFor(() => expect(tab).toHaveTextContent('4'));
    // Desde a homologação (R-19), as "Cancelada" contam em "Retornos a validar", não aqui.
    expect(screen.getByRole('tab', { name: /^Retornos com problema/ })).toHaveTextContent('0');
    await user.click(tab);
    expect(await screen.findByRole('table', { name: 'Cobradas no Hunit' })).toBeInTheDocument();
  });
});
