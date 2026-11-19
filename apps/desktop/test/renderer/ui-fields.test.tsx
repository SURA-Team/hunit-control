/**
 * Campos de ui/ (specs/006, T010): rótulo, ajuda e erro ligados ao campo, os estados da caixa de
 * seleção (parcial = `aria-checked="mixed"`), escolhas e o calendário de período do design.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  CheckboxField,
  describePeriod,
  Field,
  PasswordField,
  PeriodPicker,
  RadioField,
  SelectField,
  SelectionBox,
  SwitchField,
  TextAreaField,
} from '../../src/renderer/src/ui';
import { renderUi } from './render';

describe('Field e PasswordField', () => {
  it('rótulo, ajuda e erro ficam ligados ao campo', () => {
    renderUi(
      <Field
        label="Endereço do servidor"
        description="Ex.: https://hunit.local"
        error="Informe o endereço"
      />,
    );
    const input = screen.getByLabelText('Endereço do servidor');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/Informe o endereço/);
  });

  it('a senha aparece e some pelo ícone do olho', async () => {
    const user = userEvent.setup();
    renderUi(<PasswordField label="Senha do Hunit" defaultValue="segredo" />);
    const input = screen.getByLabelText('Senha do Hunit');
    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Mostrar ou esconder a senha' }));
    expect(input).toHaveAttribute('type', 'text');
  });
});

describe('SelectField', () => {
  it('escolhe uma opção da lista', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(
      <SelectField
        label="Origem"
        data={[
          { value: 'all', label: 'Todas' },
          { value: 'legacy', label: 'Sistema anterior' },
        ]}
        value="all"
        onChange={onChange}
      />,
    );
    const input = screen.getAllByLabelText('Origem').find((element) => element.tagName === 'INPUT');
    await user.click(input as HTMLElement);
    await user.click(await screen.findByRole('option', { name: 'Sistema anterior' }));
    expect(onChange).toHaveBeenCalledWith('legacy', expect.anything());
  });
});

describe('SelectionBox', () => {
  it('desmarcada, marcada e parcial (aria-checked="mixed")', () => {
    renderUi(
      <>
        <SelectionBox aria-label="Reserva 1" checked={false} onChange={vi.fn()} />
        <SelectionBox aria-label="Reserva 2" checked onChange={vi.fn()} />
        <SelectionBox aria-label="Todas da página" checked indeterminate onChange={vi.fn()} />
      </>,
    );
    expect(screen.getByRole('checkbox', { name: 'Reserva 1' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Reserva 2' })).toBeChecked();
    const partial = screen.getByRole('checkbox', { name: 'Todas da página' });
    expect(partial).toHaveAttribute('aria-checked', 'mixed');
    expect(partial).toBePartiallyChecked();
  });

  it('o clique avisa a marcação', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(<SelectionBox aria-label="Reserva 1" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('checkbox', { name: 'Reserva 1' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('CheckboxField, RadioField e SwitchField', () => {
  it('o rótulo marca a caixa e liga a chave', async () => {
    const user = userEvent.setup();
    renderUi(
      <>
        <CheckboxField label="Só as não encontradas" />
        <SwitchField label="Som do aviso" />
      </>,
    );
    await user.click(screen.getByText('Só as não encontradas'));
    expect(screen.getByRole('checkbox', { name: 'Só as não encontradas' })).toBeChecked();
    await user.click(screen.getByText('Som do aviso'));
    expect(screen.getByRole('switch', { name: 'Som do aviso' })).toBeChecked();
  });

  it('o grupo de rádio tem nome e avisa a escolha', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(
      <RadioField
        label="Ativa ou cancelada"
        value="all"
        onChange={onChange}
        options={[
          { value: 'all', label: 'Ativas e canceladas' },
          { value: 'cancelled', label: 'Só canceladas' },
        ]}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Ativa ou cancelada' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Ativas e canceladas' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Só canceladas' }));
    expect(onChange).toHaveBeenCalledWith('cancelled');
  });
});

describe('PeriodPicker', () => {
  it('abre pelo campo, mostra o resumo e escolhe o fim do período', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(<PeriodPicker value={{ from: '2026-11-10', to: null }} onChange={onChange} />);
    const field = screen.getByLabelText('Período de check-in');
    expect(field).toHaveTextContent('10/11/2026 a …');

    await user.click(field);
    expect(await screen.findByText('Escolha a data final')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir para hoje' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: '12 novembro 2026' })[0] as HTMLElement);

    expect(onChange).toHaveBeenCalledWith({ from: '2026-11-10', to: '2026-11-12' });
  });

  it('limpa o período quando permitido', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(
      <PeriodPicker
        value={{ from: '2026-11-10', to: '2026-11-12' }}
        onChange={onChange}
        clearable
      />,
    );
    expect(screen.getByLabelText('Período de check-in')).toHaveTextContent(
      '10/11/2026 a 12/11/2026',
    );
    await user.click(screen.getByRole('button', { name: 'Limpar o período' }));
    expect(onChange).toHaveBeenCalledWith({ from: null, to: null });
  });

  it('describePeriod: o resumo do rodapé', () => {
    expect(describePeriod({ from: null, to: null })).toBe('Escolha a data inicial');
    expect(describePeriod({ from: '2026-11-13', to: '2026-11-19' })).toBe(
      '13/11 → 19/11/2026 · 6 noites',
    );
    expect(describePeriod({ from: '2026-11-13', to: '2026-11-14' })).toBe(
      '13/11 → 14/11/2026 · 1 noite',
    );
    expect(describePeriod({ from: '2026-12-28', to: '2027-01-03' })).toBe(
      '28/12/2026 → 03/01/2027 · 6 noites',
    );
    expect(describePeriod({ from: '2026-11-13', to: '2026-11-13' })).toBe('13/11/2026');
  });
});

describe('TextAreaField (T051; tela 7.6)', () => {
  it('o contador fica na linha do rótulo, fora do nome do campo; o erro fica ligado ao campo', () => {
    renderUi(
      <TextAreaField
        label="Motivo da recusa"
        value="Valor diferente"
        onChange={vi.fn()}
        counter="15/500"
        error="Informe o motivo da recusa."
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Motivo da recusa' });
    expect(field).toHaveValue('Valor diferente');
    expect(screen.getByText('15/500')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(/Informe o motivo da recusa./);
  });
});
