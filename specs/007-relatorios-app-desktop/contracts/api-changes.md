# Contrato da API: 1.9.0 → 1.10.0 (só acréscimos)

**Feature**: [spec.md](../spec.md) | **Research**: [R-01](../research.md#r-01--versões-e-implantação), [R-02](../research.md#r-02--uma-rota-de-resumo-com-os-hotéis), [R-07](../research.md#r-07--gaveta-do-hotel-e-a-ida-para-reservas) | **Modelo**: [data-model.md](../data-model.md)

A fonte da verdade continua sendo `packages/contracts/openapi.yaml`. Na implementação, ele vai para a
1.10.0, os tipos são gerados de novo (`pnpm --filter @hunit/contracts generate`) e a cópia fica em
`contracts/openapi.yaml` desta pasta; a da 008 fica congelada na 1.9.0. O app 0.4 continua
funcionando: nenhum campo some, nenhum tipo muda, nenhuma enumeração congelada ganha valor.

## Rota nova

| Rota | Perfil | O que faz |
|---|---|---|
| `GET /reports/overview` | todos | Resumo do período de check-in ([data-model.md](../data-model.md) §2). Parâmetros `checkInFrom` e `checkInTo` (obrigatórios, `date`). 200 → `ReportOverview`. 400 `validation_error` (falta uma data, data inexistente ou início depois do fim). Não acessa o Hunit |

## Parâmetro alterado

| Onde | Mudança |
|---|---|
| `ReservationOrder` (`order` de `GET /reservations` e `GET /reservations/selection`) | valor novo `amount_desc`: valor total do maior para o menor (nas reservas em aberto, o valor a cobrar), sem valor no fim, depois hotel e número. Só o app 0.5 manda; sem ele, a ordem continua a de antes. `ReservationOrder` é parâmetro de entrada e não está entre as enumerações congeladas |

## 1.10.0 → 1.11.0 (ajuste depois do merge, research R-14)

| Onde | Mudança |
|---|---|
| `GET /reports/overview` | parâmetros opcionais `hotelCode` (lista), `detailedSituation` (lista), `reservationStatus` (lista), `channel`, `fromLegacy` e `notFound`, com a mesma regra de `GET /reservations`. Com `hotelCode`, `hotels.total` conta só os hotéis informados. Sem eles, a resposta é a da 1.10.0. Só o app 0.5.1 manda; o servidor 1.10.0 os ignoraria, por isso o servidor sobe antes |

## Esquemas novos

```yaml
ReportOverview:
  type: object
  required: [period, generatedAt, lastVerifiedAt, reservations, treatmentsSent, withoutAmount, hotels, open, charged, hotelRows]
  properties:
    period:
      type: object
      required: [from, to]
      properties:
        from: { type: string, format: date }
        to: { type: string, format: date }
    generatedAt: { type: string, format: date-time }
    lastVerifiedAt: { type: [string, 'null'], format: date-time }
    reservations: { type: integer, minimum: 0 }      # reservas do relatório (sem Ignorada, A revisar e Faturada)
    treatmentsSent: { type: integer, minimum: 0 }
    withoutAmount: { type: integer, minimum: 0 }
    hotels:
      type: object
      required: [withData, total]
      properties:
        withData: { type: integer, minimum: 0 }
        total: { type: integer, minimum: 0 }
    open:
      type: object
      required: [amount, count, requested, pending]
      properties:
        amount: { $ref: '#/components/schemas/Money' }
        count: { type: integer, minimum: 0 }
        requested: { $ref: '#/components/schemas/Money' }
        pending: { $ref: '#/components/schemas/Money' }
    charged:
      type: object
      required: [amount, previous, recovered]
      properties:
        amount: { $ref: '#/components/schemas/Money' }
        previous: { $ref: '#/components/schemas/Money' }
        recovered: { $ref: '#/components/schemas/Money' }
    hotelRows:
      type: array
      items: { $ref: '#/components/schemas/HotelReportRow' }

HotelReportRow:
  type: object
  required: [hotelCode, hotelName, reservations, treatmentsSent, openCount, openAmount, requested, pending, previousCharged, recovered]
  properties:
    hotelCode: { type: string }
    hotelName: { type: string }
    reservations: { type: integer, minimum: 0 }
    treatmentsSent: { type: integer, minimum: 0 }
    openCount: { type: integer, minimum: 0 }
    openAmount: { $ref: '#/components/schemas/Money' }
    requested: { $ref: '#/components/schemas/Money' }
    pending: { $ref: '#/components/schemas/Money' }
    previousCharged: { $ref: '#/components/schemas/Money' }
    recovered: { $ref: '#/components/schemas/Money' }
```

`Money` é o esquema de valor que já existe (texto `"1234.56"`). A descrição do `info` do contrato ganha
o parágrafo da 007.

## Testes

- Contrato: 200 com reservas em todas as situações, 200 com período vazio (zeros, `hotelRows` vazia,
  `lastVerifiedAt` nulo), 400 nas três recusas, 401 sem chave; perfil consulta aceito.
- `order=amount_desc` na lista e na seleção, com cursor.
- As duas cópias do contrato idênticas; a da 008 inalterada.
