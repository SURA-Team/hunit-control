/**
 * Grupo de opções de escolha única (specs/006; "Rádio" do design, node `21:145`): marcada em preto com
 * o ponto lima, desmarcada em branco com borda. O grupo tem rótulo próprio e cada opção, o seu.
 */
import { Radio, type RadioGroupProps } from '@mantine/core';
import { choiceClassNames, fieldClasses } from './shared';

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export type RadioFieldProps = Omit<
  RadioGroupProps,
  'classNames' | 'styles' | 'className' | 'style' | 'variant' | 'size' | 'vars' | 'children'
> & { options: readonly RadioOption[] };

export function RadioField({ options, ...props }: RadioFieldProps) {
  return (
    <Radio.Group
      classNames={{
        label: fieldClasses.label,
        description: fieldClasses.description,
        error: fieldClasses.error,
      }}
      {...props}
    >
      <div className={fieldClasses.group}>
        {options.map((option) => (
          <Radio
            key={option.value}
            value={option.value}
            label={option.label}
            description={option.description}
            disabled={option.disabled}
            classNames={{
              ...choiceClassNames,
              radio: fieldClasses.radio,
              icon: fieldClasses.radioIcon,
            }}
            vars={() => ({
              root: {
                '--radio-size': '20px',
                '--radio-icon-size': '8px',
                '--label-offset-start': '12px',
              },
            })}
          />
        ))}
      </div>
    </Radio.Group>
  );
}
