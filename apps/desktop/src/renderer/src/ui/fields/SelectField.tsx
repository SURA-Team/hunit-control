/**
 * Seletor de uma opção (specs/006; "Campo" do design com `Ícone=Seletor`, node `21:113`), com a lista
 * suspensa da tela 4.12 (opção escolhida em lima suave, com o check à direita).
 *
 * - `inlineLabel`: o rótulo à esquerda, na mesma linha ("Origem" na barra de busca, tela 4.1);
 * - `optionDescriptions`: uma segunda linha em cada opção, pelo valor ("Só ativas" → "Esconde as
 *   canceladas", tela 4.12).
 */
import { Select, type SelectProps } from '@mantine/core';
import { useId } from 'react';
import { CheckIcon, SelectorIcon } from '../icons';
import { comboboxClassNames, fieldClasses, sizedClassNames, type FieldSize } from './shared';

export type SelectFieldProps = Omit<
  SelectProps,
  'classNames' | 'styles' | 'className' | 'style' | 'variant' | 'size' | 'radius' | 'vars'
> & {
  size?: FieldSize;
  inlineLabel?: boolean;
  optionDescriptions?: Readonly<Record<string, string>>;
};

export function SelectField({
  size = 'sm',
  inlineLabel = false,
  optionDescriptions,
  label,
  id,
  ...props
}: SelectFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const select = (
    <Select
      id={inputId}
      classNames={sizedClassNames(comboboxClassNames, size)}
      rightSection={<SelectorIcon size={16} />}
      rightSectionPointerEvents="none"
      checkIconPosition="right"
      allowDeselect={false}
      comboboxProps={{ offset: 6 }}
      {...(!inlineLabel && { label })}
      {...(optionDescriptions && {
        renderOption: ({ option, checked }) => (
          <span className={fieldClasses.describedOption}>
            <span className={fieldClasses.describedOptionText}>
              <span>{option.label}</span>
              {optionDescriptions[option.value] && (
                <span className={fieldClasses.choiceDescription}>
                  {optionDescriptions[option.value]}
                </span>
              )}
            </span>
            {checked && <CheckIcon size={16} />}
          </span>
        ),
      })}
      {...props}
    />
  );
  if (!inlineLabel) return select;
  return (
    <div className={fieldClasses.inline}>
      {/* O mesmo id que o Mantine usa no `aria-labelledby` da lista de opções. */}
      <label className={fieldClasses.inlineLabel} htmlFor={inputId} id={`${inputId}-label`}>
        {label}
      </label>
      {select}
    </div>
  );
}
