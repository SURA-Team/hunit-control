# Contrato da API: 1.8.0 → 1.9.0 (só acréscimos)

**Feature**: [spec.md](../spec.md) | **Research**: [R-01](../research.md#r-01--versões-ordem-de-implantação-e-relação-com-a-007), [R-02](../research.md#r-02--enumerações-que-o-app-03-usa-como-chave-não-ganham-valores), [R-06](../research.md#r-06--leitura-do-retorno-com-situação-e-data) a [R-09](../research.md#r-09--situação-e-data-da-cobrança-no-app)

A fonte da verdade continua sendo `packages/contracts/openapi.yaml`; na implementação ele vai para a
1.9.0, os tipos são gerados de novo (`pnpm --filter @hunit/contracts generate`) e a cópia fica em
`contracts/openapi.yaml` desta pasta (as duas idênticas; a da 006 fica congelada na 1.8.0). O app 0.3
continua funcionando: nenhum campo some, nenhum tipo muda e as enumerações que ele usa como chave não
ganham valores (R-02).

## Rotas novas

| Rota | Perfil | O que faz |
|---|---|---|
| `POST /reservations/{hotelCode}/{reservationNumber}/no-charge` | operador | Marca como cancelada sem cobrança. Corpo: `{ expectedSituation: ReservationDetailedSituation, note?: string (1–500) }`. 200 → `Reservation` atualizada. 409 `no_charge_not_accepted` (com `reason`: `already_marked`, `not_accepting`, `has_proof`, `return_awaiting_validation`) ou `reservation_changed` (a situação não é mais a que a pessoa viu). 404 reserva inexistente |
| `POST /reservations/{hotelCode}/{reservationNumber}/no-charge/undo` | operador | Desfaz. Corpo: `{ markId: uuid }`. 200 → `Reservation`. 409 `no_charge_not_active` (já desfeita ou outra marcação) |
| `GET /commercial-hunit-charges` | todos | A fila "Cobradas no Hunit": `{ items: HunitChargeItem[], counts: { awaiting, notFound, confirmed } }`, ordenada por situação (aguardando, não encontrada, confirmada) e leitura mais antiga primeiro. Sem paginação (dezenas de itens) |
| `POST /commercial-hunit-charges/check` | operador | "Verificar agora": cria uma verificação (`CommercialDispatch` com `purpose = hunit_check`) com os itens aguardando e os não encontrados que ainda exigem cobrança. Corpo: `{ credentials: HunitCredentials }` (como o envio). 202 → `CommercialDispatch`. 409 `no_reports_to_check` ou `account_busy` |

O andamento, o token, o cancelamento, a retomada e os eventos da verificação usam as rotas de
`/commercial-dispatches/{dispatchId}` que já existem.

## Esquemas novos

```yaml
ChargeSituation:            # situação da cobrança informada pelo Comercial (R-06)
  type: object
  required: [kind, text]
  properties:
    kind: { enum: [charged_at_terminal, charged_in_hunit, not_charged, other] }
    text: { type: string, description: Como o Comercial escreveu (até 100) }

NoChargeMark:               # marcação "Cancelada sem cobrança" (R-08)
  type: object
  required: [id, markedAt, markedBy, note, previousAmount, undoneAt, undoneBy]
  properties:
    id: { type: string, format: uuid }
    markedAt: { type: string, format: date-time }
    markedBy: { type: string, description: Nome do cliente da API }
    note: { type: [string, 'null'] }
    previousAmount: { oneOf: [{ $ref: Money }, { type: 'null' }] }
    undoneAt: { type: [string, 'null'], format: date-time }
    undoneBy: { type: [string, 'null'] }

ReservationNoCharge:        # Reservation.noCharge (a marcação ativa)
  allOf: [NoChargeMark]
  required: [hunitShowsCharge]
  properties:
    hunitShowsCharge: { type: boolean, description: O Hunit mostra a reserva como cobrada (FR-023) }

CommercialReportBrief:      # relato atual do Comercial (R-06, R-07)
  type: object
  required: [kind, situationText, chargedBy, chargeDate, readAt, hunitStatus]
  properties:
    kind: { enum: [charged_in_hunit, not_charged] }
    situationText: { type: string }
    chargedBy: { type: string }
    chargeDate: { type: [string, 'null'], format: date }
    readAt: { type: string, format: date-time }
    hunitStatus:
      description: >-
        Só em charged_in_hunit; null em not_charged. confirmed = o Hunit mostra a cobrança;
        not_found = lida depois do relato e o Hunit não mostra a cobrança (research R-07)
      enum: [awaiting, confirmed, not_found, null]

HunitChargeItem:            # linha da fila (tela 7.15)
  type: object
  required: [hotelCode, hotelName, reservationNumber, guestName, channel, amountToCharge,
             chargedBy, chargeDate, readAt, status, checkedAt, classification]
  properties:
    status: { enum: [awaiting, confirmed, not_found] }
    checkedAt: { type: [string, 'null'], format: date-time, description: Última leitura no Hunit depois do relato }
    classification: { $ref: Classification }   # a do Hunit, para "foi para Concluídas (Já cobrada)"
    # demais campos: os da reserva e do relato, com os tipos de Reservation e CommercialReportBrief

CommercialReportProblem:    # relato "Não cobrada", na aba "Retornos com problema"
  type: object
  required: [hotelCode, reservationNumber, situationText, chargedBy, chargeDate, readAt]

CommercialHistoryEvent:     # CommercialEvent com os tipos novos (CommercialDetail.history)
  # mesmos campos de CommercialEvent; type = os 12 de hoje + report_received, report_changed,
  # report_cleared, hunit_checked
```

## Campos novos em esquemas que já existem

| Esquema | Campo novo | Conteúdo |
|---|---|---|
| `Reservation` | `amountToCharge` | `Money` ou nulo: `totalAmount`, ou `0.00` com a marcação (R-08) |
| `Reservation` | `noCharge` | `ReservationNoCharge` ou nulo (marcação ativa). Com ela, `treatment.situation` e `detailedSituation` são `cancelled_no_charge` (valor que já existe) |
| `ReservationTreatment` | `noChargeHistory` | `NoChargeMark[]`, mais recente primeiro, para o histórico do card "Tratativa" |
| `CommercialSummary` (`Reservation.commercial`) | `report` | `CommercialReportBrief` ou nulo |
| `CommercialReturnBrief`, `CommercialReturn` | `chargeSituation`, `chargeDate` | `ChargeSituation` ou nulo; data ou nula ("não informada", FR-011) |
| `CommercialDetail` | `report`, `history` | o relato atual; o histórico com os tipos novos (o `events` de hoje continua igual, só com os 12 tipos) |
| `CommercialSheetStatus` | `reports`, `hunitQueueCount` | relatos "Não cobrada" para "Retornos com problema" (só com a linha em "A cobrar" e a reserva sem marcação "Cancelada sem cobrança"); tamanho da lista da fila (contagem da aba) |
| `CommercialDispatch`, `CommercialDispatchSummary` | `purpose` | `send` ou `hunit_check` |
| `CommercialDispatchItem` | `checkResult` | `confirmed`, `not_found` ou nulo; `outcome` ganha `checked` (só em verificações, R-02) |
| `Problem.code` | — | + `no_charge_not_accepted`, `reservation_changed`, `no_charge_not_active`, `no_reports_to_check` |

## Parâmetro novo

`GET /commercial-dispatches?purpose=send|hunit_check|all` — padrão `send` (o comportamento de hoje:
o app 0.3 nunca recebe uma verificação). O app 0.4 pede `all` para os cards de andamento e o vigia do
token.

## Comportamento novo sem mudança de formato

- Parâmetro `q` de `GET /reservations`, `GET /reservations/selection` e
  `GET /reservations/quick-filter-counts`: passa a achar também pelo código de autorização de um
  retorno do Comercial **confirmado** (texto inteiro, sem maiúsculas), além do que já acha. Só a
  descrição do parâmetro muda no `openapi.yaml` (spec FR-029; research R-15).

## O que não muda

- `ReservationSituation`, `ReservationDetailedSituation`, `TreatmentStatus`, `TreatmentEvent.type`,
  `CommercialEvent.type`, `CommercialReturnState`, `CommercialSheetProblem.kind`: sem valores novos
  (teste `contract-frozen-enums.test.ts`, ampliado).
- As rotas de confirmação (`/commercial-returns/{id}/confirm`, `/commercial-returns/confirm`) não
  olham a data da cobrança (FR-011); um teste confirma retorno com data de hoje pelos dois caminhos.
- `quickFilter` e `GET /reservations/quick-filter-counts`: mesmos parâmetros e grupos; a reserva
  marcada conta em "Concluídas" por ter a situação `cancelled_no_charge`.
