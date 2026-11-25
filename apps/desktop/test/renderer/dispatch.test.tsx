/**
 * Envio ao Comercial no app (specs/005, US1, T037): a ação na barra da seleção (oculta para o perfil
 * consulta), o resumo da conferência (aceitas, as que ficam de fora com o motivo, o total), o
 * acompanhamento com cancelar e retomar, o pedido de token do envio e, ao terminar, a seleção só
 * com as não verificadas. Dados fictícios. Desde a 006 (T050; telas 7.1 a 7.4): a conferência
 * estreita, o andamento largo, as variantes das ações e o resultado em linhas.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoFactorDialog } from '../../src/renderer/src/components/TwoFactorDialog';
import { DispatchDialog } from '../../src/renderer/src/screens/dispatch/DispatchDialog';
import { DispatchView } from '../../src/renderer/src/screens/dispatch/DispatchView';
import { ReservationsScreen } from '../../src/renderer/src/screens/reservations/ReservationsScreen';
import type { CommercialDispatch } from '../../src/shared/ipc-types';
import { dispatchFixture } from '../helpers/commercial-fixtures';
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

let hunit: FakeHunit;
const HOTELS = new Map([['31', 'Hotel Praia']]);
const A = { hotelCode: '31', reservationNumber: '7001' };
const B = { hotelCode: '31', reservationNumber: '7002' };

function finished(overrides: Partial<CommercialDispatch> = {}): CommercialDispatch {
  return dispatchFixture({
    status: 'completed',
    counts: { total: 2, pending: 0, sent: 1, withdrawn: 0, notVerified: 1, ignored: 0, checked: 0 },
    items: [
      {
        ...A,
        position: 1,
        outcome: 'sent',
        classificationBefore: 'virtual_card_pending_charge',
        classificationAfter: 'virtual_card_pending_charge',
        reason: null,
        processedAt: '2026-11-17T12:01:00.000Z',
        checkResult: null,
      },
      {
        ...B,
        position: 2,
        outcome: 'not_verified',
        classificationBefore: 'virtual_card_pending_charge',
        classificationAfter: null,
        reason: 'não encontrada no Hunit no check-in registrado (03/11/2026)',
        processedAt: '2026-11-17T12:01:05.000Z',
        checkResult: null,
      },
    ],
    ...overrides,
  });
}

beforeEach(() => {
  hunit = fakeHunit();
  mocked(hunit.api.hotels.list).mockImplementation(() =>
    okResult([{ code: '31', name: 'Hotel Praia', available: true, lastSeenAt: '' }]),
  );
  mocked(hunit.api.credentials.status).mockImplementation(() =>
    okResult({ username: 'operador@hotel.test', hasPassword: true }),
  );
  mocked(hunit.api.dispatches.check).mockImplementation(() =>
    okResult({
      eligible: [{ ...A, totalAmount: '100.00', resend: false }],
      ignored: [{ ...B, reason: 'has_proof' }],
      totalAmount: '100.00',
    }),
  );
  mocked(hunit.api.dispatches.start).mockImplementation(() => okResult(dispatchFixture()));
  mocked(hunit.api.dispatches.get).mockImplementation(() => okResult(finished()));
});

describe('"Enviar ao Comercial" na seleção (FR-025)', () => {
  it('aparece na barra da seleção do operador e abre a conferência', async () => {
    mocked(hunit.api.reservations.list).mockImplementation(() =>
      okResult({
        items: [pendingReservation('7001'), pendingReservation('7002')],
        nextCursor: null,
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<ReservationsScreen />, hunit);
    await user.click(await screen.findByRole('checkbox', { name: 'Selecionar a reserva 7001' }));
    await user.click(screen.getByRole('button', { name: 'Enviar ao Comercial' }));

    expect(await screen.findByTestId('dispatch-summary')).toHaveTextContent(
      /1 reserva aceita — total de R\$\s*100,00/,
    );
    expect(hunit.api.dispatches.check).toHaveBeenCalledWith({ reservations: [A] });
  });

  it('o perfil consulta não tem a ação', async () => {
    hunit = fakeHunit(ONLINE_READER);
    mocked(hunit.api.reservations.list).mockImplementation(() =>
      okResult({ items: [pendingReservation('7001')], nextCursor: null }),
    );
    renderWithApp(<ReservationsScreen />, hunit);
    await screen.findByRole('row', { name: /7001/ });
    expect(screen.queryByRole('button', { name: 'Enviar ao Comercial' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Selecionar a reserva 7001' }),
    ).not.toBeInTheDocument();
  });
});

describe('diálogo do envio (FR-001 a FR-008)', () => {
  it('resumo com as que ficam de fora; enviar usa o acesso guardado e acompanha', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithApp(
      <DispatchDialog reservations={[A, B]} hotelNames={HOTELS} onClose={onClose} />,
      hunit,
    );

    const ignored = await screen.findByRole('list', { name: 'Reservas que ficam de fora' });
    expect(within(ignored).getByText('7002 (Hotel Praia)')).toBeInTheDocument();
    expect(within(ignored).getByText('Já tem comprovante.')).toBeInTheDocument();
    expect(await screen.findByText(/senha guardada nesta sessão/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Enviar 1 ao Comercial' }));
    expect(hunit.api.dispatches.start).toHaveBeenCalledWith({ reservations: [A, B] });
    const view = await screen.findByTestId('dispatch-view');
    expect(view).toHaveTextContent('2 de 2 verificadas');
    expect(within(view).getByText('Não verificada')).toBeInTheDocument();

    // Ao fechar (pelo X, como na tela 7.4) depois do fim, a seleção fica só com as não verificadas.
    await user.click(screen.getByRole('button', { name: 'Fechar o diálogo' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ notVerified: [B] }));
  });

  it('nenhuma aceita: não dá para enviar', async () => {
    mocked(hunit.api.dispatches.check).mockImplementation(() =>
      okResult({ eligible: [], ignored: [{ ...B, reason: 'not_accepting' }], totalAmount: '0.00' }),
    );
    renderWithApp(
      <DispatchDialog reservations={[B]} hotelNames={HOTELS} onClose={vi.fn()} />,
      hunit,
    );
    expect(
      await screen.findByText('A situação desta reserva não exige cobrança.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar 0 ao Comercial/ })).toBeDisabled();
  });

  it('conta ocupada: mostra a mensagem do servidor', async () => {
    mocked(hunit.api.dispatches.start).mockImplementation(() =>
      Promise.resolve({ ok: false, error: { code: 'account_busy' } }),
    );
    const user = userEvent.setup();
    renderWithApp(
      <DispatchDialog reservations={[A]} hotelNames={HOTELS} onClose={vi.fn()} />,
      hunit,
    );
    await user.click(await screen.findByRole('button', { name: 'Enviar 1 ao Comercial' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/conta do Hunit está em uso/);
  });
});

describe('acompanhamento (FR-005 a FR-008)', () => {
  it('em andamento: verificadas, restantes, a reserva atual e "Cancelar envio"', async () => {
    mocked(hunit.api.dispatches.cancel).mockImplementation(() =>
      okResult(dispatchFixture({ status: 'cancelled' })),
    );
    const user = userEvent.setup();
    renderWithApp(
      <DispatchView
        dispatch={dispatchFixture({
          status: 'running',
          counts: {
            total: 3,
            pending: 2,
            sent: 1,
            withdrawn: 0,
            notVerified: 0,
            ignored: 0,
            checked: 0,
          },
          current: B,
        })}
        hotelNames={HOTELS}
        onResumed={vi.fn()}
      />,
      hunit,
    );
    expect(screen.getByText(/faltam 2/)).toBeInTheDocument();
    expect(screen.getByText(/Verificando a reserva 7002 \(Hotel Praia\)/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Cancelar envio' }));
    expect(hunit.api.dispatches.cancel).toHaveBeenCalled();
  });

  it('encerrado com não verificadas: retomar abre o envio novo', async () => {
    const resumed = { ...dispatchFixture(), id: '77777777-7777-4777-8777-777777777777' };
    mocked(hunit.api.dispatches.resume).mockImplementation(() => okResult(resumed));
    const onResumed = vi.fn();
    const user = userEvent.setup();
    renderWithApp(
      <DispatchView
        dispatch={finished({ status: 'failed', endReason: 'hunit_unavailable' })}
        hotelNames={HOTELS}
        onResumed={onResumed}
      />,
      hunit,
    );
    expect(screen.getByText('O Hunit não respondeu.')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Retomar as não verificadas (1)' }));
    expect(onResumed).toHaveBeenCalledWith(resumed.id);
  });
});

describe('pedido de token do envio (research R-14)', () => {
  it('o mesmo diálogo, com "Envio ao Comercial", e o token vai para o envio', async () => {
    const user = userEvent.setup();
    renderWithApp(<TwoFactorDialog />, hunit);
    hunit.emit.twoFactorRequested({
      job: { kind: 'dispatch', id: '44444444-4444-4444-8444-444444444444' },
      deadline: new Date(Date.now() + 120_000).toISOString(),
      clockOffsetMs: 0,
    });
    expect(await screen.findByText('Envio ao Comercial')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/token do autenticador/i), '123456');
    await user.click(screen.getByRole('button', { name: /enviar token/i }));
    expect(hunit.api.dispatches.sendToken).toHaveBeenCalledWith({
      dispatchId: '44444444-4444-4444-8444-444444444444',
      token: '123456',
    });
    expect(hunit.api.executions.sendToken).not.toHaveBeenCalled();
  });
});

describe('visual novo do envio (specs/006, T050; telas 7.1 a 7.4)', () => {
  it('conferência estreita (7.1): "Cancelar" só texto, "Enviar N ao Comercial" principal', async () => {
    renderWithApp(
      <DispatchDialog reservations={[A, B]} hotelNames={HOTELS} onClose={vi.fn()} />,
      hunit,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Enviar ao Comercial' });
    await screen.findByTestId('dispatch-summary');

    expect(dialog).toHaveAttribute('data-size', 'sm');
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveAttribute(
      'data-variant',
      'text',
    );
    expect(within(dialog).getByRole('button', { name: 'Enviar 1 ao Comercial' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    // As que ficam de fora no resumo com o ícone âmbar e a quantidade (como no anexo em lote).
    expect(
      within(dialog)
        .getByText(/fica de fora/)
        .closest('[data-tone]'),
    ).toHaveAttribute('data-tone', 'amber');
    // O acesso ao Hunit na caixa cinza, com "Limpar acesso" em vermelho suave.
    expect(within(dialog).getByRole('button', { name: 'Limpar acesso' })).toHaveAttribute(
      'data-variant',
      'danger-light',
    );
    expectOnePrimaryPerBlock();
  });

  it('andamento largo (7.2): "Em andamento" em lima e "Cancelar envio" em vermelho suave', async () => {
    mocked(hunit.api.dispatches.get).mockImplementation(() =>
      okResult(
        dispatchFixture({
          status: 'running',
          counts: {
            total: 3,
            pending: 2,
            sent: 1,
            withdrawn: 0,
            notVerified: 0,
            ignored: 0,
            checked: 0,
          },
          current: B,
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithApp(
      <DispatchDialog reservations={[A]} hotelNames={HOTELS} onClose={vi.fn()} />,
      hunit,
    );
    await user.click(await screen.findByRole('button', { name: 'Enviar 1 ao Comercial' }));
    const view = await screen.findByTestId('dispatch-view');

    expect(screen.getByRole('dialog', { name: 'Enviar ao Comercial' })).toHaveAttribute(
      'data-size',
      'lg',
    );
    expect(within(view).getByText('Em andamento')).toHaveAttribute('data-tone', 'lime');
    expect(view).toHaveTextContent('1 de 3 verificadas — faltam 2');
    expect(view).toHaveTextContent('1 enviada · 0 retiradas · 0 não verificadas');
    expect(within(view).getByRole('progressbar', { name: 'Andamento do envio' })).toHaveAttribute(
      'aria-valuenow',
      '33',
    );
    expect(within(view).getByRole('button', { name: 'Cancelar envio' })).toHaveAttribute(
      'data-variant',
      'danger-light',
    );
    expect(screen.getByText(/Fechar não interrompe o envio/)).toBeInTheDocument();
    // Sem "Cancelar" nem outro botão no rodapé: fecha pelo X.
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });

  it('concluído (7.4): cada reserva numa linha com o hotel, o motivo e o selo; retomar é a principal', async () => {
    renderWithApp(
      <DispatchView dispatch={finished()} hotelNames={HOTELS} onResumed={vi.fn()} />,
      hunit,
    );
    const view = screen.getByTestId('dispatch-view');
    expect(within(view).getByText('Concluído')).toHaveAttribute('data-tone', 'green');

    const rows = within(
      within(view).getByRole('list', { name: 'Resultado de cada reserva' }),
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('7001Hotel PraiaEnviada');
    expect(rows[1]).toHaveTextContent(
      '7002Hotel Praia · não encontrada no Hunit no check-in registrado (03/11/2026)Não verificada',
    );
    expect(
      await within(view).findByRole('button', { name: 'Retomar as não verificadas (1)' }),
    ).toHaveAttribute('data-variant', 'primary');
  });
});
