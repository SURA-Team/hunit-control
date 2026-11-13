/**
 * Acesso ao Hunit (specs/002, FR-006 a FR-008, research R-05): usuário e senha vão para o cofre do
 * processo principal; a interface descarta a senha digitada e mostra só o usuário e "senha
 * guardada". "Limpar acesso" esvazia o cofre a qualquer momento.
 */
import { Button, Group, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import type { CredentialsStatus } from '../../../../shared/ipc-types';

interface Props {
  status: CredentialsStatus | undefined;
  username: string;
  password: string;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  saving: boolean;
  /** Por que o acesso precisa ser informado de novo (inatividade). */
  notice: string | null;
}

export function CredentialsForm(props: Props) {
  const { status } = props;
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Acesso ao Hunit</Title>
        {props.notice && (
          <Text size="sm" c="orange.8" role="status">
            {props.notice}
          </Text>
        )}
        {status?.hasPassword ? (
          <Group justify="space-between">
            <Text size="sm">
              Usuário{' '}
              <Text span fw={600}>
                {status.username}
              </Text>{' '}
              — senha guardada nesta sessão
            </Text>
            <Button variant="default" size="xs" onClick={props.onClear}>
              Limpar acesso
            </Button>
          </Group>
        ) : (
          <>
            <Group grow align="flex-start">
              <TextInput
                label="Usuário do Hunit"
                value={props.username}
                onChange={(event) => props.onUsername(event.currentTarget.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <PasswordInput
                label="Senha do Hunit"
                value={props.password}
                onChange={(event) => props.onPassword(event.currentTarget.value)}
                autoComplete="off"
              />
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                Fica só na memória do app até ele ser fechado ou ficar sem uso pelo prazo de
                inatividade; nunca é gravado.
              </Text>
              <Button
                variant="light"
                size="xs"
                onClick={props.onSave}
                loading={props.saving}
                disabled={props.username.trim() === '' || props.password === ''}
              >
                Guardar acesso
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
