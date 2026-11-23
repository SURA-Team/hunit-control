/** Classes comuns aos campos de texto e seletores de ui/fields (specs/006, research R-05). */
import type { ComboboxItem, ComboboxParsedItem, OptionsFilter } from '@mantine/core';
import classes from './fields.module.css';

export const inputClassNames = {
  label: classes.label,
  description: classes.description,
  error: classes.error,
  wrapper: classes.wrapper,
  input: classes.input,
  section: classes.section,
};

/** Altura do campo: `sm` 36 px (padrão das telas), `md` 40 px (barra de busca), `lg` 50 px (token). */
export type FieldSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<FieldSize, string | undefined> = {
  sm: undefined,
  md: classes.inputMd,
  lg: classes.inputLg,
};

/** As classes de um campo no tamanho pedido. */
export function sizedClassNames<T extends { input?: string }>(base: T, size: FieldSize): T {
  const extra = SIZE_CLASS[size];
  return extra ? { ...base, input: `${base.input ?? ''} ${extra}` } : base;
}

export const comboboxClassNames = {
  ...inputClassNames,
  dropdown: classes.dropdown,
  option: classes.option,
  pill: classes.pill,
};

/** Mensagem da lista quando a busca não acha nenhuma opção (specs/008, R-11). */
export const NOTHING_FOUND = 'Nenhuma opção encontrada';

/** Texto para comparar na busca: sem acentos, sem maiúsculas e sem espaços nas pontas. */
export function searchKey(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/**
 * Busca dos seletores (specs/008, R-11): a opção fica se o rótulo contém o texto digitado, sem
 * diferenciar acentos e maiúsculas ("sao" acha "São Paulo"). Grupos sem opção que combine somem.
 */
export const searchFilter: OptionsFilter = ({ options, search }) => {
  const wanted = searchKey(search);
  if (wanted === '') return options;
  const matches = (item: ComboboxItem) => searchKey(item.label).includes(wanted);
  return options.flatMap((option: ComboboxParsedItem): ComboboxParsedItem[] => {
    if ('group' in option) {
      const items = option.items.filter(matches);
      return items.length > 0 ? [{ ...option, items }] : [];
    }
    return matches(option) ? [option] : [];
  });
};

export const choiceClassNames = {
  label: classes.choiceLabel,
  description: classes.choiceDescription,
  error: classes.error,
};

export { classes as fieldClasses };
