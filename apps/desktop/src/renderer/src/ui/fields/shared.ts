/** Classes comuns aos campos de texto e seletores de ui/fields (specs/006, research R-05). */
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

export const choiceClassNames = {
  label: classes.choiceLabel,
  description: classes.choiceDescription,
  error: classes.error,
};

export { classes as fieldClasses };
