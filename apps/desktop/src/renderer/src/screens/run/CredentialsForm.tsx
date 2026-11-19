/**
 * Acesso ao Hunit (specs/002, FR-006 a FR-008, research R-05): usuário e senha vão para o cofre do
 * processo principal; a interface descarta a senha digitada e mostra só o usuário e "senha
 * guardada". "Limpar acesso" esvazia o cofre a qualquer momento.
 * Desde a 006 (T020; telas 2.1 a 2.4): card "Acesso ao Hunit"; "Guardar acesso" em contorno e
 * "Limpar acesso" em vermelho suave (FR-009). Com `inset` (T050; tela 7.1), dentro de um diálogo ou
 * de outro card: a caixa cinza com o título menor.
 */
import { Group, SimpleGrid, Text } from '@mantine/core';
import type { CredentialsStatus } from '../../../../shared/ipc-types';
import { Action, Card, CardHeader, Field, Notice, PasswordField, SectionTitle } from '../../ui';

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
  /** Dentro de um diálogo ou de outro card: caixa cinza e título menor (tela 7.1). */
  inset?: boolean;
}

export function CredentialsForm(props: Props) {
  const { status } = props;
  return (
    <Card block="Acesso ao Hunit" {...(props.inset && { tone: 'subtle', padding: 12 })}>
      {props.inset ? (
        <CardHeader title="Acesso ao Hunit" />
      ) : (
        <SectionTitle>Acesso ao Hunit</SectionTitle>
      )}
      {props.notice && (
        <Notice tone="amber" role="status">
          {props.notice}
        </Notice>
      )}
      {status?.hasPassword ? (
        <Group justify="space-between" gap={12}>
          <Text size="sm">
            Usuário <strong>{status.username}</strong> — senha guardada nesta sessão
          </Text>
          <Action variant="danger-light" size="xs" onClick={props.onClear}>
            Limpar acesso
          </Action>
        </Group>
      ) : (
        <>
          <SimpleGrid cols={2} spacing={16}>
            <Field
              label="Usuário do Hunit"
              value={props.username}
              onChange={(event) => props.onUsername(event.currentTarget.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <PasswordField
              label="Senha do Hunit"
              value={props.password}
              onChange={(event) => props.onPassword(event.currentTarget.value)}
              autoComplete="off"
            />
          </SimpleGrid>
          <Group justify="space-between" gap={12}>
            <Text size="xs" c="dimmed">
              Fica só na memória do app até ele ser fechado ou ficar sem uso pelo prazo de
              inatividade; nunca é gravado.
            </Text>
            <Action
              variant="secondary"
              size="xs"
              onClick={props.onSave}
              loading={props.saving}
              disabled={props.username.trim() === '' || props.password === ''}
            >
              Guardar acesso
            </Action>
          </Group>
        </>
      )}
    </Card>
  );
}
