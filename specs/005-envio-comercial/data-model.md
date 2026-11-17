# Data Model: Envio dos pedidos de cobrança ao Comercial

Fase 1 do `/speckit-plan`. Tabelas novas e alteradas no PostgreSQL (`apps/server/src/persistence/schema.ts`,
uma migration gerada pelo `db:generate`), regras do domínio (`packages/domain`) e estados. Nenhuma
tabela guarda o nome do hóspede além do que a 001 já guarda em `reservations`.

## 1. Tabelas novas

### 1.1 `commercial_dispatches` — envio ao Comercial (spec FR-001 a FR-007; research R-01)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `account_key` | text | HMAC do usuário do Hunit (001 R-11) |
| `client_id` | uuid → `api_clients` | quem enviou |
| `parent_dispatch_id` | uuid → `commercial_dispatches`, nulo | retomada; único (uma retomada por envio) |
| `status` | `execution_status` | `queued`, `running`, `awaiting_2fa`, `completed`, `failed`, `cancelled` |
| `end_reason` | `execution_end_reason`, nulo | obrigatório em `failed` e `cancelled` |
| `two_factor_deadline` | timestamptz, nulo | prazo do token (001 FR-004) |
| `created_at`, `started_at`, `finished_at` | timestamptz | |
| `cancelled_by_client_id` | uuid, nulo | auditoria |
| `batch_id` | uuid | o mesmo em todos os eventos gravados por este envio |

Índices: único parcial `commercial_dispatches_one_active_per_account` em `account_key` quando ativo;
único em `parent_dispatch_id`. A regra entre execuções e envios usa *advisory lock* (R-01).

### 1.2 `commercial_dispatch_items` — cada reserva de um envio

| Coluna | Tipo | Regra |
|---|---|---|
| `dispatch_id` | uuid → `commercial_dispatches` | PK com a reserva |
| `hotel_code`, `reservation_number` | text | FK → `reservations` |
| `position` | integer | ordem de processamento (a da seleção) |
| `outcome` | enum `dispatch_item_outcome` | `pending`, `sent`, `withdrawn`, `not_verified` |
| `classification_before` | `classification` | no momento da confirmação |
| `classification_after` | `classification`, nulo | lida na verificação |
| `reason` | text, nulo | motivo de `withdrawn` (a classificação) ou de `not_verified` (sem dado pessoal) |
| `processed_at` | timestamptz, nulo | |

`pending` → (`sent` \| `withdrawn` \| `not_verified`). Cancelamento ou falha do envio: os `pending`
viram `not_verified` com "envio cancelado" ou o motivo da falha. A retomada copia **todos** os
`not_verified` para o envio filho (inclusive "não encontrada": a decisão de repetir é do operador).

### 1.3 `commercial_dispatch_events` — acompanhamento em tempo real

Mesmo formato de `execution_events` (001): `id` bigserial (id das mensagens SSE), `dispatch_id`,
`at`, `type` (`status_changed`, `item_processed`, `retry`, `warning`), `status`, `hotel_code`,
`reservation_number`, `message` (nunca credencial nem nome de hóspede).

### 1.4 `commercial_lines` — a linha de cada reserva enviada (spec FR-008 a FR-013; R-06)

| Coluna | Tipo | Regra |
|---|---|---|
| `hotel_code`, `reservation_number` | text | PK; FK → `reservations` |
| `state` | enum `commercial_line_state` | `open`, `concluded`, `cancelled` |
| `first_sent_at`, `last_sent_at` | timestamptz | |
| `last_dispatch_id` | uuid → `commercial_dispatches` | coluna "Enviada em" usa `last_sent_at` |
| `last_sent_by_client_id` | uuid → `api_clients` | |
| `concluded_at` | timestamptz, nulo | quando foi para "Concluídas" (`concluded` ou `cancelled`) |
| `cancelled_at`, `cancelled_by_client_id` | nulos | envio desfeito (R-11) |
| `removed_from_sheet_at` | timestamptz, nulo | saiu da planilha (90 dias ou anonimização, R-15) |
| `version`, `synced_version` | integer | pendência = `version > synced_version` |
| `changed_at` | timestamptz | última mudança que pede escrita |
| `synced_at` | timestamptz, nulo | última escrita aplicada |
| `last_read_return` | jsonb, nulo | últimos valores lidos das colunas de retorno, normalizados (R-08) |
| `return_problem` | text, nulo | problema atual do retorno (incompleto, ilegível), sem dado do hóspede |
| `return_problem_at` | timestamptz, nulo | |
| `sheet_issue` | text, nulo | último caso relatado na linha (apagada, alterada, duplicada) |

A aba é derivada: `open` → "A cobrar"; `concluded` ou `cancelled` → "Concluídas"; com
`removed_from_sheet_at` → fora da planilha. O estado `concluded` é recalculado a cada mudança da
reserva (R-06, §3.3).

### 1.5 `commercial_returns` — retorno do Comercial (spec FR-014 a FR-019)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `hotel_code`, `reservation_number` | text | FK → `reservations` |
| `authorization_code` | text | 1 a 100 caracteres |
| `charge_hotel` | text | "Hotel da cobrança", texto livre, 1 a 100 |
| `charged_amount` | money | > 0 |
| `charged_by` | text | "Responsável pela cobrança", 1 a 100 |
| `read_at` | timestamptz | quando o servidor leu |
| `state` | enum `commercial_return_state` | `awaiting_validation`, `confirmed`, `rejected`, `superseded`, `closed` |
| `decided_at`, `decided_by_client_id` | nulos | confirmação ou recusa |
| `rejection_reason` | text, nulo | 1 a 500; obrigatório em `rejected`; apagado na anonimização |
| `batch_id` | uuid, nulo | confirmação em lote |

Índice único parcial: no máximo um retorno `awaiting_validation` ou `confirmed` por reserva.

### 1.6 `commercial_events` — histórico do Comercial por reserva (spec FR-020)

Só inclusão, como `treatment_events` (003). `id` bigserial, `hotel_code`, `reservation_number`,
`type` (enum `commercial_event_type`), `dispatch_id` (nulo), `return_id` (nulo), `client_id` (nulo =
"Comercial (planilha)"), `classification` (nulo; em `withdrawn`), `reason` (nulo; motivo da recusa ou
da retirada), `batch_id` (nulo), `at`.

Tipos: `dispatched`, `withdrawn`, `line_cancelled`, `line_restored`, `line_concluded`,
`return_received`, `return_changed`, `return_ignored`, `return_confirmed`, `return_rejected`,
`return_confirmation_undone`, `return_closed`.

### 1.7 `commercial_sheet_state` — estado da planilha (uma linha só)

`id` (sempre 1), `last_round_at`, `last_round_ok_at`, `last_read_ok_at`, `last_error_code` (nulo;
códigos de R-04), `last_error_at`, `consecutive_failures`, `next_attempt_at`.

## 2. Tabelas alteradas

- `reservations`: + `last_dispatch_id` (uuid → `commercial_dispatches`, nulo). "Verificada pelo HUNIT
  Control" = `last_execution_id` ou `last_dispatch_id` preenchido (R-02; ajusta a precedência da 004).
- Nenhuma mudança em `treatment_documents` e `treatment_events`: o "Verificar" em lote usa
  `review_confirmed` com `batch_id` (já existe).

## 3. Regras do domínio (`packages/domain`, funções puras)

### 3.1 `commercial-dispatch.ts`

- `dispatchEligibility(input)` → `eligible` ou o motivo (spec FR-003): a classificação aceita tratativa
  (`acceptsTreatment`, inclui "A revisar (sistema anterior)"), **não** tem comprovante (documento ou
  retorno confirmado) e **não** tem retorno aguardando validação. Linha já aberta é elegível (reenvio).
- `dispatchOutcome(classificationAfter)` → `sent` se `requiresCharge`, senão `withdrawn` com a
  classificação (spec FR-005).
- `canCancelLine(line, hasReturnAwaiting)`; `canRestoreLine(line, now)` (até 30 dias depois do
  cancelamento, `TREATMENT_REVERT_DAYS`, e a reserva ainda elegível).

### 3.2 `commercial-return.ts` (R-08)

`readReturn(cells)` → `empty` | `incomplete(missing)` | `illegible(problems)` | `complete(values)`;
`parseChargedAmount(cell)`; `returnChanged(previous, current)`.

### 3.3 `treatment.ts` (alterado, R-09, R-10)

- `treatmentStatus({ hasCurrentRequest, hasCurrentProof })` — chamado com
  `hasCurrentRequest = documento de tratativa atual || linha open` e
  `hasCurrentProof = documento de comprovante atual || retorno confirmed`.
- `detailedSituation(classification, status, hasReturnAwaiting)` → `ReservationSituation | 'return_pending'`.
- `effectiveChargedAmount(hunit, manual, commercial, hasCurrentProof)` → `{ amount, origin }`.
- `lineState(input)` → `open` | `concluded` (linha não cancelada: `concluded` quando a situação é
  "Comprovante enviado" ou o status do Hunit não exige mais cobrança; volta a `open` se a confirmação
  for desfeita ou o Hunit voltar a exigir cobrança).

### 3.4 `commercial-sheet.ts`

Nomes das abas e colunas (FR-010), rótulos em português de classificação, situação detalhada, ativa ou
cancelada e "Validação do Financeiro"; `sheetRow(reservation, line, return)` → valores das colunas do
sistema (sem o nome do hóspede); `copyRows(...)` para a cópia para e-mail (FR-027).

## 4. Estados

### Retorno

```text
             (lido completo)
   ──────────────► awaiting_validation ──confirmar──► confirmed
                      │   ▲     │                       │
     (Comercial muda) │   │     └──recusar──► rejected  └─desfazer confirmação─► awaiting_validation
                      ▼   │                     │
                 superseded ◄─(Comercial muda)──┘
   awaiting_validation ──(comprovante por arquivo ou envio desfeito)──► closed
```

### Linha

```text
 (enviada) ──► open ──(comprovante / Hunit não exige mais)──► concluded ──(desfazer confirmação /
                │ ▲                                                          Hunit volta a exigir)──► open
                │ └──────────(reverter em 30 dias)──────────┐
                └──(desfazer envio, sem retorno aguardando)──► cancelled
 concluded/cancelled ──(90 dias ou anonimização)──► fora da planilha (removed_from_sheet_at)
```

### Envio

Os estados da execução (constitution IV). `completed` mesmo com itens `withdrawn` ou `not_verified`
(o envio terminou; o resultado diz o que aconteceu com cada reserva).

## 5. Volumes e limites

- Até 2 000 reservas por envio, por lote e por seleção (003 FR-006a).
- "A cobrar": centenas de linhas; "Concluídas": 90 dias de concluídas.
- Textos do retorno: até 100 caracteres; motivo da recusa: até 500.
