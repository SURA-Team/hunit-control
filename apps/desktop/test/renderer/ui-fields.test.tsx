/**
 * Campos de ui/ (specs/006, T010): rótulo, ajuda e erro ligados ao campo, os estados da caixa de
 * seleção (parcial = `aria-checked="mixed"`), escolhas e o calendário de período do design. Da 008
 * (US5): o Switch ligado e desligado pelo teclado e o controle de volume; e (T035, R-11) a busca
 * pelo teclado nos seletores, sem acento e sem maiúsculas, com "Nenhuma opção encontrada".
 */
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  CheckboxField,
  describePeriod,
  Field,
  MultiSelectField,
  PasswordField,
  PeriodPicker,
  RadioField,
  SelectField,
  SelectionBox,
  SwitchField,
  TextAreaField,
  VolumeField,
} from '../../src/renderer/src/ui';
import { searchKey } from '../../src/renderer/src/ui/fields/shared';
import { formatVolume } from '../../src/renderer/src/ui/fields/VolumeField';
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

describe('busca pelo teclado nos seletores (specs/008, T035, R-11)', () => {
  const ORIGINS = [
    { value: 'all', label: 'Todas' },
    { value: 'legacy', label: 'Sistema anterior' },
    { value: 'sp', label: 'São Paulo' },
  ];
  const inputOf = (label: string) =>
    screen.getAllByLabelText(label).find((element) => element.tagName === 'INPUT') as HTMLElement;

  it('a chave de busca ignora acentos, maiúsculas e espaços nas pontas', () => {
    expect(searchKey('  São PAULO ')).toBe('sao paulo');
    expect(searchKey('Pendente de cobrança')).toBe('pendente de cobranca');
  });

  it('SelectField: digitar filtra sem acento, setas e Enter escolhem', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(<SelectField label="Origem" data={ORIGINS} value="all" onChange={onChange} />);
    act(() => inputOf('Origem').focus());
    await user.keyboard('sao');
    expect(await screen.findByRole('option', { name: 'São Paulo' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Sistema anterior' })).not.toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('sp', expect.anything());
  });

  it('SelectField: texto sem opção mostra a mensagem; Esc fecha sem mudar o valor', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(<SelectField label="Origem" data={ORIGINS} value="all" onChange={onChange} />);
    act(() => inputOf('Origem').focus());
    await user.keyboard('xyz');
    expect(await screen.findByText('Nenhuma opção encontrada')).toBeInTheDocument();
    await user.keyboard('{Enter}{Escape}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('MultiSelectField: digitar, setas e Enter escolhem; a mensagem quando nada combina', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(
      <MultiSelectField
        label="Hotéis"
        data={[
          { value: '31', label: 'Hotel Praia (31)' },
          { value: '32', label: 'Pousada São Jorge (32)' },
        ]}
        value={[]}
        onChange={onChange}
      />,
    );
    act(() => inputOf('Hotéis').focus());
    await user.keyboard('SAO JORGE');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith(['32']);
    await user.keyboard('nenhum');
    expect(await screen.findByText('Nenhuma opção encontrada')).toBeInTheDocument();
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

describe('SwitchField: ligado e desligado (specs/008, US5-1)', () => {
  it('começa desligado ou ligado conforme o valor e alterna pelo teclado (Espaço)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderUi(
      <SwitchField label="Tocar som do aviso" checked={false} onChange={onChange} />,
    );
    const toggle = screen.getByRole('switch', { name: 'Tocar som do aviso' });
    expect(toggle).not.toBeChecked();

    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(1);

    rerender(<SwitchField label="Tocar som do aviso" checked onChange={onChange} />);
    expect(screen.getByRole('switch', { name: 'Tocar som do aviso' })).toBeChecked();
  });

  it('desabilitado não alterna', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(<SwitchField label="Tocar som do aviso" disabled onChange={onChange} />);
    await user.click(screen.getByRole('switch', { name: 'Tocar som do aviso' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('VolumeField (specs/008, US5-2 e US5-3)', () => {
  function renderVolume(value: number, disabled = false) {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    const view = renderUi(
      <VolumeField
        value={value}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
        disabled={disabled}
      />,
    );
    return { ...view, onChange, onChangeEnd, slider: screen.getByRole('slider') };
  }

  it('mostra o rótulo, o valor em porcentagem e o nome para o leitor de tela', () => {
    const { slider } = renderVolume(70);
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('70 %')).toBeInTheDocument();
    expect(slider).toHaveAccessibleName('Volume do aviso');
    expect(slider).toHaveAttribute('aria-valuenow', '70');
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '100');
    expect(slider).toHaveAttribute('aria-valuetext', '70 %');
  });

  it('setas mudam 5; Page Up e Page Down mudam 10; Home e End vão a 0 e 100', async () => {
    const user = userEvent.setup();
    const { slider, onChange, onChangeEnd } = renderVolume(50);
    slider.focus();
    expect(slider).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(55);
    expect(onChangeEnd).toHaveBeenLastCalledWith(55);
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(45);
    await user.keyboard('{PageUp}');
    expect(onChange).toHaveBeenLastCalledWith(60);
    expect(onChangeEnd).toHaveBeenLastCalledWith(60);
    await user.keyboard('{PageDown}');
    expect(onChange).toHaveBeenLastCalledWith(40);
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(0);
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it('Page Up não passa de 100 nem Page Down de 0', async () => {
    const user = userEvent.setup();
    const { slider, onChange, rerender } = renderVolume(95);
    slider.focus();
    await user.keyboard('{PageUp}');
    expect(onChange).toHaveBeenLastCalledWith(100);
    rerender(<VolumeField value={5} onChange={onChange} />);
    screen.getByRole('slider').focus();
    await user.keyboard('{PageDown}');
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('desabilitado não muda pelo teclado', async () => {
    const user = userEvent.setup();
    const { slider, onChange } = renderVolume(70, true);
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    slider.focus();
    await user.keyboard('{ArrowRight}{PageUp}{End}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('formatVolume escreve a porcentagem inteira', () => {
    expect(formatVolume(0)).toBe('0 %');
    expect(formatVolume(100)).toBe('100 %');
    expect(formatVolume(72.4)).toBe('72 %');
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
