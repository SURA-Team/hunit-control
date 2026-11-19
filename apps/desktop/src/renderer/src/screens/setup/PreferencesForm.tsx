/**
 * Preferências da máquina (specs/002, FR-006, research R-05 e R-07): prazo de inatividade para
 * apagar usuário e senha da memória (1 a 24 horas) e o som do aviso dentro do app.
 * Desde a 006 (T019; tela 1.3): o prazo aparece como o campo com seletor do design (as setas do
 * teclado mudam o número), a chave do som e "Salvar preferências" como a principal do card.
 */
import { Group } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Preferences } from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';
import {
  Action,
  Card,
  Notice,
  NumberField,
  SectionTitle,
  SelectorIcon,
  SwitchField,
} from '../../ui';

export function PreferencesForm({ initial }: { initial: Preferences }) {
  const hunit = useHunit();
  const queryClient = useQueryClient();
  const [idleHours, setIdleHours] = useState<number | string>(initial.idleHours);
  const [soundEnabled, setSoundEnabled] = useState(initial.soundEnabled);
  const [invalid, setInvalid] = useState(false);

  const save = useMutation({
    mutationFn: (preferences: Preferences) => unwrap(hunit.preferences.set(preferences)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  function submit() {
    const hours = typeof idleHours === 'number' ? idleHours : Number(idleHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    save.mutate({ idleHours: hours, soundEnabled });
  }

  return (
    <Card block="Preferências">
      <SectionTitle>Preferências</SectionTitle>
      <NumberField
        label="Prazo de inatividade (horas)"
        description="Depois desse tempo sem uso, usuário e senha do Hunit são apagados da memória"
        value={idleHours}
        onChange={setIdleHours}
        min={1}
        max={24}
        step={1}
        allowDecimal={false}
        clampBehavior="none"
        hideControls
        rightSection={<SelectorIcon size={16} />}
        rightSectionPointerEvents="none"
        maw={260}
        error={invalid ? 'O prazo deve ser de 1 a 24 horas.' : undefined}
      />
      <SwitchField
        label="Som do aviso dentro do app"
        checked={soundEnabled}
        onChange={(event) => setSoundEnabled(event.currentTarget.checked)}
      />
      <Group gap={12}>
        <Action variant="primary" size="sm" onClick={submit} loading={save.isPending}>
          Salvar preferências
        </Action>
        {save.isSuccess && (
          <Notice tone="green" role="status" compact>
            Preferências salvas.
          </Notice>
        )}
      </Group>
      {save.isError && <Notice tone="red">{messageOf(save.error)}</Notice>}
    </Card>
  );
}
