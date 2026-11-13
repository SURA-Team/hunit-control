# Data Model: App desktop para operar o HUNIT Control

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

O app não tem banco próprio: os dados de negócio vêm da API (fonte da verdade, constitution
princípio VI). Este documento descreve o pouco que o app guarda na máquina, o que mantém só em
memória, as máquinas de estado da interface e as mudanças de dados no servidor.

---

## 1. Gravado na máquina: `config.json`

Local: pasta de dados do app (`app.getPath('userData')`, no Windows
`%APPDATA%\HUNIT Control\config.json`), por usuário do Windows. Escrita atômica (arquivo
temporário + renomear). Arquivo ilegível ou inválido → app tratado como "não configurado", com aviso.

| Campo | Tipo | Regras |
|---|---|---|
| `version` | `1` | versão do formato do arquivo |
| `server.url` | string | `https://` obrigatório; só origem (sem caminho, consulta ou fragmento); o nome ou IP precisa ser o do certificado do servidor |
| `server.caCertificatePem` | string | um certificado PEM de **autoridade** (CA), dentro da validade; é público (não é segredo) |
| `server.caFingerprint256` | string | impressão digital SHA-256 calculada ao importar; mostrada na configuração para conferência |
| `apiKey.ciphertext` | string (base64) | chave da API cifrada com `safeStorage` (DPAPI); nunca em texto puro (FR-003, R-04) |
| `preferences.soundEnabled` | boolean | padrão `true`; som do aviso dentro do app (R-07) |
| `preferences.idleHours` | inteiro 1–24 | padrão `8`; horas sem ação para esvaziar o cofre (FR-006, R-05) |

**Nunca gravado** (FR-007, FR-008a, SC-004): usuário, senha e token do Hunit; reservas, execuções,
nomes de hóspedes, valores e dados de cobrança; registros (*logs*). A única exceção são arquivos de
evidência que o operador salva onde escolher (FR-024).

## 2. Só em memória: processo principal

| Item | Conteúdo | Origem e vida |
|---|---|---|
| Identidade do cliente | `name`, `role` (`operator` ou `reader`) | `GET /v1/me` a cada conexão; define as ações exibidas (FR-004) e quais execuções são "desta máquina" (FR-012) |
| Cofre de acesso ao Hunit | `username`, `password`, `lastActivityAt` | informado pelo operador; esvaziado ao fechar o app, por "Limpar acesso" ou após `idleHours` sem ação (R-05) |
| Estado da conexão | ver máquina de estados 4.1 | mantido pelo principal e enviado à interface a cada mudança |
| Execuções acompanhadas | `executionId`, `lastEventId` | execuções ativas desta máquina com fluxo de eventos aberto (R-06) |
| Diferença de relógio | `offsetMs` | relógio do servidor (cabeçalho `Date`) menos o local; corrige a contagem regressiva do token (R-07) |

## 3. Só em memória: interface

| Item | Conteúdo | Observação |
|---|---|---|
| Cache de consultas | resposta + `dataUpdatedAt` por consulta (execuções, detalhe, reservas, hotéis, canais) | TanStack Query sem persistência; some ao fechar o app (R-08) |
| Pedido de token | máquina de estados 4.2 | um pedido aberto por vez; vários pedidos simultâneos (raro) entram em fila |
| Formulários | período, hotéis escolhidos, filtros e busca de reservas | a senha digitada é enviada ao cofre e descartada da interface |

## 4. Máquinas de estado

### 4.1 Conexão com o servidor (FR-001, FR-002, FR-005)

```text
não configurado ──(salvar configuração testada)──► conectando
conectando ──(health ok + /me ok)──► online
conectando / online ──(falha de rede ou tempo esgotado)──► indisponível
conectando / online ──(falha de TLS: raiz, nome ou validade)──► servidor não confirmado
conectando / online ──(401 unauthorized)──► chave recusada
indisponível ──(health a cada 5 s volta a responder)──► conectando
servidor não confirmado / chave recusada ──(nova configuração salva)──► conectando
qualquer estado ──(remover configuração)──► não configurado
```

- Em **indisponível**, a interface mantém o que já estava na tela com "dados de HH:MM — servidor
  indisponível" e desabilita ações que dependem do servidor.
- Em **servidor não confirmado** e **chave recusada**, a interface leva à configuração; não existe
  opção de continuar mesmo assim (FR-002).

### 4.2 Pedido de token (FR-011 a FR-013, FR-019)

```text
fechado ──(execução desta máquina entra em awaiting_2fa, ou é encontrada assim ao abrir/reconectar)──► aberto(prazo)
aberto ──(operador confirma)──► enviando
enviando ──(202: token entregue à execução)──► aguardando resultado
aguardando resultado ──(execução sai de awaiting_2fa para running)──► conferindo
conferindo ──(primeiro evento de andamento: acesso ao Hunit concluído)──► fechado (aceito)
conferindo / aguardando resultado ──(execução termina com invalid_token)──► fechado (recusado: mensagem e opção de iniciar de novo)
aberto ──(prazo vence / execução termina / token enviado por outro caminho)──► fechado (com o motivo)
enviando ──(409 not_awaiting_two_factor)──► fechado ("a execução não aguarda mais o token")
```

- A contagem regressiva usa `twoFactorDeadline - (agora + offsetMs)`.
- O servidor volta a execução para `running` ("Token recebido. Concluindo o acesso.") **antes** de o
  Hunit conferir o token; com o token errado, ela vai de `running` para `failed`/`invalid_token`.
  Por isso `running` não fecha o pedido como aceito: o aceite é o primeiro evento de andamento
  depois dele (catálogo, hotel iniciado). Corrigido na implementação (Fase 6, achado do T073).
- Execuções de outras máquinas nunca abrem o pedido automaticamente; o campo de token fica no
  detalhe delas, para o perfil operador (R-07).

### 4.3 Cofre de acesso ao Hunit (FR-006 a FR-008)

```text
vazio ──(operador informa usuário e senha)──► preenchido
preenchido ──(cada ação do operador)──► preenchido (lastActivityAt = agora)
preenchido ──(idleHours sem ação)──► vazio (motivo: inatividade)
preenchido ──("Limpar acesso")──► vazio (motivo: manual)
preenchido ──(fechar o app)──► vazio
```

Iniciar ou retomar com o cofre vazio devolve `credentials_missing` ou `credentials_expired`
(inatividade); a interface pede o acesso de novo e explica o motivo.

## 5. Dados vindos da API (somente leitura no app)

Os formatos estão no contrato ([`packages/contracts/openapi.yaml`](../../packages/contracts/openapi.yaml));
os acréscimos desta feature estão em [contracts/api-changes.md](./contracts/api-changes.md).

| Entidade (spec) | Esquema da API | Uso no app |
|---|---|---|
| Execução | `Execution` (+ `warnings`), `ExecutionSummary` (+ `requestedClient`) | lista, acompanhamento (com os avisos, FR-016a), pedido de token, retomada |
| Reserva | `Reservation` | lista com filtros e busca, detalhe |
| Hotel | `Hotel` | seleção de hotéis; nome do hotel nas listas |
| Evidência | `EvidenceSummary` (novo) | lista por execução e hotel; download |
| Identidade do cliente | `ClientIdentity` (novo) | perfil e execuções desta máquina |
| Canais | `ChannelList` (novo) | filtro por canal |

## 6. Tabela de apresentação (FR-023)

Nomes em português e tom de cor de cada valor dos enums da API. A tabela é tipada pelos enums de
`@hunit/contracts` (`Record<Enum, ...>`): um valor novo na API quebra a compilação do app até
ganhar nome e tom. Tons: **sucesso** (verde), **atenção** (amarelo), **erro** (vermelho),
**informação** (azul) e **neutro** (cinza). Os tons são decisão de apresentação, ajustável sem
mudar a spec.

### 6.1 Situação de cobrança (`Classification`, nomes da spec 001, FR-013)

| Valor | Nome | Tom |
|---|---|---|
| `virtual_card_already_charged` | Já cobrada | sucesso |
| `invoiced` | Faturada | sucesso |
| `virtual_card_pending_charge` | Pendente de cobrança | atenção |
| `virtual_card_validated_only` | Cartão validado (não cobrado) | atenção |
| `charge_at_terminal` | Cobrar na maquininha | atenção |
| `virtual_card_charge_error` | Erro na cobrança | erro |
| `analysis_error` | Erro de análise | erro |
| `cancelled_no_charge` | Cancelada sem cobrança | neutro |
| `ignored_hotelbeds_258` | Ignorada (Hotelbeds 258) | neutro |
| `not_virtual_card` | Não é cartão virtual (situação antiga) | neutro |

### 6.2 Situação da reserva (`ReservationStatus`)

| Valor | Nome | Tom |
|---|---|---|
| `active` | Ativa | neutro |
| `cancelled` | Cancelada | neutro |
| `unknown` | Não identificada | atenção |

### 6.3 Execução (`ExecutionStatus`) e hotel na execução (`HotelRunStatus`)

| Valor | Execução | Hotel | Tom |
|---|---|---|---|
| `queued` / `pending` | Na fila | Pendente | neutro |
| `running` | Em andamento | Em andamento | informação |
| `awaiting_2fa` | Aguardando token | — | atenção |
| `completed` | Concluída | Concluído | sucesso |
| `failed` | Falhou | Falhou | erro |
| `cancelled` | Cancelada | Cancelado | neutro |

### 6.4 Motivo de término (`ExecutionEndReason`)

| Valor | Mensagem |
|---|---|
| `invalid_credentials` | Usuário ou senha do Hunit incorretos. |
| `invalid_token` | O Hunit recusou o token. |
| `two_factor_timeout` | O prazo para informar o token terminou. |
| `hunit_unavailable` | O Hunit não respondeu. |
| `hunit_screen_not_recognized` | Uma tela ou resposta do Hunit mudou e não foi reconhecida. Veja as evidências. |
| `session_expired` | A sessão no Hunit expirou durante a execução. |
| `server_restarted` | O servidor reiniciou durante a execução. É possível retomar. |
| `cancelled_by_client` | Cancelada por um operador. |
| `internal_error` | Erro interno do servidor. |

### 6.5 Erros devolvidos ao operador

Códigos da API (`Problem.code`) e códigos do próprio app, cada um com mensagem em português na
interface. Nenhuma mensagem repete senha, token ou chave (FR-007).

| Código | Origem | Mensagem (resumo) |
|---|---|---|
| `validation_error` | API | Algum dado foi recusado pelo servidor (detalhe do servidor). |
| `unauthorized` | API | Chave de acesso recusada — confira a configuração. |
| `forbidden_for_role` | API | Seu perfil (consulta) não permite esta ação. |
| `not_found` | API | Não encontrado. |
| `execution_already_active` | API | Já existe uma execução ativa para esta conta do Hunit (leva até ela). |
| `not_awaiting_two_factor` | API | A execução não está mais aguardando o token. |
| `execution_already_finished` | API | A execução já terminou. |
| `nothing_to_resume` / `execution_already_resumed` | API | Não há o que retomar / já foi retomada. |
| `evidence_expired` | API | A evidência expirou e não está mais disponível. |
| `internal_error` | API | Erro interno do servidor. |
| `offline` | app | Servidor indisponível. |
| `untrusted_server` | app | Não foi possível confirmar a identidade do servidor. |
| `not_configured` | app | Configure a conexão com o servidor. |
| `credentials_missing` / `credentials_expired` | app | Informe usuário e senha do Hunit / apagados por inatividade. |
| `key_storage_unavailable` | app | O Windows não permitiu guardar a chave protegida. |
| `invalid_input` | app | Dado inválido enviado pela interface (erro de programação). |

## 7. Mudanças de dados no servidor

Sem tabela nova e sem coluna nova. Uma migration cria a extensão `unaccent` (busca por nome sem
acento, R-10). As consultas novas usam dados que já existem:

| Acréscimo | Dados usados |
|---|---|
| `requestedClient` na lista de execuções | `executions.client_id` → `api_clients.name` |
| Filtro `active` | `executions.status` em `queued`, `running`, `awaiting_2fa` (regra já existente no servidor) |
| Busca `q` | `reservations.reservation_number`, `transaction_id`, `authorization_code`, `processor_reference` (igualdade sem diferenciar maiúsculas) e `guest_name` (contém, sem maiúsculas e acentos; nulo após anonimização não é encontrado) |
| Busca `amount` | `reservations.total_amount` ou `reservations.charged_amount` iguais ao valor |
| Filtro `channel` e `GET /v1/channels` | `reservations.channel` |
| Evidências da execução | tabela `evidence` por `execution_id`; arquivos disponíveis conforme `screenshot_path`, `html_path`, `response_path`; evidências vencidas já são removidas pela rotina diária (FR-025 da 001) |
