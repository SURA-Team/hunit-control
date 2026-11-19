# Acréscimos à API: 1.6.0 → 1.7.0

Só acréscimos (spec, premissas; research R-13). O `packages/contracts/openapi.yaml` é a fonte da
verdade; este arquivo descreve o que entra nele. Na implementação, a cópia do contrato vai para
`specs/005-envio-comercial/contracts/openapi.yaml`. Todas as rotas exigem chave de API; as marcadas
**operador** respondem 403 `forbidden` ao perfil consulta (spec FR-021). Erros em
`application/problem+json` com `code` estável, como hoje.

## Compatibilidade com o app atual

- `ReservationSituation` e `TreatmentEvent.type` **não ganham valores** (research R-09). Um teste de
  contrato confere.
- Reserva com retorno aguardando validação: `treatment.situation = treatment_sent`; o valor novo fica
  em `treatment.detailedSituation`.
- `treatment.effectiveChargedAmount` passa a considerar o valor do Comercial confirmado (R-10): mesmo
  significado ("valor cobrado a exibir"), com uma origem a mais.

## Reservas

### `GET /reservations` — filtros novos

| Parâmetro | Tipo | Significado |
|---|---|---|
| `detailedSituation` | array de `ReservationDetailedSituation` | como `situation`, com `return_pending` ("Validar comprovante") |

Sem filtro próprio de "enviada ao Comercial" (análise de 2026-11-17): `treatment_sent` já reúne as
enviadas por e-mail e pela planilha.

`amount` passa a encontrar também o valor cobrado informado pelo Comercial.

### `Reservation` e `ReservationTreatment` — campos novos

- `ReservationTreatment.detailedSituation`: `ReservationDetailedSituation` = os valores de
  `ReservationSituation` + `return_pending`.
- `ReservationTreatment.chargedAmountOrigin`: `hunit` | `manual` | `commercial` | `null`.
- `ReservationTreatment.commercialChargedAmount`: `Money` (valor do retorno confirmado) ou `null`.
- `Reservation.commercial` (`null` = nunca enviada):

  ```yaml
  CommercialSummary:
    lineState: open | concluded | cancelled
    inSheet: boolean            # false depois de sair da planilha (90 dias, anonimização)
    lastSentAt: date-time
    lastDispatchId: uuid
    returnState: awaiting_validation | confirmed | rejected | closed | null
    currentReturn: CommercialReturnBrief | null   # acréscimo da implementação, ver abaixo
    returnProblem: string | null   # "Retorno incompleto: falta o valor cobrado"
    syncPending: boolean           # a linha tem atualização da planilha pendente
  CommercialReturnBrief:           # o retorno atual, sem consulta por reserva
    id, state, authorizationCode, chargeHotel, chargedAmount, chargedBy, readAt,
    difference                     # valor cobrado menos o valor total da reserva
  ```

  `currentReturn` entrou na implementação (T045, T050): a lista de revisão da confirmação em lote
  (FR-016a) e a aba "Retornos a validar" mostram o código, o hotel da cobrança, os valores e a
  diferença sem uma consulta por reserva.

### `GET /reservations/selection` — selecionar todas do filtro (FR-030, FR-027)

Mesmos filtros de `GET /reservations` (sem `limit` e `cursor`). Devolve até **2 000** reservas, na
ordem da lista, com só os campos da seleção e da cópia:

```yaml
200:
  total: integer          # quantas o filtro encontrou (pode passar de 2000)
  truncated: boolean      # total > 2000
  items: [ SelectionItem ]
SelectionItem:
  hotelCode, hotelName, reservationNumber, guestName (null se anonimizada), channel, checkIn,
  totalAmount, reservationStatus, classification, situation, detailedSituation, needsReview,
  treatmentStatus, effectiveChargedAmount, chargedAmountOrigin,
  currentReturn                  # CommercialReturnBrief | null (lista de revisão, FR-016a)
```

`guestName` serve só à lista da seleção no app; a cópia para e-mail nunca o usa (FR-027).

### `GET /reservations/{hotelCode}/{reservationNumber}/commercial`

Linha, retornos e histórico do Comercial da reserva (o histórico da 003 continua em `/treatment`):

```yaml
200:
  line: CommercialLine | null
  returns: [ CommercialReturn ]        # do mais recente para o mais antigo
  events: [ CommercialEvent ]          # do mais recente para o mais antigo
CommercialLine:
  state, inSheet, tab (to_charge | done | null), firstSentAt, lastSentAt, lastDispatchId,
  lastSentBy (nome do cliente), concludedAt, cancelledAt, cancelledBy, restorableUntil,
  returnProblem, sheetIssue, syncPending
CommercialReturn:
  id, authorizationCode, chargeHotel, chargedAmount, chargedBy, readAt,
  state (awaiting_validation | confirmed | rejected | superseded | closed),
  decidedAt, decidedBy, rejectionReason, expectedAmount (total da reserva), difference
CommercialEvent:
  id, type (dispatched | withdrawn | line_cancelled | line_restored | line_concluded |
  return_received | return_changed | return_ignored | return_confirmed | return_rejected |
  return_confirmation_undone | return_closed),
  actor: { kind: client | commercial_sheet, name }, at, dispatchId, returnId, classification,
  reason, batchId
```

### `POST /reservations/{h}/{n}/commercial/cancel` — desfazer o envio (**operador**)

200 com `CommercialLine`. 409 `return_awaiting_validation` se houver retorno aguardando validação;
409 `not_in_commercial_sheet` se a linha não estiver aberta.

### `POST /reservations/{h}/{n}/commercial/restore` — reverter o desfazer (**operador**)

200 com `CommercialLine`. 409 `restore_expired` depois de 30 dias; 409 `not_in_commercial_sheet` se a
linha não estiver cancelada; 409 `not_eligible_for_treatment` (FR-003) se a reserva não aceita mais o
envio (o código de recusa da 003, em vez de um 422 novo).

## Envios ao Comercial

### `POST /commercial-dispatches/check` (**operador**)

Corpo: `{ reservations: [{ hotelCode, reservationNumber }] }` (1 a 2 000). Não acessa o Hunit.

```yaml
200:
  eligible: [ { hotelCode, reservationNumber, totalAmount, resend: boolean } ]
  ignored:  [ { hotelCode, reservationNumber, reason: not_found | not_accepting | has_proof |
                return_awaiting_validation, message } ]
  totalAmount: Money      # soma das elegíveis
```

### `POST /commercial-dispatches` (**operador**)

Corpo: `{ credentials: { username, password }, reservations: [...] }` (1 a 2 000). A elegibilidade é
conferida de novo (FR-003); as que não aceitam ficam no resultado como `ignored`. Credenciais só em
memória, como em `POST /executions`.

- 202 com `CommercialDispatch`.
- 409 `account_busy` — execução ou envio ativo na mesma conta (R-01).
- 409 `commercial_sheet_not_configured`.
- 422 `no_eligible_reservations`.

```yaml
CommercialDispatch:
  id, status (ExecutionStatus), endReason, endMessage, requestedBy, createdAt, startedAt, finishedAt,
  twoFactorDeadline, parentDispatchId, resumedByDispatchId,
  counts: { total, pending, sent, withdrawn, notVerified, ignored }
  current: { hotelCode, reservationNumber } | null
  lastEventId: string | null     # acréscimo da implementação, ver abaixo
```

`lastEventId` entrou na implementação (T036): o app abre o fluxo de eventos do envio a partir dele
(`Last-Event-ID`), sem reprocessar o histórico — como faz nas execuções com `recentEvents`.

### `GET /commercial-dispatches`

Lista paginada (`limit`, `cursor`, `active`), do mais recente para o mais antigo (FR-020, US3).

### `GET /commercial-dispatches/{id}`

`CommercialDispatch` + `items: [ { hotelCode, reservationNumber, position, outcome (pending | sent |
withdrawn | not_verified | ignored), classificationBefore, classificationAfter, reason, processedAt } ]`.

### `GET /commercial-dispatches/{id}/events`

SSE, como `/executions/{id}/events` (eventos de §1.3 do data-model). Mesmo formato de mensagem.

### `POST /commercial-dispatches/{id}/two-factor` (**operador**)

Corpo `{ token }`. Mesmas respostas de `/executions/{id}/two-factor`.

### `POST /commercial-dispatches/{id}/cancel` (**operador**)

Mesmas respostas de `/executions/{id}/cancel`.

### `POST /commercial-dispatches/{id}/resume` (**operador**)

Corpo `{ credentials }`. Cria o envio filho com os itens `not_verified`. 409 `nothing_to_resume`,
409 `already_resumed`, 409 `account_busy`.

## Retornos do Comercial

### `POST /commercial-returns/{id}/confirm` (**operador**)

200 com `ReservationTreatment`. 409 `return_not_awaiting_validation` (inclusive retorno `closed`,
encerrado porque o Hunit deixou de exigir cobrança ou por comprovante por arquivo).

### `POST /commercial-returns/{id}/reject` (**operador**)

Corpo `{ reason }` (1 a 500 caracteres, obrigatório). 200 com `ReservationTreatment`. 409 como acima.

### `POST /commercial-returns/{id}/undo-confirmation` (**operador**)

200 com `ReservationTreatment`. 409 `return_not_confirmed`.

### `POST /commercial-returns/confirm` — lote (**operador**, FR-016a)

Corpo `{ reservations: [...] }` (1 a 2 000). Uma transação por reserva; confirma o retorno aguardando
validação de cada uma.

```yaml
200:
  batchId: uuid
  results: [ { hotelCode, reservationNumber, outcome: confirmed | ignored | failed, reason } ]
```

## "Verificar" em lote

### `POST /treatment-reviews` (**operador**, FR-029)

Corpo `{ reservations: [...] }` (1 a 2 000). Para cada uma, a mesma regra de
`POST /reservations/{h}/{n}/treatment/review` (003); sem alerta → `ignored` com `no_review_alert`.
Mesmo formato de resposta do lote acima (`outcome: confirmed | ignored | failed`), com
`countsByClassification` das confirmadas.

## Planilha

### `GET /commercial-sheet`

Estado da integração (FR-013, FR-025). Visível aos dois perfis; nunca mostra o ID nem a chave.

```yaml
200:
  configured: boolean
  status: ok | failing | layout_invalid | not_configured
  lastRoundOkAt, lastReadOkAt: date-time | null
  lastError: { code, message, at } | null      # mensagens genéricas (R-04)
  nextAttemptAt: date-time | null
  pending: { count, oldestChangeAt }            # linhas com escrita pendente
  awaitingValidation: integer
  problems: [ { hotelCode, reservationNumber, kind: incomplete | illegible | orphan_line |
                duplicate_line | restored_line, message, at } ]
```

### `POST /commercial-sheet/read` (**operador**)

"Ler retornos agora": faz uma rodada completa (R-06) e responde quando ela termina (até 50 s; se
passar, 202 com o corpo de `GET /commercial-sheet` e a rodada continua). 200 com
`{ sheet: <corpo de GET /commercial-sheet>, round: { returnsReceived, returnsChanged, problems,
linesWritten } }` (`CommercialSheetRead`). 503 `commercial_sheet_unavailable`
com a mensagem genérica, sem mudar nada no sistema. 409 `commercial_sheet_not_configured`.
