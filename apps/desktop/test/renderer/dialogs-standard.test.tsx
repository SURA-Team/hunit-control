/**
 * Diálogos padronizados (specs/006, T023, SC-009, FR-042, research R-14): cada diálogo do app é um
 * `AppDialog`, com uma das duas larguras (`sm` = 520 px, `lg` = 780 px), os 24 px de espaçamento e um
 * título no estilo "Título do diálogo". O tamanho na tela e o espaçamento calculado são conferidos no
 * roteiro de larguras (`test/e2e/responsive.test.ts`); aqui, que todos passam pelo mesmo componente.
 *
 * Cada história acrescenta em `DIALOGS` os diálogos que migrar (anexar, recusar retorno, confirmações
 * em lote, cópia para e-mail, envio, cancelar execução…). Hoje: o token e "Remover a configuração?".
 */
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoFactorDialog } from '../../src/renderer/src/components/TwoFactorDialog';
import { SetupScreen } from '../../src/renderer/src/screens/setup/SetupScreen';
import classes from '../../src/renderer/src/ui/structure.module.css';
import type { PublicConfig } from '../../src/shared/ipc-types';
import { fakeHunit, mocked, okResult, renderWithApp, type FakeHunit } from './render';

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
