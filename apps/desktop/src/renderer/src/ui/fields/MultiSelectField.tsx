/** Seletor de várias opções (specs/006; "Campo" com `Ícone=Seletor`): as escolhidas viram pílulas. */
import { MultiSelect, type MultiSelectProps } from '@mantine/core';
import { SelectorIcon } from '../icons';
import { comboboxClassNames } from './shared';

export type MultiSelectFieldProps = Omit<
  MultiSelectProps,
  'classNames' | 'styles' | 'className' | 'style' | 'variant' | 'size' | 'radius' | 'vars'
>;

export function MultiSelectField(props: MultiSelectFieldProps) {
  return (
    <MultiSelect
      classNames={comboboxClassNames}
      rightSection={<SelectorIcon size={16} />}
      rightSectionPointerEvents="none"
      checkIconPosition="right"
      comboboxProps={{ offset: 6 }}
      {...props}
    />
  );
}
