# Contrato: ponte entre a interface e o processo principal (preload)

**Feature**: [spec.md](../spec.md) | **Research**: [R-02](../research.md), [R-05](../research.md), [R-06](../research.md), [R-07](../research.md)

A interface (renderer) roda isolada, sem Node e sem rede (research R-02). Tudo o que ela pode
pedir ao processo principal está listado aqui, exposto pelo preload em `window.hunit` via
`contextBridge`. Regras que valem para todo o contrato:

- **Uma função por canal**, com nome fixo (`<área>:<ação>`); o `ipcRenderer` nunca é exposto.
- **Toda entrada é validada no principal** com `zod` (`src/shared/ipc-schemas.ts`); entrada
  inválida devolve `invalid_input` sem executar nada.
- **Nada sensível volta para a interface**: nem a chave da API, nem a senha do Hunit. O token 2FA
  vai da interface para o principal, nunca o contrário.
- Pedidos devolvem `Result<T>`; eventos devolvem a função que cancela a inscrição.
- Ações exclusivas de operador (iniciar, token, cancelar, retomar) são recusadas pelo servidor para
  o perfil consulta (`forbidden_for_role`); a interface também as esconde (FR-004, SC-009).

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; detail?: string; status?: number } };

// ErrorCode = códigos da API (Problem.code) + códigos do app; mensagens em data-model.md §6.5
type Unsubscribe = () => void;
```

## Tipos usados

Os tipos com prefixo `Api.` vêm de `@hunit/contracts` (`components['schemas'][...]`).

```ts
type ConnectionStatus =
  | 'not_configured' | 'connecting' | 'online' | 'offline' | 'untrusted_server' | 'unauthorized';

interface ConnectionState {
  status: ConnectionStatus;
  client: Api.ClientIdentity | null;   // { name, role } quando online
  checkedAt: string;                    // ISO; última verificação
}

interface PublicConfig {                // o que a interface pode ver da configuração
  serverUrl: string;
  certificate: CertificateInfo;
  hasApiKey: boolean;                   // a chave em si nunca sai do principal
  preferences: { soundEnabled: boolean; idleHours: number };
}

interface CertificateInfo {
  fingerprint256: string; subject: string; issuer: string; validTo: string; isCertificateAuthority: boolean;
}

interface CredentialsStatus { username: string | null; hasPassword: boolean }

interface TwoFactorRequest {
  executionId: string;
  deadline: string;                     // twoFactorDeadline do servidor (ISO)
  clockOffsetMs: number;                // relógio do servidor − relógio local
}
```

## Pedidos (`invoke`)

| Função | Entrada | Saída (`Result<…>`) | Observações |
|---|---|---|---|
| `app.info()` | — | `{ version }` | versão do app (FR-025) |
| `connection.getState()` | — | `ConnectionState` | |
| `connection.getConfig()` | — | `PublicConfig \| null` | `null` = não configurado |
| `connection.pickCertificate()` | — | `{ pem, info: CertificateInfo } \| null` | o principal abre o diálogo de arquivo e lê o arquivo; `null` = cancelado; recusa arquivo que não seja certificado de autoridade |
| `connection.test(input)` | `{ serverUrl, certificatePem, apiKey? }` | `Api.ClientIdentity` | `apiKey` omitida = testa com a chave já guardada; chama `/health` e `/me` |
| `connection.save(input)` | `{ serverUrl, certificatePem, apiKey? }` | `PublicConfig` | só salva depois de um teste bem-sucedido com os mesmos dados; cifra a chave (R-04) |
| `connection.remove()` | — | `void` | apaga o `config.json` |
| `preferences.set(input)` | `{ soundEnabled?, idleHours? (1–24) }` | `PublicConfig['preferences']` | |
| `attention.test()` | — | `void` | "Testar aviso": dispara notificação, janela à frente e som (R-07) |
| `credentials.status()` | — | `CredentialsStatus` | |
| `credentials.set(input)` | `{ username, password }` | `CredentialsStatus` | guarda no cofre do principal; a interface descarta o que foi digitado |
| `credentials.clear()` | — | `CredentialsStatus` | "Limpar acesso" (FR-008) |
| `hotels.list()` | — | `Api.Hotel[]` | catálogo conhecido (FR-009) |
| `executions.list(input)` | `{ active?, status?, cursor?, limit? }` | `{ items: Api.ExecutionSummary[], nextCursor }` | |
| `executions.get(id)` | `executionId` | `Api.Execution` | |
| `executions.start(input)` | `{ period: { from, to }, hotelCodes: string[] \| null }` | `Api.Execution` | usa o cofre; cofre vazio → `credentials_missing`/`credentials_expired`; passa a acompanhar a execução (R-06) |
| `executions.resume(id)` | `executionId` | `Api.Execution` | usa o cofre; acompanha a nova execução |
| `executions.cancel(id)` | `executionId` | `Api.Execution` | a interface confirma antes de chamar (FR-017) |
| `executions.sendToken(input)` | `{ executionId, token }` | `void` | token `^[0-9]{4,10}$`; resposta 202 = entregue; o resultado chega pelo estado da execução |
| `executions.watch(id)` / `executions.unwatch(id)` | `executionId` | `void` | abre/fecha o fluxo de eventos de uma execução exibida na tela |
| `evidence.list(id)` | `executionId` | `Api.EvidenceSummary[]` | |
| `evidence.save(input)` | `{ evidenceId, file: 'screenshot' \| 'html' \| 'response' }` | `{ savedTo: string } \| null` | o principal baixa e abre "Salvar como"; `null` = cancelado; a interface nunca recebe o conteúdo |
| `reservations.list(input)` | filtros da FR-020 + `q`, `channel`, `amount` (formato da API), `cursor`, `limit` | `{ items: Api.Reservation[], nextCursor }` | |
| `reservations.get(input)` | `{ hotelCode, reservationNumber }` | `Api.Reservation` | |
| `reservations.channels()` | — | `string[]` | |

## Avisos do operador (`send`, sem resposta)

| Função | Quando | Efeito |
|---|---|---|
| `activity.ping()` | tecla ou clique na janela, no máximo 1 vez por minuto | renova o prazo de inatividade do cofre (R-05) |

## Eventos (principal → interface)

| Inscrição | Dados | Quando |
|---|---|---|
| `connection.onState(cb)` | `ConnectionState` | toda mudança de estado da conexão |
| `credentials.onCleared(cb)` | `{ reason: 'idle' \| 'manual' }` | o cofre foi esvaziado |
| `executions.onChanged(cb)` | `{ executionId }` | chegou evento do servidor para uma execução acompanhada; a interface busca o estado de novo (R-06) |
| `twoFactor.onRequested(cb)` | `TwoFactorRequest` | execução desta máquina passou a aguardar token, ou foi encontrada aguardando ao abrir/reconectar (FR-011, FR-019) |
| `twoFactor.onClosed(cb)` | `{ executionId, reason: 'accepted' \| 'rejected' \| 'expired' \| 'finished' \| 'answered_elsewhere' }` | a execução saiu da espera do token |

## O que o principal faz sozinho (sem pedido da interface)

- Ao iniciar: lê a configuração, conecta (`/health`, `/me`), busca as execuções ativas desta
  máquina (`active=true` e `requestedClient` igual ao nome do cliente) e passa a acompanhá-las.
- Ao reconectar: repete a busca acima e reabre o pedido de token se ainda houver prazo.
- No pedido de token: notificação do Windows, janela à frente e piscando, som (se ativado) e o
  evento `twoFactor.onRequested`.
- Ao fechar a janela: se houver execução ativa desta máquina, pede confirmação; ao encerrar,
  esvazia o cofre.
