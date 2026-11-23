---

description: "Task list for feature 008 — Ajustes de cobrança e do aviso de token"
---

# Tasks: Ajustes de cobrança e do aviso de token

**Input**: Design documents from `/specs/008-ajustes-cobranca-e-aviso/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/api-changes.md](./contracts/api-changes.md),
[contracts/sheet-layout.md](./contracts/sheet-layout.md), [contracts/ipc.md](./contracts/ipc.md),
[contracts/ui-components.md](./contracts/ui-components.md), [contracts/screens.md](./contracts/screens.md),
[quickstart.md](./quickstart.md)

**Tests**: INCLUÍDOS, porque a constitution exige (princípio VII: domínio com testes unitários,
rotas com teste de contrato, Hunit contra fixtures, testes junto com cada tarefa). Em cada tarefa,
escreva os testes antes da implementação e confirme que falham. Grupos: `domain`, `contracts`,
`server`, `server-db`, `server-browser`, `desktop`, `desktop-ui` e `desktop-e2e` (research R-12).

**Organization**: uma fase por história. A US5 (componentes, P3) vem antes da US1 porque a tela do
som usa o Switch desligado e o controle de volume. Depois: US1 e US2 (P1); US3, US4, US6 e US7 (P2).

**Base**: a branch `008-ajustes-cobranca-e-aviso` recebeu a `master` com as features 003 a 006
(commit `d343264`).

**Como construir cada tela**: abrir o frame pelo node de [contracts/screens.md](./contracts/screens.md)
(`get_screenshot` e `get_design_context` do Figma, `fileKey` `YCbxTAacFxbGuOF8uwoLtt`, página
`008-ajustes-cobranca-e-aviso`) e montar **só com os componentes de `ui/`**, adaptando, nunca copiando
o código gerado. As diferenças já decididas estão no research (R-13).

**Dados**: nenhuma tarefa acessa o Hunit real. Testes, prints e Figma só com dados fictícios (os do
roteiro de captura: "Ana Ribeiro"…, "Hotel Praia Azul"…). Sem nomes de hotéis ou da empresa.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história atendida (US1 a US7)
- **⛔ MÁQUINA / HOMOLOGAÇÃO / PRODUÇÃO / FIGMA / USUÁRIO**: depende de um Windows com o app instalado,
  do PC do servidor, do ok do usuário para escrever no Figma ou de uma ação do usuário

## Path Conventions

Monorepo pnpm (ver plan.md). Renderer: `apps/desktop/src/renderer/src/` (abreviado `renderer/`
abaixo). Testes do app: `apps/desktop/test/{main,renderer,e2e}`. Servidor:
`apps/server/src/{persistence,http,commercial-sheet,dispatches,maintenance}`, testes em
`apps/server/test/{unit,contract,integration}`. Domínio: `packages/domain/{src,test}`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: ambiente de desenvolvimento e os recursos exportados do design.

- [X] T001 Na branch `008-ajustes-cobranca-e-aviso`: `pnpm install`, `pnpm build` e `pnpm test --project domain` como linha de base (o Docker em execução para os grupos de banco). Conferir que o `.specify/feature.json` aponta para `specs/008-ajustes-cobranca-e-aviso`
- [X] T002 [P] Exportar do Figma (biblioteca "Componentes — nova identidade", componente "Controle de volume") os ícones de som baixo e som alto como SVG em `apps/desktop/resources/icons/`, com `viewBox` fixo e traço de 1,8 px, como os da 006 (`apps/desktop/resources/icons/README.md`, research R-04 da 006)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: o contrato 1.9.0 e a migration, de que todas as histórias de servidor dependem.

**⚠️ CRITICAL**: nenhuma história de servidor começa antes desta fase.

- [X] T003 Contrato 1.9.0 em `packages/contracts/openapi.yaml` (`info.version: 1.9.0`), com **tudo** de [contracts/api-changes.md](./contracts/api-changes.md): rotas `POST /reservations/{hotelCode}/{reservationNumber}/no-charge` (corpo `expectedSituation` obrigatório e `note` opcional "1–500"), `POST …/no-charge/undo` (`markId` uuid), `GET /commercial-hunit-charges`, `POST /commercial-hunit-charges/check` (`credentials`); esquemas `ChargeSituation` (`kind` em `charged_at_terminal`, `charged_in_hunit`, `not_charged`, `other`; `text` até 100), `NoChargeMark`, `ReservationNoCharge` (+ `hunitShowsCharge`), `CommercialReportBrief` (`hunitStatus` em `awaiting`, `confirmed`, `not_found`, `null`), `HunitChargeItem`, `CommercialReportProblem`, `CommercialHistoryEvent` (os 12 tipos de hoje + `report_received`, `report_changed`, `report_cleared`, `hunit_checked`); campos novos `Reservation.amountToCharge` e `noCharge`, `ReservationTreatment.noChargeHistory`, `CommercialSummary.report`, `CommercialReturnBrief`/`CommercialReturn.chargeSituation` e `chargeDate`, `CommercialDetail.report` e `history`, `CommercialSheetStatus.reports` e `hunitQueueCount`, `CommercialDispatch`/`CommercialDispatchSummary.purpose` (`send`, `hunit_check`), `CommercialDispatchItem.checkResult` (`confirmed`, `not_found`, nulo) e `outcome` + `checked`; parâmetro `purpose` (`send` padrão, `hunit_check`, `all`) em `GET /commercial-dispatches`; códigos `no_charge_not_accepted`, `reservation_changed`, `no_charge_not_active`, `no_reports_to_check`; a descrição de `q` em `/reservations`, `/reservations/selection` e `/reservations/quick-filter-counts` citando o código do Comercial confirmado (R-15). Rodar `pnpm --filter @hunit/contracts generate`, copiar o arquivo para `specs/008-ajustes-cobranca-e-aviso/contracts/openapi.yaml` (idêntico; a cópia da 006 fica na 1.8.0) e deixar `pnpm --filter @hunit/contracts lint` verde
- [X] T004 Ampliar `apps/server/test/unit/contract-frozen-enums.test.ts` (research R-02): congelar, com os valores da 1.8.0, `ReservationDetailedSituation`, `CommercialEvent.type`, `CommercialReturnState` e `CommercialSheetProblem.kind`, com o comentário explicando que o app 0.3 os usa como chave; o teste passa com o contrato do T003
- [X] T005 Schema e migration em `apps/server/src/persistence/schema.ts` ([data-model.md](./data-model.md) §1 e §2): tabela `no_charge_marks` (`id` uuid PK; `hotel_code`/`reservation_number` FK → `reservations`; `previous_amount` money nulo; `note` text nulo "1 a 500 caracteres"; `marked_by_client_id` → `api_clients`; `marked_at`; `undone_by_client_id` e `undone_at` nulos; índice único parcial `no_charge_marks_one_active` com `undone_at` nulo; `check` de `undone_at` e `undone_by_client_id` nulos ou preenchidos juntos); tabela `commercial_reports` (PK `hotel_code`+`reservation_number` → `reservations`; `kind` enum `commercial_report_kind` `charged_in_hunit`/`not_charged`; `situation_text` "1 a 100"; `charged_by` "1 a 100"; `charge_date` date nula; `read_at`); `commercial_returns` + `charge_situation_text` (até 100, nulo), `charge_situation_kind` (enum `charge_situation_kind`, nulo), `charge_date` (date, nula); `commercial_dispatches` + `purpose` (enum `dispatch_purpose`, padrão `send`); `commercial_dispatch_items` + `check_result` (enum `hunit_check_result`, nulo) e `dispatch_item_outcome` + `checked`, com `check` "`check_result` preenchido se e só se `outcome = 'checked'`"; `commercial_event_type` + `report_received`, `report_changed`, `report_cleared`, `hunit_checked`. Gerar com `pnpm --filter @hunit/server db:generate --name=ajustes_cobranca_aviso` (uma migration) e cobrir em `apps/server/test/integration/schema.test.ts` (índice único, `check`s e valores dos enums)

**Checkpoint**: contrato 1.9.0 gerado e migration aplicando; as histórias podem começar.

---

## Phase 3: User Story 5 - Componentes novos na biblioteca (Priority: P3)

**Goal**: Switch com o estado desligado do design e o controle de volume, como componentes únicos de
`ui/` (pré-requisito da US1).

**Independent Test**: no catálogo de testes de `ui/`, o Switch ligado e desligado e o controle de
volume ativo e desabilitado, operado só pelo teclado, com foco visível (US5-1 a US5-3).

- [X] T006 [P] [US5] `renderer/ui/fields/SwitchField.tsx` e `fields.module.css`: estado desligado do design (variante "Desligado": trilho na cor da borda do campo, botão branco; ligado continua preto com o botão lima); atualizar o comentário do componente e `apps/desktop/test/renderer/ui-fields.test.tsx` (os dois estados, foco visível)
- [X] T007 [US5] Componente novo `renderer/ui/fields/VolumeField.tsx` (sobre o `Slider` do Mantine, permitido dentro de `ui/`) e os ícones `SoundLowIcon` e `SoundHighIcon` em `renderer/ui/icons/` (dos SVG do T002), exportados em `renderer/ui/index.ts`: rótulo "Volume", ícone baixo à esquerda e alto à direita, trilho preto com botão lima, valor "70 %" à direita, desabilitado em cinza; props `value` (0 a 100), `onChange`, `onChangeEnd`, `disabled`; teclado: setas ±5, Page Up/Down ±10, Home/End; foco visível; `aria-label` "Volume do aviso" e `aria-valuetext` em porcentagem ([contracts/ui-components.md](./contracts/ui-components.md)). Testes em `apps/desktop/test/renderer/ui-fields.test.tsx` e `ui-icons.test.tsx`

**Checkpoint**: componentes prontos para a tela do som.

---

## Phase 4: User Story 1 - Controlar o som do aviso de token em um só lugar (Priority: P1) 🎯 MVP

**Goal**: um único som no pedido de token, no volume escolhido, ou nenhum, configurado só no card
"Aviso do pedido de token" (telas 1.1 a 1.3).

**Independent Test**: em Configuração, ajustar volume e chave, "Testar aviso" e conferir um único som
no volume escolhido, ou nenhum; reabrir o app e conferir que a escolha ficou (quickstart 3.1 a 3.5).

- [X] T008 [P] [US1] Preferência `soundVolume` (inteiro "0 a 100") em `apps/desktop/src/main/config-store.ts` (esquema aceita o arquivo antigo sem o campo e assume **100**; `soundEnabled: false` salvo continua desligado, FR-005), `apps/desktop/src/shared/ipc-types.ts` e `ipc-schemas.ts` (`setPreferences` aceita `soundVolume`); testes em `apps/desktop/test/main/config-store.test.ts` (arquivo da 0.3 sem o campo, limites 0 e 100, valor fora recusado) e `ipc-handlers.test.ts`
- [X] T009 [P] [US1] `apps/desktop/src/main/attention.ts`: notificação do pedido de token e do "Testar aviso" com `silent: true` (o fim de execução não muda); `playSound` recebe o volume; em `apps/desktop/src/main/index.ts`, o evento `attention:playSound` leva `{ volume: preferences.soundVolume }`; `apps/desktop/src/preload/index.ts` repassa o volume ao `onPlaySound`. Testes em `apps/desktop/test/main/attention.test.ts` (notificação sem som; som só com a chave ligada; volume no pedido)
- [X] T010 [US1] `renderer/App.tsx`: tocar `token-alert.wav` com `audio.volume = volume / 100`, ignorando falha ao tocar (sem dispositivo de áudio, edge case). `renderer/screens/setup/SetupScreen.tsx`, card "Aviso do pedido de token" (telas 1.1 `242:44`, 1.2 `242:73`, 1.3 `242:108`): texto "Quando o Hunit pedir o token, o app mostra uma notificação do Windows, vem para a frente e toca um único som. Teste para conferir se a notificação aparece nesta máquina."; `SwitchField` "Tocar som do aviso" com a descrição "Desligue para deixar o aviso sem som (mudo)."; `VolumeField` desabilitado com a chave desligada; `Notice` de informação "Toca um som só: o do app. A notificação do Windows aparece sem som, para os dois não tocarem ao mesmo tempo."; "Testar aviso". Chave e volume gravam na hora (sem botão); ao soltar o volume com o som ligado, toca a amostra no volume escolhido (FR-006); volume 0 mantém a chave ligada. `renderer/screens/setup/PreferencesForm.tsx` sem a chave de som (FR-004). Testes em `apps/desktop/test/renderer/setup-screen.test.tsx` (card nos três estados, gravação, amostra só com o som ligado, Preferências sem a chave)
- [X] T011 [US1] Registrar as telas 1.1, 1.2 e 1.3 em `apps/desktop/test/e2e/screens-capture.test.ts` (1.2 com o som desligado) e o card do aviso em `apps/desktop/test/e2e/responsive.test.ts`

**Checkpoint**: US1 completa — um som só, com volume, testável sozinha.

---

## Phase 5: User Story 2 - Registrar e ver a situação e a data da cobrança (Priority: P1)

**Goal**: colunas "Situação da cobrança" e "Data da cobrança" na planilha, lidas pelo servidor e
mostradas na gaveta, em "Retornos a validar", na confirmação em lote e em "Retornos com problema", sem
bloquear a confirmação por data.

**Independent Test**: preencher situação e data na planilha de teste, "Ler agora" e conferir as quatro
telas; confirmar um retorno com data de hoje (quickstart 3.6 a 3.9).

- [X] T012 [P] [US2] `packages/domain/src/commercial-return.ts` (research R-06, [data-model.md](./data-model.md) §3.1): `COMMERCIAL_RETURN_COLUMNS` (os quatro de hoje + `chargeSituation` e `chargeDate`), `CHARGE_SITUATIONS` ("Cobrada na maquininha", "Cobrada no Hunit", "Não cobrada"), `recognizeChargeSituation` (sem acento, sem maiúsculas, espaços normalizados; começa com "nao cobrad" → `not_charged`; contém "hunit" → `charged_in_hunit`; contém "maquininha" → `charged_at_terminal`; outro → `other`; até 100 caracteres), `parseChargeDate` (número de série do Google, dias desde 30/12/1899, ou texto `dd/mm/aaaa`; outro → problema "data da cobrança não entendida"), `readReturn` com o resultado `report` (situação reconhecida "Cobrada no Hunit" ou "Não cobrada" e responsável preenchido; sem responsável → `incomplete` "falta o responsável pela cobrança"; a situação manda sobre os outros campos) e `complete` com `chargeSituation` e `chargeDate`; `returnChanged` comparando também situação e data; `reportChanged`. Testes em `packages/domain/test/commercial-return.test.ts` cobrindo cada linha da tabela do R-06 e os retornos da 005 sem situação nem data (continuam `complete`)
- [X] T013 [P] [US2] `packages/domain/src/commercial-sheet.ts`: `COMMERCIAL_SHEET_HEADERS` com "Situação da cobrança" e "Data da cobrança" (16 colunas); `FinanceValidation` + `not_charged` ("Não cobrada: aguardando o Financeiro", tom vermelho `attention`) em `financeValidationText` e `FINANCE_VALIDATION_TONES`. Testes em `packages/domain/test/commercial-sheet.test.ts`
- [X] T014 [US2] Planilha ([contracts/sheet-layout.md](./contracts/sheet-layout.md)): `apps/server/src/commercial-sheet/google-sheet-gateway.ts`, `sheet-appearance.ts`, `layout.ts`, `memory-sheet-gateway.ts` e `command.ts` — colunas O e P no fim; O com validação `ONE_OF_LIST` das três situações, `strict: false`, `showCustomUi: true`; P com `DATE_IS_VALID`, `strict: true`, formato `dd/mm/aaaa`; em "A cobrar", K a P editáveis pelo Comercial e A:J protegidas; cabeçalho de O e P em lima; larguras, bordas e listras até P; a leitura passa a trazer K a P; o `setup` numa planilha da 005 acrescenta O e P sem mexer nas linhas e o `check` aponta as colunas faltando. Testes em `apps/server/test/unit/commercial-sheet-gateway.test.ts`, `commercial-sheet-command.test.ts` e `apps/server/test/integration/commercial-sync.test.ts` (planilha da 005 fica `layout_invalid` até o `setup`)
- [X] T015 [US2] Leitura dos retornos: `apps/server/src/commercial-sheet/returns.ts`, `apps/server/src/persistence/commercial-returns-repo.ts` e o repositório novo `apps/server/src/persistence/commercial-reports-repo.ts` — retorno `complete` grava `charge_situation_text`, `charge_situation_kind` e `charge_date`; `report` cria ou atualiza `commercial_reports` (mudou responsável, data ou texto → atualiza e renova `read_at`, evento `report_changed`; novo → `report_received`), situação trocada ou apagada remove o relato (evento `report_cleared`); `commercial_lines.last_read_return` guarda situação e data; só linhas `open`. `apps/server/src/commercial-sheet/sync.ts` escreve na coluna J o texto `not_charged`. Testes em `apps/server/test/integration/commercial-sync.test.ts` e no novo `apps/server/test/integration/commercial-reports.test.ts`
- [X] T016 [US2] API ([contracts/api-changes.md](./contracts/api-changes.md)): `apps/server/src/http/commercial-views.ts`, `views.ts` e `handlers/commercial.ts` — `chargeSituation` e `chargeDate` em `CommercialReturnBrief` e `CommercialReturn`; `CommercialSummary.report` e `CommercialDetail.report`; `CommercialDetail.history` com os tipos novos (o `events` de hoje continua só com os 12 tipos); `CommercialSheetStatus.reports` com os relatos `not_charged`. Testes de contrato em `apps/server/test/contract/commercial-returns.test.ts` e `reservations-commercial.test.ts`, incluindo **confirmar um retorno com a data de hoje** pela rota única e pelo lote (FR-011, SC-003)
- [X] T017 [P] [US2] Rótulos e formatos do app: `renderer/presentation/labels.ts` (nomes das situações da cobrança, "não informada", eventos novos do histórico do Comercial) e o formato da data com "hoje" e "ontem" (fuso de Brasília) em `renderer/presentation/`; testes em `apps/desktop/test/renderer/labels.test.ts` e `format.test.ts`
- [X] T018 [US2] Telas: `renderer/screens/reservations/CommercialSection.tsx` (tela 7.5 `242:159`: "Situação da cobrança" e "Data da cobrança" no bloco "Retorno do Comercial", com "hoje"/"ontem" embaixo; histórico pelo `history`), `renderer/screens/commercial/ReturnsTab.tsx` (tela 7.8 `242:399`: "<situação> em <data> (hoje)" na coluna "Responsável e cobrança"), `renderer/screens/reservations/ConfirmBatchDialog.tsx` (tela 7.12 `242:466`: a mesma linha por retorno) e `renderer/screens/commercial/ProblemsTab.tsx` (relatos "Não cobrada" com situação, responsável, data e "Abrir"); vazio → "não informada" (FR-011). Testes em `apps/desktop/test/renderer/commercial-validation.test.tsx`, `commercial-screen.test.tsx` e `commercial-reservations.test.tsx`
- [X] T019 [US2] Registrar as telas 7.5, 7.8 e 7.12 com situação e data em `apps/desktop/test/e2e/screens-capture.test.ts` e o relato "Não cobrada" em `responsive.test.ts`

**Checkpoint**: US2 completa — situação e data lidas e mostradas, confirmação sem bloqueio por data.

---

## Phase 6: User Story 3 - Acompanhar a fila "Cobrada no Hunit" (Priority: P2)

**Goal**: aba "Cobradas no Hunit" com a situação derivada de cada relato e o "Verificar agora" (tela
7.15), conferida também pelas execuções.

**Independent Test**: relatos "Cobrada no Hunit" na planilha de teste em três situações; abrir a fila,
conferir contagem e situações, "Verificar agora" com o Hunit simulado (quickstart 3.10 a 3.15).

**Depende de**: US2 (T012, T015: os relatos).

- [X] T020 [P] [US3] Domínio: `packages/domain/src/commercial-report.ts` (novo) com `hunitChargeStatus({ readAt, lastVerifiedAt, hunitClassification })` → `awaiting` (não lida depois do relato), `confirmed` (lida depois e o Hunit mostra a cobrança: `hunitShowsCharge`, classificação `virtual_card_already_charged`), `not_found` (lida depois e o Hunit não mostra a cobrança, qualquer que seja a classificação: pendente, cancelada sem cobrança, faturada…) — sempre pela classificação do Hunit, nunca a efetiva da marcação (research R-07) — e `HUNIT_QUEUE_CONFIRMED_DAYS = 7`, `inHunitQueue` e `hunitCheckTargets` (data-model §3.4); `hunitCheckResult` em `commercial-dispatch.ts` (`confirmed` só com `hunitShowsCharge`); `commercial-sheet.ts` + `hunit_awaiting` ("Aguardando verificação no Hunit", laranja) e `hunit_confirmed` ("Cobrança confirmada no Hunit", sem cor), e o relato não encontrado como `rejected` com o motivo "cobrança não encontrada no Hunit" ("Recusado pelo Financeiro: cobrança não encontrada no Hunit", vermelho). Exportar em `packages/domain/src/index.ts`; testes em `packages/domain/test/commercial-report.test.ts`, `commercial-dispatch.test.ts` e `commercial-sheet.test.ts`
- [X] T021 [US3] Fila no servidor: `apps/server/src/persistence/commercial-reports-repo.ts` — consulta da fila com a situação derivada em SQL (mesma regra do T020), ordem aguardando → não encontrada → confirmada e leitura mais antiga primeiro, aguardando sempre, não encontradas que ainda exigem cobrança sempre, e por 7 dias depois da leitura que as definiu as confirmadas e as não encontradas que não exigem mais cobrança (`inHunitQueue`, data-model §3.4), contagens; `hunitQueueCount` no estado da planilha; `apps/server/src/commercial-sheet/sync.ts` escreve na J "Aguardando verificação no Hunit", "Recusado pelo Financeiro: cobrança não encontrada no Hunit" ou "Cobrança confirmada no Hunit", pela situação derivada; toda leitura que grava uma reserva com relato (execução, envio ou verificação) atualiza a linha dela (`refreshCommercialLine`), para a J acompanhar. Testes de paridade SQL × domínio e de ordem em `apps/server/test/integration/commercial-reports.test.ts` (inclui a leitura feita por uma execução atualizando a situação e a J, US3-4a, e uma reserva que o Hunit mostra cancelada sem cobrança ficando "não encontrada", US3-6a)
- [X] T022 [US3] "Verificar agora" no executor (research R-07): `apps/server/src/persistence/dispatches-repo.ts` (`purpose`, `outcome` `checked`, `check_result`; a lista de envios filtra `purpose=send` por padrão) e `apps/server/src/dispatches/runner.ts` (propósito `hunit_check`: itens = relatos `awaiting` e os `not_found` que ainda exigem cobrança, no pedido (`hunitCheckTargets`); cada reserva lida com `findReservation` e gravada com `commitVerifiedReservation`, **sem** `openLineOnSend` nem evento de envio; evento `hunit_checked` com a classificação e "cobrança encontrada"/"cobrança não encontrada"; item `checked` com `confirmed`/`not_found` ou `not_verified` com o motivo, sem mudar a situação na fila, FR-016; `refreshCommercialLine` leva a confirmada para "Concluídas"; sem relato → erro `no_reports_to_check`; trava de uma automação por conta como no envio). Testes em `apps/server/test/integration/dispatch-runner.test.ts` (Hunit simulado: confirmada, ainda pendente, cancelada ou faturada no Hunit como `not_found`, indisponível, token, cancelamento e uma verificação com 50 relatos, todos com resultado, SC-005) e `dispatches-repo.test.ts`
- [X] T023 [US3] Rotas: `GET /commercial-hunit-charges` (todos) e `POST /commercial-hunit-charges/check` (operador; 202 com o `CommercialDispatch`; 409 `no_reports_to_check` e `account_busy`), parâmetro `purpose` em `GET /commercial-dispatches`, `purpose` e `checkResult` nas respostas, em `apps/server/src/http/handlers/commercial.ts`, `handlers/dispatches.ts` e `commercial-views.ts`. Testes de contrato no novo `apps/server/test/contract/commercial-hunit-charges.test.ts`, inclusive "a lista padrão de envios nunca traz uma verificação" (R-02) e o perfil consulta recebendo 403 no `check`
- [X] T024 [P] [US3] Ponte do app ([contracts/ipc.md](./contracts/ipc.md)): `apps/desktop/src/main/api-client.ts`, `commercial-handlers.ts` (`hunitCharges`; `checkHunitCharges` com as credenciais do cofre, como `dispatches.start`), `dispatches.list` com `purpose`, `execution-watcher.ts` acompanhando `purpose=all` para o aviso do token; `apps/desktop/src/shared/ipc-*.ts` e `apps/desktop/src/preload/index.ts`. Testes em `apps/desktop/test/main/commercial-handlers.test.ts` e `dispatch-watcher.test.ts`
- [X] T025 [US3] Telas: `renderer/screens/commercial/CommercialScreen.tsx` com a aba "Cobradas no Hunit" e contagem (tela 7.7 `242:375`) e o novo `renderer/screens/commercial/HunitChargesTab.tsx` (tela 7.15 `243:1281`): texto "O Comercial marcou estas reservas como “Cobrada no Hunit” na planilha. O app confere no Hunit se a cobrança existe antes de dar a reserva como concluída."; "Verificar agora" só para o operador (sem credenciais → diálogo de credenciais da 005; o andamento e o token no card escuro, com o título da verificação pelo `purpose`); colunas Reserva (número e canal), Hóspede e hotel, Valor a cobrar, Marcada pelo Comercial (responsável e "lido em …"), Verificação no Hunit (selo laranja "Aguardando verificação" + "confere na próxima execução", verde "Confirmada no Hunit" + "foi para Concluídas", vermelho "Não encontrada no Hunit" + "continua pendente", ou a situação do Hunit quando ela não exige mais cobrança, ex.: "Cancelada sem cobrança no Hunit", research R-13) e "Abrir"; rodapé "A verificação roda a cada execução. Se a cobrança não aparecer no Hunit, a reserva continua pendente e pode ser conferida de novo com “Verificar agora”."; estado vazio da 006 com explicação; falha da verificação com mensagem clara e situações mantidas. Testes no novo `apps/desktop/test/renderer/hunit-charges-tab.test.tsx` e em `commercial-screen.test.tsx`
- [X] T026 [US3] Jornada de ponta a ponta no novo `apps/desktop/test/e2e/hunit-charges.test.ts` (relato na planilha em memória → fila "Aguardando" → "Verificar agora" com token no Hunit simulado → uma confirmada e uma ainda pendente); telas 7.7 e 7.15 em `screens-capture.test.ts` e a fila em `responsive.test.ts`

**Checkpoint**: US3 completa — a fila mostra o que o Hunit informou, sem conferência automática.

---

## Phase 7: User Story 4 - Marcar uma reserva como cancelada sem cobrança (Priority: P2)

**Goal**: marcação com confirmação, efeito mostrado antes, desfazer e histórico; a reserva vai para
"Concluídas" com R$ 0,00 (telas 7.17 e 7.18).

**Independent Test**: marcar uma reserva pendente com e sem observação, conferir detalhe, lista,
contagens e planilha; desfazer e conferir que tudo volta (quickstart 3.16 a 3.19).

- [X] T027 [P] [US4] Domínio ([data-model.md](./data-model.md) §3.2, research R-08): em `packages/domain/src/treatment.ts`, `effectiveClassification(classification, noChargeMarked)` (marcada → `cancelled_no_charge`) usado por `reservationSituation`, `detailedSituation`, `isPendingCharge`, `lineState` e `needsReview` (sempre falso com marcação); `amountToCharge(totalAmount, noChargeMarked)` (`0.00` com marcação); `noChargeEligibility` com os motivos `already_marked`, `not_accepting`, `has_proof`, `return_awaiting_validation` (aceita enviada sem retorno e com relato "Não cobrada", FR-022); `hunitShowsCharge` (`virtual_card_already_charged`). Em `commercial-dispatch.ts`, `dispatchEligibility` recusa a marcada (`not_accepting`). Em `commercial-sheet.ts`, `FinanceValidation` + `no_charge` ("Cancelada sem cobrança pelo Financeiro", sem cor) e a coluna E com `amountToCharge`. Testes em `packages/domain/test/treatment.test.ts`, `commercial-dispatch.test.ts`, `commercial-sheet.test.ts` e `quick-filters.test.ts` (marcada só em "Concluídas")
- [X] T028 [US4] SQL com a classificação efetiva em `apps/server/src/persistence/reservations-repo.ts`: condição "tem marcação ativa" e a expressão da classificação efetiva nas condições de situação, situação detalhada, "Falta cobrar", aceita tratativa, alerta "Verificar", filtros rápidos e contagens; `amountToCharge` nas respostas. Em `apps/server/src/dispatches/eligibility.ts` e `apps/server/src/persistence/commercial-repo.ts` (`refreshCommercialLine`), a marcada não é enviada e a linha vai para "Concluídas"; em `apps/server/src/commercial-sheet/sync.ts`, J `no_charge` e E R$ 0,00; em `apps/server/src/persistence/commercial-reports-repo.ts`, o relato "Não cobrada" entra em `CommercialSheetStatus.reports` só com a linha `open` e a reserva sem marcação — marcada ou concluída por outro motivo, sai; desfeita a marcação, volta (FR-007a, FR-020). A fila "Cobradas no Hunit" não muda com a marcação (usa a classificação do Hunit, R-07). Testes de paridade com reservas marcadas em `apps/server/test/integration/reservations-quick-filters.test.ts` e de elegibilidade e linha em `commercial-repo.test.ts`
- [X] T029 [US4] Marcar e desfazer: repositório novo `apps/server/src/persistence/no-charge-repo.ts` e as rotas em `apps/server/src/http/handlers/reservations.ts` — `POST …/no-charge` (operador; confere a `expectedSituation` → 409 `reservation_changed`; elegibilidade → 409 `no_charge_not_accepted` com `reason`; grava `previous_amount` = `total_amount` e a `note` "1 a 500"; atualiza a linha na mesma transação) e `POST …/no-charge/undo` (operador; 409 `no_charge_not_active`); `Reservation.noCharge` (com `hunitShowsCharge`) e `ReservationTreatment.noChargeHistory` em `apps/server/src/http/views.ts`; `apps/server/src/maintenance/retention.ts` apaga a `note` e o `charge_situation_text` de tipo `other` na anonimização. Testes de contrato no novo `apps/server/test/contract/reservations-no-charge.test.ts` (inclui o perfil consulta com 403, duas marcações concorrentes e a classificação do Hunit intacta depois de uma nova verificação, FR-023) e de retenção em `apps/server/test/integration/commercial-retention.test.ts`
- [X] T030 [P] [US4] Ponte do app: `reservations.markNoCharge` e `reservations.undoNoCharge` em `apps/desktop/src/main/api-client.ts`, `ipc-handlers.ts`, `apps/desktop/src/shared/ipc-*.ts` e `apps/desktop/src/preload/index.ts`; testes em `apps/desktop/test/main/ipc-handlers.test.ts` e `api-client.test.ts`
- [X] T031 [US4] Telas: novo `renderer/screens/reservations/NoChargeSection.tsx` — card "Reserva cancelada sem nada a cobrar?" com o texto "Se o hóspede cancelou e não há valor a cobrar, marque a reserva como cancelada sem cobrança. O valor a cobrar fica R$ 0,00 e ela vai para “Concluídas”. Dá para desfazer depois." e "Marcar como cancelada sem cobrança" (tela 7.17 `242:544`); diálogo pequeno "Marcar como cancelada sem cobrança?" com o aviso âmbar "Use só quando a reserva foi cancelada e não há nada a cobrar. A reserva sai das pendências e não é mais enviada ao Comercial.", Reserva, "Valor a cobrar R$ X → R$ 0,00", "Vai para Concluídas, com a situação “Cancelada sem cobrança”", "Observação (opcional)" com contador "0/500" e o exemplo "Ex.: hóspede cancelou antes do check-in", "Voltar" em texto e "Marcar como cancelada" vermelho cheio; depois de marcada (tela 7.18 `244:1673`), card "Cancelada sem cobrança" com "Valor a cobrar R$ 0,00 · antes R$ …", "Marcada em … por …", "Onde está: Concluídas · não vai mais ao Comercial", a observação, o aviso quando `hunitShowsCharge` e "Desfazer" (vermelho suave) com o diálogo pequeno padrão da 006; 409 com a mensagem do motivo ou "a situação mudou"; perfil consulta sem as ações. `ReservationDetail.tsx` (selo do cabeçalho), `TreatmentSection.tsx` (histórico "Marcou como cancelada sem cobrança — …" e "Desfez …"), `CommercialSection.tsx` (linha em "Concluídas") e `renderer/ui/lists/ReservationRow.tsx` (valor "R$ 0,00" com "antes R$ …"). Testes no novo `apps/desktop/test/renderer/no-charge-section.test.tsx` e em `reservation-detail.test.tsx`, `ui-lists.test.tsx` e `dialogs-standard.test.tsx`
- [X] T032 [US4] Jornada no novo `apps/desktop/test/e2e/no-charge.test.ts` (marcar → "Concluídas" e contagens dos filtros rápidos → desfazer → tudo volta); telas 7.17 e 7.18 em `screens-capture.test.ts`; detalhe marcado em `responsive.test.ts` e o diálogo aberto em `resize.test.ts`

**Checkpoint**: US4 completa — marcação e desfazer sem tocar no Hunit.

---

## Phase 8: User Story 6 - Ícone na barra de tarefas, busca pelo teclado nos filtros e destaque da linha (Priority: P2)

**Goal**: a marca na barra de tarefas do Windows em qualquer situação, os seletores de filtro
operáveis só pelo teclado e o destaque da linha dentro do card das listas.

**Independent Test**: quickstart §4 (ícone) e cenários 3.20 (seletores) e 3.24 (destaque da linha).

- [ ] T033 [US6] ⛔ MÁQUINA: antes das medidas, reproduzir o ícone do Electron com o instalador atual (0.3) numa máquina que já rodou o app em desenvolvimento e os testes, com e sem limpar o cache (`ie4uinit.exe -show`); registrar em `research.md` (seção nova "Ícone na barra de tarefas") o que foi visto. A conferência depois das medidas da T034 é feita na homologação (T042, quickstart §4)
- [X] T034 [US6] Medidas do R-10: `apps/desktop/src/main/index.ts` com o AUMID `io.github.sura-team.hunit-control` só empacotado e `io.github.sura-team.hunit-control.dev` em desenvolvimento e testes; `apps/desktop/src/main/window.ts` com o ícone nos dois modos (empacotado: `path.join(process.resourcesPath, 'icon.ico')`) e, no Windows, `setAppDetails({ appId, appIconPath: process.execPath, appIconIndex: 0, relaunchDisplayName: 'HUNIT Control' })`; `apps/desktop/electron-builder.yml` com `extraResources` do `resources/icon.ico`. Testes em `apps/desktop/test/main/builder-config.test.ts` (o `extraResources`) e no novo `apps/desktop/test/main/window-identity.test.ts` (AUMID e ícone por modo, `setAppDetails` só no Windows)
- [X] T035 [P] [US6] Busca pelo teclado (R-11): `renderer/ui/fields/SelectField.tsx` e `MultiSelectField.tsx` com `searchable` por padrão, comparação sem acento e sem maiúsculas e `nothingFoundMessage` "Nenhuma opção encontrada"; tirar o `searchable` repetido das telas (`renderer/screens/reservations/ReservationFilters.tsx`, `renderer/screens/run/HotelSelect.tsx`). Testes em `apps/desktop/test/renderer/ui-fields.test.tsx` e `reservations-filters-panel.test.tsx` (cada seletor — Hotéis, Situação da reserva, Ativa ou cancelada, Canal e Origem — escolhido só pelo teclado: digitar, setas, Enter, Esc; texto sem opção mostra a mensagem e não muda o filtro)
- [X] T036 [P] [US6] Destaque da linha (FR-030, research R-16): em `renderer/ui/lists/lists.module.css`, `.card` e `.inset` com `overflow: clip` (não `hidden`, para não criar rolagem), sem mudar o espaço interno nem a `.toolbar`; conferir o contorno de foco da linha e as listas de Reservas, Comercial e Execuções. Teste em `apps/desktop/test/e2e/responsive.test.ts` (com `layout-checks.ts`): uma reserva só, selecionada e com o mouse em cima, nas quatro larguras — o card corta o conteúdo e os cantos do card não mostram o lima nem o cinza da linha; o mesmo em "Retornos a validar" com um retorno só

**Checkpoint**: US6 completa no código; o ícone é confirmado na homologação (T042).

---

## Phase 9: User Story 7 - Achar a reserva pelo código de autorização do Comercial (Priority: P2)

**Goal**: a busca acha a reserva pelo código do retorno confirmado pelo Financeiro (R-15).

**Independent Test**: confirmar um retorno, buscar o código com outra caixa e achar; buscar o de um
retorno aguardando e não achar (quickstart 3.22 e 3.23).

- [X] T037 [US7] `apps/server/src/persistence/reservations-repo.ts`, `freeTextCondition`: mais uma alternativa — a reserva tem retorno em `commercial_returns` com `state = 'confirmed'` e `lower(authorization_code) = lower(texto)` (texto inteiro, sem maiúsculas, como o código do Hunit). Testes em `apps/server/test/contract/reservations-search.test.ts`: acha pelo código confirmado na lista, nas contagens dos filtros rápidos e em `/reservations/selection`; não acha por código de retorno `awaiting_validation`, `rejected`, `superseded` nem depois de desfazer a confirmação; as buscas de hoje (número, transação, código do Hunit, referência, hóspede, valor) continuam iguais. Rodar o teste de desempenho das contagens da 006 com a busca por código (até 1 s com 20 000 reservas)

**Checkpoint**: US7 completa — bug do item 1 do doc da PM corrigido.

---

## Phase 9a: Ajustes da homologação (23/11/2026)

**Goal**: o que a homologação pediu (spec, sessão de 23/11; research R-19): situação e data da
cobrança obrigatórias, "Não cobrada" vira "Cancelada", que o Financeiro valida em "Retornos a
validar", e a tabela do Comercial no perfil consulta.

**Independent Test**: quickstart 3.7 a 3.9b e 3.15 refeitos na homologação.

- [X] T046 Spec, research (R-19), data-model, contratos (`api-changes.md`, `sheet-layout.md`, `screens.md`) e quickstart com as decisões da sessão de 23/11; tarefas desta fase
- [X] T047 [P] 3.15: em `renderer/ui/lists/lists.module.css`, a coluna que passa a ser a última visível em "Retornos a validar" no perfil consulta (diferença abaixo de 1 105 px, valores abaixo de 850 px, valores na lista interna abaixo de 720 px) ganha o espaço do fim da linha; em `screens/commercial/ReturnsTab.tsx`, a linha estreita repete "Responsável e cobrança" (com a situação e a data). Teste novo `apps/desktop/test/e2e/reader-commercial.test.ts` (perfil consulta, quatro abas, 960, 1 280 e 1 440 px)
- [X] T048 Domínio (`packages/domain/src/commercial-return.ts`, `commercial-sheet.ts`): `not_charged` → `cancelled` ("Cancelada", reconhecida pelo começo "cancelad"); `readReturn` com a situação obrigatória e a data exigida em maquininha, outro texto e Hunit (falta → `incomplete` com `chargeSituation`/`chargeDate`); "Cancelada" vira relato com o responsável opcional; textos da coluna J ("Cancelada: aguardando validação do Financeiro", laranja) e a recusa da "Cancelada" ("Recusado pelo Financeiro: …"). Testes em `packages/domain/test/commercial-return.test.ts` e `commercial-sheet.test.ts`
- [X] T049 Banco: migration `0014` (renomeia `not_charged` → `cancelled` nos enums `charge_situation_kind` e `commercial_report_kind`; `commercial_reports.charged_by` nulo; `validation_state` (enum `commercial_report_validation`: `awaiting_validation`, `confirmed`, `rejected`), `decided_at`, `decided_by_client_id`, `rejection_reason` (até 500), `no_charge_mark_id`; `check`: validação preenchida só na `cancelled`; tipos de evento `cancellation_confirmed` e `cancellation_rejected`). Teste em `apps/server/test/integration/schema.test.ts`
- [X] T050 Servidor: `commercial-reports-repo.ts` (relato `cancelled` grava `awaiting_validation`; versão nova volta a aguardar; lista das canceladas a validar; confirmar e recusar com trava da reserva), `commercial-returns-repo.ts` (`confirmReturnsBatch` com `includeCancellations`), `no-charge-repo.ts` (desfazer a marcação criada pela confirmação volta a "Cancelada" para validar), `commercial-sheet/sync.ts` (coluna J), `http/handlers/commercial.ts` e `commercial-views.ts` (rotas novas, contagem "Retornos a validar" com as canceladas, `reports` = canceladas a validar), `maintenance/retention.ts` (motivo da recusa apagado na anonimização). Testes em `apps/server/test/contract/` e `integration/`
- [X] T051 Contrato 1.9.0 (ainda não entregue): `ChargeSituation.kind` e `CommercialReportBrief.kind` com `cancelled`; `CommercialReportBrief.chargedBy` nulo e `validation`; rotas `POST /reservations/{h}/{n}/commercial/cancellation/confirm` e `/reject`; `includeCancellations` e o motivo `cancellation_not_accepted` em `POST /commercial-returns/confirm`; tipos novos do histórico. `generate` e a cópia em `contracts/`
- [X] T052 Ponte do app: `commercial.confirmCancellation`, `commercial.rejectCancellation` e `includeCancellations` em `confirmReturns`. Testes em `apps/desktop/test/main/`
- [X] T053 Telas: `ReturnsTab.tsx` (as canceladas no topo, com o selo "Cancelada" em cor própria, "Confirmar cancelamento" e "Recusar"), `CommercialSection.tsx` (bloco "Cancelada pelo Comercial" na gaveta, com as mesmas ações), `ConfirmBatchDialog.tsx` (canceladas no lote), `ProblemsTab.tsx` (sem relatos), `presentation/labels.ts` ("Cancelada"). Testes em `apps/desktop/test/renderer/`
- [X] T054 Planilha: `commercial-sheet setup` com as opções "Cobrada na maquininha", "Cobrada no Hunit" e "Cancelada" (lista que aceita outro texto); `check` confere. Testes do adaptador e do comando
- [X] T055 Ponta a ponta: jornada nova em `apps/desktop/test/e2e/cancellation.test.ts` ("Cancelada" na planilha → "Retornos a validar" → confirmar → "Concluídas"; outra recusada → coluna J); `responsive.test.ts` com a "Cancelada" em "Retornos a validar"; `screens-capture.test.ts`
- [X] T056 Documentação: `README.md` ("Envio ao Comercial" e "Planilha do Comercial": situação e data obrigatórias, "Cancelada"; produção: avisar o Comercial dos retornos abertos sem as colunas novas), `AGENTS.md` (parágrafo da 008)
- [ ] T057 Verificação completa (como a T041) e nova rodada de homologação dos cenários 3.6 a 3.9b, 3.15 e 3.19 ⛔ (usuário)
  - 23/11/2026: verificação completa feita (build, lint, typecheck e todos os testes; as falhas da rodada completa foram a lista da ponte em `security-hardening.test.ts`, corrigida, e dois testes da interface lentos pela carga, que passam sozinhos). Homologação: 3.7, 3.8, 3.9 e 3.15 aprovados, e também o rótulo "Confirmar" da "Cancelada" na lista; faltam 3.6, 3.9a, 3.9b e 3.19

**Checkpoint**: ajustes da homologação prontos para a nova rodada.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: documentação, comparação com o design, verificação completa, homologação, Figma e
produção.

- [X] T038 [P] Catálogo e rótulos: `.claude/skills/figma-screens-sync/references/screens.md` com as telas 7.15, 7.17 e 7.18 e a coluna "Ativa em" `008` para as telas da página 008; conferir em `renderer/presentation/labels.ts` os tons dos selos novos (laranja, verde, vermelho, neutro) com `apps/desktop/test/renderer/labels.test.ts`
- [X] T039 Comparação com o design (SC-008): roteiro `screens-capture` em 1 440 × 900 (e 960 e 1 280 px para a UX, prints fora do Git); comparar 1.1, 1.2, 1.3, 7.5, 7.7, 7.8, 7.12, 7.15, 7.17 e 7.18 com os frames da página 008; registrar em `research.md` ("Comparação com o design") e corrigir até não sobrar diferença sem aceite (as do R-13 já decididas)
- [X] T040 [P] Documentação: `AGENTS.md` (contrato 1.9.0 com a cópia em `specs/008-ajustes-cobranca-e-aviso/contracts/`, a cópia da 006 congelada na 1.8.0, as enumerações congeladas do R-02, os arquivos novos na tabela de estrutura e o parágrafo "Desde a feature 008"); `README.md` (passo 9: `commercial-sheet setup` logo depois do servidor; "Planilha do Comercial": colunas "Situação da cobrança" e "Data da cobrança" e o que cada situação faz; cache de ícones se a T033 pedir); versão do app para 0.4.0 em `apps/desktop/package.json`
- [X] T041 Verificação completa: `pnpm build`, `pnpm lint`, `pnpm typecheck` e `pnpm test` (todos os grupos, com o Docker) verdes; `git diff --cached --name-only` sem prints, planilhas, `.env` ou dados reais
- [ ] T042 ⛔ HOMOLOGAÇÃO: quickstart §2 a §4 — servidor de homologação na 1.9.0, `commercial-sheet setup` na planilha de teste, instalador 0.4; cenários 3.1 a 3.24 (e 3.11a) com os dois perfis e a seção 4 (ícone, depois das medidas da T034: registrar em `research.md`, "Ícone na barra de tarefas", qual medida resolveu); o app 0.3 contra a 1.9.0 continua funcionando. Registrar em `research.md` ("Homologação")
- [X] T043 ⛔ FIGMA: skill `figma-screens-sync` com `FEATURE = '008-ajustes-cobranca-e-aviso'`: simulação, relatório ao usuário e, com o ok dele, aplicação — telas da página 008 com ✅ e as mesmas da página 006 com ❌ e ocultas (research R-14)
  - 23/11/2026: feita depois do PR (o conector do Figma estava desconectado na hora): 17 frames, sem conflitos; 1.1, 1.2, 1.3, 7.5, 7.7, 7.8, 7.12, 7.15, 7.17 e 7.18 da 008 com ✅, e as sete versões da 006 com ❌. A 007 ficou de fora (`SKIP`, opção nova do script); as 7.5a e 7.8a não têm desenho
- [ ] T044 ⛔ PRODUÇÃO: quickstart §6 — servidor na 1.9.0, `commercial-sheet setup` (o `check` confirma), instalador 0.4 nas máquinas do Financeiro e da Controladoria, aviso ao Comercial das colunas novas. Registrar em `research.md` ("Produção")
- [ ] T045 ⛔ USUÁRIO: atualizar o doc "HUNIT Control — ajustes e bugs para a PM" — itens 1 a 5 e 7 a 9 com o status da 008 e a tabela "Andamento do desenvolvimento" (o doc não abre pelo Claude Code; feito pelo usuário ou por uma conversa no claude.ai)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: depois do Setup; bloqueia as histórias com servidor (US2, US3, US4, US7)
  e as que usam tipos gerados no app.
- **US5 (Phase 3)**: depois do T002; não depende da Foundational (só `ui/`).
- **US1 (Phase 4)**: depende da US5 (T006, T007).
- **US2 (Phase 5)**: depende da Foundational.
- **US3 (Phase 6)**: depende da US2 (T012, T015).
- **US4 (Phase 7)**: depende da Foundational; independente de US2 e US3 (só a J `no_charge` passa pelo
  `sync.ts`, que a US2 também altera: fazer depois do T015 para evitar conflito).
- **US6 (Phase 8)**: independente (só o app); T033 (reproduzir) → T034 (medidas) → conferência na homologação (T042); T035 e T036 independentes.
- **US7 (Phase 9)**: depende da Foundational (descrição do `q`); independente das demais.
- **Polish (Phase 10)**: depois de todas as histórias. T038 e T040 em paralelo; T039 → T041 → T042 →
  T043 e T044; T045 ao fim.

### Within Each User Story

- Testes escritos antes e falhando; domínio → repositório → rotas → ponte do app → telas → jornada.
- Uma tarefa só está concluída com os testes dela passando (constitution VII).

### Parallel Opportunities

- Setup: T002 com T001.
- Foundational: T004 com T005 (depois do T003).
- US5: T006 com T007.
- US1: T008 e T009 em paralelo; T010 depois dos dois.
- US2: T012, T013 e T017 em paralelo; T014 e T015 depois do T012/T013.
- US3: T020 com T024 (depois do T023 para os tipos, ou sobre o contrato do T003).
- US4: T027 e T030 em paralelo.
- US6: T035 e T036 em paralelo, e com a T034.
- US6 e US7 podem andar em paralelo com US2 a US4 (arquivos diferentes), se houver mais de uma pessoa.
- Polish: T038 e T040.

---

## Parallel Example: User Story 2

```bash
# Domínio e rótulos, em paralelo:
Task: "T012 readReturn com situação e data (commercial-return.ts)"
Task: "T013 Cabeçalhos e textos da coluna J (commercial-sheet.ts)"
Task: "T017 Rótulos e formato hoje/ontem (presentation/)"
```

## Parallel Example: User Story 4

```bash
# Domínio e ponte do app, em paralelo:
Task: "T027 Classificação efetiva, amountToCharge e noChargeEligibility (treatment.ts)"
Task: "T030 reservations.markNoCharge e undoNoCharge (main, preload, ipc)"
```

---

## Implementation Strategy

### MVP First (US5 + US1)

1. Phase 1 (Setup) e Phase 2 (Foundational).
2. Phase 3 (US5) e Phase 4 (US1): um som só, com volume — o incômodo diário.
3. **PARAR E VALIDAR**: quickstart 3.1 a 3.5.

### Incremental Delivery

1. Setup + Foundational → contrato 1.9.0 e migration.
2. US5 + US1 → som do aviso (MVP).
3. US2 → situação e data da cobrança (precisa do `commercial-sheet setup` na homologação).
4. US3 → fila "Cobradas no Hunit".
5. US4 → cancelada sem cobrança.
6. US7 → busca pelo código do Comercial (pequena; pode vir antes, se o Financeiro pedir).
7. US6 → ícone (com a máquina do T033), seletores pelo teclado e destaque da linha.
8. Polish → comparação com o design, homologação, Figma, produção e o doc da PM.

O app só vai para as máquinas no fim (T044), depois do servidor e do `setup` da planilha.

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- Commits pequenos, em português, citando a spec (ex.: `feat(specs/008): som do aviso com volume (T008-T011)`).
- Antes de cada commit: `git diff --cached --name-only` sem prints, `.env`, planilhas ou dados reais
  (AGENTS.md).
- O "Verificar agora" e os testes do Hunit usam só o Hunit simulado; acesso ao Hunit real só com
  autorização do usuário (AGENTS.md).
- Se a implementação mostrar que a spec está errada ou incompleta, **parar e atualizar a spec** antes
  de seguir.
