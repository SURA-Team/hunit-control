/**
 * Área "Comercial" do app (specs/005, US3, T050; FR-013, FR-018, FR-020, FR-021): as abas
 * "Envios", "Retornos a validar", "Retornos com problema" e "Planilha", com as ações só para o
 * perfil operador. Dados fictícios. Desde a 006 (T052): o visual novo das quatro abas. Desde a
 * homologação da 008 (R-19): a "Cancelada" do Comercial em "Retornos a validar".
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommercialScreen } from '../../src/renderer/src/screens/commercial/CommercialScreen';
import { dispatchFixture } from '../helpers/commercial-fixtures';
import { expectOnePrimaryPerBlock } from './hierarchy';
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
          counts: {
            total: 10,
            pending: 0,
            sent: 7,
            withdrawn: 2,
            notVerified: 1,
            ignored: 0,
            checked: 0,
          },
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
            currentReturn: returnBrief({
              chargeSituation: { kind: 'other', text: 'Paga no balcão' },
              chargeDate: '2026-11-03',
            }),
            returnProblem: null,
            syncPending: false,
            report: null,
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
    // Situação e data da cobrança na coluna "Responsável e cobrança" (specs/008, tela 7.8).
    expect(within(table).getByText('Responsável e cobrança')).toBeInTheDocument();
    expect(within(table).getByText('Paga no balcão em 03/11/2026')).toBeInTheDocument();
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

  it('as "Cancelada" não aparecem aqui (homologação, R-19)', async () => {
    programCancellation(hunit);
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    await user.click(screen.getByRole('tab', { name: /^Retornos com problema/ }));
    expect(await screen.findByText('Nenhum retorno com problema.')).toBeInTheDocument();
    expect(screen.queryByText('7020')).not.toBeInTheDocument();
  });
});

/** Uma "Cancelada" do Comercial aguardando validação (homologação da 008, R-19). */
function programCancellation(target: FakeHunit) {
  mocked(target.api.commercial.sheetStatus).mockImplementation(() =>
    okResult(
      sheetStatus({
        problems: [],
        reports: [
          {
            hotelCode: '31',
            reservationNumber: '7020',
            situationText: 'Cancelada na Expedia',
            chargedBy: null,
            chargeDate: null,
            readAt: '2026-11-18T12:00:00.000Z',
            totalAmount: '655.00',
          },
        ],
      }),
    ),
  );
}

describe('"Cancelada" em "Retornos a validar" (homologação da 008, R-19; FR-007c)', () => {
  const KEY = { hotelCode: '31', reservationNumber: '7020' };

  async function openTab() {
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    await user.click(screen.getByRole('tab', { name: /^Retornos a validar/ }));
    const table = await screen.findByRole('table', { name: 'Retornos a validar' });
    const row = (await within(table).findByText('7020')).closest('tr') as HTMLElement;
    return { user, table, row };
  }

  it('no topo, com o selo "Cancelada", a situação como veio e o valor que vira R$ 0,00', async () => {
    programCancellation(hunit);
    const { table, row } = await openTab();
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toBe(row);
    expect(within(row).getByText('Cancelada')).toBeInTheDocument();
    expect(within(row).getByText('"Cancelada na Expedia"')).toBeInTheDocument();
    expect(within(row).getByText(/R\$\s*655,00 a cobrar/)).toBeInTheDocument();
    expect(within(row).getByText('vira R$ 0,00 ao confirmar')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Abrir a reserva 7020' })).toBeInTheDocument();
    expectOnePrimaryPerBlock();
  });

  it('"Confirmar cancelamento" chama a ponte com a reserva', async () => {
    programCancellation(hunit);
    mocked(hunit.api.commercial.confirmCancellation).mockImplementation(() =>
      okResult(pendingReservation('7020')),
    );
    const { user, row } = await openTab();
    await user.click(within(row).getByRole('button', { name: 'Confirmar cancelamento' }));
    expect(hunit.api.commercial.confirmCancellation).toHaveBeenCalledWith(KEY);
    expect(
      await screen.findByText('Reserva 7020 marcada como cancelada sem cobrança.'),
    ).toBeInTheDocument();
  });

  it('"Recusar" pede o motivo, sem as sugestões dos retornos', async () => {
    programCancellation(hunit);
    mocked(hunit.api.commercial.rejectCancellation).mockImplementation(() =>
      okResult(pendingReservation('7020')),
    );
    const { user, row } = await openTab();
    await user.click(within(row).getByRole('button', { name: 'Recusar' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Recusar a "Cancelada" do Comercial',
    });
    expect(within(dialog).queryByText('Motivos mais comuns')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Motivo da recusa'), 'Hóspede fez check-in');
    await user.click(within(dialog).getByRole('button', { name: 'Recusar' }));
    expect(hunit.api.commercial.rejectCancellation).toHaveBeenCalledWith({
      key: KEY,
      reason: 'Hóspede fez check-in',
    });
  });

  it('"Confirmar marcados" leva a "Cancelada" ao lote, com includeCancellations', async () => {
    programCancellation(hunit);
    mocked(hunit.api.commercial.confirmReturns).mockImplementation(() =>
      okResult({
        batchId: '55555555-5555-4555-8555-555555555555',
        items: [],
        countsByClassification: {},
      }),
    );
    const { user, table } = await openTab();
    await user.click(within(table).getByRole('checkbox', { name: 'Marcar a reserva 7020' }));
    await user.click(within(table).getByRole('checkbox', { name: 'Marcar a reserva 7001' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar marcados (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirmar retornos do Comercial' });
    expect(within(dialog).getByTestId('batch-summary')).toHaveTextContent(
      '1 retorno aguardando validação e 1 reserva "Cancelada" pelo Comercial.',
    );
    expect(within(dialog).getByText('"Cancelada na Expedia"')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar 2' }));
    expect(hunit.api.commercial.confirmReturns).toHaveBeenCalledWith({
      reservations: [{ hotelCode: '31', reservationNumber: '7001' }, KEY],
      includeCancellations: true,
    });
  });

  it('o perfil consulta vê a "Cancelada" sem ações', async () => {
    hunit = fakeHunit(ONLINE_READER);
    program(hunit);
    programCancellation(hunit);
    const { row } = await openTab();
    expect(within(row).getByText('Cancelada')).toBeInTheDocument();
    expect(
      within(row).queryByRole('button', { name: 'Confirmar cancelamento' }),
    ).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Recusar' })).not.toBeInTheDocument();
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

describe('visual novo da área Comercial (specs/006, T052; telas 7.7 a 7.10)', () => {
  it('título com a explicação e as abas com a contagem dos retornos (FR-039)', async () => {
    renderWithApp(<CommercialScreen />, hunit);
    expect(screen.getByRole('heading', { level: 1, name: 'Comercial' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Envios das reservas para a planilha do Comercial e os retornos que ele preenche.',
      ),
    ).toBeInTheDocument();
    // 2 aguardando validação e 1 com problema (a situação da planilha do teste).
    const returns = screen.getByRole('tab', { name: /^Retornos a validar/ });
    await waitFor(() => expect(returns).toHaveTextContent('2'));
    expect(screen.getByRole('tab', { name: /^Retornos com problema/ })).toHaveTextContent('1');
  });

  it('envio em andamento no card escuro (7.7a) e os encerrados no "Histórico" (7.7)', async () => {
    mocked(hunit.api.dispatches.list).mockImplementation(() =>
      okResult({
        items: [
          {
            ...dispatchFixture({ status: 'running' }),
            id: '55555555-5555-4555-8555-555555555555',
            counts: {
              total: 16,
              pending: 8,
              sent: 8,
              withdrawn: 0,
              notVerified: 0,
              ignored: 0,
              checked: 0,
            },
          },
          {
            ...dispatchFixture({ status: 'completed' }),
            counts: {
              total: 15,
              pending: 0,
              sent: 14,
              withdrawn: 0,
              notVerified: 1,
              ignored: 0,
              checked: 0,
            },
          },
        ],
        nextCursor: null,
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);

    const card = await screen.findByRole('region', { name: /^Em andamento: Iniciado em/ });
    expect(card).toHaveTextContent('desktop-financeiro (esta máquina) · 16 reservas');
    expect(card).toHaveTextContent('8 de 16 reservas verificadas');
    expect(card).toHaveTextContent('50%');

    const table = screen.getByRole('table', { name: 'Envios ao Comercial' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('14 enviadas · 0 retiradas · 1 não verificada');
    expect(within(rows[0] as HTMLElement).getByText('Concluído')).toHaveAttribute(
      'data-tone',
      'green',
    );

    await user.click(within(card).getByRole('button', { name: 'Ver envio' }));
    expect(await screen.findByRole('dialog', { name: 'Detalhe do envio' })).toBeInTheDocument();
  });

  it('retornos (7.8): faixa com "Confirmar marcados", "Confirmar" principal de cada linha', async () => {
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    await user.click(screen.getByRole('tab', { name: /^Retornos a validar/ }));
    const table = await screen.findByRole('table', { name: 'Retornos a validar' });

    const batch = screen.getByRole('button', { name: 'Confirmar marcados (0)' });
    expect(batch).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Marcar a reserva 7001' }));
    expect(screen.getByRole('button', { name: 'Confirmar marcados (1)' })).toBeEnabled();

    expect(within(table).getByRole('button', { name: 'Confirmar' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    expect(within(table).getByRole('button', { name: 'Recusar' })).toHaveAttribute(
      'data-variant',
      'danger-light',
    );
    expect(within(table).getByRole('button', { name: 'Abrir a reserva 7001' })).toBeInTheDocument();
    expectOnePrimaryPerBlock();
  });

  it('problemas (7.9): selo âmbar e a seta abre o detalhe da reserva', async () => {
    mocked(hunit.api.reservations.get).mockImplementation(() =>
      okResult(pendingReservation('7009')),
    );
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    await user.click(screen.getByRole('tab', { name: /^Retornos com problema/ }));
    const table = await screen.findByRole('table', { name: 'Retornos com problema' });
    expect(within(table).getByText('Retorno incompleto')).toHaveAttribute('data-tone', 'amber');

    await user.click(within(table).getByRole('button', { name: 'Abrir a reserva 7009' }));
    expect(hunit.api.reservations.get).toHaveBeenCalledWith({
      hotelCode: '31',
      reservationNumber: '7009',
    });
    expect(await screen.findByTestId('reservation-detail')).toBeInTheDocument();
  });

  it('planilha (7.10): selo, "Ler retornos agora" principal e os números em caixas', async () => {
    const user = userEvent.setup();
    renderWithApp(<CommercialScreen />, hunit);
    await user.click(screen.getByRole('tab', { name: 'Planilha' }));
    const panel = await screen.findByTestId('sheet-status');

    expect(
      within(panel).getByRole('heading', { name: 'Situação da planilha' }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Ler retornos agora' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    const tiles = within(panel).getByLabelText('Situação da planilha');
    expect([...tiles.querySelectorAll('dt')].map((term) => term.textContent)).toEqual([
      'Atualizações pendentes',
      'Retornos aguardando validação',
      'Retornos com problema',
      'Última rodada completa',
      'Última leitura dos retornos',
    ]);
  });
});
