# Research: Validação dos retornos do Comercial

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-11-27

Decisões técnicas da 009, tomadas a partir do código entregue pela 008 (contrato 1.11.0, app 0.5.1). Cada
uma traz a decisão, o motivo e as alternativas descartadas. Nenhum dado real neste arquivo.

## R-01 — Contrato 1.11.0 → 1.12.0, só acréscimos; servidor antes do app

**Decisão**: a API passa para a **1.12.0**, só com acréscimos. A ordem de implantação continua a de
sempre: servidor, depois `commercial-sheet setup` e por último o instalador do app 0.6.0. Os apps 0.3 a
0.5.1 continuam funcionando contra a 1.12.0: eles não recebem a situação livre como retorno comum (R-03)
e não veem a aba nova como valor desconhecido (R-06).

**Motivo**: constitution III (mudança incompatível exige versão nova da API); a regra do projeto desde a
1.7.0 é que enums usadas como chave pelo app em uso não ganham valores (specs/005 R-09, specs/008 R-02).

**Alternativas**: versão 2.0.0 com `CommercialReturnBrief` de campos nulos (descartada: obrigaria trocar
todos os apps no mesmo dia; as quatro usuárias não atualizam ao mesmo tempo).

## R-02 — Regra de leitura da situação (domínio)

**Decisão**: `readReturn` (`packages/domain/src/commercial-return.ts`) passa a decidir o que é exigido pela
situação reconhecida:

| Situação (`recognizeChargeSituation`, sem mudança) | Exigidos | Resultado com tudo |
|---|---|---|
| `charged_at_terminal` (contém "maquininha") | responsável, código, hotel, valor, data | `complete` (como hoje) |
| `charged_in_hunit` (contém "hunit") | responsável | `report` "Cobrada no Hunit"; data opcional |
| `cancelled` (começa com "cancelad") | responsável | `report` "Cancelada"; data opcional |
| `other` (outro texto) | responsável | **`situation`** (novo): código, hotel, valor e data opcionais |
| situação vazia | situação (e responsável, se vazio) | `incomplete` |

- O que estiver preenchido além do exigido é lido com as regras de hoje (`readText`, `parseChargedAmount`,
  `parseChargeDate`); valor ou data que não forem entendidos dão `illegible` em qualquer situação.
- `incomplete.missing` lista só os campos que a situação exige e faltam, na ordem das colunas (FR-003). Sem
  situação: `['chargedBy', 'chargeSituation']` filtrado pelo que falta (a ordem das colunas põe o
  responsável antes da situação; a mensagem fica "faltam o responsável pela cobrança e a situação da
  cobrança").
- A leitura nova `situation` carrega `{ chargeSituation, chargedBy, authorizationCode?, chargeHotel?,
  chargedAmount?, chargeDate? }`.

**Motivo**: FR-001 a FR-005 e as decisões S2 e S3 do clarify. A regra fica no domínio, com testes de tabela,
e o servidor só grava o que o domínio decidiu (constitution VII).

**Alternativas**: interpretar o texto livre (por exemplo, "OTA" ⇒ cobrada) — descartada pela spec
(premissas: quem decide o significado é o Financeiro).

## R-03 — Situação livre guardada como retorno, escondida dos campos antigos

**Decisão**: a situação livre é um **retorno do Comercial** (`commercial_returns`) com
`charge_situation_kind = 'other'` e código, hotel e valor **opcionais**. Chamamos esse retorno de
**retorno de situação** no código (`isSituationReturn(kind) = kind === 'other'`).

- **Por que retorno e não relato**: "Confirmar como cobrada" vale como comprovante. Um retorno confirmado
  já é comprovante em todo lugar: `treatmentFlags`, a CTE da situação das reservas, os filtros rápidos, as
  contagens, o relatório da 007 e a busca pelo código. Como relato, cada um desses lugares precisaria de uma
  condição nova, e o teste de paridade da 006 seria refeito.
- **Compatibilidade**: os apps 0.3 a 0.5.1 leem `CommercialSummary.currentReturn` (código, hotel e valor
  obrigatórios) e confirmam em lote todo retorno aguardando validação. Por isso:
  - `currentReturn` **não** mostra retorno de situação (fica `null`); `returnState` continua com o estado
    (a reserva aparece como "Validar comprovante", como deve). O app 0.5.1 já trata `currentReturn` nulo
    (mostra "—").
  - `CommercialDetail.returns` não lista retornos de situação; eles vão para o campo novo
    `situationReturns`.
  - `POST /commercial-returns/{id}/confirm` recusa retorno de situação com 409
    `situation_return_needs_decision`; `POST /commercial-returns/confirm` (lote) o deixa de fora com o
    motivo que já existe, `no_return_awaiting_validation`.
  - O app novo lê o campo novo `CommercialSummary.situationReturn`.
- **Retornos `other` da 008** que já existem (com os quatro campos): passam a ser retornos de situação, pelo
  tipo. Os que estão aguardando validação ganham as três decisões; os confirmados continuam confirmados (e
  continuam comprovante).

**Alternativas**: (a) relato `commercial_reports` com o tipo `other` — descartada pelo custo nas condições
SQL de comprovante (acima); (b) mostrar o retorno de situação em `currentReturn` com textos vazios e valor
"0.00" — descartada: um app antigo confirmaria uma cobrança de R$ 0,00.

## R-04 — As três decisões do Financeiro sobre um retorno de situação

**Decisão**: uma rota nova, `POST /commercial-returns/{returnId}/situation/confirm`, com
`{ as: 'charged' | 'no_charge', chargedAmount?, note? }`; a recusa reusa
`POST /commercial-returns/{returnId}/reject`.

- **`as: 'charged'`**: o retorno passa a `confirmed`, como a confirmação de hoje (evento `return_confirmed`,
  linha para "Concluídas" pelo caminho que já existe). Valor:
  - com o valor do Comercial, ele é o valor cobrado (origem `commercial`, como hoje);
  - sem o valor do Comercial, `chargedAmount` é obrigatório (400 `charged_amount_required`) e é gravado
    como **valor informado à mão** (`reservation_manual_amounts`, da 003), na mesma transação: origem
    `manual`. O valor à mão só vale enquanto há comprovante, então desfazer a confirmação o esconde
    sozinho.
  - Mandar `chargedAmount` quando o Comercial já informou o valor dá 400 (`charged_amount_from_commercial`):
    o valor do Comercial não é trocado aqui; para corrigir, o Financeiro recusa e o Comercial corrige.
- **`as: 'no_charge'`**: grava a marcação "Cancelada sem cobrança" com `markNoChargeTx` (as regras e recusas
  da 008, FR-022, menos a de "retorno aguardando validação", que é este próprio retorno). A observação
  automática diz que a situação veio do Comercial e repete o texto dele, mais a nota opcional. O retorno
  passa a `closed`, com `no_charge_mark_id` apontando para a marcação. Evento `cancellation_confirmed` com o
  `returnId`.
  - Desfazer a marcação (rota que já existe) devolve o retorno a `awaiting_validation` se a linha ainda
    tiver a mesma leitura, como a "Cancelada" da 008 (FR-008).
- **Recusar**: a rota de hoje, que já vale para qualquer retorno aguardando validação.
- **Lote**: fora (FR-007). `includeCancellations` continua só para as "Cancelada".

**Motivo**: reaproveita a confirmação, o valor à mão e a marcação, sem estado novo. Uma rota só, com `as`,
deixa a escolha explícita e permite conferir que o retorno é de situação.

**Alternativas**: duas rotas (`confirm-charged`, `confirm-no-charge`) — equivalente, mais superfície;
guardar o valor do Financeiro numa coluna nova do retorno — descartada: duplicaria o valor à mão e a origem
`manual`, que já existem.

## R-05 — Valor do retorno confirmado sem valor do Comercial

**Decisão**: onde o servidor usa o valor do retorno confirmado (`treatmentFlags.commercialAmount`, a CTE da
situação, o relatório da 007), `charged_amount` nulo passa a ser tratado como "sem valor do Comercial", e o
valor cobrado vem do valor à mão (R-04). Um teste de paridade cobre um retorno de situação confirmado com
valor à mão: a lista, o detalhe e o relatório mostram o mesmo valor e a mesma origem.

**Motivo**: hoje `charged_amount` é `not null` e o código conta com isso; com a coluna opcional, todo uso
precisa do `coalesce` ou da regra do domínio.

**Alternativas**: exigir o valor do Comercial em toda situação livre — contraria FR-002.

## R-06 — Aba "Aguardando validação do Financeiro"

**Decisão**:

- **Domínio** (`commercial-sheet.ts`): `COMMERCIAL_SHEET_TABS` ganha `awaitingValidation: 'Aguardando
  validação do Financeiro'`. Uma função pura `sheetTabOf({ lineState, validation, awaitingSince, now })`
  decide a aba:
  - `concluded` ou `cancelled` → `done`;
  - `open` e a validação é `awaiting` (retorno, inclusive de situação), `cancellation_awaiting` ou
    `hunit_awaiting`, **e** `now − awaitingSince ≥ 10 min` (`AWAITING_TAB_DELAY_MINUTES`) →
    `awaitingValidation`;
  - o resto → `toCharge` (sem retorno, com problema, recusada).
- **`awaitingSince`** é o `read_at` da versão que está aguardando: o do retorno aguardando validação ou o do
  relato. Uma mudança do Comercial cria um retorno novo (`return_changed`) ou atualiza o `read_at` do relato,
  então "10 minutos sem mudança" é só comparar com o `read_at`; nenhuma coluna nova (S7).
- **Sincronizador** (`sync.ts`): o alvo da linha deixa de ser `state === 'open' ? 'toCharge' : 'done'` e
  passa a ser `sheetTabOf`. O resto da reconciliação não muda: mudar de aba já é "apagar onde está e
  acrescentar no alvo, copiando K a P". Quando o Financeiro decide antes dos 10 minutos, a linha vai direto
  para o destino, porque a validação deixa de ser "aguardando".
- **A linha só muda de aba numa rodada**: a leitura a cada 10 minutos (e o "Ler agora") já faz rodadas, e
  qualquer escrita pendente também. Por isso a mudança leva no máximo cerca de 20 minutos, como a spec
  admite (premissas): 10 minutos sem mudança mais a próxima rodada. Nenhuma coluna ou gatilho novo.
- **Leitura dos retornos**: continua só em "A cobrar" (`returns.ts` já filtra a aba). Na aba nova, o
  sincronizador compara também K a P com o último valor lido (`lastReadCells`) e restaura o que mudou
  (FR-012), relatando `restored_line` como faz com A a J.
- **Gateway** (`gateway.ts`, `google-sheet-gateway.ts`, `memory-sheet-gateway.ts`): `SheetTab` ganha
  `awaitingValidation`; `SHEET_TABS` passa a ter as três, na ordem das abas. O `setup` cria a aba entre "A
  cobrar" e "Concluídas" (`addSheet` com `index`), escreve o cabeçalho, protege a aba inteira (como
  "Concluídas") e aplica a aparência de "A cobrar" (cabeçalho preto e lima, K a P em lima, larguras,
  bordas, listras e as cores da coluna J). `layoutProblems` aponta a aba que falta ("a aba 'Aguardando
  validação do Financeiro' não existe"), e a planilha fica `layout_invalid` até o `setup`, como na 008
  (FR-014).
- **API**: `CommercialLine.tab` continua com `to_charge | done | null` para os apps antigos (a aba nova
  aparece como `to_charge`); o campo novo `CommercialLine.sheetTab` traz `to_charge | awaiting_validation |
  done | null`.

**Motivo**: a aba é uma projeção do estado, como as duas de hoje; nenhum estado novo de linha
(`commercial_line_state` continua `open | concluded | cancelled`), então situação, filtros e contagens não
mudam.

**Alternativas**: um estado de linha novo `awaiting_validation` — descartada: mexeria em todas as consultas
que tratam `open` como "enviada e aberta"; mover a linha na hora em que o retorno é lido — descartada pela
decisão S7.

## R-07 — Retornos já abertos na atualização

**Decisão**: nenhuma migração de dados além do schema. Na primeira rodada depois do `setup`:

- as linhas que aguardam validação há mais de 10 minutos vão para a aba nova;
- uma situação livre que estava em "Retornos com problema" por falta dos dados da maquininha é lida de novo
  (o problema calculado muda) e vira retorno de situação aguardando validação;
- uma "Cancelada" sem responsável que aguardava validação passa a `incomplete` ("falta o responsável pela
  cobrança"), e a coluna J pede o responsável. **Atenção — diverge do caso-limite da spec**: pela regra da
  005 (`recordReturnReading`: "um retorno com problema nunca muda a reserva"), a leitura com problema não
  desfaz o que já estava aguardando. O relato continua aguardando validação e aparece em "Retornos a
  validar" (`cancellationAwaitingCondition` não olha o problema da linha), e o Financeiro ainda pode
  decidir. O mesmo vale, desde a 005, para um retorno da maquininha aguardando validação cuja linha passa a
  ter problema. **Decidido com o usuário em 27/11 (opção A)**: manter a regra da 005; o caso-limite da spec
  foi ajustado (sessão "plano"). Alternativa descartada: a leitura com problema tirar da validação o relato
  e o retorno aguardando, o que mudaria o comportamento de todos os retornos;
- um "Cobrada no Hunit" sem data que estava com problema vira relato e entra na fila.

O README (produção) pede para avisar o Comercial antes, como na 008.

**Motivo**: as regras novas valem desde a primeira leitura (spec, casos-limite); o processador de retornos
já relê toda linha cujo problema calculado mudou (`returns.ts`, `problem === line.returnProblem`).

## R-08 — Telas do app e o desenho da UX

**Decisão**: a regra do projeto pede o desenho da UX para telas que mudam. As que esta feature muda, com o
que o plano usa até o desenho chegar (componentes de `ui/` da 006 e da 008, sem componente novo):

| Tela (número no Figma) | O que muda | Até o desenho chegar |
|---|---|---|
| 7.8 Retornos a validar | linha da situação livre: selo "Outra situação" (âmbar), a situação como veio, responsável, valor e data se houver; três ações; sem caixa de marcar | linha no padrão da "Cancelada" (topo da lista), com o `StatusBadge` âmbar |
| 7.5 Gaveta, bloco "Retorno do Comercial" | a situação livre com as três ações | o bloco de hoje, com as três ações no lugar de "Confirmar" |
| nova: diálogo "Confirmar como cobrada" | valor do Comercial, ou campo de valor obrigatório | diálogo pequeno da 006 com o campo de valor do "valor cobrado informado à mão" (`TreatmentSection`, 003) |
| nova: diálogo "Confirmar como cancelada sem cobrança" | o da 7.17 (valor → R$ 0,00), com a situação do Comercial | o diálogo da 7.17 |
| 7.6 / card "Comercial" da reserva | "Aguardando validação do Financeiro" como aba da linha | o texto da aba, como hoje |
| 7.9 Retornos com problema | sem mudança de tela (os textos vêm do servidor) | — |

A tarefa de telas começa pedindo o desenho à UX (página `009-validacao-retornos-comercial` no Figma); a
comparação com o design e a marcação no Figma (`figma-screens-sync`) seguem a regra de sempre.

**Motivo**: AGENTS.md ("Telas no Figma"); a spec admite os componentes que já existem enquanto o desenho
não chega.

## R-09 — Testes

**Decisão**: nos grupos que já existem.

| Grupo | O quê |
|---|---|
| `domain` | `readReturn` em tabela (cada situação × cada campo faltando, valor e data não entendidos, sem situação); `describeReturnReading`; `sheetTabOf` (estados, 10 minutos, decisões antes do prazo) |
| `contracts` | 1.12.0 sem quebra: `currentReturn` sem retorno de situação; enums congeladas (`contract-frozen-enums.test.ts`) sem valor novo |
| `server` | handlers: `situation/confirm` (as duas decisões, valor obrigatório, valor do Comercial, 409s); `/confirm` antigo recusando retorno de situação |
| `server-db` | migration; gravação do retorno de situação; confirmação com valor à mão (paridade lista × detalhe × relatório); marcação e desfazer devolvendo para validar; sincronizador com o gateway em memória (linha muda de aba depois de 10 min, volta na recusa, vai para "Concluídas" na confirmação, decisão antes do prazo, K a P restaurados na aba nova, `layout_invalid` sem a aba); `setup` criando a aba |
| `desktop-ui` | Retornos a validar com a situação livre (ações, sem caixa de marcar, perfil consulta); diálogos; gaveta |
| `desktop-e2e` | jornada: situação livre lida, confirmada como cobrada com valor digitado; outra cancelada sem cobrança e desfeita; roteiro de captura das telas novas |

## R-10 — O que não muda

- Nenhuma rota nova do Hunit; a lista do `read-only-guard` não muda (constitution II).
- Nenhuma variável de ambiente, volume ou serviço novo (constitution V).
- Colunas A a P e a cópia para e-mail continuam as mesmas; a planilha continua sem dado do hóspede (FR-016).
- A anonimização já apaga o texto da situação `other` (008); o valor à mão segue a regra da 003.

## Notas da implementação (27/11/2026)

O que a implementação decidiu ou descobriu além do plano:

- **Contrato**: `CommercialSituationReturn.chargedAmount` usa `$ref: Money` direto. `Money` já aceita
  nulo, e um `oneOf` com `null` ficava ambíguo (as duas opções valiam para nulo), o que fazia o
  servidor responder 500 ao validar a resposta. O teste de enums congeladas mudou só a versão esperada
  (1.12.0).
- **Aba na API**: `CommercialLine.sheetTab` vem do método `sheetTabOfLine` do sincronizador, que usa a
  mesma regra da rodada (`validationOf` e `awaitingSince`). `listSheetLines` ganhou o filtro opcional
  por reserva. Sem planilha configurada, `sheetTab` segue o estado da linha.
- **Desfazer a marcação** (`undoNoCharge`): o retorno de situação volta a aguardar validação só se
  ainda é o mais recente da reserva. O vínculo `no_charge_mark_id` é limpo na mesma transação.
- **Valor à mão**: a gravação foi extraída para `writeManualAmountTx` (`treatments-repo.ts`), usada
  pela tela da 003 e pela confirmação como cobrada.
- **Restauração na aba nova**: K a P são comparados pela leitura (`readReturn` contra o último lido),
  não pelo texto das células. Assim, "1.234,56" digitado como texto e lido igual não é restaurado à toa.
- **Telas, até o desenho da UX (R-08)**:
  - Na lista "Retornos a validar", as três decisões ficam uma embaixo da outra. Lado a lado, elas não
    cabem na coluna de ações de 180 px, e o "Recusar" saía do card (achado no e2e).
  - Na gaveta, as decisões ficam lado a lado.
  - Rótulos curtos nos botões ("Cobrada", "Sem cobrança", "Recusar"). O nome acessível é completo,
    com o número da reserva.
  - Números provisórios das telas no roteiro de captura: 7.8b (lista com a situação livre), 7.8c
    (diálogo "Confirmar como cobrada"), 7.8d (diálogo "Confirmar como cancelada sem cobrança") e 7.5b
    (bloco na gaveta).
- **Testes**: os da US1 no servidor ficaram em `apps/server/test/integration/commercial-situation-returns.test.ts`
  (rotas validadas contra o OpenAPI) e os da US2 em `commercial-awaiting-tab.test.ts`, com o relógio
  simulado. Os testes da 008 que descreviam as regras antigas foram atualizados
  (`commercial-reports.test.ts` e os e2e `cancellation.test.ts` e `screens-capture.test.ts`).
