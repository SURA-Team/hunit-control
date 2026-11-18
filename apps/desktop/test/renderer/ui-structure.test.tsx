/**
 * Estrutura de ui/ (specs/006, T012, T015, FR-042, FR-047): card como bloco, cabeçalho da página, as
 * duas larguras do diálogo, o fechar acessível, a gaveta e a regra de uma ação principal por bloco.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Action,
  AppDialog,
  AppDrawer,
  Card,
  PageHeader,
  SectionTitle,
} from '../../src/renderer/src/ui';
import { expectOnePrimaryPerBlock } from './hierarchy';
import { renderUi } from './render';

describe('Card e PageHeader', () => {
  it('o card é um bloco, com o espaçamento escolhido', () => {
    const { container } = renderUi(
      <Card block="Acesso ao Hunit" padding={24}>
        conteúdo
      </Card>,
    );
    const card = container.querySelector('[data-block]');
    expect(card).toHaveAttribute('data-block', 'Acesso ao Hunit');
    expect(card).toHaveAttribute('data-padding', '24');
  });

  it('título da página, subtítulo, ação e título de seção', () => {
    renderUi(
      <>
        <PageHeader
          title="Comercial"
          subtitle="Envios das reservas para a planilha do Comercial."
          action={<Action variant="secondary">Copiar para e-mail</Action>}
        />
        <SectionTitle>Histórico</SectionTitle>
      </>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Comercial' })).toBeInTheDocument();
    expect(
      screen.getByText('Envios das reservas para a planilha do Comercial.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar para e-mail' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Histórico' })).toBeInTheDocument();
  });
});

describe('AppDialog', () => {
  it.each([
    ['sm', '32.5rem'],
    ['lg', '48.75rem'],
  ] as const)('a largura %s é a do design', (size, rem) => {
    renderUi(
      <AppDialog opened onClose={vi.fn()} title="Cancelar a execução?" size={size}>
        conteúdo
      </AppDialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Cancelar a execução?' });
    expect(dialog).toHaveAttribute('data-size', size);
    expect(dialog).toHaveAttribute('data-block');
    const root = dialog.closest<HTMLElement>('.mantine-Modal-root');
    expect(root?.getAttribute('style')).toContain(rem);
  });

  it('fechar acessível e "Cancelar" em texto à esquerda da principal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCancel = vi.fn();
    renderUi(
      <AppDialog
        opened
        onClose={onClose}
        title="Anexar comprovante"
        size="lg"
        onCancel={onCancel}
        actions={
          <Action variant="primary" size="sm">
            Confirmar
          </Action>
        }
      >
        conteúdo
      </AppDialog>,
    );
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    const confirm = screen.getByRole('button', { name: 'Confirmar' });
    expect(cancel).toHaveAttribute('data-variant', 'text');
    expect(cancel.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Fechar o diálogo' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expectOnePrimaryPerBlock();
  });

  it('o diálogo escuro (token) põe a principal em lima', () => {
    renderUi(
      <AppDialog
        opened
        onClose={vi.fn()}
        title="O Hunit pediu o token"
        dark
        withCloseButton={false}
      >
        <Action variant="primary" size="sm">
          Enviar token
        </Action>
      </AppDialog>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('data-dark');
    expect(screen.getByRole('button', { name: 'Enviar token' })).toHaveAttribute(
      'data-surface',
      'dark',
    );
    expect(screen.queryByRole('button', { name: 'Fechar o diálogo' })).toBeNull();
  });
});

describe('AppDrawer', () => {
  it('mostra o título e fecha pelo botão "Fechar"', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(
      <AppDrawer opened onClose={onClose} title="Detalhe da reserva">
        <Card padding={16}>Tratativa</Card>
      </AppDrawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Detalhe da reserva' })).toBeInTheDocument();
    expect(screen.getByText('Tratativa')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('uma ação principal por bloco (FR-007)', () => {
  it('aceita uma principal por card, mesmo com vários cards', () => {
    const { container } = renderUi(
      <>
        <Card block="Acesso">
          <Action variant="primary">Guardar acesso</Action>
          <Action variant="danger-light">Limpar acesso</Action>
        </Card>
        <Card block="Consulta">
          <Action variant="primary">Iniciar execução</Action>
        </Card>
      </>,
    );
    expect(() => expectOnePrimaryPerBlock(container)).not.toThrow();
  });

  it('acusa duas principais no mesmo bloco', () => {
    const { container } = renderUi(
      <Card block="Tratativa">
        <Action variant="primary">Anexar tratativa</Action>
        <Action variant="primary">Anexar comprovante</Action>
      </Card>,
    );
    expect(() => expectOnePrimaryPerBlock(container)).toThrow(/Tratativa/);
  });
});
