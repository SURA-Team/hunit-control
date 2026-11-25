# Data model: Módulo de Relatórios

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

A 007 não muda o banco: nenhuma tabela, coluna, enum ou migration. Os números são calculados na hora,
a partir das reservas e dos fatos da tratativa que já existem (R-04). Este documento descreve as
regras do domínio e o formato do resumo.

## 1. Regras do domínio (`packages/domain/src/report.ts`)

### 1.1 Reservas do relatório (FR-008a)

Uma reserva entra no relatório quando o check-in está no período (inclusive as pontas) e a **situação
detalhada** não é uma destas:

| Situação | Valor |
|---|---|
| Ignorada (Hotelbeds 258) | `ignored_hotelbeds_258` |
| A revisar (sistema anterior) | `not_virtual_card` |
| Faturada | `invoiced` |

A situação detalhada é a da coluna da lista (`detailedSituation`), já com a marcação "Cancelada sem
cobrança" (classificação efetiva, 008) e com o comprovante.

### 1.2 Faixa de cada reserva (`reportBucket`)

| Situação detalhada | Tratativa (FR-014) | Faixa |
|---|---|---|
| Pendente de cobrança, Cobrar na maquininha, Cartão validado (não cobrado), Erro na cobrança, Erro de análise | — (sem tratativa) | `pending` |
| Tratativa enviada, Validar comprovante | sim | `requested` |
| Comprovante enviado, Já cobrada | sim | `recovered` |
| Comprovante enviado, Já cobrada | não | `previous_charged` |
| Cancelada sem cobrança | — | `none` |
| Ignorada, A revisar, Faturada | — | `excluded` |

- **Tratativa** = documento de tratativa vigente ou linha enviada ao Comercial não cancelada (a mesma
  regra de `hasRequest` da lista, 005).
- `pending` e `requested` juntos são exatamente o "Falta cobrar" da lista (`isPendingCharge`).

### 1.3 Valor de cada reserva (`reportAmount(bucket, { amountToCharge, chargedAmount, totalAmount })`)

| Faixa | Valor | Sem valor |
|---|---|---|
| `pending`, `requested` | valor a cobrar (`amountToCharge`, o total do Hunit) | conta em `withoutAmount` |
| `previous_charged`, `recovered` | valor cobrado exibido (`chargedAmountWithOrigin`: Hunit > 0, informado à mão com comprovante, Comercial confirmado); sem ele, o total | conta em `withoutAmount` |
| `none` | — (R$ 0,00) | — |

### 1.4 Percentuais da distribuição (`distributionPercentages`)

- Entrada: os quatro valores (cobrado anteriormente, recuperado, pendente, solicitado); base = a soma.
- Saída: percentual com uma casa, ajustado pelo maior resto para somar 100,0; `belowMinimum = true`
  quando o valor é maior que zero e o percentual exato é menor que 0,1 (exibido "<0,1%"); base zero →
  todos 0 e a barra vazia.

### 1.5 Atalhos do período (`reportPeriod`)

| Atalho | De | Até |
|---|---|---|
| `last_7_days` | hoje − 6 dias | hoje |
| `last_30_days` (padrão) | hoje − 29 dias | hoje |
| `this_month` | dia 1 do mês de hoje | último dia do mês de hoje |

"Hoje" é a data local da máquina (o app passa a data). "Personalizado" é qualquer período escolhido no
calendário; um período igual ao de um atalho mostra o atalho ativo.

## 2. Resumo do período (API, `ReportOverview`)

```text
ReportOverview
├── period { from, to }                  # datas AAAA-MM-DD, as pedidas
├── generatedAt                          # momento do cálculo (subtítulo "dados do servidor atualizados em …")
├── lastVerifiedAt | null                # leitura mais recente no Hunit entre as reservas do relatório (R-05)
├── reservations                         # reservas do relatório (FR-008a) — "Reservas" e "N reservas no recorte"
├── treatmentsSent                       # reservas do relatório com tratativa — "Tratativas enviadas"
├── withoutAmount                        # reservas com faixa de valor e sem valor (Edge Cases)
├── hotels { withData, total }           # "X de Y" (R-05)
├── open { amount, count, requested, pending }      # FR-012/013; count = reservas em "Falta cobrar"
├── charged { amount, previous, recovered }         # FR-014
└── hotelRows[] HotelReportRow           # todos os hotéis com reservas do relatório no período
```

```text
HotelReportRow
├── hotelCode, hotelName                 # nome do catálogo (sem rede, clarificação 5)
├── reservations                         # reservas do relatório do hotel
├── treatmentsSent
├── openCount                            # reservas em "Falta cobrar" — "Ver as N reservas"
├── openAmount = requested + pending
├── requested, pending
└── previousCharged, recovered
```

- Valores em reais no formato da API (`Money`, texto `"1234.56"`); somas feitas no PostgreSQL em
  `numeric`.
- `open`, `charged`, `treatmentsSent` e `reservations` do topo são a soma das linhas de hotel (uma
  consulta, R-04).
- Nenhum dado de hóspede (FR-027). A ordem de `hotelRows` é a do código do hotel; o app ordena (R-09).

## 3. Ordem nova das reservas (`order=amount_desc`)

Valor total do maior para o menor (reservas sem valor no fim), depois hotel e número; nas reservas em
aberto ("Falta cobrar"), o total é o valor a cobrar. Cursor `[amount_desc, valor ou −1, hotel,
número]`. Usada pela gaveta do hotel com
`quickFilter=pending_charge` (R-07); vale para qualquer filtro.

## 4. Estado no app (renderer, sem disco)

| Estado | Onde | Vida |
|---|---|---|
| Período escolhido e atalho ativo | `App` (área Relatórios) | enquanto o app está aberto |
| Resumo por período | cache do TanStack Query, chave `['reports', from, to]` | até "Atualizar dados" ou fechar o app |
| Gaveta aberta (hotel ou todos), busca e ordenação da gaveta | `ReportsScreen` | enquanto a área está aberta |
| `ReservationsPreset` (`hotelCodes?`, `checkInFrom`, `checkInTo`, `quickFilter: 'pending_charge'`, `expectedCount`) | `App` | até a próxima troca de área |
