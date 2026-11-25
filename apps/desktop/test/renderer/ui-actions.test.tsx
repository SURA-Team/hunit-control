/**
 * Ações de ui/ (specs/006, T009, FR-007 a FR-013, research R-06): variantes fechadas, principal lima
 * em superfície escura, ações de documento distintas, botão com menu pelo teclado e o chip com a
 * contagem abreviada.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Action,
  DocumentAction,
  FilterChip,
  MenuButton,
  Surface,
  type ActionVariant,
  type DocumentActionKind,
} from '../../src/renderer/src/ui';
import { renderUi } from './render';

const VARIANTS: ActionVariant[] = [
  'primary',
  'secondary',
  'text',
  'warning',
  'danger-light',
  'danger',
];

describe('Action', () => {
  it.each(VARIANTS)('a variante %s fica no elemento, para o teste de hierarquia', (variant) => {
    renderUi(<Action variant={variant}>Confirmar</Action>);
    const button = screen.getByRole('button', { name: 'Confirmar' });
    expect(button).toHaveAttribute('data-variant', variant);
    expect(button).toHaveAttribute('data-size', 'md');
    expect(button).toHaveAttribute('data-no-truncate');
  });

  it('a principal sabe se está numa superfície escura (lima) ou clara (preta)', () => {
    renderUi(
      <>
        <Action variant="primary">Salvar</Action>
        <Surface dark>
          <Action variant="primary">Enviar token</Action>
        </Surface>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('data-surface', 'light');
    expect(screen.getByRole('button', { name: 'Enviar token' })).toHaveAttribute(
      'data-surface',
      'dark',
    );
  });

  it('chama a ação no clique e não chama quando desabilitada', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = renderUi(
      <Action variant="secondary" size="xs" onClick={onClick}>
        Testar
      </Action>,
    );
    await user.click(screen.getByRole('button', { name: 'Testar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Action variant="secondary" size="xs" onClick={onClick} disabled>
        Testar
      </Action>,
    );
    await user.click(screen.getByRole('button', { name: 'Testar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('DocumentAction (FR-010)', () => {
  const KINDS: [DocumentActionKind, string][] = [
    ['download', 'Baixar'],
    ['revert', 'Reverter'],
    ['undo', 'Desfazer'],
    ['remove', 'Remover valor'],
  ];

  it('os quatro tipos têm rótulos, tipos e ícones diferentes', () => {
    renderUi(
      <>
        {KINDS.map(([kind]) => (
          <DocumentAction key={kind} kind={kind} />
        ))}
      </>,
    );
    const icons = KINDS.map(([kind, label]) => {
      const button = screen.getByRole('button', { name: label });
      expect(button).toHaveAttribute('data-kind', kind);
      return button.querySelector('path')?.getAttribute('d');
    });
    expect(new Set(icons).size).toBe(KINDS.length);
  });

  it('aceita outro rótulo sem mudar o tipo', () => {
    renderUi(<DocumentAction kind="download">Baixar comprovante</DocumentAction>);
    expect(screen.getByRole('button', { name: 'Baixar comprovante' })).toHaveAttribute(
      'data-kind',
      'download',
    );
  });
});

describe('MenuButton', () => {
  it('abre pelo teclado, navega pelas setas e executa a opção', async () => {
    const user = userEvent.setup();
    const attachTreatment = vi.fn();
    const attachProof = vi.fn();
    renderUi(
      <MenuButton
        label="Anexar"
        items={[
          { label: 'Tratativa (e-mail)', onClick: attachTreatment },
          { label: 'Comprovante', onClick: attachProof },
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Anexar' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');

    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Tratativa (e-mail)' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Comprovante' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(attachProof).toHaveBeenCalledTimes(1);
    expect(attachTreatment).not.toHaveBeenCalled();
  });

  it('desabilitado não abre', async () => {
    const user = userEvent.setup();
    renderUi(
      <MenuButton label="Confirmar" items={[{ label: 'Retornos', onClick: vi.fn() }]} disabled />,
    );
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('FilterChip', () => {
  it('diz qual filtro está em vigor e abrevia a contagem, com o número inteiro na dica', () => {
    renderUi(
      <>
        <FilterChip label="Todas" count={12345} active />
        <FilterChip label="Falta cobrar" count={12} active={false} />
      </>,
    );
    const all = screen.getByRole('button', { name: /Todas/ });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    const count = screen.getByTitle('12.345');
    expect(count.textContent?.replace(/\s/g, ' ')).toBe('12,3 mil');
    expect(screen.getByRole('button', { name: /Falta cobrar/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('sem contagem (carregando), só o rótulo; o clique troca o filtro', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderUi(<FilterChip label="Com erro" active={false} onClick={onClick} />);
    const chip = screen.getByRole('button', { name: 'Com erro' });
    expect(chip.querySelector('[title]')).toBeNull();
    await user.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
