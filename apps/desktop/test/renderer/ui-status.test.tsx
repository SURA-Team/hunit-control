/**
 * Status e avisos de ui/ (specs/006, T011, FR-006, FR-021): o selo sempre com texto, a pilha de selos,
 * o aviso, a barra de progresso, os cards de número e o estado vazio.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  BatchSummary,
  CountCard,
  EmptyState,
  IndicatorCard,
  Notice,
  ProgressBar,
  ReasonList,
  SituationBadges,
  StatusBadge,
  SummaryLine,
  Surface,
} from '../../src/renderer/src/ui';
import { renderUi } from './render';

describe('StatusBadge e SituationBadges', () => {
  it('o selo leva o texto, o tom e a marca de "não cortar"', () => {
    renderUi(
      <StatusBadge tone="alert" title="O Hunit mudou a situação">
        Verificar
      </StatusBadge>,
    );
    const badge = screen.getByText('Verificar');
    expect(badge).toHaveAttribute('data-tone', 'alert');
    expect(badge).toHaveAttribute('data-no-truncate');
    expect(badge).toHaveAttribute('title', 'O Hunit mudou a situação');
  });

  it('os selos da reserva ficam empilhados, na ordem dada', () => {
    const { container } = renderUi(
      <SituationBadges
        items={[
          { label: 'Pendente de cobrança', tone: 'amber' },
          { label: 'Verificar', tone: 'alert' },
          { label: 'Sistema anterior', tone: 'gray' },
        ]}
      />,
    );
    expect([...container.querySelectorAll('[data-tone]')].map((b) => b.textContent)).toEqual([
      'Pendente de cobrança',
      'Verificar',
      'Sistema anterior',
    ]);
  });
});

describe('Notice', () => {
  it('título, mensagem e ação; anunciado como alerta por padrão', () => {
    renderUi(
      <Notice
        tone="red"
        title="Servidor indisponível"
        action={<button type="button">Tentar</button>}
      >
        Os dados podem estar desatualizados.
      </Notice>,
    );
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Servidor indisponível');
    expect(notice).toHaveTextContent('Os dados podem estar desatualizados.');
    expect(screen.getByRole('button', { name: 'Tentar' })).toBeInTheDocument();
  });

  it('pode ser só um status', () => {
    renderUi(
      <Notice tone="green" role="status">
        Conexão confirmada
      </Notice>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Conexão confirmada');
  });
});

describe('BatchSummary, SummaryLine e ReasonList (FR-024, tela 4.6)', () => {
  it('cada linha tem o tom e o ícone, e o texto diz o grupo e a quantidade', () => {
    renderUi(
      <BatchSummary data-testid="resumo">
        <SummaryLine tone="green">3 reservas aceitam o documento</SummaryLine>
        <SummaryLine tone="amber">1 será ignorada</SummaryLine>
        <SummaryLine tone="red">1 falhou</SummaryLine>
      </BatchSummary>,
    );
    const lines = [...screen.getByTestId('resumo').querySelectorAll('[data-tone]')];
    expect(lines.map((line) => [line.getAttribute('data-tone'), line.textContent])).toEqual([
      ['green', '3 reservas aceitam o documento'],
      ['amber', '1 será ignorada'],
      ['red', '1 falhou'],
    ]);
    // O ícone fica oculto do leitor de tela: o texto já diz o grupo (FR-006).
    for (const line of lines) {
      expect(line.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('a caixa lista cada reserva com o motivo; vazia, não aparece', () => {
    const { rerender } = renderUi(
      <ReasonList
        label="Reservas que ficam de fora"
        items={[
          { key: '1', title: '104-1015 (hotel 104)', reason: 'Esta reserva não exige cobrança.' },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Reservas que ficam de fora' });
    expect(list).toHaveTextContent('104-1015 (hotel 104)Esta reserva não exige cobrança.');

    rerender(<ReasonList label="Reservas que ficam de fora" items={[]} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('ProgressBar', () => {
  it('é uma barra de progresso acessível, limitada a 0–100', () => {
    renderUi(
      <>
        <ProgressBar value={50} label="Hotéis concluídos" />
        <Surface dark>
          <ProgressBar value={140} label="Reservas verificadas" />
        </Surface>
      </>,
    );
    const hotels = screen.getByRole('progressbar', { name: 'Hotéis concluídos' });
    expect(hotels).toHaveAttribute('aria-valuenow', '50');
    expect(hotels).toHaveAttribute('data-surface', 'light');
    const dispatch = screen.getByRole('progressbar', { name: 'Reservas verificadas' });
    expect(dispatch).toHaveAttribute('aria-valuenow', '100');
    expect(dispatch).toHaveAttribute('data-surface', 'dark');
  });
});

describe('CountCard e IndicatorCard', () => {
  it('mostram o rótulo e o número grande, que nunca é cortado', () => {
    renderUi(
      <>
        <CountCard tone="amber" label="Pendentes de cobrança" value="12" />
        <IndicatorCard label="Reservas" value="34.526" help="Total no recorte" />
      </>,
    );
    expect(screen.getByText('Pendentes de cobrança')).toBeInTheDocument();
    expect(screen.getByText('12')).toHaveAttribute('data-no-truncate');
    expect(screen.getByText('34.526')).toHaveAttribute('data-no-truncate');
    expect(screen.getByText('Total no recorte')).toBeInTheDocument();
  });
});

describe('EmptyState (FR-021)', () => {
  it('sem busca nem filtro, só a explicação', () => {
    renderUi(
      <EmptyState title="Nenhuma reserva encontrada" description="Ainda não há reservas." />,
    );
    expect(screen.getByText('Nenhuma reserva encontrada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Limpar busca e filtros' })).toBeNull();
  });

  it('com busca ou filtro, oferece "Limpar busca e filtros"', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderUi(<EmptyState title="Nenhuma reserva encontrada" onClear={onClear} />);
    await user.click(screen.getByRole('button', { name: 'Limpar busca e filtros' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
