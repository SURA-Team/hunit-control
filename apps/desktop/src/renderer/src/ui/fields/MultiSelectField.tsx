/** Seletor de várias opções (specs/006; "Campo" com `Ícone=Seletor`): as escolhidas viram pílulas. */
import { MultiSelect, type MultiSelectProps } from '@mantine/core';
import { SelectorIcon } from '../icons';
import { comboboxClassNames, sizedClassNames, type FieldSize } from './shared';

export type MultiSelectFieldProps = Omit<
  MultiSelectProps,
  'classNames' | 'styles' | 'className' | 'style' | 'variant' | 'size' | 'radius' | 'vars'
> & { size?: FieldSize };

export function MultiSelectField({ size = 'sm', ...props }: MultiSelectFieldProps) {
  return (
    <MultiSelect
      classNames={sizedClassNames(comboboxClassNames, size)}
      rightSection={<SelectorIcon size={16} />}
      rightSectionPointerEvents="none"
      checkIconPosition="right"
      comboboxProps={{ offset: 6 }}
      {...props}
    />
  );
}
