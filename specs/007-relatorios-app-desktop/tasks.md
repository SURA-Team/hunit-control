---

description: "Task list for feature 007 — Módulo de Relatórios do app desktop"
---

# Tasks: Módulo de Relatórios do app desktop

**Input**: Design documents from `/specs/007-relatorios-app-desktop/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/api-changes.md](./contracts/api-changes.md),
[contracts/ipc.md](./contracts/ipc.md), [contracts/ui-components.md](./contracts/ui-components.md),
[contracts/screens.md](./contracts/screens.md), [quickstart.md](./quickstart.md)

**Tests**: INCLUÍDOS, porque a constitution exige (princípio VII: domínio com testes unitários, rotas
com teste de contrato, testes junto com cada tarefa). Em cada tarefa, escreva os testes antes da
implementação e confirme que falham. Grupos: `domain`, `contracts`, `server`, `server-db`, `desktop`,
`desktop-ui` e `desktop-e2e` (research R-11).

**Organization**: uma fase por história, na ordem de prioridade: US1 e US2 (P1); US3, US5 e US6
(P2); US4 (P3). A US1 abre com o período padrão ("Últimos 30 dias"); a US2 acrescenta a troca.

**Base**: a branch `007-relatorios-app-desktop` (spec da PM de 16/11) recebeu a `master` com as
features 003 a 008 em 2026-11-25 (merge `03bf5db`), antes do clarify e do plano.

**Como construir cada tela**: abrir o frame pelo node de [contracts/screens.md](./contracts/screens.md)
(`get_screenshot` e `get_design_context` do Figma, `fileKey` `YCbxTAacFxbGuOF8uwoLtt`, página
`007-relatorios-app-desktop`) e montar **só com os componentes de `ui/`**, adaptando, nunca copiando o
código gerado. As diferenças já decididas estão no research (R-12): sem nome de rede, "Todos os
hotéis" com os de R$ 0,00, período padrão "Últimos 30 dias".

**Dados**: nenhuma tarefa acessa o Hunit. Testes, prints e Figma só com dados fictícios (os do roteiro
de captura: "Hotel Praia Azul", "Pousada Serra Verde"…, hóspedes "Ana Ribeiro"…). Sem nomes de hotéis
ou da empresa.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história atendida (US1 a US6)
- **⛔ HOMOLOGAÇÃO / PRODUÇÃO / FIGMA / USUÁRIO**: depende do PC do servidor, do ok do usuário para
  escrever no Figma ou de uma ação do usuário ou da PM

## Path Conventions

Monorepo pnpm (ver plan.md). Renderer: `apps/desktop/src/renderer/src/` (abreviado `renderer/`
abaixo). Testes do app: `apps/desktop/test/{main,renderer,e2e}`. Servidor:
`apps/server/src/{persistence,http}`, testes em `apps/server/test/{unit,contract,integration}`.
Domínio: `packages/domain/{src,test}`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: linha de base e os recursos exportados do design.

- [X] T001 Na branch `007-relatorios-app-desktop`: `pnpm install`, `pnpm build` e `pnpm test --project domain` como linha de base (o Docker em execução para os grupos de banco). Conferir que o `.specify/feature.json` aponta para `specs/007-relatorios-app-desktop`
- [X] T002 [P] Exportar do Figma o ícone de gráfico do item "Relatórios" do menu (tela 8.1, `90:3573`) como SVG em `apps/desktop/resources/icons/reports.svg`, com `viewBox` fixo e traço de 1,8 px, como os da 006 (`apps/desktop/resources/icons/README.md`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contrato 1.10.0, a regra do relatório no domínio, a rota do resumo e a ponte do app, de
que todas as histórias dependem.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

- [X] T003 Contrato 1.10.0 em `packages/contracts/openapi.yaml` (`info.version: 1.10.0` e o parágrafo da 007 na descrição), com tudo de [contracts/api-changes.md](./contracts/api-changes.md): rota `GET /reports/overview` (tag nova `reports`, `operationId` `getReportOverview`, parâmetros `checkInFrom` e `checkInTo` obrigatórios `format: date`, 200 `ReportOverview`, 400 `validation_error`, 401), esquemas `ReportOverview` e `HotelReportRow` (valores em `Money`, contagens `integer` `minimum: 0`, `lastVerifiedAt` "date-time ou nulo") e o valor `amount_desc` em `ReservationOrder` ("valor a cobrar do maior para o menor, sem valor no fim, depois hotel e número"). Rodar `pnpm --filter @hunit/contracts generate`, copiar para `specs/007-relatorios-app-desktop/contracts/openapi.yaml` (idêntico; a cópia da 008 fica na 1.9.0) e deixar `pnpm --filter @hunit/contracts lint` verde. Conferir que `apps/server/test/unit/contract-frozen-enums.test.ts` continua passando sem mudança
- [X] T004 [P] Domínio em `packages/domain/src/report.ts` (exportado em `index.ts`), com testes em `packages/domain/test/report.test.ts` ([data-model.md](./data-model.md) §1): `REPORT_EXCLUDED_SITUATIONS = ['ignored_hotelbeds_258', 'not_virtual_card', 'invoiced']` sobre a situação **detalhada**; `reportBucket({ detailedSituation, pendingCharge, hasRequest })` → `excluded` (situação excluída), `requested` ("Falta cobrar" com tratativa), `pending` ("Falta cobrar" sem tratativa), `recovered` (`proof_sent` ou `virtual_card_already_charged` com tratativa), `previous_charged` (os mesmos sem tratativa), `none` (`cancelled_no_charge`), com um caso de teste para cada uma das 13 situações detalhadas × com e sem tratativa; `reportAmount(bucket, { amountToCharge, chargedAmount, totalAmount })` (em aberto = valor a cobrar; cobrado = valor cobrado exibido ou, sem ele, o total; `null` = sem valor); `distributionPercentages(values)` (uma casa, maior resto, soma 100,0; `belowMinimum` quando > 0 e < 0,1 %; base zero → todos 0); `reportPeriod(shortcut, today)` (`last_7_days` = hoje − 6 a hoje, `last_30_days` = hoje − 29 a hoje, `this_month` = dia 1 ao último dia; testes na virada de mês e de ano e em fevereiro bissexto) e `reportShortcutOf(period, today)` (o atalho igual ao período ou `custom`)
- [X] T005 Extrair a CTE dos fatos da tratativa de `countQuickFilters` para uma função `treatmentFactsSql(where)` em `apps/server/src/persistence/reservations-repo.ts`, **sem mudar a regra**, com as colunas a mais que o relatório usa (`hotel_code`, `check_in`, `last_verified_at`, `total_amount`, valor a cobrar e o valor cobrado exibido pela regra de `chargedAmountWithOrigin`: Hunit maior que zero, informado à mão com comprovante vigente, Comercial confirmado). `countQuickFilters` passa a usá-la; `apps/server/test/integration/reservations-quick-filters.test.ts` e `apps/server/test/contract/reservations-quick-filters.test.ts` continuam verdes
- [X] T006 Repositório novo `apps/server/src/persistence/reports-repo.ts`: `reportOverview(db, { from, to })` sobre `treatmentFactsSql` com o período de check-in, sem as situações de `REPORT_EXCLUDED_SITUATIONS` (expressão da situação detalhada a partir das listas do domínio), agrupando por hotel com `count(*) filter` e `sum(...) filter` para as faixas do T004, `max(last_verified_at)` e o nome do catálogo (`hotels`); totais = soma das linhas; `hotels.total` = hotéis disponíveis mais os indisponíveis com dados no período (R-05); `withoutAmount` = reservas com faixa de valor e sem valor. Testes (`server-db`) em `apps/server/test/contract/reports.test.ts` e `apps/server/test/integration/reports-repo.test.ts`: **paridade** relatório × `reportBucket`/`reportAmount` do domínio × lista (`listReservations` com `quickFilter: 'pending_charge'` dá o mesmo `openCount` e a mesma soma por hotel) com reservas fictícias em todas as situações, com e sem tratativa, comprovante, retorno do Comercial confirmado, linha cancelada e marcação "Cancelada sem cobrança"; período vazio; check-in nas pontas do período; e o **volume**: 35 000 reservas em até 1 s
- [X] T007 Rota `GET /reports/overview` em `apps/server/src/http/handlers/reports.ts` (nova), com a conversão em `apps/server/src/http/report-views.ts` (nova; `Money` com duas casas, datas ISO) e o registro em `apps/server/src/http/app.ts`, liberada aos perfis operador e consulta; período validado com `validatePeriod` do domínio (`InvalidPeriodError`) (falta uma data, data inexistente ou início depois do fim → 400 `validation_error`). Teste de contrato em `apps/server/test/contract/reports.test.ts` (200 com dados, 200 com período vazio — zeros, `hotelRows` vazia, `lastVerifiedAt` nulo —, as três recusas 400, 401 sem chave, perfil consulta aceito, resposta validada contra o OpenAPI e sem nenhum campo de hóspede)
- [X] T008 [P] Ponte `reports.overview` ([contracts/ipc.md](./contracts/ipc.md)): canal `reports:overview` em `apps/desktop/src/shared/ipc-channels.ts`, tipos `ReportOverview` e `HotelReportRow` (dos gerados) em `shared/ipc-types.ts`, esquema da entrada em `shared/ipc-schemas.ts` (só datas `AAAA-MM-DD` existentes, início até o fim), `reportsOverview` em `main/api-client.ts`, handler em `main/story-handlers.ts` (com os canais das reservas), `preload/index.ts`. Testes em `apps/desktop/test/main/api-client.test.ts` e `apps/desktop/test/main/reports-overview.test.ts` (entrada inválida recusada sem chamar a API, erro do servidor no `Result`); `reports.overview` na lista da ponte em `apps/desktop/test/e2e/security-hardening.test.ts`
- [X] T009 Área "Relatórios" no app: `ReportsIcon` em `renderer/ui/icons/icons.tsx` (do SVG do T002) e no `index.ts`, área `reports` em `renderer/App.tsx` (título "Relatórios", entre `commercial` e `setup`, nos dois perfis), `renderer/screens/reports/ReportsScreen.tsx` com o `PageHeader` "Relatórios" e `renderer/state/reports.ts` com `useReportOverview(period)` (TanStack Query, chave `['reports', from, to]`, `staleTime: Infinity`, `refetchOnWindowFocus: false`, sem `placeholderData`, R-06). Testes em `apps/desktop/test/renderer/app-shell.test.tsx` (ordem do menu do design: Executar, Execuções, Reservas, Comercial, Relatórios, Configuração; o consulta sem "Executar") e `ui-icons.test.tsx`

**Checkpoint**: contrato 1.10.0, regra, rota e ponte prontas; a área abre vazia nos dois perfis.

---

## Phase 3: User Story 1 - Ver o panorama do período e o valor em aberto (Priority: P1) 🎯 MVP

**Goal**: a tela 8.1 sem o ranking: topo, os três grupos de indicadores e a distribuição dos valores,
com o período padrão "Últimos 30 dias".

**Independent Test**: com reservas fictícias em várias situações, abrir Relatórios e conferir cada
número, o card escuro, o card de valor já cobrado e a distribuição contra a lista de Reservas no mesmo
período (quickstart 3.1 a 3.5).

- [X] T010 [P] [US1] Componentes `renderer/ui/charts/StackedBar.tsx` e `renderer/ui/charts/LegendList.tsx` ([contracts/ui-components.md](./contracts/ui-components.md)): segmentos com `tone` `requested` (cinza) / `pending` (lima) / `previous` (verde) / `recovered` (preto), escala comum por `max`, tamanhos `sm` e `md`, fundo claro ou escuro (`Surface dark`), nome acessível; barra sem valor = só o fundo; legenda com marcador, nome, detalhe, valor e percentual. Tokens em `renderer/ui/tokens.ts` se faltar cor; exportar em `renderer/ui/index.ts`. Testes em `apps/desktop/test/renderer/ui-charts.test.tsx` (larguras proporcionais, escala comum, barra vazia, legenda em texto) e o contraste em `tokens-contrast.test.ts`
- [X] T011 [P] [US1] `renderer/presentation/report.ts` com testes em `apps/desktop/test/renderer/report-presentation.test.ts`: rótulos ("Cobrado anteriormente" — "sem precisar de tratativa", "Recuperado" — "cobrado depois da tratativa", "Solicitado" — "com tratativa enviada", "Pendente" — "sem tratativa"), percentuais do `distributionPercentages` em "96,6%" e "<0,1%", "X de Y", "34.526 reservas no recorte" / "1 reserva no recorte", subtítulo "Reservas com cartão virtual · dados do servidor atualizados em DD/MM/AAAA às HH:MM" e "Última verificação das reservas: DD/MM/AAAA às HH:MM" (formatos de `presentation/format.ts`)
- [X] T012 [US1] Tela 8.1 (sem o ranking) em `renderer/screens/reports/`: `ReportsScreen.tsx` (período padrão `reportPeriod('last_30_days', hoje)`, topo com o selo "Dados atualizados" e "Atualizar dados", que refaz a consulta), `VolumeCards.tsx` (Reservas, Tratativas enviadas e Hotéis com dados "79 de 83", com os textos de apoio do design, sem barra), `OpenValueCard.tsx` (superfície escura, total, "Ainda precisa de ação: cobranças solicitadas e pendentes", `StackedBar` solicitado/pendente com valor e percentual de cada parte e o botão "Ver reservas em aberto" recebido por prop; R$ 0,00 → barra vazia e botão desabilitado com "Nada em aberto neste período"), `ChargedValueCard.tsx` (total, "Cobranças concluídas no período", as duas linhas) e `ValueDistributionCard.tsx` ("Distribuição dos valores", "Do total de R$ … em cartão virtual", `StackedBar` 100 % e `LegendList` com as quatro faixas, valor e percentual); aviso "N reservas ficaram sem valor" quando `withoutAmount > 0` (Edge Cases); grupos em coluna em janela estreita. Testes em `apps/desktop/test/renderer/reports-screen.test.tsx` com a ponte simulada (cada número no formato brasileiro, ordem dos grupos, só pendente, só solicitado, zero em aberto, "Atualizar dados" refaz a consulta e troca a hora)

**Checkpoint**: MVP — o Financeiro lê o valor em aberto e o já cobrado dos últimos 30 dias.

---

## Phase 4: User Story 2 - Escolher o período sem passos extras (Priority: P1)

**Goal**: o campo de período com os atalhos e o calendário (8.2), aplicado na hora, com o total do
recorte.

**Independent Test**: escolher cada atalho e um período personalizado e conferir que os números mudam
sem confirmação e que o total do recorte acompanha (quickstart 3.6 e 3.7).

- [X] T013 [US2] `renderer/screens/reports/ReportPeriodBar.tsx`: rótulo "Período de check-in", o `PeriodPicker` (o mesmo dos filtros, sem limpar), os atalhos "Últimos 7 dias", "Últimos 30 dias", "Este mês" e "Personalizado" com o `FilterChip` sem contagem (o ativo destacado; "Personalizado" abre o calendário), à direita "N reservas no recorte" e a "Última verificação das reservas"; sem "Aplicar filtros" nem "Limpar". O período fica no `App` (lembrado enquanto o app está aberto, não em disco) e passa ao `ReportsScreen`. Testes em `apps/desktop/test/renderer/reports-period.test.tsx`: cada atalho troca a consulta na hora; período escolhido no calendário igual a um atalho mostra o atalho ativo; singular "1 reserva no recorte"; troca rápida de período não mostra a resposta de um período anterior; voltar à área mantém o período

**Checkpoint**: US1 e US2 completas — o relatório de qualquer período.

---

## Phase 5: User Story 3 - Do hotel com mais valor em aberto às reservas que resolvem (Priority: P2)

**Goal**: o ranking (8.1), a gaveta do hotel (8.3) e a ida para a área Reservas filtrada.

**Independent Test**: abrir a gaveta de um hotel, conferir o valor e a contagem e chegar em Reservas
com a mesma quantidade anunciada (quickstart 3.9 a 3.13).

- [X] T014 [P] [US3] Ordem `amount_desc` no servidor: `orderColumns`, `encodeCursor`/`decodeCursor` e `afterCursor` em `apps/server/src/persistence/reservations-repo.ts` (valor a cobrar do maior para o menor, sem valor no fim, depois hotel e número; cursor `[amount_desc, valor ou null, hotel, número]`) e o parâmetro em `apps/server/src/http/handlers/reservations.ts` (lista e seleção). Testes em `apps/server/test/contract/reservations-amount-order.test.ts` (ordem, empates, reservas sem valor, paginação pelo cursor sem repetir nem pular, cursor de outra ordem → 400) e o esquema da ponte (`order` aceita `'amount_desc'` em `apps/desktop/src/shared/ipc-schemas.ts`)
- [X] T015 [P] [US3] Componente `renderer/ui/lists/RankingRow.tsx` ([contracts/ui-components.md](./contracts/ui-components.md)): número em pílula, nome cortado numa linha (inteiro no `title`), barra, valor à direita e seta; a linha é um botão com o nome acessível "Abrir o detalhe de <hotel>"; `disabled`. Testes em `apps/desktop/test/renderer/ui-lists.test.tsx`
- [X] T016 [US3] `renderer/screens/reports/HotelRankingCard.tsx`: "Hotéis com mais valor em aberto", subtítulo "Solicitado + pendente · maiores primeiro" (sem rede), hotéis com valor em aberto > 0, do maior para o menor, empate pelo nome (função em `presentation/report.ts`), barras `StackedBar` na escala do maior hotel, rolagem dentro do card (a página não rola), legenda "Solicitado (tratativa enviada)" e "Pendente (sem tratativa)" e o botão "Ver todos os hotéis" (a gaveta vem na US4). Testes em `apps/desktop/test/renderer/reports-screen.test.tsx`
- [X] T017 [US3] `renderer/screens/reports/HotelDetailDrawer.tsx` (8.3) no `AppDrawer`: nome do hotel, "Nº com mais valor em aberto · check-in de DD/MM a DD/MM/AAAA", card escuro do valor em aberto com a barra e os dois valores, os três cards (Reservas, Tratativas enviadas, Recuperado) da linha do hotel e "Reservas em aberto (N)" — "maiores valores primeiro" — por `reservations.list` com `hotelCode`, período, `quickFilter: 'pending_charge'`, `order: 'amount_desc'` e 50 por página (hóspede, número, "DD/MM → DD/MM/AAAA", valor e o selo da situação detalhada), e o botão "Ver as N reservas em Reservas". Fechar devolve o relatório no mesmo estado (período e rolagem do ranking, FR-023). Testes em `apps/desktop/test/renderer/reports-hotel-drawer.test.tsx`
- [X] T018 [US3] Ida para Reservas (R-07): `ReservationsPreset` (`hotelCodes?`, `checkInFrom`, `checkInTo`, `quickFilter: 'pending_charge'`, `expectedCount`) no `renderer/App.tsx`, que generaliza o `initialExecutionId` (a ida a partir da execução continua igual); `renderer/screens/reservations/ReservationsScreen.tsx` aplica os filtros iniciais (visíveis em "Filtros aplicados", removíveis) e, se a contagem de "Falta cobrar" for diferente de `expectedCount`, mostra o `Notice` âmbar "Os números do relatório podem estar desatualizados. Atualize o relatório para ver os de agora."; ligar "Ver as N reservas em Reservas" (hotel) e "Ver reservas em aberto" (todos os hotéis). Testes em `apps/desktop/test/renderer/reservations-screen.test.tsx` (filtros do preset, aviso só com divergência, ida pela execução sem mudança)
- [X] T019 [US3] Jornada em `apps/desktop/test/e2e/reports.test.ts` (nova), com o app compilado e a API com reservas fictícias em vários hotéis e situações: abrir Relatórios → conferir o valor em aberto com a soma esperada → abrir o 1º do ranking → "Ver as N reservas em Reservas" → a lista mostra N reservas, com os filtros; voltar e usar "Ver reservas em aberto" (SC-002, SC-004)

**Checkpoint**: do número à reserva em até 3 cliques.

---

## Phase 6: User Story 5 - Saber sempre em que estado estão os dados (Priority: P2)

**Goal**: carregamento, vazio (8.4) e servidor indisponível (8.5).

**Independent Test**: período sem reservas, servidor desligado com o relatório aberto, abertura com o
servidor desligado e carregamento lento (quickstart 3.8 e 3.16 a 3.18).

- [X] T020 [US5] Estados em `renderer/screens/reports/ReportsScreen.tsx`: carregando = esqueleto no lugar dos números (nunca zeros) e o selo "Atualizando…" (lima); `reservations = 0` = card com o `EmptyState` "Nenhuma reserva neste período", "Não há check-ins com cartão virtual entre DD/MM e DD/MM/AAAA. Escolha outro período para ver os indicadores." e "Ver os últimos 30 dias" (aplica o atalho), com o filtro e "0 reservas no recorte" (8.4); servidor indisponível com dados = o alerta do app (`ConnectionBanner`), o selo trocado pelo `StaleDataNotice` ("dados de HH:MM — servidor indisponível"), subtítulo "dados obtidos às HH:MM de DD/MM/AAAA", números legíveis e "Atualizar dados", "Ver reservas em aberto" e as linhas do ranking (abrir hotel) desabilitados; "Ver todos os hotéis" continua habilitado, porque usa os dados já na tela (8.5); indisponível sem dados = só o alerta, sem números; ao voltar, "Atualizar dados" refaz e o alerta some. Testes em `apps/desktop/test/renderer/reports-states.test.tsx`
- [X] T021 [US5] Ponta a ponta em `apps/desktop/test/e2e/reports.test.ts`: derrubar a API com o relatório aberto (ações desabilitadas, hora visível), subir de novo e "Atualizar dados"; abrir o app com a API parada e ir a Relatórios (só o alerta) — como em `offline-recovery.test.ts`

**Checkpoint**: nenhum número sem a hora a que se refere (SC-006).

---

## Phase 7: User Story 6 - Consultar os relatórios com o perfil de consulta (Priority: P2)

**Goal**: o mesmo módulo no perfil consulta (8.6).

**Independent Test**: abrir Relatórios com cada perfil e conferir o mesmo conteúdo, com "Executar" só
no operador (quickstart 3.19).

- [X] T022 [US6] Testes do perfil consulta: em `apps/desktop/test/renderer/reports-screen.test.tsx`, os mesmos números, gavetas e a ida para Reservas com o perfil consulta; em `apps/desktop/test/e2e/reports.test.ts` (ou um `reader-reports.test.ts`), o consulta abre Relatórios, a gaveta do hotel e chega em Reservas sem ações de registro, e o menu não tem "Executar". Corrigir o que faltar (o módulo não tem ação de operador)

**Checkpoint**: os dois perfis com o mesmo relatório.

---

## Phase 8: User Story 4 - Ver todos os hotéis, com busca e ordenação (Priority: P3)

**Goal**: a gaveta "Todos os hotéis" (8.7).

**Independent Test**: abrir "Ver todos os hotéis", buscar um nome parcial, trocar a ordenação e abrir o
detalhe de um hotel (quickstart 3.14 e 3.15).

- [X] T023 [P] [US4] Funções em `renderer/presentation/report.ts` com testes em `apps/desktop/test/renderer/report-presentation.test.ts`: busca pelo nome "sem diferenciar maiúsculas e acentos"; ordenações "Maior valor" (valor em aberto), "Mais pendente" (valor pendente) e "Nome A-Z", "nas duas primeiras, empate pelo nome"; hotéis com R$ 0,00 em aberto no fim nas duas primeiras
- [X] T024 [US4] `renderer/screens/reports/AllHotelsDrawer.tsx` (8.7) no `AppDrawer`: título "Todos os hotéis", subtítulo "N hotéis · check-in de DD/MM a DD/MM/AAAA · total em aberto R$ …" (sem rede), campo "Buscar hotel pelo nome", os três botões de ordenação (o ativo destacado), cabeçalho Hotel / Solicitado + pendente / Em aberto, `RankingRow` numerada na ordem mostrada, com os de R$ 0,00; busca sem resultado = `EmptyState` com "Limpar busca"; clicar abre o `HotelDetailDrawer` (T017; sem a posição no subtítulo quando o valor em aberto é R$ 0,00); ligar "Ver todos os hotéis" do ranking. Testes em `apps/desktop/test/renderer/reports-all-hotels.test.tsx`

**Checkpoint**: todas as histórias completas.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: larguras, comparação com o design, documentação, verificação, homologação, Figma e
produção.

- [X] T025 [P] Larguras em `apps/desktop/test/e2e/responsive.test.ts` (com `layout-checks.ts`): Relatórios, a gaveta do hotel e "Todos os hotéis" em 960, 1 280 e 1 920 px e com zoom de 125 %: sem rolagem horizontal, grupos em coluna na janela estreita, card de valor em aberto visível, nome longo de hotel cortado numa linha e inteiro na gaveta, cantos dos cards cortando o destaque das linhas
- [X] T026 [P] Roteiro de captura em `apps/desktop/test/e2e/screens-capture.test.ts`: as sete telas com os nomes `8.1 relatorios-visao-geral`, `8.2 relatorios-escolhendo-o-periodo`, `8.3 relatorios-detalhe-do-hotel`, `8.4 relatorios-nenhuma-reserva-no-periodo`, `8.5 relatorios-servidor-indisponivel`, `8.6 consulta-relatorios` e `8.7 relatorios-todos-os-hoteis`, com dados fictícios (hotéis e valores parecidos com os do design)
- [X] T027 Comparação com o design (SC-005): `screens-capture` em 1 440 × 900, as sete telas ao lado dos frames da página 007; registrar em `research.md` ("Comparação com o design") e corrigir até não sobrar diferença sem aceite (as do R-12 já decididas); conferir o dia de hoje em lima no calendário (FR-006); passar ao usuário a lista de diferenças do R-12 para levar à UX
  - 25/11/2026: comparação registrada no research; as correções do primeiro print (selo em pílula, cards da mesma altura, estado vazio num card só) foram conferidas pelos testes; uma nova captura acompanha a marcação no Figma (T032)
- [X] T028 [P] Documentação: `AGENTS.md` (contrato 1.10.0 com a cópia em `specs/007-relatorios-app-desktop/contracts/`, a da 008 congelada na 1.9.0; `reports-repo.ts`, `screens/reports/` e `ui/charts/` na tabela de estrutura; parágrafo "Desde a feature 007"); `README.md` ("Relatórios" na visão geral do app); versão do app para 0.5.0 em `apps/desktop/package.json`
- [X] T029 Verificação completa: `pnpm build`, `pnpm lint`, `pnpm typecheck` e `pnpm test` (todos os grupos, com o Docker) verdes; `git diff --cached --name-only` sem prints, planilhas, `.env` ou dados reais
  - 25/11/2026: build, lint e typecheck verdes. Na rodada completa, 11 testes de banco passaram do tempo (a máquina roda também a produção e a homologação no Docker); rodados de novo, sozinhos, os arquivos passaram (100 + 19 testes), como `domain`, `server`, `desktop` e `desktop-ui` (1 572). De ponta a ponta: `reports`, `responsive` (28) e `screens-capture` passaram
- [X] T030 ⛔ HOMOLOGAÇÃO: quickstart §2 e §3 — servidor de homologação na 1.10.0, instalador 0.5; cenários 3.1 a 3.22 com os dois perfis; o app 0.4 contra a 1.10.0 continua funcionando. Registrar em `research.md` ("Homologação")
  - 25/11/2026: cenários 3.1 a 3.22 aprovados pelo usuário; 3.22 em menos de 1 s
- [ ] T031 ⛔ USUÁRIO: SC-007 com a PM — as 4 usuárias respondem, sem ajuda, "qual hotel tem mais valor em aberto?" e "quanto já foi cobrado?" em até 30 s; registrar em `research.md` ("Homologação")
- [ ] T032 ⛔ FIGMA: skill `figma-screens-sync` com `FEATURE = '008-ajustes-cobranca-e-aviso'` e sem `SKIP` (research R-13): simulação, relatório ao usuário e, com o ok dele, aplicação — 8.1 a 8.7 com ✅ e nenhuma outra tela mudando
- [X] T033 ⛔ PRODUÇÃO: quickstart §5 — servidor na 1.10.0 e instalador 0.5 nas máquinas do Financeiro e da Controladoria. Registrar em `research.md` ("Produção")
  - 27/11/2026: a produção foi direto para a 1.11.0 e o app 0.5.1 (T043), com tudo certo; registro em `research.md` ("Produção")
- [X] T034 ⛔ USUÁRIO: atualizar o doc "HUNIT Control — ajustes e bugs para a PM" com a 007 na tabela "Andamento do desenvolvimento" e no Histórico (o doc pode não abrir pelo Claude Code; nesse caso, o texto vai para o usuário colar)
  - 27/11/2026: doc atualizado pelo Claude Docs: a 007 no "Andamento do desenvolvimento" (42 de 44), item 14 "Concluído" e a linha no Histórico

---

## Phase 10: Filtros do relatório (ajuste depois do merge, FR-005a, research R-14)

**Purpose**: o botão "Filtros" ao lado do período, com o painel da área Reservas, pedido pelo usuário
depois do merge do PR #12, sem esperar o design (branch `fix/007-filtros-relatorios`). Contrato
1.11.0, app 0.5.1.

- [X] T035 Spec: clarificação "ajuste depois do merge", FR-005a e os ajustes no FR-005, FR-011, FR-022 e FR-024; research R-14 e a linha na R-12; data-model §4; contracts/api-changes.md e ui-components.md; quickstart 3.23 a 3.28
- [X] T036 Contrato 1.11.0 em `packages/contracts/openapi.yaml`: filtros opcionais em `GET /reports/overview`; `generate`; cópia em `specs/007-relatorios-app-desktop/contracts/openapi.yaml`; versão em `apps/server/test/unit/contract-frozen-enums.test.ts`
- [X] T037 Servidor: `filterConditions` exportada em `reservations-repo.ts`; `ReportFilters` e o "X de Y" dos hotéis escolhidos em `reports-repo.ts`; o handler lê os filtros; testes em `test/contract/reports.test.ts` (hotel, paridade com a lista filtro a filtro, filtro inválido)
- [X] T038 Ponte do app: `reportOverviewInputSchema` e `ReportOverviewInput` com os filtros; `story-handlers.ts`; testes em `test/main/api-client.test.ts` e `reports-overview.test.ts`
- [X] T039 Tela: `PanelFields` extraído de `ReservationFilters.tsx` (com `withPeriod`, `situations` e `origin`); `AppliedFilterChips` com a Origem e `clearLabel`; `FilterAnchor` e `clearLabel` em `ui/FilterBar.tsx`; `screens/reports/ReportFilters.tsx`; botão e painel no `ReportPeriodBar`; filtros no `ReportsScreen` (consulta, gaveta do hotel, ida para Reservas, estado vazio) e no `App`; `ReservationsPreset` com `filters` e `origin`; correção do "Personalizado" ao fechar o calendário
- [X] T040 Testes da interface: `test/renderer/reports-filters.test.tsx` (painel, chips, consulta, gaveta, ida para Reservas, estado vazio), `reservations-screen.test.tsx` (preset com filtros) e `reports-screen.test.tsx` ("Personalizado"); de ponta a ponta, `reports.test.ts` (jornada com filtro) e as capturas 8.8 e 8.9 em `screens-capture.test.ts`
- [X] T041 Verificação: build, lint, typecheck e os grupos de teste; `responsive`; versão do app para 0.5.1; `AGENTS.md` (contrato 1.11.0)
  - 25/11/2026: build, lint e typecheck verdes; `domain`, `server` e `contracts` (705), `desktop` (291), `desktop-ui` (582), `reports.test.ts` do banco (23); de ponta a ponta, `reports` (5), `responsive` (28, rodado sozinho: junto com outras rodadas a janela não chegou a 960 px), `us3-reservations` e `screens-capture` sem falhas. O teste longo de teclado do painel de Reservas ganhou 30 s (passava dos 15 s só na rodada em paralelo)
- [X] T042 ⛔ FIGMA: telas de sugestão 8.8 (painel aberto) e 8.9 (relatório filtrado) na página 007, marcadas como sugestão do desenvolvimento para a UX, sem mexer nas telas da UX
  - 25/11/2026: seção "💡 Sugestões do desenvolvimento" abaixo da seção "8. Relatórios", com uma nota e os prints 8.8 e 8.9 do roteiro de captura; os nomes começam por "💡", fora da marcação ✅/❌ do `figma-screens-sync`
- [X] T043 ⛔ USUÁRIO: homologação (quickstart 3.23 a 3.28) e produção (servidor 1.11.0 antes do instalador 0.5.1); registrar em `research.md`
  - 25/11/2026: homologação aprovada (3.23 a 3.28); falta a produção
  - 27/11/2026: produção feita (servidor 1.11.0 antes do instalador 0.5.1), com tudo certo
- [X] T044 Doc da PM: o ajuste na lista de ajustes e bugs (regra da memória: todo ajuste pedido em conversa vai para o doc)
  - 25/11/2026: item 14 (Ajuste, Relatórios, "Em desenvolvimento"), o detalhe e a linha no Histórico

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: depois do Setup; bloqueia todas as histórias. T003 → T005 → T006 → T007;
  T004 em paralelo com T003; T008 depois do T003 (tipos gerados); T009 depois do T002 e do T008.
- **US1 (Phase 3)**: depende da Foundational.
- **US2 (Phase 4)**: depende da US1 (T012).
- **US3 (Phase 5)**: depende da US1; T014 depende só do T003.
- **US5 (Phase 6)**: depende da US1; melhor depois da US3 (desabilita o ranking).
- **US6 (Phase 7)**: depois da US3 (testa a gaveta e a ida para Reservas).
- **US4 (Phase 8)**: depende da US3 (T015, T017).
- **Polish (Phase 9)**: depois de todas as histórias. T025, T026 e T028 em paralelo; T027 → T029 →
  T030 → T031 e T032; T033 depois da homologação; T034 ao fim.

### Within Each User Story

- Testes escritos antes e falhando; domínio → repositório → rota → ponte do app → telas → jornada.
- Uma tarefa só está concluída com os testes dela passando (constitution VII).

### Parallel Opportunities

- Setup: T002 com T001.
- Foundational: T004 com T003; T008 depois do T003; T009 depois do T008.
- US1: T010 e T011 em paralelo; T012 depois dos dois.
- US3: T014 e T015 em paralelo; T016 → T017 → T018 → T019.
- US4: T023 em paralelo com qualquer tarefa da US5 ou da US6.
- Polish: T025, T026 e T028.

---

## Parallel Example: Foundational

```bash
# Contrato e domínio, em paralelo:
Task: "T003 Contrato 1.10.0 (openapi.yaml, generate, cópia em specs/007)"
Task: "T004 report.ts: faixas, valores, percentuais e atalhos (domínio)"
```

## Parallel Example: User Story 1

```bash
# Componentes e apresentação, em paralelo:
Task: "T010 StackedBar e LegendList (ui/charts)"
Task: "T011 Rótulos e formatos do relatório (presentation/report.ts)"
```

## Parallel Example: User Story 3

```bash
# Servidor e componente, em paralelo:
Task: "T014 Ordem amount_desc (reservations-repo.ts, handler, ponte)"
Task: "T015 RankingRow (ui/lists)"
```

---

## Implementation Strategy

### MVP First (US1)

1. Phase 1 (Setup) e Phase 2 (Foundational).
2. Phase 3 (US1): o panorama dos últimos 30 dias — valor em aberto e já cobrado.
3. **PARAR E VALIDAR**: quickstart 3.1 a 3.5.

### Incremental Delivery

1. Setup + Foundational → contrato 1.10.0, regra, rota e ponte.
2. US1 → panorama (MVP).
3. US2 → qualquer período.
4. US3 → ranking, gaveta e ida para Reservas.
5. US5 → estados (carregando, vazio, indisponível).
6. US6 → perfil consulta conferido.
7. US4 → "Todos os hotéis".
8. Polish → larguras, comparação com o design, homologação, SC-007, Figma, produção e o doc da PM.

O app só vai para as máquinas no fim (T033), depois do servidor.

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- Commits pequenos, em português, citando a spec (ex.: `feat(specs/007): resumo do período no servidor (T005-T007)`).
- Antes de cada commit: `git diff --cached --name-only` sem prints, `.env`, planilhas ou dados reais
  (AGENTS.md).
- Nenhuma tarefa acessa o Hunit.
- Se a implementação mostrar que a spec está errada ou incompleta, **parar e atualizar a spec** antes
  de seguir.
