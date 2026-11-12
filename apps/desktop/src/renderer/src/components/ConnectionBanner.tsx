/**
 * Aviso do estado da conexão, visível em todas as telas (specs/002, FR-002, FR-005). Em "servidor
 * não confirmado" e "chave recusada" só leva à configuração: não existe "continuar mesmo assim".
 */
import { Alert, Button, Group, Text } from '@mantine/core';
import type { ConnectionState } from '../../../shared/ipc-types';

interface Props {
  state: ConnectionState | null;
  onOpenSetup: () => void;
}

function SetupButton({ onOpenSetup }: Pick<Props, 'onOpenSetup'>) {
  return (
    <Button size="xs" variant="white" color="dark" onClick={onOpenSetup}>
      Abrir configuração
    </Button>
  );
}

export function ConnectionBanner({ state, onOpenSetup }: Props) {
  switch (state?.status) {
    case 'offline':
      return (
        <Alert color="yellow" title="Servidor indisponível" role="status">
          <Text size="sm">
            O app vai reconectar sozinho assim que o servidor voltar. O que já estava na tela
            continua visível, com o horário em que foi obtido; as ações ficam desabilitadas até lá.
          </Text>
        </Alert>
      );
    case 'connecting':
      return (
        <Alert color="blue" title="Conectando ao servidor…" role="status">
          <Text size="sm">Aguarde a confirmação da conexão.</Text>
        </Alert>
      );
    case 'untrusted_server':
      return (
        <Alert color="red" title="Não foi possível confirmar a identidade do servidor" role="alert">
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">
              O certificado apresentado não é o do servidor configurado. Confira o endereço e o
              certificado raiz na configuração.
            </Text>
            <SetupButton onOpenSetup={onOpenSetup} />
          </Group>
        </Alert>
      );
    case 'unauthorized':
      return (
        <Alert color="red" title="Chave de acesso recusada" role="alert">
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">
              O servidor não aceitou a chave desta máquina (inválida ou revogada). Informe uma nova
              chave na configuração.
            </Text>
            <SetupButton onOpenSetup={onOpenSetup} />
          </Group>
        </Alert>
      );
    case 'not_configured':
      return (
        <Alert color="blue" title="Configure a conexão com o servidor" role="status">
          <Text size="sm">
            Informe o endereço do servidor, o certificado raiz e a chave de acesso desta máquina.
          </Text>
        </Alert>
      );
    default:
      return null;
  }
}
