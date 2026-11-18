/**
 * Aviso do estado da conexão e dos dados antigos (specs/002, T031, FR-002, FR-005, research R-08).
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionBanner } from '../../src/renderer/src/components/ConnectionBanner';
import { StaleDataNotice } from '../../src/renderer/src/components/StaleDataNotice';
import type { ConnectionState, ConnectionStatus } from '../../src/shared/ipc-types';
import { renderWithApp } from './render';

function state(status: ConnectionStatus): ConnectionState {
  return { status, client: null, checkedAt: '2026-11-12T12:00:00.000Z' };
}

describe('ConnectionBanner', () => {
  it('online não mostra aviso', () => {
    renderWithApp(
      <div data-testid="banner">
        <ConnectionBanner
          state={{ ...state('online'), client: { name: 'x', role: 'operator' } }}
          onOpenSetup={vi.fn()}
        />
      </div>,
    );

    expect(screen.getByTestId('banner')).toBeEmptyDOMElement();
  });

  it('indisponível mostra o aviso e que tenta reconectar sozinho (FR-005)', () => {
    renderWithApp(<ConnectionBanner state={state('offline')} onOpenSetup={vi.fn()} />);

    expect(screen.getByText(/servidor indisponível/i)).toBeInTheDocument();
    expect(screen.getByText(/reconectar/i)).toBeInTheDocument();
  });

  it.each([
    ['untrusted_server', /não foi possível confirmar a identidade do servidor/i],
    ['unauthorized', /chave de acesso recusada/i],
  ] as const)('%s leva à configuração, sem opção de continuar (FR-002)', async (status, text) => {
    const onOpenSetup = vi.fn();
    renderWithApp(<ConnectionBanner state={state(status)} onOpenSetup={onOpenSetup} />);

    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continuar|ignorar/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /abrir configuração/i }));
    expect(onOpenSetup).toHaveBeenCalled();
  });
});

describe('ConnectionBanner no visual novo (specs/006, T017)', () => {
  it.each([
    ['offline', 'amber', 'status'],
    ['connecting', 'lime', 'status'],
    ['not_configured', 'lime', 'status'],
    ['untrusted_server', 'red', 'alert'],
    ['unauthorized', 'red', 'alert'],
  ] as const)('%s: alerta %s, anunciado como %s', (status, tone, role) => {
    renderWithApp(<ConnectionBanner state={state(status)} onOpenSetup={vi.fn()} />);
    expect(screen.getByRole(role)).toHaveAttribute('data-tone', tone);
  });

  it('"Abrir configuração" é uma ação secundária, não a principal', () => {
    renderWithApp(<ConnectionBanner state={state('unauthorized')} onOpenSetup={vi.fn()} />);
    expect(screen.getByRole('button', { name: /abrir configuração/i })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
  });
});

describe('StaleDataNotice', () => {
  it('é um aviso âmbar compacto, anunciado como status', () => {
    renderWithApp(<StaleDataNotice updatedAt={new Date(2026, 10, 12, 9, 5).getTime()} offline />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveAttribute('data-tone', 'amber');
    expect(notice).toHaveAttribute('data-compact');
  });

  it('com o servidor indisponível, mostra o horário dos dados', () => {
    const updatedAt = new Date(2026, 10, 12, 9, 5).getTime();
    renderWithApp(<StaleDataNotice updatedAt={updatedAt} offline />);

    expect(screen.getByText('dados de 09:05 — servidor indisponível')).toBeInTheDocument();
  });

  it('online, não mostra nada', () => {
    renderWithApp(
      <div data-testid="notice">
        <StaleDataNotice updatedAt={Date.now()} offline={false} />
      </div>,
    );

    expect(screen.getByTestId('notice')).toBeEmptyDOMElement();
  });

  it('sem dados carregados, não mostra horário', () => {
    renderWithApp(
      <div data-testid="notice">
        <StaleDataNotice updatedAt={0} offline />
      </div>,
    );

    expect(screen.getByTestId('notice')).toBeEmptyDOMElement();
  });
});
