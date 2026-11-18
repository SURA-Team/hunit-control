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
