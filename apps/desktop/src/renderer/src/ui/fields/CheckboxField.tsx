/** Caixa de seleção com rótulo (specs/006; "Checkbox" do design, node `21:195`): a mesma caixa da lista. */
import { Checkbox, type CheckboxProps } from '@mantine/core';
import { CheckIcon, MinusIcon } from '../icons';
import { selectionVars } from './SelectionBox';
import { choiceClassNames, fieldClasses } from './shared';

export type CheckboxFieldProps = Omit<
  CheckboxProps,
  | 'classNames'
  | 'styles'
  | 'className'
  | 'style'
  | 'variant'
  | 'size'
  | 'radius'
  | 'vars'
  | 'icon'
  | 'color'
  | 'iconColor'
>;

function FieldIcon({
  indeterminate,
  className,
}: {
  indeterminate: boolean | undefined;
  className: string;
}) {
  return indeterminate ? <MinusIcon className={className} /> : <CheckIcon className={className} />;
}

export function CheckboxField(props: CheckboxFieldProps) {
  return (
    <Checkbox
      classNames={{
        ...choiceClassNames,
        input: fieldClasses.checkboxInput,
        icon: fieldClasses.checkboxIcon,
      }}
      vars={() => ({ root: { ...selectionVars().root, '--label-offset-start': '10px' } })}
      icon={FieldIcon}
      {...props}
    />
  );
}
