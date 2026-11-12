/**
 * Preferências da máquina (specs/002, FR-006, research R-05 e R-07): prazo de inatividade para
 * apagar usuário e senha da memória (1 a 24 horas) e o som do aviso dentro do app.
 */
import {
  Alert,
  Button,
  Group,
  NumberInput,
  Paper,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Preferences } from '../../../../shared/ipc-types';
import { messageOf, unwrap, useHunit } from '../../hunit';

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
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
        <Title order={4}>Preferências</Title>
        <NumberInput
          label="Prazo de inatividade (horas)"
          description="Depois desse tempo sem uso, usuário e senha do Hunit são apagados da memória"
          value={idleHours}
          onChange={setIdleHours}
          min={1}
          max={24}
          step={1}
          allowDecimal={false}
          clampBehavior="none"
          maw={260}
          error={invalid ? 'O prazo deve ser de 1 a 24 horas.' : undefined}
        />
        <Switch
          label="Som do aviso dentro do app"
          checked={soundEnabled}
          onChange={(event) => setSoundEnabled(event.currentTarget.checked)}
        />
        <Group>
          <Button variant="light" onClick={submit} loading={save.isPending}>
            Salvar preferências
          </Button>
          {save.isSuccess && (
            <Text size="sm" c="green.8" role="status">
              Preferências salvas.
            </Text>
          )}
        </Group>
        {save.isError && (
          <Alert color="red" role="alert">
            {messageOf(save.error)}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
