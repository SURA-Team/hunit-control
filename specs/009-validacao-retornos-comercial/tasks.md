---

description: "Task list for feature 009 — Validação dos retornos do Comercial"
---

# Tasks: Validação dos retornos do Comercial

**Input**: Design documents from `/specs/009-validacao-retornos-comercial/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/api-changes.md](./contracts/api-changes.md),
[contracts/sheet-layout.md](./contracts/sheet-layout.md), [contracts/ipc.md](./contracts/ipc.md),
[quickstart.md](./quickstart.md)

**Tests**: INCLUÍDOS, porque a constitution exige (princípio VII: domínio com testes unitários, rotas com
teste de contrato, testes junto com cada tarefa). Em cada tarefa, escreva os testes antes da implementação e
confirme que falham. Grupos: `domain`, `contracts`, `server`, `server-db`, `desktop`, `desktop-ui` e
`desktop-e2e` (research R-09).

**Organization**: uma fase por história. US1 (P1, situação livre validada pelo Financeiro) e US2 (P2, aba
"Aguardando validação do Financeiro") são independentes depois da fase 2: a US2 funciona também com as regras
de hoje.

**Base**: a branch `009-validacao-retornos-comercial` está na `master` `0916290` (007 concluída), com a spec,
o clarify e o plano da 009 por cima.

**Antes de começar**: a spec está "Com a PM" (doc de ajustes, itens 15 e 16). Se a PM trocar alguma decisão
(S1 a S7, ou a R-07), atualize a spec e o plano antes do código (constitution I). As tarefas T016, T024
e T027 esperam o desenho da UX (T002); as outras tarefas de tela seguem com os componentes que já existem
(R-08).

**Dados**: nenhuma tarefa acessa o Hunit real. Testes, prints e Figma só com dados fictícios (os do roteiro
de captura). Sem nomes de hotéis ou da empresa. A planilha só com a de teste da homologação.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história atendida (US1 ou US2)
- **⛔ UX / HOMOLOGAÇÃO / PRODUÇÃO / FIGMA / USUÁRIO**: depende do desenho da UX, do PC do servidor, do ok do
  usuário para escrever no Figma ou de uma ação do usuário

## Path Conventions

Monorepo pnpm (ver plan.md). Renderer: `apps/desktop/src/renderer/src/` (abreviado `renderer/` abaixo).
Testes do app: `apps/desktop/test/{main,renderer,e2e}`. Servidor: `apps/server/src/{persistence,http,
commercial-sheet}`, testes em `apps/server/test/{unit,contract,integration}`. Domínio:
`packages/domain/{src,test}`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: linha de base e o pedido do desenho.

- [ ] T001 Na pasta `C:\Dev\desenvolvimento\hunit-control-009` (branch `009-validacao-retornos-comercial`): `pnpm install`, `pnpm build` e `pnpm test --project domain` como linha de base (o Docker em execução para os grupos de banco). Conferir que `.specify/feature.json` aponta para `specs/009-validacao-retornos-comercial`
- [ ] T002 [P] ⛔ UX — Pedir à UX o desenho da página `009-validacao-retornos-comercial` no Figma com as telas do research R-08: 7.8 com a linha da situação livre (selo "Outra situação", três ações, sem caixa de marcar), 7.5 com o bloco da situação livre, o diálogo "Confirmar como cobrada" (com e sem o valor do Comercial) e o diálogo "Confirmar como cancelada sem cobrança" com a situação do Comercial. Quando chegar, anotar os nodes em `research.md` (R-08)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contrato 1.12.0 e migration, de que as duas histórias dependem.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

- [ ] T003 Contrato 1.12.0 em `packages/contracts/openapi.yaml` (`info.version: 1.12.0`), com **tudo** de [contracts/api-changes.md](./contracts/api-changes.md): rota `POST /commercial-returns/{returnId}/situation/confirm` (corpo `as` obrigatório em `charged`/`no_charge`, `chargedAmount` `Money` opcional, `note` opcional "1–500"; respostas 200 `Reservation`, 400, 401, 403, 404, 409); schema `CommercialSituationReturn` (`state` em `awaiting_validation`, `confirmed`, `rejected`, `closed`; `situationText` até 100; `authorizationCode`, `chargeHotel`, `chargedAmount` e `chargeDate` nulos; `decision` em `charged`, `no_charge`, `null`); campos novos `CommercialSummary.situationReturn`, `CommercialDetail.situationReturns` e `CommercialLine.sheetTab` (`to_charge`, `awaiting_validation`, `done`, `null`); descrições atualizadas de `POST /commercial-returns/{returnId}/confirm` (409 `situation_return_needs_decision`), do lote (retorno de situação fica de fora com `no_return_awaiting_validation`), de `CommercialLine.tab` (a aba nova aparece como `to_charge`), de `CommercialSummary.currentReturn` (nulo quando o retorno atual é de situação) e de `CommercialSheetStatus.awaitingValidation`; códigos `charged_amount_required`, `charged_amount_from_commercial`, `not_a_situation_return`, `situation_return_needs_decision`. Rodar `pnpm --filter @hunit/contracts generate`, copiar o arquivo para `specs/009-validacao-retornos-comercial/contracts/openapi.yaml` (idêntico; a cópia da 007 fica na 1.11.0) e deixar `pnpm --filter @hunit/contracts lint` e `apps/server/test/unit/contract-frozen-enums.test.ts` verdes **sem mudar o teste** (nenhuma enum congelada ganha valor, R-01)
- [ ] T004 Schema e migration em `apps/server/src/persistence/schema.ts` ([data-model.md](./data-model.md) §1.1): em `commercial_returns`, `authorization_code`, `charge_hotel` e `charged_amount` passam a aceitar nulo ("nula só em retorno de situação"); coluna nova `no_charge_mark_id uuid references no_charge_marks(id)`; `commercial_returns_texts_check` aceita código e hotel nulos e, presentes, "de 1 a 100 caracteres" (`charged_by` continua obrigatório); `commercial_returns_amount_check` = "`charged_amount is null or charged_amount > 0`"; nova `commercial_returns_terminal_fields_check` = "se `charge_situation_kind` é nulo ou diferente de `other`, código, hotel e valor são obrigatórios"; nova `commercial_returns_no_charge_check` = "`no_charge_mark_id is null or (state = 'closed' and charge_situation_kind = 'other')`". Nenhum valor novo em enum. Gerar com `pnpm --filter @hunit/server db:generate --name=validacao_retornos` (uma migration, `0015_…`) e cobrir em `apps/server/test/integration/schema.test.ts` (retorno da 005 sem tipo exige os três campos; `other` aceita nulos; `no_charge_mark_id` só com `closed` e `other`; retornos `other` da 008 com os três campos continuam válidos)

**Checkpoint**: contrato 1.12.0 gerado e migration aplicando; as histórias podem começar.

---

## Phase 3: User Story 1 — Registrar a situação real e o Financeiro validar (Priority: P1) 🎯 MVP

**Goal**: com a situação e o responsável, o retorno vai para "Retornos a validar"; só a maquininha exige
código, hotel, valor e data; para a situação livre, o Financeiro confirma como cobrada, confirma como
cancelada sem cobrança ou recusa.

**Independent Test**: com o gateway em memória, preencher retornos com cada situação (maquininha completa e
incompleta, livre com e sem responsável, "Cancelada" com e sem responsável, "Cobrada no Hunit" sem data), ler
e conferir onde cada um aparece e a coluna J; validar situações livres com as três decisões e conferir a
reserva, o valor cobrado (e a origem) e a planilha (quickstart 3.3 a 3.13, 3.20, 3.22).

### Domínio

- [ ] T005 [P] [US1] Regra de leitura por situação em `packages/domain/src/commercial-return.ts` (research R-02): `readReturn` exige, além da situação, o responsável em toda situação; `charged_at_terminal` exige também código, hotel, valor e data (`complete`, como hoje); `charged_in_hunit` vira `report` com a data opcional; `cancelled` vira `report` com o responsável **obrigatório**; `other` vira a leitura nova `situation` `{ chargeSituation, chargedBy, authorizationCode?, chargeHotel?, chargedAmount?, chargeDate? }`; situação vazia → `incomplete` com `chargedBy` (se vazio) e `chargeSituation`. Campos preenchidos além do exigido são lidos com `readText`, `parseChargedAmount` e `parseChargeDate`; valor ou data não entendidos dão `illegible` em qualquer situação. `incomplete.missing` só com o que a situação exige, na ordem das colunas. Acrescentar `isSituationReturn(kind)` (`kind === 'other'`); `ReturnSnapshot` com código, hotel e valor opcionais; `returnSnapshot` aceita `complete` e `situation`; `returnChanged` compara presentes e ausentes. Exportar em `packages/domain/src/index.ts`. Testes em tabela em `packages/domain/test/commercial-return.test.ts`: cada situação × cada campo faltando; as mensagens do [sheet-layout](./contracts/sheet-layout.md#coluna-j-textos) ("Retorno incompleto: falta o responsável pela cobrança"; "Retorno incompleto: faltam o código de autorização, o hotel da cobrança, o valor cobrado e a data da cobrança"; "Retorno incompleto: faltam o responsável pela cobrança e a situação da cobrança"); situação com "maquininha" no meio; texto começando com "Cancelada"; valor e data não entendidos numa situação livre

### Servidor

- [ ] T006 [US1] Gravar a leitura `situation` em `apps/server/src/persistence/commercial-returns-repo.ts` (`recordReturnReading`) e `apps/server/src/commercial-sheet/returns.ts` (`sameAsStored`): retorno em `commercial_returns` com `charge_situation_kind = 'other'`, o texto, o responsável e os campos opcionais (nulos quando vazios), estado `awaiting_validation`, eventos `return_received`/`return_changed` e `superseded` do anterior como num retorno completo; a leitura `situation` limpa o relato da linha, como `complete` (`clearReport`); `lastReadReturn` com o snapshot de campos opcionais. Em `apps/server/src/commercial-sheet/sync.ts`, `lastReadCells` escreve `''` para os campos ausentes. Testes em `apps/server/test/integration/commercial-sync.test.ts` (gateway em memória): situação livre lida e relida sem mudança (nada novo); mudada (substitui); trocada para maquininha completa e para "Cancelada"; "Cobrada no Hunit" sem data entra na fila; "Cancelada" sem responsável dá problema e, se já aguardava validação, continua aguardando (R-07, regra da 005)
- [ ] T007 [US1] Valor do retorno confirmado sem valor do Comercial (research R-05): `treatmentFlags.commercialAmount` nulo quando `chargedAmount` é nulo, em `apps/server/src/persistence/treatments-repo.ts`; as expressões SQL que usam o valor do retorno confirmado em `apps/server/src/persistence/reservations-repo.ts` (CTE da situação, valor cobrado e origem) e em `apps/server/src/persistence/reports-repo.ts` (valor já cobrado) tratam o nulo e caem no valor informado à mão. Teste de paridade em `apps/server/test/integration/reports-repo.test.ts` (ou no teste de paridade da 006, onde estiver): retorno de situação confirmado com valor à mão mostra o mesmo valor e a origem `manual` na lista, no detalhe e no relatório
- [ ] T008 [US1] Decisões em `apps/server/src/persistence/commercial-returns-repo.ts` (research R-04): `confirmSituationReturn(db, { returnId, as, chargedAmount?, note?, clientId, now })`. Com `as = 'charged'`: retorno `confirmed`, `decided_*`, evento `return_confirmed`, linha atualizada pelo caminho de hoje; sem valor do Comercial, `chargedAmount` obrigatório (`charged_amount_required`) e gravado em `reservation_manual_amounts` na mesma transação; com valor do Comercial, `chargedAmount` recusado (`charged_amount_from_commercial`). Com `as = 'no_charge'`: `markNoChargeTx` (as recusas do FR-022 da 008, menos "retorno aguardando validação", que é este) com a observação "Situação informada pelo Comercial: <texto>" mais a nota; retorno `closed` com `no_charge_mark_id` e `decided_*`; evento `cancellation_confirmed` com o `returnId`. Recusas: `not_a_situation_return`, `return_not_awaiting_validation`, `no_charge_not_accepted` (com `reason`). Em `apps/server/src/persistence/no-charge-repo.ts` (`undoNoCharge`): localizar o retorno pelo `no_charge_mark_id` da marcação desfeita; se a linha ainda tem a mesma leitura, o retorno volta a `awaiting_validation` e o `no_charge_mark_id` volta a nulo **na mesma transação** (exigido por `commercial_returns_no_charge_check`, [data-model §1.1](./data-model.md#11-commercial_returns-alterada)), como a "Cancelada" da 008. Testes em `apps/server/test/integration/commercial-situation-returns.test.ts` (novo): as duas decisões, valor à mão e origem, recusas, desfazer da confirmação (o valor à mão some do valor cobrado) e da marcação (volta para validar, sem vínculo, e pode ser confirmada de novo como cobrada), recusa pela rota de hoje, e o Hunit deixando de exigir cobrança enquanto o retorno aguarda (encerrado `closed` sem vínculo, fora de "Retornos a validar"; uma decisão depois disso dá `return_not_awaiting_validation`)
- [ ] T009 [US1] Rotas antigas sem confirmar retorno de situação (research R-03) em `apps/server/src/persistence/commercial-returns-repo.ts`: `confirmReturn` recusa retorno de situação com `situation_return_needs_decision`; `confirmReturnsBatch` o deixa de fora com `no_return_awaiting_validation`; `rejectReturn` aceita. Testes em `apps/server/test/contract/commercial-returns.test.ts`
- [ ] T010 [US1] API em `apps/server/src/http/handlers/commercial.ts` e `apps/server/src/http/commercial-views.ts`: rota `POST /commercial-returns/{returnId}/situation/confirm` (somente operador; erros 400/409 com os códigos do T003); `CommercialSummary.situationReturn` e `currentReturn` nulo quando o retorno atual é de situação (`returnState` continua com o estado); `CommercialDetail.situationReturns` (do mais recente ao mais antigo) e `returns` sem os retornos de situação. Testes de contrato em `apps/server/test/contract/commercial-situation-returns.test.ts` (novo), validados contra o OpenAPI: as duas decisões, os erros, perfil consulta com 403, e a reserva vista por um cliente antigo (`currentReturn` nulo, `returnState` `awaiting_validation`, `detailedSituation` `return_pending`)

### App

- [ ] T011 [P] [US1] Ponte do app ([contracts/ipc.md](./contracts/ipc.md)): `commercial.confirmSituationReturn({ returnId, as, chargedAmount?, note? })` em `apps/desktop/src/shared/ipc-types.ts`, `ipc-schemas.ts` (valida `as` e o valor) e `ipc-channels.ts` (`commercialConfirmSituationReturn: 'commercial:confirmSituationReturn'`); `apps/desktop/src/main/api-client.ts`, `apps/desktop/src/main/commercial-handlers.ts` e `apps/desktop/src/preload/index.ts`. Testes em `apps/desktop/test/main/commercial-handlers.test.ts`
- [ ] T012 [P] [US1] Textos em `renderer/presentation/labels.ts`: selo "Outra situação" (tom âmbar), rótulos "Confirmar como cobrada", "Confirmar como cancelada sem cobrança" e "Recusar", e as mensagens de erro de [contracts/ipc.md](./contracts/ipc.md) ("Informe o valor cobrado: o Comercial não informou."; "Este retorno não é de uma situação livre. Atualize a lista."). Testes em `apps/desktop/test/renderer/labels.test.ts`
- [ ] T013 [US1] Diálogos em `renderer/screens/commercial/SituationReturnDialogs.tsx` (novo), só com os componentes de `ui/`: "Confirmar como cobrada" (mostra o valor do Comercial; sem ele, campo de valor obrigatório no padrão do valor informado à mão da `TreatmentSection`, sem confirmar vazio) e "Confirmar como cancelada sem cobrança" (o diálogo da 7.17: valor → R$ 0,00, "Concluídas", a situação do Comercial e a observação opcional). Testes em `apps/desktop/test/renderer/commercial-situation.test.tsx` (novo)
- [ ] T014 [US1] "Retornos a validar" em `renderer/screens/commercial/ReturnsTab.tsx`: as reservas com `commercial.situationReturn` aguardando validação aparecem como linha própria, com o selo "Outra situação", a situação como veio, o responsável e, se houver, código, hotel, valor e data; ações "Confirmar como cobrada", "Confirmar como cancelada sem cobrança" (diálogos do T013) e "Recusar" (o `RejectDialog` de hoje); **sem caixa de marcar** e fora de "Confirmar marcados" (FR-007); perfil consulta só vê (FR-009). Testes em `apps/desktop/test/renderer/commercial-situation.test.tsx` e ajuste de `apps/desktop/test/renderer/commercial-fixtures.ts`
- [ ] T015 [US1] Gaveta da reserva em `renderer/screens/reservations/CommercialSection.tsx`: o bloco "Retorno do Comercial" mostra a situação livre com as três ações (operador) e o histórico das decisões (situação do Comercial, quem decidiu, quando); `cancellation_confirmed` com `returnId` é a decisão sobre uma situação livre, e sem `returnId` é a "Cancelada" da 008 ([api-changes](./contracts/api-changes.md#acréscimos-em-schemas-existentes)). Testes em `apps/desktop/test/renderer/commercial-reservations.test.tsx`
- [ ] T016 [US1] ⛔ UX (se o desenho já chegou) — Ajustar T013 a T015 ao desenho da página 009 (nodes no R-08), só com os componentes de `ui/`; as diferenças decididas vão para o research (R-08)
- [ ] T017 [US1] Jornada de ponta a ponta em `apps/desktop/test/e2e/situation-returns.test.ts` (novo), contra a API com o gateway em memória: uma situação livre sem valor confirmada como cobrada com o valor digitado (reserva "Comprovante enviado", origem "informado à mão"); outra confirmada como cancelada sem cobrança e desfeita (volta para validar); outra recusada (motivo na coluna J da planilha em memória)

**Checkpoint**: US1 funcional — quickstart 3.3 a 3.13, 3.20 e 3.22 passam com o gateway em memória.

---

## Phase 4: User Story 2 — Fila do Comercial só com o que depende dele (Priority: P2)

**Goal**: a aba "Aguardando validação do Financeiro", protegida, recebe as linhas que esperam o Financeiro ou
a verificação no Hunit há 10 minutos; recusa devolve para "A cobrar"; confirmação leva para "Concluídas".

**Independent Test**: com o gateway em memória e o relógio simulado, linhas em cada estado; rodar e conferir
a aba de cada uma antes e depois dos 10 minutos, depois de recusar e de confirmar; `setup` numa planilha sem a
aba (quickstart 3.1, 3.2, 3.14 a 3.19, 3.21).

- [ ] T018 [P] [US2] Domínio em `packages/domain/src/commercial-sheet.ts` (research R-06): `COMMERCIAL_SHEET_TABS` ganha `awaitingValidation: 'Aguardando validação do Financeiro'`; `AWAITING_TAB_DELAY_MINUTES = 10`; `sheetTabOf({ lineState, validation, awaitingSince, now })` — `concluded`/`cancelled` → `done`; `open` com validação `awaiting`, `cancellation_awaiting` ou `hunit_awaiting` e `now − awaitingSince ≥ 10 min` → `awaitingValidation`; o resto → `toCharge`. Testes em `packages/domain/test/commercial-sheet.test.ts` (a tabela do [data-model §4](./data-model.md#4-aba-da-linha-na-planilha), 9 min 59 s × 10 min, recusa, problema, sem retorno)
- [ ] T019 [P] [US2] Gateway com três abas: `SheetTab` e `SHEET_TABS` (`toCharge`, `awaitingValidation`, `done`, nessa ordem) e `SheetSnapshot` em `apps/server/src/commercial-sheet/gateway.ts`; `apps/server/src/commercial-sheet/memory-sheet-gateway.ts`; em `apps/server/src/commercial-sheet/google-sheet-gateway.ts`, o `setup` cria a aba entre as outras duas (`addSheet` com `index`), escreve o cabeçalho, protege a aba inteira (descrição nova em `PROTECTION_DESCRIPTIONS`, como "Concluídas") e o `inspect` a descreve; `apps/server/src/commercial-sheet/sheet-appearance.ts` aplica na aba nova a aparência de "A cobrar" (cabeçalho preto e lima, K a P em lima, larguras, bordas, listras e as cores da coluna J). Testes em `apps/server/test/unit/commercial-sheet-gateway.test.ts` (pedidos montados para uma planilha da 008 e para uma já preparada; `setup` repetido sem duplicar)
- [ ] T020 [US2] Formato e comando: `apps/server/src/commercial-sheet/layout.ts` aponta "a aba \"Aguardando validação do Financeiro\" não existe" (planilha `layout_invalid` até o `setup`, FR-014); `apps/server/src/commercial-sheet/command.ts` mostra a aba nova no `setup` e no `check`. Testes em `apps/server/test/unit/commercial-sheet-command.test.ts`
- [ ] T021 [US2] Sincronizador: `SheetLineSource` em `apps/server/src/persistence/commercial-repo.ts` (`listSheetLines`) ganha `awaitingSince` = `read_at` do retorno aguardando validação ou do relato ("Cancelada" aguardando validação ou "Cobrada no Hunit" aguardando a verificação); em `apps/server/src/commercial-sheet/sync.ts`, o alvo da linha passa a ser `sheetTabOf` (a mudança de aba usa o mecanismo de hoje: acrescenta no destino copiando K a P e apaga a origem); na aba nova, K a P diferentes do último lido (`lastReadCells`) são reescritos com o problema `restored_line`; a leitura dos retornos continua só em "A cobrar". Testes em `apps/server/test/integration/commercial-sync.test.ts` com o relógio simulado: linha aguardando sai de "A cobrar" só depois de 10 minutos sem mudança; mudança do Comercial antes do prazo reinicia a contagem; recusa devolve para o fim de "A cobrar" com o motivo; confirmação leva para "Concluídas"; decisão antes do prazo vai direto; desfazer a confirmação tira a linha de "Concluídas" e a devolve à aba nova (FR-011); desfazer a marcação de um retorno de situação a devolve à aba nova; "Cobrada no Hunit" aguardando fica na aba nova e "não encontrada" volta; K a P alterados na aba nova são restaurados; planilha sem a aba fica `layout_invalid` sem escrever; primeira rodada depois do `setup` move as linhas que já aguardavam (R-07); nenhuma linha perdida ou duplicada (SC-006); nenhuma linha da aba nova traz o nome do hóspede (FR-016)
- [ ] T022 [US2] API: `CommercialLine.sheetTab` e `tab` (a aba nova como `to_charge`) em `apps/server/src/http/commercial-views.ts`, pela mesma `sheetTabOf` da rodada. Testes em `apps/server/test/contract/commercial-lines.test.ts`
- [ ] T023 [P] [US2] App: o card "Comercial" da reserva em `renderer/screens/reservations/CommercialSection.tsx` mostra a linha em "Aguardando validação do Financeiro" por `sheetTab` (rótulo em `renderer/presentation/labels.ts`). Testes em `apps/desktop/test/renderer/commercial-reservations.test.tsx`
- [ ] T024 [US2] ⛔ UX (se o desenho já chegou) — Ajustar o T023 ao desenho da página 009

**Checkpoint**: US2 funcional — quickstart 3.1, 3.2 e 3.14 a 3.21 passam com o gateway em memória e o
relógio simulado.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: versão, documentação, prints, verificação e as etapas fora do código.

- [ ] T025 [P] Versão do app 0.6.0 em `apps/desktop/package.json` (o teste do instalador e o "Sobre" usam a versão)
- [ ] T026 [P] Roteiro de captura em `apps/desktop/test/e2e/screens-capture.test.ts`: cenas da 7.8 com a situação livre, da 7.5 com o bloco novo e dos dois diálogos, com o número da tela do Figma no nome do PNG (R-08)
- [ ] T027 ⛔ UX — Comparar o app com o design (prints do T026 nas três larguras ao lado dos frames da página 009) e registrar em `research.md` ("Comparação com o design"); diferenças novas vão para a UX
- [ ] T028 [P] `README.md`, seção "Planilha do Comercial": a aba nova (só para consulta, a linha vai depois de 10 minutos sem mudança, recusa volta para "A cobrar"), o que cada situação exige ([sheet-layout](./contracts/sheet-layout.md#o-que-cada-situação-exige-coluna-o)) e o passo do `commercial-sheet setup` na atualização, com o aviso ao Comercial (quickstart §4)
- [ ] T029 [P] `AGENTS.md`: tabela de estrutura (o que a 009 acrescenta), regra do contrato (cópia em `specs/009-validacao-retornos-comercial/contracts/openapi.yaml`; a da 007 congelada na 1.11.0) e o parágrafo da feature 009 (situação livre com as três decisões, aba nova, contrato 1.12.0, app 0.6.0, os apps 0.3 a 0.5.1 continuam funcionando)
- [ ] T030 Verificação completa (quickstart §1): `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` verdes; rodar de novo, sozinhos, os arquivos de banco que passarem do tempo; conferir `git diff --cached --name-only` sem arquivo sensível antes do commit
- [ ] T031 ⛔ HOMOLOGAÇÃO — Quickstart §2 (cenários 3.1 a 3.22) no ambiente de homologação, com o `commercial-sheet setup` e o app 0.6.0; registrar o resultado em `research.md` ("Homologação")
- [ ] T032 ⛔ FIGMA / USUÁRIO — Com o ok do usuário, rodar a skill `figma-screens-sync` com a 009 como feature concluída (quickstart §3)
- [ ] T033 ⛔ PRODUÇÃO / USUÁRIO — Quickstart §4: avisar o Comercial, atualizar o servidor, `commercial-sheet setup`, `check` e o instalador 0.6.0; registrar em `research.md` ("Produção")
- [ ] T034 ⛔ USUÁRIO — SC-007 com a PM e o Comercial, depois da produção: o Comercial abre a planilha e acha em "A cobrar" o que precisa fazer sem filtrar nem pular linhas já respondidas; registrar o resultado em `research.md` ("SC-007")
- [ ] T035 Doc da PM ("HUNIT Control — ajustes e bugs para a PM"): itens 15 e 16 em "Em desenvolvimento" no início da implementação e "Concluído" depois da produção e do SC-007; a seção "Andamento" com a 009 (tarefas feitas de 35) e uma linha no "Histórico"

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências. T002 corre em paralelo com tudo (espera a UX).
- **Foundational (Phase 2)**: depois do T001; bloqueia as duas histórias (T003 e T004 podem andar juntos).
- **US1 (Phase 3)** e **US2 (Phase 4)**: depois da fase 2; independentes entre si.
- **Polish (Phase 5)**: T025, T028 e T029 a qualquer momento depois da fase 2; T026 e T027 depois das telas;
  T030 depois de tudo; T031 → T032 → T033 → T034 → T035 nessa ordem.

### Within US1

- T005 (domínio) antes de T006 a T009.
- T006 antes de T008 (o retorno de situação precisa existir). T007 em paralelo com T006.
- T008 e T009 antes de T010 (API). T010 antes de T014, T015 e T017.
- T011 e T012 em paralelo, depois do T003; T013 depois de T011 e T012; T014 e T015 depois de T013.
- T016 depois de T002 e de T013 a T015; T017 depois de T010, T014 e T015.

### Within US2

- T018 e T019 em paralelo; T020 depois do T019; T021 depois de T018 a T020; T022 depois de T018 e T021;
  T023 depois de T022 (e do T011, se a US1 vier antes); T024 depois de T002 e T023.

### Arquivos compartilhados entre as histórias

`commercial-returns-repo.ts` (US1), `sync.ts` (T006 da US1 e T021 da US2), `commercial-views.ts` (T010 e
T022), `CommercialSection.tsx` (T015 e T023), `labels.ts` (T012 e T023): se as histórias andarem juntas,
faça essas tarefas uma de cada vez.

---

## Parallel Example: User Story 1

```text
# Depois da fase 2, juntas:
T005 Regra de leitura por situação (packages/domain/src/commercial-return.ts)
T011 Ponte do app (apps/desktop/src/shared/…, main/…, preload/…)
T012 Textos (renderer/presentation/labels.ts)

# Depois do T005:
T006 Gravar a leitura `situation` (commercial-returns-repo.ts, returns.ts, sync.ts)
T007 Valor nulo do retorno confirmado (treatments-repo.ts, reservations-repo.ts, reports-repo.ts)
```

## Parallel Example: User Story 2

```text
T018 sheetTabOf (packages/domain/src/commercial-sheet.ts)
T019 Gateway com três abas (commercial-sheet/gateway.ts, google-sheet-gateway.ts, memory-sheet-gateway.ts, sheet-appearance.ts)
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Fase 1 e fase 2 (contrato e migration).
2. US1 (T005 a T017): o Comercial já pode escrever a situação real e o Financeiro decide.
3. **Parar e validar** com o quickstart 3.3 a 3.13, 3.20 e 3.22 (gateway em memória).
4. A US1 pode ir sozinha para a homologação e a produção: sem a US2, a planilha não ganha aba nova e não
   precisa do `setup`. A US2 exige o `setup` logo depois do servidor (sem a aba, a planilha fica "Formato
   alterado").

### Incremental Delivery

1. Fases 1 e 2 → base pronta.
2. US1 → testes verdes → demonstração com o gateway em memória.
3. US2 → testes verdes → homologação completa (quickstart §2).
4. Polish → Figma → produção → SC-007 com a PM e o Comercial.

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- Commits pequenos, em português, citando `specs/009`.
- Uma tarefa só está concluída com os testes dela passando (constitution VII).
- Se a implementação mostrar que a spec está errada ou incompleta, pare e atualize a spec antes de seguir.
