/**
 * Aviso do estado da conexão, visível em todas as telas (specs/002, FR-002, FR-005). Em "servidor
 * não confirmado" e "chave recusada" só leva à configuração: não existe "continuar mesmo assim".
 * Desde a 006 (T017), no alerta do design: âmbar para indisponível, vermelho para o que impede o uso
 * e lima para o que está em andamento ou por fazer.
 */
import type { ConnectionState } from '../../../shared/ipc-types';
import { Action, Notice } from '../ui';

interface Props {
  state: ConnectionState | null;
  onOpenSetup: () => void;
}

function SetupAction({ onOpenSetup }: Pick<Props, 'onOpenSetup'>) {
  return (
    <Action variant="secondary" size="xs" onClick={onOpenSetup}>
      Abrir configuração
    </Action>
  );
}

export function ConnectionBanner({ state, onOpenSetup }: Props) {
  switch (state?.status) {
    case 'offline':
      return (
        <Notice tone="amber" title="Servidor indisponível" role="status">
          O app vai reconectar sozinho assim que o servidor voltar. O que já estava na tela continua
          visível, com o horário em que foi obtido; as ações ficam desabilitadas até lá.
        </Notice>
      );
    case 'connecting':
      return (
        <Notice tone="lime" title="Conectando ao servidor…" role="status">
          Aguarde a confirmação da conexão.
        </Notice>
      );
    case 'untrusted_server':
      return (
        <Notice
          tone="red"
          title="Não foi possível confirmar a identidade do servidor"
          action={<SetupAction onOpenSetup={onOpenSetup} />}
        >
          O certificado apresentado não é o do servidor configurado. Confira o endereço e o
          certificado raiz na configuração.
        </Notice>
      );
    case 'unauthorized':
      return (
        <Notice
          tone="red"
          title="Chave de acesso recusada"
          action={<SetupAction onOpenSetup={onOpenSetup} />}
        >
          O servidor não aceitou a chave desta máquina (inválida ou revogada). Informe uma nova
          chave na configuração.
        </Notice>
      );
    case 'not_configured':
      return (
        <Notice tone="lime" title="Configure a conexão com o servidor" role="status">
          Informe o endereço do servidor, o certificado raiz e a chave de acesso desta máquina.
        </Notice>
      );
    default:
      return null;
  }
}
