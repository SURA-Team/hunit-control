---

description: "Task list for feature 005 — Envio dos pedidos de cobrança ao Comercial"
---

# Tasks: Envio dos pedidos de cobrança ao Comercial

**Input**: Design documents from `/specs/005-envio-comercial/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/api-changes.md](./contracts/api-changes.md),
[contracts/sheet-layout.md](./contracts/sheet-layout.md), [contracts/cli.md](./contracts/cli.md),
[contracts/ipc.md](./contracts/ipc.md), [quickstart.md](./quickstart.md)

**Tests**: INCLUÍDOS, porque a constitution exige (princípio VII: domínio com testes unitários,
contrato com teste, camada do Hunit com fixtures, testes junto com cada tarefa). Escreva os testes de
cada bloco antes da implementação e confirme que falham. Grupos: `domain`, `contracts`, `server`,
`server-db`, `desktop`, `desktop-ui` e `desktop-e2e` (research R-16).

**Organization**: tarefas agrupadas por história, na ordem de prioridade da spec: US1 (P1), US2 (P2),
US3 (P2), US4 (P3) e US5 (P3).

**Base**: a 004 está na `master` (PR #9); a `005-envio-comercial` parte da `master`.

**Dados**: nenhuma tarefa acessa o Hunit real nem a planilha real. Os testes usam o Hunit simulado e a
planilha em memória (`MemorySheetGateway`), com dados fictícios: hotéis `hml_um` a `hml_quatro`
("Hotel Homologação Um" …), hóspedes "Hóspede Fictício N", números `900001…` e responsáveis
"Comercial Fictício N". Sem nomes de hotéis ou da empresa (AGENTS.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história atendida (US1 a US5)
- **⛔ HOMOLOGAÇÃO / PRODUÇÃO**: depende do PC do servidor, de uma conta Google e, para o Hunit real,
  de autorização explícita do usuário

## Path Conventions

Monorepo pnpm (ver plan.md): `packages/domain/`, `packages/contracts/`, `apps/server/`
(`src/{hunit-session,dispatches,commercial-sheet,hunit,persistence,http,maintenance}`,
`test/{unit,contract,integration,helpers}`) e `apps/desktop/` (`src/{main,shared,renderer}`,
`test/{main,renderer,e2e}`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependência nova, configuração e dados fictícios usados por todos os testes.

- [ ] T001 Em `apps/server/package.json`, acrescentar `google-auth-library` (versão publicada há 3 dias ou mais) em `dependencies` e o script `"commercial-sheet": "node dist/cli.js commercial-sheet"`. Rodar `pnpm install` e conferir que nem ela nem as dependências dela pedem script de instalação (o `allowBuilds` do `pnpm-workspace.yaml` não muda) e que o `apps/server/Dockerfile` a instala sem ajuste (research R-03)
- [ ] T002 [P] Configuração (research R-04, R-15): em `apps/server/src/config.ts`, `COMMERCIAL_SHEET_ID` e `COMMERCIAL_SHEET_KEY_FILE` (as duas ou nenhuma; só uma = `ConfigError` "defina as duas variáveis da planilha do Comercial ou nenhuma") e `COMMERCIAL_SHEET_DONE_RETENTION_DAYS` (inteiro ≥ 1, padrão 90); `AppConfig.commercialSheet: { spreadsheetId, keyFile } | null`. No `docker-compose.yml`: `secrets.commercial_sheet_key` com `file: ${COMMERCIAL_SHEET_KEY_PATH:-./deploy/secrets/commercial-sheet-key.json}` montado no `server`, e as variáveis no `environment` do `server` (`COMMERCIAL_SHEET_KEY_FILE: /run/secrets/commercial_sheet_key` só quando configurado). Variáveis no `.env.example` com comentário; `deploy/secrets/` no `.gitignore`. Testes em `apps/server/test/unit/config.test.ts` (duas, nenhuma, só uma) e em `apps/server/test/unit/compose-config.test.ts` (a chave vem de `secrets`, nunca de variável com o conteúdo; as regras de portas continuam)
- [ ] T003 [P] Criar `apps/server/test/helpers/commercial-fixtures.ts`: `seedCommercialReservations(db, specs)` (reservas fictícias em cada classificação, ativas e canceladas, com e sem total, com e sem tratativa/comprovante da 003, e "A revisar (sistema anterior)"), `returnCells(overrides)` (as quatro colunas de retorno: completo, sem valor, valor `"abc"`, valor `0`, texto de 101 caracteres) e `GUEST_MARKER`/`SHEET_SECRET_MARKER` (valores-marcador para SC-007 e SC-009)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contrato, regras puras do domínio, banco, sessão do Hunit compartilhada, integração com
a planilha e o sincronizador que todas as histórias usam.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

### Contrato da API

- [ ] T004 Atualizar `packages/contracts/openapi.yaml` para `info.version: 1.7.0` com **todos** os acréscimos de [contracts/api-changes.md](./contracts/api-changes.md): rotas `/commercial-dispatches` (+ `/check`, `/{id}`, `/{id}/events`, `/{id}/two-factor`, `/{id}/cancel`, `/{id}/resume`), `/commercial-returns/{id}/confirm|reject|undo-confirmation`, `/commercial-returns/confirm`, `/treatment-reviews`, `/commercial-sheet`, `/commercial-sheet/read`, `/reservations/selection`, `/reservations/{h}/{n}/commercial` (+ `/cancel`, `/restore`); schemas `ReservationDetailedSituation` (valores de `ReservationSituation` + `return_pending`), `CommercialSummary`, `CommercialLine`, `CommercialReturn`, `CommercialEvent`, `CommercialDispatch`, `SelectionItem`, `BatchResult`, `CommercialSheetStatus`; campos `ReservationTreatment.detailedSituation`, `chargedAmountOrigin` (`hunit|manual|commercial|null`), `commercialChargedAmount` e `Reservation.commercial` (`oneOf` null/`CommercialSummary`, **fora** do `required`); filtros `detailedSituation` e `sentToCommercial`; `reason` da recusa `minLength: 1, maxLength: 500`; listas de reservas `minItems: 1, maxItems: 2000`; códigos de erro novos (`account_busy`, `commercial_sheet_not_configured`, `commercial_sheet_unavailable`, `no_eligible_reservations`, `return_awaiting_validation`, `not_in_commercial_sheet`, `restore_expired`, `return_not_awaiting_validation`, `return_not_confirmed`, `nothing_to_resume`); citar a feature 005 em `info.description`. **Não** acrescentar valores a `ReservationSituation` nem a `TreatmentEvent.type` (research R-09). Rodar `pnpm --filter @hunit/contracts generate` e copiar para `specs/005-envio-comercial/contracts/openapi.yaml`. No `AGENTS.md`, trocar a cópia "em andamento" para `specs/005-envio-comercial/...` e registrar que a da 004 fica congelada na 1.6.0
- [ ] T005 [P] Em `packages/contracts/test/`, teste que congela os enums usados pelo app atual: `ReservationSituation` e `TreatmentEvent.type` iguais aos da 1.6.0; `ReservationDetailedSituation` = `ReservationSituation` + `return_pending` (research R-09)

### Domínio: testes primeiro (grupo `domain`)

- [ ] T006 [P] Escrever `packages/domain/test/commercial-return.test.ts` (research R-08): `readReturn` → `empty` (quatro vazias, inclusive só espaços), `incomplete` com a lista das que faltam, `illegible` com os problemas, `complete` normalizado; `parseChargedAmount` aceita número `1234.5`, `"1.234,56"`, `"1234,56"`, `"1234.56"`, `"R$ 1.234,56"` → `"1234.56"` e recusa `0`, negativo, `"abc"`, `"1,234"` ambíguo com 3 casas e mais de 2 casas; textos com espaços nas pontas removidos e "até 100 caracteres" (101 = ilegível); "Hotel da cobrança" é texto livre sem validação de catálogo; `returnChanged(previous, current)`
- [ ] T007 [P] Escrever `packages/domain/test/commercial-dispatch.test.ts` (data-model §3.1): `dispatchEligibility` — aceita as classificações de `acceptsTreatment` (inclui `not_virtual_card`), recusa com motivo `not_accepting`, `has_proof` (documento ou retorno confirmado) e `return_awaiting_validation`, e marca `resend` quando há linha `open`; `dispatchOutcome` → `sent` se `requiresCharge`, senão `withdrawn` com a classificação; `canCancelLine` (só `open` e sem retorno aguardando); `canRestoreLine` (só `cancelled`, até `TREATMENT_REVERT_DAYS` = 30 dias, e ainda elegível)
- [ ] T008 [P] Ampliar `packages/domain/test/treatment.test.ts` (research R-09, R-10): `treatmentStatus` com linha aberta conta como tratativa e retorno confirmado como comprovante; `detailedSituation` na ordem da spec (comprovante → status do Hunit que não exige cobrança, com `needsReview` → `return_pending` → `treatment_sent` → status do Hunit); `isPendingCharge` continua verdadeiro com retorno aguardando (clarify Q1); `effectiveChargedAmount` → `{ amount, origin }` na ordem Hunit → manual (só com comprovante) → Comercial; `lineState` → `concluded` com comprovante ou status que não exige cobrança e de volta a `open` quando a confirmação é desfeita ou o Hunit volta a exigir
- [ ] T009 [P] Escrever `packages/domain/test/commercial-sheet.test.ts`: abas "A cobrar" e "Concluídas"; as 14 colunas na ordem e com os nomes de [contracts/sheet-layout.md](./contracts/sheet-layout.md); `sheetRow` sem nenhum campo de hóspede (o tipo de entrada nem tem o campo), com "Valor a cobrar" vazio sem total, "Ativa/Cancelada/Não identificada", situação "Pedido cancelado pelo Financeiro" para linha cancelada e textos da coluna J ("Aguardando validação do Financeiro", "Recusado pelo Financeiro: <motivo>", "Confirmado pelo Financeiro", "Retorno incompleto: falta o valor cobrado"); `copyRows` com só as 8 colunas da cópia (FR-027) e a linha de total

### Domínio: implementação

- [ ] T010 [P] Implementar `packages/domain/src/commercial-return.ts` (passa T006) e exportar em `packages/domain/src/index.ts`
- [ ] T011 [P] Implementar `packages/domain/src/commercial-dispatch.ts` (passa T007), reaproveitando `acceptsTreatment`, `requiresCharge` e `TREATMENT_REVERT_DAYS` de `treatment.ts`
- [ ] T012 Alterar `packages/domain/src/treatment.ts` (passa T008): `detailedSituation`, `effectiveChargedAmount` com origem (manter a assinatura antiga como função de compatibilidade se algum chamador ainda usar), `lineState`; tipo `ReservationDetailedSituation`
- [ ] T013 [P] Implementar `packages/domain/src/commercial-sheet.ts` (passa T009), com os rótulos em português da classificação e da situação

### Banco

- [ ] T014 Em `apps/server/src/persistence/schema.ts`, criar as tabelas e enums do [data-model.md](./data-model.md) §1 e §2: `commercial_dispatches` (status e `end_reason` reaproveitando `execution_status` e `execution_end_reason`; check "`end_reason` obrigatório em `failed` e `cancelled`"; único parcial `commercial_dispatches_one_active_per_account` em `account_key` quando `queued|running|awaiting_2fa`; único em `parent_dispatch_id`), `commercial_dispatch_items` (PK `dispatch_id` + reserva; enum `dispatch_item_outcome` = `pending`, `sent`, `withdrawn`, `not_verified`), `commercial_dispatch_events`, `commercial_lines` (PK hotel + número, FK → `reservations`; enum `commercial_line_state` = `open`, `concluded`, `cancelled`; `version`/`synced_version` inteiros ≥ 0; check `cancelled_at` e `cancelled_by_client_id` preenchidos juntos e só em `cancelled`), `commercial_returns` (enum `commercial_return_state` = `awaiting_validation`, `confirmed`, `rejected`, `superseded`, `closed`; checks "1 a 100 caracteres" em `authorization_code`, `charge_hotel` e `charged_by`, "`charged_amount` > 0", "`rejection_reason` 1 a 500, obrigatório em `rejected`"; único parcial "no máximo um retorno `awaiting_validation` ou `confirmed` por reserva"), `commercial_events` (enum `commercial_event_type` com os 12 tipos; `client_id` nulo = "Comercial (planilha)"), `commercial_sheet_state` (uma linha, `id = 1` por check) e `reservations.last_dispatch_id`. Gerar a migration com `pnpm --filter @hunit/server db:generate --name=commercial_dispatch` e conferir o SQL
- [ ] T015 [P] Criar `apps/server/src/persistence/dispatches-repo.ts` (criar envio com itens na ordem, transições, itens processados, filho da retomada, listagem paginada) com teste `apps/server/test/integration/dispatches-repo.test.ts`
- [ ] T016 [P] Criar `apps/server/src/persistence/commercial-repo.ts` (linhas: criar/reenviar, marcar mudança com `version += 1` e `changed_at`, marcar aplicadas, pendências; retornos: criar, substituir, confirmar, recusar, desfazer, fechar; eventos; estado da planilha) com teste `apps/server/test/integration/commercial-repo.test.ts` cobrindo as transições do data-model §4 e o índice "um retorno aguardando ou confirmado por reserva"

### Sessão do Hunit compartilhada e regra da conta

- [ ] T017 Rodar `pnpm test --project server-db` e `--project server` e guardar o resultado das execuções como linha de base (risco "refatorar login/token", plan.md)
- [ ] T018 Extrair de `apps/server/src/executions/runner.ts` para `apps/server/src/hunit-session/` o login, a espera e o envio do token (com prazo `twoFactorTimeoutMs`), o registro e a liberação dos segredos no `SecretRegistry`, o mapa de erros do Hunit → `ExecutionEndReason` e o fechamento forçado no cancelamento (research R-01). O `ExecutionRunner` passa a usar o módulo **sem mudança de comportamento**: os testes da linha de base (T017) continuam verdes sem alteração
- [ ] T019 Regra "uma automação por conta" entre execuções e envios (research R-01): em `apps/server/src/persistence/executions-repo.ts` e `dispatches-repo.ts`, criar dentro de uma transação com `pg_advisory_xact_lock(hashtext(account_key))` e conferir que não há execução **nem** envio ativo da conta; senão `AccountBusyError`. Teste `apps/server/test/integration/account-lock.test.ts`: execução ativa bloqueia envio e vice-versa; contas diferentes não se bloqueiam; duas criações concorrentes na mesma conta → uma só passa

### Planilha: gateway, chave e formato

- [ ] T020 [P] Criar `apps/server/src/commercial-sheet/gateway.ts` (interface `CommercialSheetGateway`: `readTabs()`, `applyChanges(batch)`, `getLayout()`, `setupLayout()`; erros tipados `SheetError` com `code` = `sheet_unavailable|sheet_forbidden|sheet_not_found|sheet_layout_invalid|sheet_rate_limited`) e `memory-sheet-gateway.ts` (planilha em memória com as duas abas, proteções simuladas, falhas programáveis e edição "como o Comercial"), com teste unitário do gateway em memória
- [ ] T021 [P] Criar `apps/server/src/commercial-sheet/key.ts`: lê o arquivo da chave, valida o formato de conta de serviço e registra `private_key`, `private_key_id`, `client_email` e o ID da planilha no `SecretRegistry` (research R-04). Teste: chave inválida → erro sem o conteúdo; valores registrados
- [ ] T022 Criar `apps/server/src/commercial-sheet/google-sheet-gateway.ts` (research R-03, R-04): token pela `google-auth-library` (escopo `spreadsheets`), `spreadsheets.get`, `values.batchGet` (`UNFORMATTED_VALUE`) e `spreadsheets.batchUpdate` por `fetch`; toda falha vira `SheetError` com o status HTTP, **sem** guardar nem registrar o objeto de erro, a resposta, o endereço ou o token. Teste `apps/server/test/unit/google-sheet-gateway.test.ts` com `undici` `MockAgent`: pedidos montados (ranges, `valueRenderOption`, pedidos do `batchUpdate`), 401/403/404/429/500/tempo esgotado → códigos, e nenhuma mensagem contendo `SHEET_SECRET_MARKER`
- [ ] T023 Criar `apps/server/src/commercial-sheet/layout.ts` (formato de [contracts/sheet-layout.md](./contracts/sheet-layout.md): abas, cabeçalhos, localidade `pt_BR`, fuso `America/Sao_Paulo`, formatos — Reserva como texto `@`, datas `dd/mm/aaaa`, valores `R$ #.##0,00` —, linha 1 congelada, proteções de A:J em "A cobrar" e de "Concluídas" inteira só para a conta de serviço) e o subcomando `commercial-sheet setup|check` em `apps/server/src/cli.ts` ([contracts/cli.md](./contracts/cli.md): saídas e códigos 0 a 4, sem mostrar chave, ID nem o e-mail completo). Testes com o gateway em memória: `setup` repetível; `check` acusa cabeçalho mudado (código 4); configuração ausente (código 1)

### Situação, valor e resumo do Comercial nas consultas

- [ ] T024 Em `apps/server/src/persistence/treatments-repo.ts` e `reservations-repo.ts`, calcular a tratativa com linha aberta e retorno confirmado (research R-09): `situation` (inalterada para o app atual), `detailedSituation`, `chargedAmountOrigin`, `commercialChargedAmount`, `effectiveChargedAmount` com o valor do Comercial e `Reservation.commercial`; em `apps/server/src/http/views.ts`, os campos novos. Testes em `apps/server/test/integration/treatment-situation.test.ts`: reserva com retorno aguardando → `situation = treatment_sent` e `detailedSituation = return_pending`; "Falta cobrar" a inclui; comprovante por retorno → `proof_sent`; e2e de compatibilidade: as respostas validam contra o schema 1.6.0 do app atual (campos novos ignorados, nenhum valor de enum novo)

### Sincronizador da planilha

- [ ] T025 Criar `apps/server/src/commercial-sheet/sync.ts` (research R-06, R-07): rodada única por vez (trava em memória + `pg_try_advisory_lock`); lê as duas abas; confere o formato (diferente → `layout_invalid`, nada escrito); casa as linhas por Hotel + Reserva (nome do catálogo; "Nome (código)" com nomes repetidos); monta um `batchUpdate` com células do sistema que diferem, linhas novas no fim de "A cobrar", mover para "Concluídas" (acrescenta com os valores lidos e apaga em "A cobrar", de baixo para cima), apagar duplicadas e as vencidas de "Concluídas" (`COMMERCIAL_SHEET_DONE_RETENTION_DAYS`), reconstruir apagadas; **nunca** escreve as colunas K:N de linha que fica em "A cobrar"; marca `synced_version`; grava `commercial_sheet_state` e os problemas (`restored_line`, `duplicate_line`, `orphan_line`). Gatilhos: `requestRound()` agrupando 5 s, a cada 10 min, e novas tentativas em 1, 2, 4, 5 min (depois a cada 5 min). Ponto de extensão para os retornos (US2). Testes `apps/server/test/integration/commercial-sync.test.ts` com o gateway em memória: linha nova; célula do sistema alterada é restaurada; linha apagada é reconstruída; duplicada apagada; linha órfã com retorno relatada e mantida; K:N preservadas quando o "Comercial" digita entre a leitura e a escrita; falha → pendências visíveis e aplicadas na volta, na próxima tentativa (SC-010 com relógio controlado); planilha não configurada → nada roda
- [ ] T026 Iniciar o sincronizador em `apps/server/src/main.ts` (só com `commercialSheet` configurado) e pará-lo no desligamento, como a retenção; teste de início e parada

**Checkpoint**: contrato, domínio, banco, sessão compartilhada, planilha e sincronizador prontos.

---

## Phase 3: User Story 1 - Enviar reservas ao Comercial com verificação no Hunit (Priority: P1) 🎯 MVP

**Goal**: o operador envia reservas selecionadas; o sistema faz login com token, verifica cada uma no
Hunit, retira as já cobradas e coloca as demais na aba "A cobrar", como "Tratativa enviada".

**Independent Test**: com o Hunit simulado e a planilha em memória, enviar 10 reservas (2 "já
cobradas" no Hunit e 1 não encontrada): 7 na planilha sem nome de hóspede e "Tratativa enviada", 2
retiradas com "Já cobrada", 1 não verificada; reenviar 3 e conferir 7 linhas (quickstart §2, 1 a 5).

### Camada do Hunit

- [ ] T027 [P] [US1] Escrever os testes de `findReservation` (research R-02): no gateway simulado (`apps/server/test/helpers/`) e no real contra as fixtures anonimizadas existentes de `GetBookings`/`BookingDetail` em `apps/server/test/unit/`: período = dia do check-in, percorre as páginas, acha pelo número, devolve `null` quando não acha, `ScreenNotRecognizedError` com evidência no detalhe estranho; e um teste que confere que `API_CLIENT_ALLOWED_ROUTES` **não mudou**
- [ ] T028 [US1] Implementar `findReservation(hotelCode, reservationNumber, checkIn)` em `apps/server/src/hunit/gateway.ts`, `playwright-gateway.ts` (com `searchBookings` + `readBookingDetail` e as novas tentativas da 001 FR-011a) e no gateway simulado (passa T027)

### Gravação da reserva verificada

- [ ] T029 [US1] Extrair de `commitHotel` em `apps/server/src/persistence/reservations-repo.ts` a atualização de uma reserva para `commitVerifiedReservation(db, { snapshot, classification, dispatchId })` (transação com `FOR UPDATE`, histórico e mudança de status da 001 FR-016 a FR-018b; grava `last_dispatch_id`; **não** cria `reservation_observations` nem marca "não encontrada"). Em `apps/server/src/legacy-import/applier.ts`, "verificada pelo HUNIT Control" = `last_execution_id` **ou** `last_dispatch_id` preenchido. Testes: `commitHotel` sem regressão; verificação muda a classificação e registra o histórico; reserva importada verificada por envio não é sobrescrita pela importação

### Envio (servidor)

- [ ] T030 [US1] Escrever `apps/server/test/integration/dispatch-runner.test.ts` (Hunit simulado + planilha em memória): cenários 1 a 5 do quickstart §2 (enviada, retirada com a classificação — inclusive "faturada" e "cancelada sem cobrança" —, não encontrada, reenvio sem duplicar mantendo o retorno, tempo do token esgotado sem enviar nada, cancelar no meio, retomar só as não verificadas com novo login, conta ocupada); "A revisar (sistema anterior)" reclassificada e enviada ou retirada; tratativa com e-mail da 003 continua registrada ao lado do envio (US1, cenário 9); falha passageira repetida e, esgotada, item `not_verified` e o envio segue; sessão expirada encerra como `failed` com os já processados mantidos; credenciais nunca em eventos, logs ou banco
- [ ] T031 [US1] Implementar `apps/server/src/dispatches/runner.ts` (`DispatchRunner`, passa T030): cria o envio com a elegibilidade conferida de novo (`dispatchEligibility`; as recusadas viram itens `ignored` no resultado), usa `hunit-session`, processa os itens um por um (`findReservation` → classificação do domínio → `commitVerifiedReservation` → `dispatchOutcome`); `sent` cria ou reenvia a linha `open` (`last_sent_at`, `last_dispatch_id`) e grava o evento `dispatched`; `withdrawn` grava o evento `withdrawn`; cada item numa transação própria, logo depois de verificado (FR-007); pede uma rodada da planilha; cancelamento e falha deixam os `pending` como `not_verified` com o motivo; `failInterruptedDispatches` ao subir (como `failInterruptedExecutions`)
- [ ] T032 [P] [US1] Implementar `apps/server/src/dispatches/events.ts` (SSE como `executions/events.ts`: `status_changed`, `item_processed`, `retry`, `warning`; mensagens sem credencial nem hóspede) e `apps/server/src/dispatches/resume.ts` (envio filho com os `not_verified`; `nothing_to_resume`, `already_resumed`), com testes
- [ ] T033 [US1] Criar `apps/server/src/http/handlers/dispatches.ts` com `POST /commercial-dispatches/check`, `POST /commercial-dispatches`, `GET /commercial-dispatches/{id}`, `GET /{id}/events`, `POST /{id}/two-factor`, `/{id}/cancel`, `/{id}/resume` ([contracts/api-changes.md](./contracts/api-changes.md); perfil operador nas escritas; `account_busy`, `commercial_sheet_not_configured`, `no_eligible_reservations`) e registrar em `apps/server/src/http/app.ts`. Testes de contrato em `apps/server/test/contract/dispatches.test.ts` contra o `openapi.yaml` 1.7.0, inclusive 403 para o perfil consulta
- [ ] T034 [US1] Desfazer e reverter o envio (research R-11): `POST /reservations/{h}/{n}/commercial/cancel` e `/restore` em `apps/server/src/http/handlers/commercial.ts` (novo), com `canCancelLine`/`canRestoreLine`; linha `cancelled` vai para "Concluídas" com "Pedido cancelado pelo Financeiro"; reverter em até 30 dias a devolve para "A cobrar"; eventos `line_cancelled`/`line_restored`; `GET /reservations/{h}/{n}/commercial` (linha e histórico; retornos virão na US2). Testes de contrato e de integração (com retorno aguardando → 409 `return_awaiting_validation`; depois de 30 dias → `restore_expired`)
- [ ] T035 [US1] Atualizar as linhas quando a situação muda por outros caminhos (FR-009): ao gravar uma execução (`commitHotel`), uma ação da 003 (anexar, desfazer, reverter) ou uma verificação, recalcular `lineState` das reservas com linha e, se mudou, marcar a linha (`version += 1`) e pedir uma rodada. Teste: execução que passa a reserva enviada para "já cobrada" a move para "Concluídas" com o alerta "Verificar" na reserva; comprovante por arquivo também

### Envio (app desktop)

- [ ] T036 [P] [US1] Ponte do app ([contracts/ipc.md](./contracts/ipc.md)): em `apps/desktop/src/shared/ipc-types.ts` e `ipc-schemas.ts`, o grupo `dispatches` e `TwoFactorRequest.job`; em `apps/desktop/src/main/api-client.ts`, as rotas de envio; `apps/desktop/src/main/dispatches.ts` (start/resume com o cofre de credenciais, como as execuções); `execution-watcher.ts` observa também os envios desta máquina e dispara o mesmo aviso (`attention.ts`). Testes em `apps/desktop/test/main/` (limites de 2 000, credenciais nunca devolvidas ao renderer, aviso do token de um envio)
- [ ] T037 [US1] Interface do envio em `apps/desktop/src/renderer/src/screens/dispatch/` (novo): ação "Enviar ao Comercial" na barra da seleção de `screens/reservations/ReservationsScreen.tsx` (oculta para o perfil consulta); diálogo com o resumo do `check` (aceitas, ignoradas com o motivo de cada uma, total dos valores); formulário de credenciais das execuções; tela de acompanhamento (verificadas, restantes, resultado de cada reserva, cancelar, retomar) com o pedido de token; ao terminar, a seleção fica só com as não verificadas. Rótulos em `presentation/labels.ts`. Testes `desktop-ui` em `apps/desktop/test/renderer/dispatch.test.tsx`
- [ ] T038 [US1] Seção "Comercial" no detalhe da reserva (`screens/reservations/ReservationDetail.tsx` e um componente novo `CommercialSection.tsx`): aba da planilha, último envio, quem enviou, desfazer (com confirmação) e reverter no prazo, e o histórico do Comercial mesclado com o da tratativa por data (5 mais recentes e "Mostrar mais", 003 FR-017a). Testes `desktop-ui`
- [ ] T039 [US1] Teste `desktop-e2e` em `apps/desktop/test/e2e/dispatch.spec.ts`: o app compilado contra a API com o Hunit simulado e a planilha em memória envia 3 reservas, informa o token pelo aviso e acompanha até "concluído", com 1 retirada

**Checkpoint**: o envio ao Comercial funciona sozinho (MVP): a planilha recebe só as reservas que ainda
precisam de cobrança.

---

## Phase 4: User Story 2 - Validar o retorno do Comercial (Priority: P2)

**Goal**: o servidor lê o retorno da planilha; a reserva fica "Validar comprovante" até o Financeiro
confirmar (individual ou em lote) ou recusar com motivo.

**Independent Test**: preencher na planilha em memória três retornos (completo, sem valor, valor
ilegível), "Ler retornos agora": só o completo fica "Validar comprovante"; confirmar → "Comprovante
enviado" com valor "Comercial" e linha em "Concluídas"; recusar outro → "Tratativa enviada" e recusa
na coluna J (quickstart §2, 6 a 9).

- [ ] T040 [US2] Escrever `apps/server/test/integration/commercial-returns.test.ts`: retorno completo cria `awaiting_validation`, evento `return_received` com "Comercial (planilha)", coluna J "Aguardando validação do Financeiro"; incompleto e ilegível só gravam o problema (coluna J e lista de problemas) e **nada** muda na reserva; Comercial altera antes da validação → `superseded` + `return_changed`; corrige depois da recusa → retorno novo, recusa sai da linha; valores iguais aos recusados → nada; reserva com comprovante por arquivo ou linha cancelada → `return_ignored`; comprovante por arquivo com retorno aguardando → `closed`; linha órfã com retorno → só relatada
- [ ] T041 [US2] Implementar `apps/server/src/commercial-sheet/returns.ts` (passa T040), ligado ao ponto de extensão da rodada (T025): para cada linha de "A cobrar", `readReturn` e `returnChanged` contra `last_read_return`; grava retorno, problema e evento na mesma transação que marca a linha para escrita
- [ ] T042 [US2] Escrever testes de integração e de contrato para confirmar, recusar, desfazer a confirmação e confirmar em lote (`apps/server/test/integration/commercial-validation.test.ts`, `apps/server/test/contract/commercial-returns.test.ts`): confirmar → "Comprovante enviado", `commercialChargedAmount`, origem `commercial` (o valor do Hunit e o manual continuam prevalecendo, R-10), linha em "Concluídas" com "Confirmado pelo Financeiro"; recusar exige `reason` de 1 a 500 caracteres e volta a "Tratativa enviada" com "Recusado pelo Financeiro: <motivo>"; desfazer a confirmação volta a "Validar comprovante" e a linha a "A cobrar"; lote de 20 com 2 sem retorno → 18 `confirmed` e 2 `ignored` com motivo, mesmo `batch_id`, uma transação por reserva; 403 para o perfil consulta; Hunit "já cobrada" com retorno aguardando → situação do Hunit com "Verificar" e o retorno ainda pode ser confirmado
- [ ] T043 [US2] Implementar `POST /commercial-returns/{id}/confirm|reject|undo-confirmation` e `POST /commercial-returns/confirm` em `apps/server/src/http/handlers/commercial.ts` e no `commercial-repo.ts` (passa T042); `GET /reservations/{h}/{n}/commercial` passa a devolver `returns` com `expectedAmount` e `difference`
- [ ] T044 [P] [US2] Ponte do app: grupo `commercial` (`get`, `confirmReturn`, `rejectReturn`, `undoConfirmation`, `confirmReturns`) em `ipc-types.ts`, `ipc-schemas.ts` (`reason` 1 a 500), `main/api-client.ts` e `ipc-handlers.ts`, com testes em `apps/desktop/test/main/`
- [ ] T045 [US2] Interface da validação: no `CommercialSection.tsx`, o retorno com código, hotel da cobrança **ao lado do hotel da reserva, destacado quando diferentes**, valor cobrado, valor a cobrar e diferença, responsável, quando foi lido; "Confirmar", "Recusar" (diálogo com as sugestões "código de autorização errado", "valor diferente", "pagamento não encontrado", texto obrigatório e o aviso de que o motivo aparece para o Comercial na planilha) e "Desfazer confirmação"; na seleção, "Confirmar retornos" com a lista de revisão (FR-016a). Testes `desktop-ui` em `apps/desktop/test/renderer/commercial-validation.test.tsx`

**Checkpoint**: o ciclo pedido → cobrança → retorno → validação fecha sem e-mail.

---

## Phase 5: User Story 3 - Acompanhar envios, retornos e a planilha (Priority: P2)

**Goal**: lista de envios, filtros "Validar comprovante" e "Enviada ao Comercial", retornos com
problema, pendências da planilha, "Ler retornos agora", "Verificar" em lote e "selecionar todas do
filtro"; perfil consulta só vê.

**Independent Test**: com envios e retornos em várias situações, conferir a lista de envios, os filtros,
os problemas e as pendências (planilha indisponível e depois de volta); selecionar todas as 5 000 "A
verificar" (2 000 + aviso) e confirmar em lote; com chave de consulta, nenhuma ação aceita (quickstart
§2, 10, 13 e 16).

- [ ] T046 [US3] Filtros e listas no servidor: `detailedSituation` e `sentToCommercial` em `GET /reservations` (`reservations-repo.ts`), `GET /commercial-dispatches` paginado com `active`, `GET /commercial-sheet` (estado, pendências com `oldestChangeAt`, `awaitingValidation`, problemas; nunca o ID nem a chave) e `POST /commercial-sheet/read` (rodada completa, resposta em até 50 s ou 202; `commercial_sheet_unavailable` com mensagem genérica). Testes de contrato e de integração, inclusive "filtro `return_pending` traz exatamente as que a coluna mostra assim"
- [ ] T047 [US3] `POST /treatment-reviews` (FR-029) em `apps/server/src/http/handlers/treatments.ts` e `treatments-repo.ts`: até 2 000 reservas, mesma regra da confirmação individual da 003, evento `review_confirmed` com `batch_id`, `ignored` com `no_review_alert`, `countsByClassification`. Testes de contrato e de integração (2 000 confirmadas, histórico de cada uma; SC-014 medido no teste com 2 000)
- [ ] T048 [US3] `GET /reservations/selection` (FR-030) em `apps/server/src/http/handlers/reservations.ts` e `reservations-repo.ts`: mesmos filtros da lista, até 2 000 `SelectionItem` na ordem da lista, `total` e `truncated`. Testes: 5 000 "A verificar" → 2 000 primeiras e `truncated`; depois de confirmar, as 2 000 seguintes; desempenho em até 5 s para 2 000 (SC-015)
- [ ] T049 [P] [US3] Ponte do app: `dispatches.list`, `commercial.sheetStatus`, `commercial.readNow`, `reservations.selectAll`, `treatments.confirmReviews` e os filtros `detailedSituation`/`sentToCommercial` ([contracts/ipc.md](./contracts/ipc.md)), com testes em `apps/desktop/test/main/`
- [ ] T050 [US3] Área "Comercial" no app (`apps/desktop/src/renderer/src/screens/commercial/`, item novo na navegação de `App.tsx`): abas "Envios" (lista e resultado de cada envio), "Retornos a validar" (reservas com `detailedSituation = return_pending`, confirmação individual, em lote e recusa), "Retornos com problema" e "Planilha" (situação, pendências e desde quando, última leitura, falha atual com mensagem genérica, "Ler retornos agora"). Ações ocultas para o perfil consulta. Testes `desktop-ui`
- [ ] T051 [US3] Reservas no app: o filtro "Situação da reserva" passa a usar `detailedSituation` e ganha "Validar comprovante" (depois de "Tratativa enviada" em `SITUATION_ORDER`); filtro "Enviada ao Comercial"; a coluna e o selo mostram `detailedSituation`; "Selecionar todas do filtro" ao lado de "selecionar a página" em `state/selection.tsx` e `ReservationsScreen.tsx` (soma à seleção, avisa as que ficaram de fora pelo limite de 2 000, não conta duas vezes); "Confirmar 'Verificar'" na barra da seleção, com o resumo (quantas têm o alerta, quantas ficam de fora, contagem por status do Hunit) e confirmação. Testes `desktop-ui`

**Checkpoint**: o que está com o Comercial e o que espera o Financeiro fica visível; a revisão das
reservas do sistema anterior anda em lotes de 2 000.

---

## Phase 6: User Story 4 - Ver o valor cobrado na lista de reservas (Priority: P3)

**Goal**: a lista mostra, além do valor total, o valor cobrado com a origem.

**Independent Test**: reservas com valor cobrado do Hunit, manual, do Comercial e sem nenhum: a lista
mostra o valor e a origem de cada uma e o total continua visível (quickstart §2, 14).

- [ ] T052 [US4] No servidor, o filtro `amount` encontra também `commercialChargedAmount` (`reservations-repo.ts`). Teste de integração
- [ ] T053 [US4] Coluna "Valor cobrado" com a origem ("Hunit", "manual", "Comercial") ao lado de "Valor total" em `ReservationsScreen.tsx` e no detalhe; vazia quando não há. Rótulos em `presentation/labels.ts`. Testes `desktop-ui`. Resolve a pendência registrada em `specs/004-importacao-historico/research.md` ("Homologação")

**Checkpoint**: conferência rápida pela lista mostra o que foi cobrado de fato.

---

## Phase 7: User Story 5 - Copiar as reservas da pesquisa para o e-mail (Priority: P3)

**Goal**: "Copiar para e-mail" copia o resultado da pesquisa (ou a seleção) numa tabela formatada como a
planilha, sem nome de hóspede.

**Independent Test**: 30 reservas em 2 páginas, copiar e colar num e-mail: tabela com 30 linhas,
colunas da planilha, total, filtros e momento dos dados; sem nome de hóspede; nada muda nas reservas
(quickstart §2, 15).

- [ ] T054 [US5] Escrever `apps/desktop/test/main/clipboard.test.ts`: o HTML (tabela com estilos embutidos) e o texto com tabulação têm as 8 colunas de FR-027 na ordem, a linha de total, os filtros e o momento dos dados; nenhum nome de hóspede de teste aparece (`GUEST_MARKER`); acima de 2 000 → recusa; nada é gravado em disco (spy no `fs`)
- [ ] T055 [US5] Implementar `apps/desktop/src/main/clipboard.ts` (passa T054) e o grupo `clipboard.copyReservations` na ponte ([contracts/ipc.md](./contracts/ipc.md): `source: 'selection'` com `CopyRow[]` sem campo de hóspede, ou `source: 'filter'` via `GET /reservations/selection`); usa os rótulos de `@hunit/domain` `commercial-sheet.ts` (`copyRows`)
- [ ] T056 [US5] Ação "Copiar para e-mail" na consulta de reservas (`ReservationsScreen.tsx`): indisponível com resultado vazio; com seleção, pergunta "selecionadas" ou "resultado da pesquisa"; aviso de quantas foram copiadas; disponível também para o perfil consulta. Testes `desktop-ui`

**Checkpoint**: o pedido por e-mail continua possível, com a mesma tabela da planilha.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: retenção, segurança, cópia de segurança, documentação, espelho no Figma e validação.

- [ ] T057 Retenção (research R-15) em `apps/server/src/maintenance/retention.ts`: na anonimização da reserva, apagar `rejection_reason` e `last_read_return` e marcar a linha para sair da planilha (`removed_from_sheet_at` aplicado pela rodada); linhas de "Concluídas" com mais de `COMMERCIAL_SHEET_DONE_RETENTION_DAYS` saem da planilha e ficam no banco. Testes de integração
- [ ] T058 [P] Teste de marcadores `apps/server/test/integration/commercial-markers.test.ts` (SC-007, SC-009): com `GUEST_MARKER` como nome de hóspede e `SHEET_SECRET_MARKER` como chave e ID da planilha, rodar envio, rodada, retornos, falhas da planilha e a CLI; conferir que nenhum marcador aparece na planilha em memória, nos logs capturados, nas respostas da API, nos eventos SSE, nas mensagens de erro nem na saída da CLI
- [ ] T059 [P] Cópia e restauração (teste existente de `server-db`): incluir uma reserva enviada com retorno confirmado e um envio; depois de restaurar, os dados voltam e a primeira rodada reconstrói a planilha em memória a partir do banco
- [ ] T060 [P] Homologação (research R-17): em `deploy/homolog/`, o acréscimo do secret e das variáveis da planilha de homologação e o modelo do `.env.homolog`; passo a passo no quickstart §3 da 005 referenciado em `deploy/homolog/`
- [ ] T061 [P] Documentação: `README.md` ganha "Planilha do Comercial" (conta de serviço, criar e compartilhar a planilha, salvar a chave em `deploy/secrets/`, `.env`, `commercial-sheet setup` e `check`, compartilhar com o Comercial); `AGENTS.md` ganha o comando `commercial-sheet` na tabela de comandos, as pastas novas na tabela de estrutura e o parágrafo "Desde a feature 005" (contrato 1.7.0, envio, planilha, validação, lotes)
- [ ] T062 Roteiro de captura (`apps/desktop/test/e2e/screens-capture`): telas novas (diálogo e acompanhamento do envio, seção "Comercial" do detalhe com retorno, recusa, área "Comercial" nas quatro abas, "Selecionar todas do filtro", "Confirmar 'Verificar'", coluna "Valor cobrado", "Copiar para e-mail") com dados fictícios
- [ ] T063 Verificação completa: `pnpm build`, `pnpm typecheck`, `pnpm lint` e `pnpm test` (todos os grupos, com o Docker em execução); corrigir o que falhar
- [ ] T064 ⛔ HOMOLOGAÇÃO: seguir o [quickstart.md](./quickstart.md) §3 com uma planilha de teste e dados fictícios (conta de serviço, `setup`, `check`, proteções conferidas com uma segunda conta, cenários 1, 6, 7, 8, 10 e 11, medições de SC-002, SC-004 e SC-010, logs sem segredos); registrar os resultados em `research.md` ("Homologação"). Hunit real só com autorização explícita do usuário; opcional: observar o filtro "nº da reserva" (R-02)
- [ ] T065 Espelho no Figma (AGENTS.md, "Telas no Figma"): rodar a skill `figma-screens-sync` com as capturas de T062 para criar a página `005-envio-comercial` e registrar a mudança no histórico dela
- [ ] T066 ⛔ PRODUÇÃO: quickstart §4 — planilha real do Comercial, chave em `deploy/secrets/` do clone de produção (`C:\Dev\producao\hunit-control`), `setup`, `check` e compartilhamento com o Comercial no Google; instalar a versão nova do app nas máquinas

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: depende do Setup; **bloqueia** todas as histórias. Dentro dela: T004 →
  T005; testes do domínio (T006–T009) → implementações (T010–T013); T014 → T015, T016; T017 → T018 →
  T019; T020 → T022, T023; T012, T016 → T024; T016, T020, T024 → T025 → T026.
- **US1 (Phase 3)**: depende da Foundational. T027 → T028; T028, T029 → T030 → T031 → T032, T033;
  T031 → T034, T035; T033 → T036 → T037 → T038 → T039.
- **US2 (Phase 4)**: depende da Foundational e, para ter linhas na planilha, do envio da US1 (T031).
  Os testes podem semear linhas direto pelo `commercial-repo` e rodar sem a US1 pronta.
- **US3 (Phase 5)**: depende da Foundational; a lista de envios usa T033 (US1). "Verificar" em lote
  (T047) e "selecionar todas do filtro" (T048) não dependem de nenhuma outra história.
- **US4 (Phase 6)**: depende só da Foundational (T024).
- **US5 (Phase 7)**: depende da Foundational e de T048 (seleção do filtro) para `source: 'filter'`.
- **Polish (Phase 8)**: depois das histórias desejadas. T063 antes de T064; T062 antes de T065.

### Within Each User Story

- Testes escritos antes e falhando; domínio → repositório → rotas → ponte do app → telas.
- Uma tarefa só está concluída com os testes dela passando (constitution VII).

### Parallel Opportunities

- Setup: T002 e T003.
- Foundational: T005 com os testes do domínio (T006–T009); as implementações T010, T011 e T013;
  T015 e T016; T020 e T021.
- US1: T027 com T029; T032 com T034 depois de T031; T036 em paralelo com T034/T035.
- US3: T047 e T048 em paralelo entre si e com T046; T049 em paralelo com as telas.
- US4 e US5 podem começar logo depois da Foundational (US5 precisa de T048 para copiar do filtro).
- Polish: T058, T059, T060 e T061.

---

## Parallel Example: User Story 1

```bash
# Depois da Foundational, em paralelo:
Task: "T027 Testes de findReservation (gateway simulado e real com fixtures)"
Task: "T029 commitVerifiedReservation extraído de commitHotel"

# Depois de T031:
Task: "T032 Eventos SSE e retomada dos envios"
Task: "T034 Desfazer e reverter o envio"
Task: "T036 Ponte do app para os envios"
```

## Parallel Example: User Story 3

```bash
Task: "T047 POST /treatment-reviews (Verificar em lote)"
Task: "T048 GET /reservations/selection (selecionar todas do filtro)"
Task: "T049 Ponte do app: lista de envios, planilha, seleção e Verificar em lote"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup) e Phase 2 (Foundational).
2. Phase 3 (US1): envio com verificação e a planilha recebendo as linhas.
3. **PARAR E VALIDAR**: quickstart §2, cenários 1 a 5, e o `desktop-e2e` do envio.
4. Já substitui o e-mail de pedido; o comprovante continua sendo anexado como na 003.

### Incremental Delivery

1. Setup + Foundational → base pronta.
2. US1 → envio (MVP).
3. US2 → retorno e validação (fecha o ciclo).
4. US3 → acompanhamento, "Verificar" em lote e "selecionar todas do filtro" (pode vir antes da US2 se
   a revisão das reservas do sistema anterior for mais urgente: T047, T048 e T051 não dependem da US2).
5. US4 → valor cobrado na lista.
6. US5 → cópia para e-mail.
7. Polish → retenção, marcadores, documentação, homologação, Figma e produção.

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- Commits pequenos, em português, citando a spec (ex.: `feat(specs/005): ... (T031)`).
- Antes de cada commit: `git diff --cached --name-only` sem chave da planilha, `.env`, planilhas ou
  dados reais (AGENTS.md). A chave fica só em `deploy/secrets/`, ignorada pelo Git.
- Se a implementação mostrar que a spec está errada ou incompleta, **parar e atualizar a spec** antes
  de seguir.
