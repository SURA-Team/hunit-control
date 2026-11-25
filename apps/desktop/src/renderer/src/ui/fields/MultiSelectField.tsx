/**
 * Seletor de várias opções (specs/006; "Campo" com `Ícone=Seletor`): as escolhidas viram pílulas.
 * Desde a 008 (R-11, FR-028), com a busca pelo teclado por padrão, como o `SelectField`.
 */
import { MultiSelect, type MultiSelectProps } from '@mantine/core';
import { SelectorIcon } from '../icons';
import {
  comboboxClassNames,
  NOTHING_FOUND,
  searchFilter,
  sizedClassNames,
  type FieldSize,
} from './shared';

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
      searchable
      filter={searchFilter}
      nothingFoundMessage={NOTHING_FOUND}
      {...props}
    />
  );
}
