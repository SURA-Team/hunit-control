# Acréscimos à API: 1.7.0 → 1.8.0

Só acréscimos (spec FR-014, FR-017 e FR-031; research R-09 e R-18). O `packages/contracts/openapi.yaml` é a fonte da
verdade; este arquivo descreve o que entra nele. Na implementação, a cópia do contrato vai para
`specs/006-redesign-app-desktop/contracts/openapi.yaml` (a da 005 fica congelada na 1.7.0). As rotas
exigem chave de API e valem para os dois perfis (operador e consulta), como a lista de reservas.
Erros em `application/problem+json` com `code` estável, como hoje. O servidor não acessa o Hunit em
nenhuma delas.

## Compatibilidade com o app atual

- Nenhum enum existente ganha valores; `ReservationSituation`, `TreatmentEvent.type` e
  `TreatmentStatus` continuam congelados (teste da 005, R-09).
- Nenhuma resposta existente muda. O parâmetro novo é opcional; sem ele, as rotas respondem como
  na 1.7.0.

## Enum novo `ReservationQuickFilter`

| Valor | Filtro rápido | Reservas incluídas (spec FR-016) |
|---|---|---|
| `pending_charge` | Falta cobrar | As de `pendingCharge=true` (inclui "Validar comprovante") |
| `to_review` | A verificar | Alerta "Verificar" (`needsReview`) **ou** situação "A revisar (sistema anterior)" (`not_virtual_card` sem comprovante) **ou** "Validar comprovante" (`detailedSituation = return_pending`) |
| `with_error` | Com erro | `detailedSituation` em `virtual_card_charge_error`, `analysis_error` |
| `done` | Concluídas | `detailedSituation` em `proof_sent`, `invoiced`, `virtual_card_already_charged`, `cancelled_no_charge`, `ignored_hotelbeds_258` |

"Todas" é a ausência do parâmetro. Uma reserva pode estar em mais de um grupo. A regra é a de
`quickFiltersOf` do domínio ([data-model.md](../data-model.md)).

## Enum novo `ReservationOrder` (research R-18)

| Valor | Ordem |
|---|---|
| `hotel_number` | Código do hotel e número da reserva (padrão; a ordem de hoje) |
| `hotel_check_in` | Código do hotel, data de check-in crescente e número da reserva (a do app novo, spec FR-014) |

## `GET /reservations` e `GET /reservations/selection` — parâmetros novos

| Parâmetro | Tipo | Significado |
|---|---|---|
| `quickFilter` | `ReservationQuickFilter` | Só as reservas do grupo, combinado com "e" com os demais filtros |
| `order` | `ReservationOrder` | Ordem da lista; sem o parâmetro, `hotel_number` |

O `nextCursor` passa a carregar a ordem em que foi gerado. Um cursor usado com outra ordem (ou com
`order` diferente do da primeira página) responde 400 `invalid_cursor`, como qualquer cursor
inválido. Cursores emitidos pela 1.7.0 continuam válidos para `hotel_number` durante a implantação
(o servidor aceita o formato antigo `[hotel, número]` como `hotel_number`).

Na seleção, "as 2 000 primeiras na ordem da lista" (005, FR-030) passa a seguir o `order` informado.

## Rota nova `GET /reservations/quick-filter-counts`

Contagem das reservas de cada filtro rápido, considerando a busca e os demais filtros (spec FR-017).

**Parâmetros**: os mesmos filtros de `GET /reservations` (`executionId`, `hotelCode`,
`classification`, `reservationStatus`, `notFound`, `checkInFrom`, `checkInTo`, `q`, `channel`,
`amount`, `treatmentStatus`, `pendingCharge`, `situation`, `needsReview`, `fromLegacy`,
`detailedSituation`), sem `quickFilter`, `cursor` e `limit`. Valores inválidos: 400 como na lista.

**Resposta 200** (`ReservationQuickFilterCounts`):

```json
{ "all": 12, "pendingCharge": 5, "toReview": 0, "withError": 3, "done": 4 }
```

| Campo | Significado |
|---|---|
| `all` | Reservas que atendem aos filtros ("Todas"; também o "Mostrando X de Y") |
| `pendingCharge`, `toReview`, `withError`, `done` | Reservas de cada grupo, com os mesmos filtros |

Todos inteiros ≥ 0, obrigatórios. A soma dos grupos pode passar de `all`, porque uma reserva pode
estar em mais de um grupo.

**Erros**: 400 `invalid_parameters`; 401 sem chave.

## Testes de contrato

- `quickFilter` e `order` aceitos nas duas rotas e recusados com valor fora do enum (400).
- `order=hotel_check_in` com cursor percorre todas as reservas uma vez, na ordem certa; cursor de uma
  ordem usado com a outra dá 400 `invalid_cursor`; cursor no formato da 1.7.0 continua aceito.
- `/reservations/quick-filter-counts` validado contra o esquema, com e sem filtros, para os dois
  perfis.
- Paridade (`server-db`): para cada grupo, a contagem é igual ao número de reservas devolvidas pela
  lista com o mesmo `quickFilter` e os mesmos filtros (research R-09).
