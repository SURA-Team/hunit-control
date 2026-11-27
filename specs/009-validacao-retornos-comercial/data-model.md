# Data Model: Validação dos retornos do Comercial

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md) | **Date**: 2026-11-27

Só o que muda em relação à 008 ([specs/008-ajustes-cobranca-e-aviso/data-model.md](../008-ajustes-cobranca-e-aviso/data-model.md)).
Uma migration (`0015_validacao_retornos`, gerada com `db:generate`).

## 1. Banco

### 1.1 `commercial_returns` (alterada)

| Coluna | Antes | Depois |
|---|---|---|
| `authorization_code` | `text not null` | `text` (nula só em retorno de situação) |
| `charge_hotel` | `text not null` | `text` (idem) |
| `charged_amount` | `money not null` | `money` (idem) |
| `no_charge_mark_id` | — | **nova**: `uuid references no_charge_marks(id)`; a marcação criada por "Confirmar como cancelada sem cobrança" (R-04) |

Restrições:

- `commercial_returns_texts_check` passa a aceitar código e hotel nulos; quando presentes, de 1 a 100
  caracteres. `charged_by` continua obrigatório.
- `commercial_returns_amount_check`: `charged_amount is null or charged_amount > 0`.
- **Nova** `commercial_returns_terminal_fields_check`: se `charge_situation_kind` é nulo (retornos da 005) ou
  diferente de `other`, código, hotel e valor são obrigatórios. Retornos da 008 com `other` já têm os três e
  continuam válidos.
- **Nova** `commercial_returns_no_charge_check`: `no_charge_mark_id is null or (state = 'closed' and
  charge_situation_kind = 'other')`. Por isso, desfazer a marcação **limpa** o vínculo na mesma transação
  em que o retorno volta a `awaiting_validation`; o vínculo antigo fica no histórico (evento com o
  `returnId`).
- `commercial_returns_one_current` (índice único) não muda.

Nenhum valor novo nos enums do banco: as decisões usam `confirmed`, `closed` e `rejected`, e os eventos
`return_confirmed`, `return_rejected` e `cancellation_confirmed` (R-04).

### 1.2 Sem mudança

`commercial_lines` (a aba é calculada, R-06), `commercial_reports` (a data já é nula e o responsável da
"Cancelada" passa a ser exigido pelo domínio; o banco continua aceitando nulo para os relatos antigos),
`no_charge_marks`, `reservation_manual_amounts` e os enums.

## 2. Domínio (`packages/domain`)

### 2.1 Leitura do retorno (`commercial-return.ts`)

```text
CommercialReturnReading =
  | empty
  | report        { kind: charged_in_hunit | cancelled, situationText, chargedBy (obrigatório), chargeDate? }
  | situation     { chargeSituation (other), chargedBy, authorizationCode?, chargeHotel?, chargedAmount?, chargeDate? }   ← novo
  | incomplete    { missing: só os campos que a situação exige }
  | illegible     { problems }
  | complete      { values (os quatro), chargeSituation (charged_at_terminal), chargeDate }
```

O que cada situação exige está no research (R-02). `ReturnSnapshot` (o último retorno lido, guardado em
`commercial_lines.last_read_return`) passa a ter código, hotel e valor opcionais; `returnChanged` compara os
campos presentes e ausentes.

Funções novas ou alteradas:

| Função | O que faz |
|---|---|
| `readReturn(cells)` | regra nova (R-02) |
| `isSituationReturn(kind)` | `kind === 'other'` |
| `returnSnapshot(reading)` | aceita `complete` e `situation` |

### 2.2 Planilha (`commercial-sheet.ts`)

| Item | Mudança |
|---|---|
| `COMMERCIAL_SHEET_TABS` | ganha `awaitingValidation: 'Aguardando validação do Financeiro'` |
| `AWAITING_TAB_DELAY_MINUTES` | novo: `10` |
| `sheetTabOf({ lineState, validation, awaitingSince, now })` | nova (R-06) |

### 2.3 Tratativa (`treatment.ts`)

`treatmentFlags.commercialAmount` passa a ser `null` quando o retorno confirmado não tem valor (o valor
cobrado vem do valor à mão, R-05). Nenhuma outra regra muda: o retorno de situação aguardando validação deixa
a reserva em "Validar comprovante" (`return_pending`), e o confirmado como cobrado vale como comprovante.

## 3. Estados do retorno de situação

```text
                    leitura da planilha (situação livre + responsável)
                                      │
                                      ▼
                           awaiting_validation ──── o Comercial muda a linha ───► superseded (+ leitura nova)
             ┌────────────────────┼──────────────────────────┐
  "Confirmar como cobrada"  "Confirmar como cancelada"    "Recusar"
             │               sem cobrança                    │
             ▼                    │                          ▼
         confirmed                ▼                       rejected
   (comprovante; valor    closed + no_charge_mark_id   (motivo na coluna J; linha
    do Comercial ou à mão)        │                      volta para "A cobrar")
             │          desfazer a marcação
   desfazer a confirmação         │
             │                    ▼
             └──────────► awaiting_validation (se a linha mantém a mesma leitura;
                          no_charge_mark_id volta a nulo)
```

Se o Hunit deixar de exigir cobrança enquanto o retorno de situação aguarda validação, ele é encerrado
(`closed`, sem `no_charge_mark_id`), como os outros retornos (`commercial-repo.ts`).

## 4. Aba da linha na planilha

| Estado da linha | Validação (coluna J) | `read_at` da versão aguardando | Aba |
|---|---|---|---|
| `concluded` ou `cancelled` | qualquer | — | Concluídas |
| `open` | aguardando validação (retorno, situação livre ou "Cancelada") ou aguardando verificação no Hunit | há 10 min ou mais | Aguardando validação do Financeiro |
| `open` | idem | há menos de 10 min | A cobrar |
| `open` | sem retorno, com problema ou recusada | — | A cobrar |

## 5. Retenção e anonimização

Sem regra nova: o texto da situação `other` já é apagado na anonimização (008); o valor à mão segue a 003; o
código e o hotel, quando houver, seguem a regra dos retornos da 005.
