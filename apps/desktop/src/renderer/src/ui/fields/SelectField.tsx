/**
 * Seletor de uma opção (specs/006; "Campo" do design com `Ícone=Seletor`, node `21:113`), com a lista
 * suspensa da tela 4.12 (opção escolhida em lima suave, com o check à direita).
 */
import { Select, type SelectProps } from '@mantine/core';
import { SelectorIcon } from '../icons';
import { comboboxClassNames } from './shared';

export type SelectFieldProps = Omit<
  SelectProps,
  'classNames' | 'styles' | 'className' | 'style' | 'variant' | 'size' | 'radius' | 'vars'
>;

export function SelectField(props: SelectFieldProps) {
  return (
    <Select
      classNames={comboboxClassNames}
      rightSection={<SelectorIcon size={16} />}
      rightSectionPointerEvents="none"
      checkIconPosition="right"
      allowDeselect={false}
      comboboxProps={{ offset: 6 }}
      {...props}
    />
  );
}
