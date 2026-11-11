# Data Model: Consulta de Reservas de Cartão Virtual no Hunit

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md) | **Date**: 2026-11-11

Banco: PostgreSQL 17. Nomes de tabelas e colunas em inglês (código); significado em português.
Nenhuma tabela armazena senha, token 2FA, usuário do Hunit ou sessão do Hunit (FR-005).

## Visão geral

```text
api_clients 1───* executions *───1 (account_key)
                     │ 1
                     ├───* execution_hotels *───1 hotels
                     ├───* execution_events
                     ├───* reservation_observations *───1 reservations
                     └───* evidence
executions 0..1───* executions   (retomada: parent_execution_id)
```

## Enumerações

| Enum | Valores | Origem |
|---|---|---|
| `client_role` | `operator`, `reader` | FR-007 |
| `execution_status` | `queued`, `running`, `awaiting_2fa`, `completed`, `failed`, `cancelled` | Constitution IV |
| `execution_end_reason` | `invalid_credentials`, `invalid_token`, `two_factor_timeout`, `hunit_unavailable`, `hunit_screen_not_recognized`, `session_expired`, `server_restarted`, `cancelled_by_client`, `internal_error` | FR-003, edge cases |
| `hotel_run_status` | `pending`, `running`, `completed`, `failed`, `cancelled` | FR-021 |
| `classification` | `ignored_hotelbeds_258`, `not_virtual_card`, `virtual_card_charge_error`, `virtual_card_already_charged`, `virtual_card_validated_only`, `virtual_card_pending_charge`, `analysis_error` | FR-013 |
| `reservation_status` | `active`, `cancelled`, `unknown` | FR-014a |
| `evidence_kind` | `navigation_failure`, `classification_failure`, `screen_not_recognized`, `reservation_status_unknown` | FR-024 |

## Entidades

### api_clients — Cliente autorizado (FR-007)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | único; ex.: `desktop`, `sura` |
| `role` | `client_role` | |
| `key_hash` | text | SHA-256 da chave; único |
| `created_at` | timestamptz | |
| `revoked_at` | timestamptz null | cliente revogado é recusado |

### hotels — Catálogo (FR-008)

| Campo | Tipo | Regras |
|---|---|---|
| `code` | text PK | identificador do hotel no Hunit |
| `name` | text | |
| `first_seen_at` / `last_seen_at` | timestamptz | atualizados a cada leitura do catálogo |
| `available` | boolean | `false` se não apareceu no último catálogo lido |

### executions — Execução (FR-001 a FR-006, FR-021 a FR-023)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | uuid PK | |
| `account_key` | text | HMAC do usuário do Hunit (R-11) |
| `client_id` | uuid FK api_clients | quem iniciou |
| `parent_execution_id` | uuid FK executions null | preenchido em retomadas |
| `period_from`, `period_to` | date | `period_from <= period_to` |
| `requested_hotel_codes` | text[] null | `null` = todos os hotéis do catálogo (FR-009) |
| `status` | `execution_status` | ver transições |
| `end_reason` | `execution_end_reason` null | obrigatório em `failed`/`cancelled` |
| `two_factor_deadline` | timestamptz null | preenchido ao entrar em `awaiting_2fa` (FR-004) |
| `created_at`, `started_at`, `finished_at` | timestamptz | |
| `cancelled_by_client_id` | uuid FK null | auditoria (FR-007) |

**Restrição**: índice único parcial em `account_key` onde `status in ('queued','running','awaiting_2fa')`
→ garante no máximo uma execução ativa por conta (FR-006).

**Transições de estado**:

```text
queued ──► running ──► awaiting_2fa ──► running ──► completed
   │          │              │              │
   │          │              ├─ token inválido/expirado ─► failed (invalid_token | two_factor_timeout)
   │          ├─ credenciais inválidas / Hunit fora / tela não reconhecida ─► failed
   │          └─ sessão expirada / reinício do servidor ─► failed (session_expired | server_restarted)
   └──────────┴──────────────┴──────── cancelar ─► cancelled (cancelled_by_client)
```

- `completed` é usado mesmo quando alguns hotéis falharam; os hotéis falhos aparecem em
  `execution_hotels` (edge case "falha repetida em um hotel").
- Ao iniciar, o servidor marca como `failed/server_restarted` toda execução que estava ativa
  (credenciais em memória foram perdidas).
- Retomada (FR-023): cria nova execução com `parent_execution_id` e `requested_hotel_codes` = hotéis
  da execução original que não estão `completed`. Se a original terminou antes de definir os
  hotéis (ex.: token inválido), repete o pedido original. Só execuções encerradas são retomadas,
  inclusive `completed` com hotéis falhos (research R-19).
- Cancelamento (FR-022): os hotéis em andamento ficam `cancelled` sem gravar; os pendentes
  continuam `pending`, para a retomada.

### execution_hotels — Processamento de hotel (FR-019, FR-021)

| Campo | Tipo | Regras |
|---|---|---|
| `execution_id` + `hotel_code` | PK composta | |
| `status` | `hotel_run_status` | |
| `pages_total`, `pages_done` | int null | `pages_total` descoberto dinamicamente (FR-011) |
| `reservations_total` | int | reservas informadas pela listagem do Hunit (soma dos blocos do período); base das "reservas ainda não processadas" da estimativa (R-08a) |
| `reservations_seen` | int | |
| `counts` | jsonb | contagem por `classification` |
| `failure_reason` | text null | |
| `started_at`, `finished_at` | timestamptz null | duração do hotel (FR-021a) |
| `reservations_opened` | int | reservas efetivamente abertas/lidas (exclui "258-"); base da média por reserva (R-08a) |

### execution_events — Eventos recentes (FR-021)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | bigserial PK | ordem dos eventos; usado como `id` do SSE |
| `execution_id` | uuid FK | |
| `at` | timestamptz | |
| `type` | text | ex.: `status_changed`, `hotel_started`, `page_done`, `reservation_classified`, `hotel_failed` |
| `status` | `execution_status` null | novo estado da execução, nos eventos `status_changed` |
| `hotel_code`, `reservation_number` | text null | |
| `message` | text | sem credenciais nem nome de hóspede |

### reservations — Reserva (FR-016 a FR-018a, FR-026)

| Campo | Tipo | Regras |
|---|---|---|
| `hotel_code` + `reservation_number` | PK composta | FR-017 |
| `guest_name` | text null | `null` após anonimização (FR-026) |
| `channel` | text | |
| `check_in`, `check_out` | date | |
| `stay_period` | text | como exibido no Hunit |
| `total_amount` | numeric(12,2) | |
| `reservation_status` | `reservation_status` | FR-014a |
| `classification` | `classification` | FR-013 |
| `reason` | text | FR-014 |
| `pre_payment_found` | boolean | |
| `charged_at` | timestamptz null | data/hora do último evento de pagamento: "Cobrado em" ou, se a classificação for `virtual_card_validated_only`, "Validado em" |
| `charged_by` | text null | responsável pelo último evento de pagamento |
| `charged_amount` | numeric(12,2) null | valor do último evento de pagamento (pode ser 0 numa validação) |
| `transaction_id`, `authorization_code`, `processor_reference` | text null | |
| `is_installment` | boolean null | |
| `installment_count` | int null | |
| `installment_amount` | numeric(12,2) null | |
| `pre_payment_state`, `pre_payment_message` | text null | |
| `charge_action_visible` | boolean | apenas sinal; nunca acionado (FR-012) |
| `first_verified_at`, `last_verified_at` | timestamptz | FR-018 |
| `verification_count` | int | ≥ 1 |
| `changed_fields` | text[] | campos alterados na última verificação |
| `status_changed` | boolean | classificação **ou** situação mudou na última verificação |
| `previous_classification` | `classification` null | |
| `previous_reservation_status` | `reservation_status` null | ativa → cancelada (FR-018) |
| `status_changed_at` | timestamptz null | |
| `not_found_since` | timestamptz null | FR-018a; `null` quando vista novamente |
| `last_execution_id` | uuid FK executions | |
| `anonymized_at` | timestamptz null | FR-026 |

**Regras de atualização (FR-018)** — ao gravar um hotel concluído:
1. Reserva nova → insere com `first_verified_at = last_verified_at = agora`, `verification_count = 1`.
2. Reserva conhecida → compara campos; atualiza `changed_fields`; se `classification` ou
   `reservation_status` mudou, guarda o anterior e `status_changed_at = agora`; incrementa
   `verification_count`; `last_verified_at = agora`; `not_found_since = null`.
3. Reservas do hotel com `check_in` dentro do período consultado que **não** foram vistas →
   `not_found_since = coalesce(not_found_since, agora)`; nada mais muda (FR-018a).

Índices: `(classification)`, `(reservation_status)`, `(hotel_code, check_in)`,
`(not_found_since) where not null`, `(check_in) where anonymized_at is null` (rotina de anonimização).

### reservation_observations — O que cada execução viu (FR-020 "por execução")

| Campo | Tipo | Regras |
|---|---|---|
| `execution_id` + `hotel_code` + `reservation_number` | PK composta | |
| `classification` | `classification` | valor observado nesta execução |
| `reservation_status` | `reservation_status` | |
| `observed_at` | timestamptz | |

Não contém nome do hóspede (não precisa de anonimização).

### evidence — Evidência (FR-024, FR-025)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | uuid PK | |
| `execution_id` | uuid FK | |
| `hotel_code`, `reservation_number` | text null | |
| `kind` | `evidence_kind` | |
| `reason` | text | |
| `screenshot_path`, `html_path`, `response_path` | text null | relativos ao volume `/data/evidence`; pelo menos um preenchido. `response_path` = JSON da resposta do Hunit que não foi reconhecida (falhas da coleta pela rede) |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | `created_at + 30 dias`; removida pela rotina diária |

## Objeto de domínio (não persistido): `ReservationSnapshot`

Produzido pela camada do Hunit (leitor do `BookingDetail`, research R-13a), consumido por `classifyReservation` em `packages/domain` (R-06):

| Campo | Tipo | Significado |
|---|---|---|
| `reservationNumber` | string | |
| `structureRecognized` | boolean | a tela de detalhe foi reconhecida |
| `prePaymentPresent` | boolean \| null | `null` = não foi possível determinar |
| `chargeRecordPresent` | boolean \| null | registro "Cobrado em" |
| `chargeActionVisible` | boolean \| null | ação de cobrar visível (somente leitura) |
| `chargeFailed` | boolean \| null | estado ativo indica falha de cobrança |
| `validationOnly` | boolean \| null | último evento foi só validação do cartão ("Validado em"), sem cobrança |
| `reservationStatus` | `active` \| `cancelled` \| `unknown` | |
| `payment` | objeto | `chargedAt`, `chargedBy`, `chargedAmount`, `transactionId`, `authorizationCode`, `processorReference`, `installment*`, `prePaymentState`, `prePaymentMessage` |
| `listing` | objeto | `guestName`, `channel`, `checkIn`, `checkOut`, `stayPeriod`, `totalAmount` |

Qualquer `null` nos campos que decidem a classificação leva a `analysis_error` (FR-015).
