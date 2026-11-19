# Data Model: Ajustes de cobrança e do aviso de token

Fase 1 do `/speckit-plan`. Tabelas novas e alteradas no PostgreSQL
(`apps/server/src/persistence/schema.ts`, **uma** migration gerada pelo `db:generate`), regras do
domínio (`packages/domain`, funções puras) e a preferência nova do app. Nenhuma tabela nova guarda o
nome do hóspede.

## 1. Tabelas novas

### 1.1 `no_charge_marks` — marcação "Cancelada sem cobrança" (spec FR-018 a FR-023; research R-08)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `hotel_code`, `reservation_number` | text | FK → `reservations` |
| `previous_amount` | money, nulo | valor a cobrar no momento da marcação (`total_amount`), para "antes R$ …" |
| `note` | text, nulo | observação, 1 a 500 caracteres; apagada na anonimização |
| `marked_by_client_id` | uuid → `api_clients` | quem marcou |
| `marked_at` | timestamptz | |
| `undone_by_client_id` | uuid → `api_clients`, nulo | quem desfez |
| `undone_at` | timestamptz, nulo | |

- Índice único parcial `no_charge_marks_one_active`: no máximo uma marcação com `undone_at` nulo por
  reserva.
- `check`: `undone_at` e `undone_by_client_id` nulos juntos ou preenchidos juntos.
- Só inclusão e o "desfazer" (preenche `undone_*`); marcar de novo cria outra linha. As linhas são o
  histórico (marcou, desfez), com quem e quando.

### 1.2 `commercial_reports` — relato do Comercial sem retorno a validar (spec FR-007a, FR-012; R-06)

| Coluna | Tipo | Regra |
|---|---|---|
| `hotel_code`, `reservation_number` | text | PK; FK → `reservations` |
| `kind` | enum `commercial_report_kind` | `charged_in_hunit` ("Cobrada no Hunit") ou `not_charged` ("Não cobrada") |
| `situation_text` | text | a situação como o Comercial escreveu, 1 a 100 |
| `charged_by` | text | responsável pela cobrança, 1 a 100 |
| `charge_date` | date, nulo | data da cobrança, se informada |
| `read_at` | timestamptz | quando o servidor leu **esta versão** do relato (base da fila, §3.4) |

- Uma linha por reserva: o relato atual da linha da planilha. O Comercial mudar o responsável, a data
  ou o texto atualiza a linha e o `read_at` (a reserva volta a "Aguardando verificação"); trocar para
  outra situação, ou apagar, remove a linha (a reserva sai da fila, FR-012).
- Só existe para linha `open` (como os retornos): relato numa linha que foi para "Concluídas" fica como
  estava (a aba é protegida), e é assim que a fila mostra as confirmadas por 7 dias.

## 2. Tabelas alteradas

| Tabela | Mudança |
|---|---|
| `commercial_returns` | + `charge_situation_text` (text, nulo, até 100), + `charge_situation_kind` (enum `charge_situation_kind`: `charged_at_terminal`, `charged_in_hunit`, `not_charged`, `other`; nulo = situação vazia), + `charge_date` (date, nulo). Num retorno completo o tipo é `charged_at_terminal`, `other` ou nulo (os outros viram relato). `charge_situation_text` com tipo `other` é apagado na anonimização |
| `commercial_lines` | `last_read_return` (jsonb) passa a guardar também a situação e a data normalizadas, para `returnChanged`; sem coluna nova |
| `commercial_dispatches` | + `purpose` (enum `dispatch_purpose`: `send`, `hunit_check`; padrão `send`). A trava de uma automação por conta vale para os dois |
| `commercial_dispatch_items` | `outcome` (`dispatch_item_outcome`) + `checked`; + `check_result` (enum `hunit_check_result`: `confirmed`, `still_pending`; nulo). `check`: `check_result` preenchido se e só se `outcome = 'checked'` |
| `commercial_event_type` (enum) | + `report_received`, `report_changed`, `report_cleared` (o Comercial mudou ou apagou a situação), `hunit_checked` (verificação: `classification` lida e `reason` "cobrança encontrada" ou "cobrança não encontrada") |

Nenhuma mudança em `reservations`, `treatment_documents` e `treatment_events`: a marcação não grava a
classificação na reserva (R-08) e o "Verificar agora" usa `commitVerifiedReservation`, que já atualiza
`last_verified_at`, `verification_count` e `last_dispatch_id`. A busca pelo código do Comercial (R-15)
também não muda o banco: lê `commercial_returns.authorization_code` dos retornos `confirmed`, sem
índice novo.

## 3. Regras do domínio (`packages/domain`)

### 3.1 `commercial-return.ts` (alterado; R-06)

- Colunas de retorno passam a seis: `COMMERCIAL_RETURN_COLUMNS` = os quatro de hoje + `chargeSituation`
  e `chargeDate`. `COMMERCIAL_RETURN_FIELDS` (os quatro obrigatórios do retorno completo) não muda.
- `CHARGE_SITUATIONS`: as três sugeridas, com o tipo e o texto da lista da planilha.
- `recognizeChargeSituation(text)` → `charged_at_terminal` | `charged_in_hunit` | `not_charged` |
  `other` (sem acento, sem maiúsculas, espaços normalizados; ordem: "não cobrad…", "hunit",
  "maquininha").
- `parseChargeDate(cell)` → data ISO ou problema (número de série do Google ou `dd/mm/aaaa`).
- `readReturn(cells)` → `empty` | `report { kind, situationText, chargedBy, chargeDate }` |
  `incomplete` | `illegible` | `complete { values, chargeSituation, chargeDate }` (tabela do R-06).
- `returnChanged` compara também situação e data; `reportChanged(previous, current)`.
- `describeReturnReading` ganha "data da cobrança não entendida" e "falta o responsável pela cobrança"
  para relato sem responsável.

### 3.2 `treatment.ts` (alterado; R-08)

- `effectiveClassification(classification, noChargeMarked)` → `cancelled_no_charge` com marcação
  ativa; senão a própria.
- `reservationSituation`, `detailedSituation`, `isPendingCharge`, `lineState` e `needsReview` recebem
  `noChargeMarked` e usam a classificação efetiva (`needsReview` é sempre falso com marcação).
- `amountToCharge(totalAmount, noChargeMarked)` → `0.00` com marcação; senão `totalAmount`.
- `noChargeEligibility({ classification, noChargeMarked, hasCurrentProof, hasReturnAwaiting })` →
  `eligible` ou o motivo: `already_marked`, `not_accepting` (concluída), `has_proof`,
  `return_awaiting_validation` (FR-022).
- `hunitShowsCharge(classification)` → a classificação do Hunit é `virtual_card_already_charged`
  (aviso do FR-023).

### 3.3 `commercial-dispatch.ts` (alterado)

- `dispatchEligibility` passa a receber `noChargeMarked` (marcada → `not_accepting`).
- `hunitCheckResult(classificationAfter)` → `confirmed` se `requiresCharge` é falso; senão
  `still_pending`.

### 3.4 `commercial-report.ts` (novo; R-07)

`hunitChargeStatus({ readAt, lastVerifiedAt, classification })` → `awaiting` (não lida depois do
relato) | `confirmed` (lida depois e não exige mais cobrança) | `not_found` (lida depois e ainda exige).
`HUNIT_QUEUE_CONFIRMED_DAYS = 7`: até quando uma confirmada fica na lista. O servidor monta o SQL da
fila com a mesma regra (teste de paridade).

### 3.5 `commercial-sheet.ts` (alterado; R-05, R-06, R-08)

- `COMMERCIAL_SHEET_HEADERS` + "Situação da cobrança" e "Data da cobrança" (16 colunas).
- `FinanceValidation` + `hunit_awaiting` ("Aguardando verificação no Hunit", tom laranja),
  `hunit_not_found` ("Cobrança não encontrada no Hunit", vermelho), `not_charged` ("Não cobrada:
  aguardando o Financeiro", vermelho) e `no_charge` ("Cancelada sem cobrança pelo Financeiro", sem
  cor).
- `sheetSystemRow` usa `amountToCharge` na coluna E ("Valor a cobrar").

### 3.6 Grupos dos filtros rápidos

Sem mudança em `quick-filters.ts`: a reserva marcada tem a situação `cancelled_no_charge`, que já está
em "Concluídas", e deixa de estar em "Falta cobrar" porque `isPendingCharge` usa a classificação
efetiva. O teste de paridade da 006 ganha reservas marcadas e relatos.

## 4. Estados

### Marcação "Cancelada sem cobrança"

```text
 (reserva que aceita a ação) ──marcar──► ativa ──desfazer──► desfeita
                                           │
                       (marcar de novo depois de desfeita = outra linha, outra marcação ativa)
```

### Relato do Comercial e a fila "Cobradas no Hunit"

```text
 (planilha: "Cobrada no Hunit" + responsável) ──leitura──► relato charged_in_hunit
        │                                                      │
        │  situação derivada (§3.4), a cada leitura da reserva no Hunit depois de read_at:
        │     awaiting ──(lida, não exige mais cobrança)──► confirmed  → linha vai para "Concluídas"
        │     awaiting ──(lida, ainda exige)──────────────► not_found ──(lida de novo)──► confirmed | not_found
        │
        └──(Comercial troca a situação ou apaga)──► relato removido: a reserva sai da fila
```

### Item de uma verificação (`purpose = hunit_check`)

`pending` → `checked` (`confirmed` | `still_pending`) | `not_verified` (com o motivo; a situação na
fila não muda). Cancelamento ou falha: os `pending` viram `not_verified`, como no envio; a retomada
copia os `not_verified`.

## 5. App desktop — preferência do aviso (R-03)

`Preferences` (arquivo de configuração do app, `ConfigStore`):

| Campo | Tipo | Regra |
|---|---|---|
| `soundEnabled` | boolean | já existia; o valor salvo é mantido (FR-005) |
| `soundVolume` | inteiro 0 a 100 | novo; ausente no arquivo antigo → 100 |
| `idleHours` | inteiro 1 a 24 | sem mudança |

## 6. Volumes e limites

- Marcações: dezenas por mês; relatos: dezenas abertos ao mesmo tempo.
- Uma verificação confere até 2 000 reservas (o limite dos envios); o normal é menos de 50 (SC-005).
- Textos do relato: até 100 caracteres; observação da marcação: até 500.
