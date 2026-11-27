# API 1.11.0 → 1.12.0

**Feature**: [spec.md](../spec.md) | **Research**: [R-01, R-03, R-04, R-06](../research.md)

Só acréscimos. O contrato completo continua em `packages/contracts/openapi.yaml` (fonte da verdade); a cópia
`specs/009-validacao-retornos-comercial/contracts/openapi.yaml` é criada na implementação, idêntica. Nenhuma
enum congelada ganha valor (`contract-frozen-enums.test.ts`).

## Rota nova

### `POST /commercial-returns/{returnId}/situation/confirm` — somente operador

Decide um retorno de situação (situação livre do Comercial) aguardando validação. Não acessa o Hunit.

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [as]
        additionalProperties: false
        properties:
          as:
            type: string
            enum: [charged, no_charge]
            description: >-
              charged = "Confirmar como cobrada" (vale como comprovante); no_charge = "Confirmar como
              cancelada sem cobrança" (marca a reserva, como a "Cancelada" da 008)
          chargedAmount:
            $ref: '#/components/schemas/Money'
            description: >-
              Só com as = charged e só quando o Comercial não informou o valor; gravado como valor
              informado à mão (chargedAmountOrigin = manual)
          note:
            type: string
            minLength: 1
            maxLength: 500
            description: Só com as = no_charge; observação opcional da marcação
responses:
  '200': Reservation (atualizada)
  '400': chargedAmount faltando (`charged_amount_required`), mandado quando o Comercial já informou
         (`charged_amount_from_commercial`) ou campo que não vale para a decisão
  '401', '403', '404'
  '409': o retorno não é de situação (`not_a_situation_return`), não está aguardando validação
         (`return_not_awaiting_validation`) ou a reserva não aceita a marcação (`no_charge_not_accepted`,
         com `reason`)
```

A recusa usa a rota de hoje, `POST /commercial-returns/{returnId}/reject`. Desfazer usa as de hoje:
`POST /commercial-returns/{returnId}/undo-confirmation` (cobrada) e `POST /reservations/{h}/{n}/no-charge/undo`
(cancelada sem cobrança; o retorno volta a aguardar validação, R-04).

## Rotas que mudam de comportamento

| Rota | Mudança |
|---|---|
| `POST /commercial-returns/{returnId}/confirm` | retorno de situação → 409 `situation_return_needs_decision` |
| `POST /commercial-returns/confirm` (lote) | retorno de situação fica de fora com `no_return_awaiting_validation` (motivo que já existe) |
| `POST /commercial-returns/{returnId}/reject` | aceita também retorno de situação (sem mudança de forma) |

## Campos novos

### `CommercialSituationReturn` (schema novo)

```yaml
CommercialSituationReturn:
  type: object
  description: Retorno do Comercial com uma situação livre (feature 009); código, hotel e valor opcionais
  required: [id, state, situationText, chargedBy, authorizationCode, chargeHotel, chargedAmount, chargeDate,
             readAt, decidedAt, decidedBy, rejectionReason, decision]
  properties:
    id: { type: string, format: uuid }
    state:
      type: string
      enum: [awaiting_validation, confirmed, rejected, closed]
    situationText: { type: string, maxLength: 100, description: Como o Comercial escreveu }
    chargedBy: { type: string }
    authorizationCode: { type: [string, 'null'] }
    chargeHotel: { type: [string, 'null'] }
    chargedAmount:
      oneOf: [{ type: 'null' }, { $ref: '#/components/schemas/Money' }]
    chargeDate: { type: [string, 'null'], format: date }
    readAt: { type: string, format: date-time }
    decidedAt: { type: [string, 'null'], format: date-time }
    decidedBy: { type: [string, 'null'] }
    rejectionReason: { type: [string, 'null'] }
    decision:
      type: [string, 'null']
      description: charged = confirmada como cobrada; no_charge = confirmada como cancelada sem cobrança; null = não decidida ou recusada
      enum: [charged, no_charge, null]
```

### Acréscimos em schemas existentes

| Schema | Campo novo | Conteúdo |
|---|---|---|
| `CommercialSummary` | `situationReturn` | `CommercialSituationReturn` ou `null`: o retorno de situação atual. Quando ele existe, `currentReturn` é `null` e `returnState` traz o estado dele |
| `CommercialDetail` | `situationReturns` | lista de `CommercialSituationReturn`, do mais recente ao mais antigo (os retornos de situação não aparecem em `returns`) |
| `CommercialLine` | `sheetTab` | `to_charge \| awaiting_validation \| done \| null`. `tab` continua com `to_charge \| done \| null` (a aba nova aparece como `to_charge` para os apps antigos) |

`CommercialSheetStatus.awaitingValidation` continua contando todos os retornos aguardando validação,
inclusive os de situação, e as "Cancelada" (descrição atualizada).

## Compatibilidade

| App | O que vê de um retorno de situação |
|---|---|
| 0.3 a 0.5.1 | a reserva em "Validar comprovante", com `currentReturn` nulo ("—" na lista); "Confirmar" recusado com 409; fora do lote |
| 0.6.0 | `situationReturn`, com as três decisões |
