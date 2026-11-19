/**
 * Diálogos padronizados (specs/006, T023, SC-009, FR-042, research R-14): cada diálogo do app é um
 * `AppDialog`, com uma das duas larguras (`sm` = 520 px, `lg` = 780 px), os 24 px de espaçamento e um
 * título no estilo "Título do diálogo". O tamanho na tela e o espaçamento calculado são conferidos no
 * roteiro de larguras (`test/e2e/responsive.test.ts`); aqui, que todos passam pelo mesmo componente.
 *
 * Cada história acrescenta em `DIALOGS` os diálogos que migrar (recusar retorno, confirmações em
 * lote, cópia para e-mail…). Hoje: o token, "Remover a configuração?", desde a US3 anexar (uma reserva
 * e lote), "Desfazer o comprovante?" e "Cancelar a execução?" e, desde a US8, o envio ao Comercial
 * (conferência e andamento), a recusa do retorno, "Desfazer o envio ao Comercial?", as confirmações
 * em lote (retornos e "Verificar") e a cópia para e-mail.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoFactorDialog } from '../../src/renderer/src/components/TwoFactorDialog';
import { DispatchDialog } from '../../src/renderer/src/screens/dispatch/DispatchDialog';
import { ExecutionDetail } from '../../src/renderer/src/screens/executions/ExecutionDetail';
import { AttachDialog } from '../../src/renderer/src/screens/reservations/AttachDialog';
import { CommercialSection } from '../../src/renderer/src/screens/reservations/CommercialSection';
import { ConfirmBatchDialog } from '../../src/renderer/src/screens/reservations/ConfirmBatchDialog';
import { CopyDialog } from '../../src/renderer/src/screens/reservations/CopyDialog';
import { toSelected } from '../../src/renderer/src/state/selection';
import { ReservationDetail } from '../../src/renderer/src/screens/reservations/ReservationDetail';
import { SetupScreen } from '../../src/renderer/src/screens/setup/SetupScreen';
import classes from '../../src/renderer/src/ui/structure.module.css';
import type { Execution, PublicConfig } from '../../src/shared/ipc-types';
import { dispatchFixture } from '../helpers/commercial-fixtures';
import { detail as commercialDetail, returnBrief, selectionItem } from './commercial-fixtures';
import { fakeHunit, mocked, okResult, renderWithApp, type FakeHunit } from './render';
import {
  check,
  detail,
  document as treatmentDocument,
  outcome,
  pendingReservation,
  pickedFile,
  treatment,
} from './treatment-fixtures';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const EXECUTION_ID = '11111111-1111-4111-8111-111111111111';

/** Classes do `AppDialog` no conteúdo e no título. */
const DIALOG_CONTENT = classes.dialogContent ?? '';
const DIALOG_TITLE = classes.dialogTitle ?? '';

/** Largura de cada tamanho, como o Mantine a escreve (px ÷ 16). */
const WIDTHS = { sm: '32.5rem', lg: '48.75rem' } as const;

const CONFIG: PublicConfig = {
  serverUrl: 'https://192.168.0.50',
  certificatePem: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n',
  certificate: {
    fingerprint256: 'AB:CD:EF:01',
    subject: 'CN=Caddy Local Authority - 2026 ECC Root',
    issuer: 'CN=Caddy Local Authority - 2026 ECC Root',
    validTo: '2036-11-10T00:00:00.000Z',
    isCertificateAuthority: true,
  },
  hasApiKey: true,
  preferences: { soundEnabled: true, idleHours: 8 },
};

let hunit: FakeHunit;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  hunit = fakeHunit();
});

afterEach(() => {
  vi.useRealTimers();
});

function requestToken() {
  act(() =>
    hunit.emit.twoFactorRequested({
      job: { kind: 'execution', id: EXECUTION_ID },
      deadline: new Date(NOW.getTime() + 120_000).toISOString(),
      clockOffsetMs: 0,
    }),
  );
}

interface DialogCase {
  /** Nome acessível do diálogo (o título). */
  title: string;
  /** Largura do design. */
  size: keyof typeof WIDTHS;
  /** Renderiza a tela e abre o diálogo. */
  open: () => Promise<void>;
}

const DIALOGS: Record<string, DialogCase> = {
  'token — pedido (tela 2.4)': {
    title: 'O Hunit pediu o token',
    size: 'sm',
    open: async () => {
      renderWithApp(<TwoFactorDialog />, hunit);
      requestToken();
      await screen.findByLabelText(/token do autenticador/i);
    },
  },
  'token — desfecho (tela 2.5)': {
    title: 'O Hunit pediu o token',
    size: 'sm',
    open: async () => {
      renderWithApp(<TwoFactorDialog />, hunit);
      requestToken();
      await screen.findByLabelText(/token do autenticador/i);
      act(() =>
        hunit.emit.twoFactorClosed({
          job: { kind: 'execution', id: EXECUTION_ID },
          reason: 'accepted',
        }),
      );
      await screen.findByText(/token aceito/i);
    },
  },
  'remover a configuração (tela 1.3)': {
    title: 'Remover a configuração?',
    size: 'sm',
    open: async () => {
      mocked(hunit.api.connection.getConfig).mockImplementation(() => okResult(CONFIG));
      renderWithApp(<SetupScreen />, hunit);
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('button', { name: /remover a configuração desta máquina/i }),
      );
    },
  },
  'anexar tratativa (tela 4.8)': {
    title: 'Anexar tratativa',
    size: 'lg',
    open: async () => {
      serveAttach();
      renderWithApp(
        <AttachDialog kind="request" reservations={[RESERVATION]} onClose={vi.fn()} />,
        hunit,
      );
      await screen.findByTestId('attach-summary');
    },
  },
  'anexar comprovante em lote (tela 4.6)': {
    title: 'Anexar comprovante a 2 reservas',
    size: 'lg',
    open: async () => {
      serveAttach();
      renderWithApp(
        <AttachDialog
          kind="proof"
          reservations={[RESERVATION, { ...RESERVATION, reservationNumber: '7002' }]}
          onClose={vi.fn()}
        />,
        hunit,
      );
      await screen.findByTestId('attach-summary');
    },
  },
  'desfazer o comprovante (tela 4.7)': {
    title: 'Desfazer o comprovante?',
    size: 'sm',
    open: async () => {
      const proof = treatmentDocument();
      const current = treatment({ status: 'charged', proof });
      mocked(hunit.api.treatments.get).mockImplementation(() =>
        okResult(detail({ treatment: current, documents: [proof] })),
      );
      renderWithApp(
        <ReservationDetail reservation={pendingReservation('7001', { treatment: current })} />,
        hunit,
      );
      await waitFor(() => expect(hunit.api.connection.getState).toHaveBeenCalled());
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Desfazer' }));
    },
  },
  'envio ao Comercial — conferência (tela 7.1)': {
    title: 'Enviar ao Comercial',
    size: 'sm',
    open: async () => {
      serveDispatch();
      renderWithApp(
        <DispatchDialog reservations={[RESERVATION]} hotelNames={new Map()} onClose={vi.fn()} />,
        hunit,
      );
      await screen.findByTestId('dispatch-summary');
    },
  },
  'envio ao Comercial — andamento (tela 7.2)': {
    title: 'Enviar ao Comercial',
    size: 'lg',
    open: async () => {
      serveDispatch();
      renderWithApp(
        <DispatchDialog reservations={[RESERVATION]} hotelNames={new Map()} onClose={vi.fn()} />,
        hunit,
      );
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Enviar 1 ao Comercial' }));
      await screen.findByTestId('dispatch-view');
    },
  },
  'recusar o retorno do Comercial (tela 7.6)': {
    title: 'Recusar o retorno do Comercial',
    size: 'sm',
    open: async () => {
      mocked(hunit.api.commercial.get).mockImplementation(() => okResult(commercialDetail()));
      renderWithApp(<CommercialSection reservation={pendingReservation('7001')} />, hunit);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Recusar' }));
    },
  },
  'desfazer o envio ao Comercial (tela 7.5)': {
    title: 'Desfazer o envio ao Comercial?',
    size: 'sm',
    open: async () => {
      mocked(hunit.api.commercial.get).mockImplementation(() => okResult(commercialDetail()));
      renderWithApp(<CommercialSection reservation={pendingReservation('7001')} />, hunit);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Desfazer envio' }));
    },
  },
  'confirmar retornos em lote (tela 7.12)': {
    title: 'Confirmar retornos do Comercial',
    size: 'lg',
    open: async () => {
      renderWithApp(
        <ConfirmBatchDialog
          kind="returns"
          items={[toSelected(selectionItem('7001', { currentReturn: returnBrief() }))]}
          hotelNames={new Map()}
          onClose={vi.fn()}
        />,
        hunit,
      );
      await screen.findByTestId('batch-summary');
    },
  },
  'confirmar "Verificar" em lote (tela 7.13)': {
    title: 'Confirmar "Verificar"',
    size: 'sm',
    open: async () => {
      renderWithApp(
        <ConfirmBatchDialog
          kind="reviews"
          items={[toSelected(selectionItem('7001', { needsReview: true }))]}
          hotelNames={new Map()}
          onClose={vi.fn()}
        />,
        hunit,
      );
      await screen.findByTestId('batch-summary');
    },
  },
  'copiar para e-mail (tela 7.14)': {
    title: 'Copiar para e-mail',
    size: 'sm',
    open: async () => {
      renderWithApp(
        <CopyDialog
          filters={{}}
          hotels={[]}
          hotelNames={new Map()}
          selected={[toSelected(selectionItem('7001'))]}
          onClose={vi.fn()}
        />,
        hunit,
      );
      await screen.findByText('O que copiar');
    },
  },
  'cancelar a execução (tela 3.3)': {
    title: 'Cancelar a execução?',
    size: 'sm',
    open: async () => {
      mocked(hunit.api.executions.get).mockImplementation(() => okResult(RUNNING_EXECUTION));
      renderWithApp(
        <ExecutionDetail
          executionId={EXECUTION_ID}
          onOpenExecution={vi.fn()}
          onOpenReservations={vi.fn()}
        />,
        hunit,
      );
      const user = userEvent.setup();
      const cancel = await screen.findByRole('button', { name: 'Cancelar execução' });
      // Habilita quando o perfil da conexão chega.
      await waitFor(() => expect(cancel).toBeEnabled());
      await user.click(cancel);
    },
  },
};

const RESERVATION = { hotelCode: '31', reservationNumber: '7001' };

/** Arquivo escolhido e conferência do servidor para o diálogo de anexar. */
function serveAttach() {
  URL.createObjectURL = vi.fn(() => 'blob:teste');
  URL.revokeObjectURL = vi.fn();
  mocked(hunit.api.treatments.pickFile).mockImplementation(() => okResult(pickedFile()));
  mocked(hunit.api.treatments.check).mockImplementation((input) =>
    okResult(
      check(
        input.reservations.map((reservation) => outcome(reservation.reservationNumber)),
        '100.00',
      ),
    ),
  );
}

/** Conferência com uma reserva aceita, acesso guardado e o envio em andamento. */
function serveDispatch() {
  mocked(hunit.api.credentials.status).mockImplementation(() =>
    okResult({ username: 'operador@hotel.test', hasPassword: true }),
  );
  mocked(hunit.api.dispatches.check).mockImplementation(() =>
    okResult({
      eligible: [{ ...RESERVATION, totalAmount: '100.00', resend: false }],
      ignored: [],
      totalAmount: '100.00',
    }),
  );
  mocked(hunit.api.dispatches.start).mockImplementation(() => okResult(dispatchFixture()));
  mocked(hunit.api.dispatches.get).mockImplementation(() =>
    okResult(dispatchFixture({ status: 'running' })),
  );
}

const RUNNING_EXECUTION: Execution = {
  id: EXECUTION_ID,
  status: 'running',
  period: { from: '2026-11-01', to: '2026-11-07' },
  createdAt: '2026-11-12T11:00:00.000Z',
  requestedClient: 'desktop-financeiro',
  endReason: null,
  finishedAt: null,
  twoFactorDeadline: null,
  current: null,
  hotels: [],
  counts: {},
  recentEvents: [],
  warnings: [],
};

/** O diálogo é um `AppDialog` com a largura `size`, os 24 px de espaçamento e o título padrão. */
function expectStandard(dialog: HTMLElement, size?: keyof typeof WIDTHS): void {
  const name = dialog.getAttribute('aria-labelledby');
  const title = name ? document.getElementById(name) : null;
  expect(title?.textContent?.trim(), 'diálogo sem título').toBeTruthy();
  expect(title).toHaveClass(DIALOG_TITLE);

  expect(dialog, 'diálogo fora do AppDialog').toHaveClass(DIALOG_CONTENT);
  const actual = dialog.getAttribute('data-size');
  expect(Object.keys(WIDTHS)).toContain(actual);
  if (size) expect(actual).toBe(size);

  const root = dialog.closest<HTMLElement>('.mantine-Modal-root');
  const style = root?.getAttribute('style') ?? '';
  // O Mantine escreve as medidas como `calc(<rem> * var(--mantine-scale))`.
  expect(style).toContain(`--modal-size: calc(${WIDTHS[actual as keyof typeof WIDTHS]} `);
  expect(style).toContain('--mb-padding: calc(1.5rem ');
}

describe('diálogos padronizados (SC-009, FR-042)', () => {
  it.each(Object.entries(DIALOGS))('%s', async (_, { title, size, open }) => {
    await open();

    expectStandard(await screen.findByRole('dialog', { name: title }), size);
    // Nenhum outro diálogo fora do padrão aberto junto.
    for (const dialog of screen.getAllByRole('dialog')) expectStandard(dialog);
  });

  it('acusa um diálogo fora do padrão', () => {
    // As classes do módulo CSS existem no teste (senão a comparação passaria à toa).
    expect(DIALOG_CONTENT).toMatch(/\w/);
    expect(DIALOG_TITLE).toMatch(/\w/);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-labelledby', 'titulo-fora-do-padrao');
    dialog.setAttribute('data-size', 'sm');
    dialog.innerHTML = `<h2 id="titulo-fora-do-padrao" class="${DIALOG_TITLE}">Outro</h2>`;
    document.body.appendChild(dialog);
    try {
      expect(() => expectStandard(dialog)).toThrow(/fora do AppDialog/);
    } finally {
      dialog.remove();
    }
  });
});
