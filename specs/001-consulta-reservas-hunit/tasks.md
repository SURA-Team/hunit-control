---

description: "Task list for feature 001 — Consulta de Reservas de Cartão Virtual no Hunit"
---

# Tasks: Consulta de Reservas de Cartão Virtual no Hunit

**Input**: Design documents from `/specs/001-consulta-reservas-hunit/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/openapi.yaml](./contracts/openapi.yaml),
[quickstart.md](./quickstart.md)

**Tests**: INCLUÍDOS — exigidos pela constitution (princípio VII: domínio unitário, contrato,
Page Objects e leitores da API contra fixtures). Escreva os testes de cada história antes da implementação e
confirme que falham.

**Organization**: tarefas agrupadas por história de usuário (US1 = P1, US2 = P2, US3 = P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história atendida (US1, US2, US3)
- **⛔ HUNIT**: depende de acesso/fixtures reais do Hunit (T020–T022); pode ser adiada sem bloquear
  o restante, usando o `FakeHunitGateway` (T019)

## Path Conventions

Monorepo pnpm (ver plan.md): `apps/server/`, `packages/domain/`, `packages/contracts/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: inicializar o monorepo, ferramentas e containers.

- [X] T001 Criar o monorepo na raiz: `package.json` (`"packageManager": "pnpm@<versão atual>"`, scripts `build`, `test`, `lint`, `typecheck`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `tsconfig.base.json` (`strict: true`, `module`/`moduleResolution: "NodeNext"`, `target: "ES2023"`) e `.nvmrc` com `24`
- [X] T002 [P] Configurar ESLint (flat config) e Prettier na raiz em `eslint.config.js` e `.prettierrc.json`, incluindo regra que proíbe `packages/domain` de importar `playwright`, `pg`, `drizzle-orm` ou `fastify` (princípio II)
- [X] T003 [P] Configurar Vitest com projetos por pacote em `vitest.config.ts` (opção `test.projects`; no Vitest 5 ela substitui o antigo `vitest.workspace.ts`)
- [X] T004 [P] Criar o pacote `packages/domain` (`package.json` sem dependências de runtime, `tsconfig.json`, `src/index.ts`)
- [X] T005 [P] Criar o pacote `packages/contracts`: copiar `specs/001-consulta-reservas-hunit/contracts/openapi.yaml` para `packages/contracts/openapi.yaml` (passa a ser a fonte da verdade), script `generate` com `openapi-typescript` gerando `packages/contracts/src/generated.ts` e script `lint` com `@redocly/cli lint openapi.yaml` (o `lint` também falha se `generated.ts` estiver fora de sincronia com o contrato)
- [X] T006 Criar o app `apps/server` (`package.json` com `fastify`, `fastify-openapi-glue`, `playwright`, `drizzle-orm`, `pg`, `pino`, `zod`; devDeps `drizzle-kit`, `@testcontainers/postgresql`, `ajv`, `ajv-formats`; `tsconfig.json`; `src/main.ts` vazio) dependendo de `@hunit/domain` e `@hunit/contracts`
- [X] T007 [P] Criar `apps/server/Dockerfile` multi-stage a partir de `mcr.microsoft.com/playwright:v<MESMA versão do pacote playwright>-noble`, executando como usuário não-root, e `docker-compose.yml` na raiz com serviços `server` (porta 3000, volume `evidence:/data/evidence`, `depends_on: db` com healthcheck) e `db` (`postgres:17`, volume `pgdata`)
- [X] T008 [P] Criar `.env.example` na raiz com: `PORT=3000`, `POSTGRES_PASSWORD=` (vazio; senha do banco do Compose), `DATABASE_URL`, `ACCOUNT_KEY_SECRET=` (vazio), `HUNIT_WEB_URL=https://hunit.hsystem.com.br`, `HUNIT_API_URL=https://hunit-api.hsystem.com.br`, `TWO_FACTOR_TIMEOUT_SECONDS=120`, `HOTEL_CONCURRENCY=1`, `MAX_PERIOD_DAYS=` (vazio = sem divisão), `EVIDENCE_DIR=/data/evidence`, `EVIDENCE_RETENTION_DAYS=30`, `RESERVATION_RETENTION_YEARS=5`, `LOG_LEVEL=info`; adicionar `*.har` e `apps/server/test/fixtures/hunit/raw/` ao `.gitignore`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: base que todas as histórias usam.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase. T020–T022 (Hunit) bloqueiam apenas as
tarefas marcadas ⛔ HUNIT.

### Domínio e configuração

- [X] T009 [P] Definir tipos de domínio em `packages/domain/src/types.ts`: `Classification` = `ignored_hotelbeds_258` | `not_virtual_card` | `virtual_card_charge_error` | `virtual_card_already_charged` | `virtual_card_validated_only` | `virtual_card_pending_charge` | `analysis_error`; `ReservationStatus` = `active` | `cancelled` | `unknown`; `ReservationSnapshot` exatamente como em data-model.md ("Qualquer `null` nos campos que decidem a classificação leva a `analysis_error`")
- [X] T010 [P] Implementar leitura e validação das variáveis de ambiente com zod em `apps/server/src/config.ts` (falha ao iniciar se `ACCOUNT_KEY_SECRET` ou `DATABASE_URL` faltarem; `HOTEL_CONCURRENCY` ≥ 1; `MAX_PERIOD_DAYS` opcional)

### Banco de dados

- [X] T011 Escrever o schema Drizzle de todas as tabelas de data-model.md em `apps/server/src/persistence/schema.ts`, incluindo: enums `client_role`, `execution_status`, `execution_end_reason`, `hotel_run_status`, `classification`, `reservation_status`, `evidence_kind` com os valores literais do data-model; restrição `period_from <= period_to`; "índice único parcial em `account_key` onde `status in ('queued','running','awaiting_2fa')`"; PK composta `hotel_code` + `reservation_number` em `reservations`; `verification_count` ≥ 1; `numeric(12,2)` para valores; índices listados em data-model.md
- [X] T012 Gerar a migration inicial com `drizzle-kit` em `apps/server/src/persistence/migrations/` (`pnpm --filter @hunit/server db:generate`) e criar `apps/server/src/persistence/db.ts` (pool `pg`, execução das migrations no startup sob bloqueio no banco; o build copia as migrations para `dist/`)
- [X] T013 [P] Criar helper de testes com PostgreSQL efêmero (Testcontainers) aplicando as migrations em `apps/server/test/helpers/db.ts` (projeto `server-db` do Vitest: um container por rodada, um banco por arquivo de teste)

### HTTP, autenticação e observabilidade

- [X] T014 [P] Configurar o logger Pino em `apps/server/src/logging.ts` com `redact` para `password`, `token`, `authorization`, `credentials.*`, `req.headers.authorization` e `req.body` (R-12); e o registro de segredos em uso em `apps/server/src/secrets.ts` (`SecretRegistry`), que apaga usuário, senha e token de todo texto gravado (logs, evidências, eventos)
- [X] T015 [P] Implementar respostas de erro RFC 9457 em `apps/server/src/http/problem.ts` com os códigos do contrato: `validation_error`, `unauthorized`, `forbidden_for_role`, `not_found`, `execution_already_active`, `not_awaiting_two_factor`, `execution_already_finished`, `nothing_to_resume`, `evidence_expired`, `internal_error`
- [X] T016 Criar a fábrica da aplicação Fastify em `apps/server/src/http/app.ts` carregando `packages/contracts/openapi.yaml` via `fastify-openapi-glue` (validação de request e response), handler de erros → problem+json e handler `GET /v1/health` em `apps/server/src/http/handlers/health.ts`
- [X] T017 Implementar autenticação por chave em `apps/server/src/http/auth.ts`: `Authorization: Bearer <chave>` → SHA-256 → `api_clients` (`revoked_at` preenchido → 401); guarda de nível que recusa com 403 `forbidden_for_role` para `reader` nas operações `createExecution`, `sendTwoFactor`, `cancelExecution`, `resumeExecution` (FR-007); e CLI `create-client --name --role` / `revoke-client --name` em `apps/server/src/cli.ts` (chave exibida uma única vez)
- [X] T018 [P] Criar helper de validação de respostas contra `packages/contracts/openapi.yaml` (ajv + ajv-formats) em `apps/server/test/helpers/contract.ts` e testes de autenticação em `apps/server/test/contract/auth.test.ts` (sem chave → 401; chave revogada → 401; `reader` em `POST /v1/executions` → 403)

### Camada do Hunit (interface) e evidências

- [X] T019 Definir a interface `HunitGateway` (`login`, `submitToken`, `listHotels`, `searchReservations(hotelCode, period, page)` → itens da listagem + total de páginas, `readReservation(hotelCode, bookingId)` → `ReservationSnapshot`) em `apps/server/src/hunit/gateway.ts`, os erros tipados `InvalidCredentialsError`, `InvalidTokenError`, `TwoFactorTimeoutError`, `HunitUnavailableError`, `ScreenNotRecognizedError`, `SessionExpiredError` em `apps/server/src/hunit/errors.ts`, e um `FakeHunitGateway` programável por roteiro em `apps/server/test/helpers/fake-hunit-gateway.ts`
- [ ] T020 ⛔ HUNIT Capturar o material real do Hunit (R-13/R-13a), guardando os originais apenas em `apps/server/test/fixtures/hunit/raw/` (ignorado pelo Git): `npx playwright codegen` + HTML das telas de **login** e **token 2FA** (incluindo erro de senha e de token); respostas JSON de `GetCurrentUser`, `GetBookings` (filtro Canal Collect, com mais de uma página) e `BookingDetail` em cada situação (sem cartão, cobrada, validada sem cobrança, pendente, falha na cobrança, cancelada); incluir também a tela de token expirado / sessão de login expirada do Keycloak
- [ ] T021 ⛔ HUNIT Criar o script de anonimização em `apps/server/scripts/anonymize-fixtures.ts` — HTML: remove `value` de inputs e substitui nomes/e-mails; JSON: substitui por valores fictícios `guestFullName`, `guest.*`, `roomStays[].guestName`, `comments`, `lastPaymentEvent.user`, `authorizationCode`, `transactionId`, `processorReferenceNumber`, `description`, `displayName`, `email`, nomes de hotéis e `channelIdentifier`, preservando tipos, enums e booleanos — e gerar as fixtures versionadas em `apps/server/test/fixtures/hunit/{html,json}/`
- [ ] T022 ⛔ HUNIT No primeiro acesso real autorizado, verificar e registrar em `specs/001-consulta-reservas-hunit/research.md` (R-13a, "A verificar"): código de `DateTypeId` para Check-in e de `CollectTypeId` para Canal Collect; se `X-Company-Id` basta sem `SelectCompany`; se dois hotéis podem ser lidos em paralelo (R-08); `PageSize` máximo e limite de período (R-09); tempo que a tela do token (Keycloak) aceita antes de expirar, ajustando o padrão de `TWO_FACTOR_TIMEOUT_SECONDS` (FR-004); rota de retorno do login no `hunit-api`, hoje liberada provisoriamente como `/signin-oidc` em `BROWSER_LOGIN_ALLOWED_ROUTES` (`read-only-guard.ts`)
  - **Como verificar (2026-11-11)**: rota de retorno do login já confirmada (T032). O restante sai do `hunit:reservations-check --hotel <código> --from … --to … --parallel-hotel <outro> --save-dir test/fixtures/hunit/raw` (Fase 4): uma página recusada por "filtro não foi aplicado" indica código errado de `DateTypeId`/`CollectTypeId`; o comando mostra o `pageSize` que o Hunit usou e se a leitura simultânea de dois hotéis bate com a leitura um por vez. O tempo da tela do token continua a medir manualmente
  - **Verificado em 2026-11-11 (`hunit:reservations-check`, hotéis 3544 e 4909)**: `DateTypeId=2` e `CollectTypeId=2` confirmados; `X-Company-Id` basta, sem `SelectCompany`; dois hotéis lidos ao mesmo tempo dão o mesmo resultado (paralelismo viável, R-08); `PageSize=50` aceito e páginas começam em 1; período de 3 dias aceito. **Falta**: o operador conferir que o total (32) bate com a tela do Hunit; `PageSize` máximo e limite de período (medir na homologação, T062); tempo de expiração da tela do token
- [X] T023 [P] Implementar a captura de evidências em `apps/server/src/evidence/` (`capture.ts`, `sanitize.ts`, `store.ts`): screenshot com `mask` sobre todos os `input` e HTML sanitizado (remove atributo `value` de todo `<input>`) para falhas de tela; JSON da resposta não reconhecida (`response_path`) para falhas da coleta pela rede; arquivos em `${EVIDENCE_DIR}/<executionId>/`, registro em `evidence` com "`expires_at` = `created_at + 30 dias`"; teste do sanitizador em `apps/server/test/unit/evidence-sanitize.test.ts`
- [X] T024 Implementar o barramento de eventos em `apps/server/src/executions/events.ts`: publica em memória para assinantes SSE e persiste em `execution_events` (`message` "sem credenciais nem nome de hóspede")
- [X] T045 Implementar a proteção de somente-leitura em `apps/server/src/hunit/read-only-guard.ts` (FR-012, research R-13a): (a) `api-client` só aceita GET para `GetCurrentUser`, `GetCurrentUserCompanies`, `GetBookings`, `BookingDetail`; (b) `page.route` no navegador aborta e registra evento para toda requisição a `hunit-api` fora das rotas usadas pela tela de login/2FA; (c) lista de bloqueio explícita que vence qualquer permissão: `Payment/CalculePrePayment`, `Payment/ChargePrePayment`, `Payment/UpdatePrePaymentInformation*`, `Company/BookingPaymentDetails`, `Company/CancelBooking`, `EditBooking`, `ReactivateIntegration`, `bookings/{id}/events/*`; teste em `apps/server/test/unit/read-only-guard.test.ts` provando que cada rota bloqueada é recusada — **movida para a Fase 2**: precisa existir antes de qualquer acesso real (T032)

**Checkpoint**: base pronta — histórias podem começar.

---

## Phase 3: User Story 1 - Acesso ao Hunit com token 2FA (Priority: P1) 🎯 MVP

**Goal**: iniciar uma execução pela API, pausar em `awaiting_2fa`, receber o token e concluir o
acesso (lendo o catálogo de hotéis como prova), ou falhar com motivo distinto.

**Independent Test**: quickstart.md › US1 — iniciar com credenciais válidas, enviar o token e ver
`completed` com o catálogo atualizado; repetir com senha errada, token errado, sem token e com
execução já ativa.

### Tests for User Story 1 ⚠️

- [X] T025 [P] [US1] Testes de contrato de `POST /v1/executions`, `GET /v1/executions/{id}`, `POST /v1/executions/{id}/two-factor` e `GET /v1/hotels` em `apps/server/test/contract/executions-us1.test.ts` (inclui 409 `execution_already_active` e 409 `not_awaiting_two_factor`)
- [X] T026 [P] [US1] Testes de integração do runner com `FakeHunitGateway` + banco em `apps/server/test/integration/execution-login.test.ts`: `awaiting_2fa` com `two_factor_deadline`; token correto → acesso concluído; `invalid_credentials` sem pedir token; `invalid_token`; `two_factor_timeout` (timers falsos, `TWO_FACTOR_TIMEOUT_SECONDS`); `hunit_screen_not_recognized` com evidência; segunda execução na mesma conta → recusada; reinício do servidor marca execuções ativas como `failed/server_restarted`; Hunit fora do ar (Fake lança `HunitUnavailableError`) → `failed/hunit_unavailable`
- [X] T027 [P] [US1] ⛔ HUNIT Testes de acesso contra fixtures em `apps/server/test/hunit/login.test.ts` (Page Objects de login e token contra HTML; senha/token inválidos detectados; tela alterada → `ScreenNotRecognizedError`) e `apps/server/test/hunit/catalog.test.ts` (`GetCurrentUser` JSON → hotéis com código, nome e ativo); token expirado ou sessão de login expirada → `TwoFactorTimeoutError`
  - **Concluída (2026-11-11)**: marcação e textos das mensagens de erro conferidos com o login real; as fixtures reconstruídas serão trocadas pelas reais anonimizadas na T021. Histórico: testes escritos e passando contra fixtures **reconstruídas** a partir dos HARs (`test/fixtures/hunit/html/`) e um "Hunit" falso em HTTP (`test/helpers/fake-hunit-server.ts`); a resposta de `GetCurrentUser` é sintética. Fica aberta até as fixtures reais (T020/T021) substituírem as reconstruídas — principalmente a marcação das mensagens de erro de senha e de token, que hoje segue o padrão do Keycloak

### Implementation for User Story 1

- [X] T028 [P] [US1] Implementar `account_key = HMAC-SHA256(usuário normalizado (trim + minúsculas), ACCOUNT_KEY_SECRET)` em `apps/server/src/executions/account-key.ts` (R-11)
- [X] T029 [P] [US1] Implementar o repositório de execuções em `apps/server/src/persistence/executions-repo.ts`: criar (violação do índice único parcial → erro `execution_already_active`), transições de estado do diagrama do data-model, `end_reason` obrigatório em `failed`/`cancelled`, e `failAllActive('server_restarted')`
- [X] T030 [P] [US1] Implementar o repositório de hotéis em `apps/server/src/persistence/hotels-repo.ts`: upsert do catálogo atualizando `last_seen_at` e marcando `available = false` para hotéis ausentes no último catálogo (FR-008)
- [X] T031 [US1] Implementar o runner em `apps/server/src/executions/runner.ts`: credenciais mantidas apenas na closure da execução e registradas no `SecretRegistry` enquanto estiverem em uso (o token também, ao ser recebido); `awaiting_2fa` + evento `status_changed` publicado imediatamente (SC-005); espera do token com prazo `TWO_FACTOR_TIMEOUT_SECONDS`; credenciais e token descartados logo após o acesso; leitura do catálogo; mapeamento de cada erro tipado para o `end_reason` correspondente; evidência em falha de tela
- [X] T032 [US1] ⛔ HUNIT Implementar o navegador e o acesso: `apps/server/src/hunit/browser.ts` (Chromium headless, contexto por execução), Page Objects `apps/server/src/hunit/login-page.ts` e `apps/server/src/hunit/two-factor-page.ts` (localizadores por role/label/texto — princípio II), `apps/server/src/hunit/network/api-client.ts` (GET via `page.request` com a sessão do contexto, header `X-Company-Id`, só rotas da lista de permissão, validação de formato → `ScreenNotRecognizedError` com a resposta como evidência), `apps/server/src/hunit/network/catalog.ts` (`listHotels` via `GetCurrentUser.companies`) e `PlaywrightHunitGateway` em `apps/server/src/hunit/playwright-gateway.ts`; criar o contexto com `serviceWorkers: 'block'` e instalar `installBrowserGuard` antes de abrir qualquer página; passar o usuário como texto sensível a `capturePageEvidence`; sair da tela do Hunit (ex.: `about:blank`) assim que o acesso for concluído, para ela não disparar as próprias requisições; resposta 401/403 ou redirecionamento para `login.hsystem.com.br` durante a coleta → `SessionExpiredError` (edge case "sessão expira")
  - **Concluída (2026-11-11)**: login real confirmado pelo operador com `hunit-login-check` (acesso concluído, senha errada e token errado reconhecidos; rota de retorno aceita pela lista atual). Histórico: login, token e catálogo implementados (`browser.ts`, `login-pages.ts` — os dois Page Objects num arquivo —, `network/api-client.ts`, `network/catalog.ts`, `playwright-gateway.ts`); `searchReservations`/`readReservation` entram com a T046. Achado: o Playwright não intercepta saltos de redirecionamento HTTP; a proteção passa a **detectá-los** e o gateway interrompe o acesso citando a rota (research R-13a). Criado `apps/server/src/hunit-login-check.ts` (`pnpm --filter @hunit/server hunit:login-check`), para o operador testar o login real digitando as credenciais no próprio terminal e guardar as telas para a T020. Fica aberta até o primeiro login real confirmar telas, mensagens de erro e a rota de retorno (T022)
- [X] T033 [P] [US1] Implementar os handlers `createExecution`, `getExecution`, `listExecutions` e `sendTwoFactor` em `apps/server/src/http/handlers/executions.ts` e `listHotels` em `apps/server/src/http/handlers/hotels.ts` (respostas conforme schemas `Execution`, `ExecutionSummary`, `Hotel`)
- [X] T034 [US1] Implementar o stream SSE `GET /v1/executions/{id}/events` com reenvio a partir de `Last-Event-ID` em `apps/server/src/http/handlers/execution-events.ts`
- [X] T035 [US1] Montar tudo em `apps/server/src/main.ts`: config, logger, migrations, `failAllActive('server_restarted')`, runner com `PlaywrightHunitGateway`, servidor HTTP

**Checkpoint**: US1 funciona sozinha (com Fake, e com o Hunit real após T032).

---

## Phase 4: User Story 2 - Consulta e classificação das reservas (Priority: P2)

**Goal**: com acesso concluído, percorrer hotéis, períodos e páginas, classificar cada reserva com
as regras de domínio, gravar por hotel com histórico e permitir consultas filtradas.

**Independent Test**: quickstart.md › US2 — executar 1 hotel × 1 semana e comparar 50 reservas
com o Hunit (SC-002); filtro "canceladas pendentes"; segunda execução incrementa
`verificationCount`.

### Tests for User Story 2 ⚠️

- [X] T036 [P] [US2] Testes unitários da classificação em `packages/domain/test/classification.test.ts`: cada regra da FR-013 na ordem (1 "258-" sem abrir … 7 `analysis_error`; regra 5 `justValidate` → `virtual_card_validated_only`); `null` em campo decisivo → `analysis_error` (FR-015); reserva cancelada recebe a mesma classificação que teria ativa (FR-014a); `reason` sempre preenchido (FR-014)
- [X] T037 [P] [US2] Testes unitários do histórico em `packages/domain/test/verification.test.ts`: reserva nova (`verification_count = 1`); conhecida (`first_verified_at` preservado, `changed_fields`, `previous_classification`, `previous_reservation_status`, `status_changed_at`); ativa → cancelada conta como mudança (FR-018); `not_found_since = coalesce(not_found_since, agora)` só para check-in dentro do período (FR-018a); reaparecimento limpa a marcação
- [X] T038 [P] [US2] Testes unitários de período em `packages/domain/test/period.test.ts`: `from <= to`; períodos retroativos e maiores que uma semana aceitos; divisão em blocos de `MAX_PERIOD_DAYS` sem lacunas nem sobreposição (FR-010a)
- [X] T039 [P] [US2] Testes de integração da coleta com `FakeHunitGateway` + banco em `apps/server/test/integration/execution-hotels.test.ts`: transação única por hotel; hotel com falha não grava nada e a execução segue (`completed` com hotel `failed`); reservas repetidas entre páginas gravadas uma vez; `reservation_observations` por execução; marcação "não encontrada" só em hotel concluído; nenhuma chamada de escrita no gateway; `SessionExpiredError` no meio de um hotel → execução `failed/session_expired`, hotel sem gravação, retomável
- [X] T040 [P] [US2] Testes de contrato de `GET /v1/reservations` (filtros combinados `classification` + `reservationStatus` + `notFound` + `executionId`, paginação por cursor), `GET /v1/reservations/{hotelCode}/{reservationNumber}` e `GET /v1/evidence/{id}/{file}` (410 após expirar) em `apps/server/test/contract/reservations.test.ts`
- [X] T041 [P] [US2] Testes dos leitores da API em `apps/server/test/hunit/reservations.test.ts` com fixtures JSON (sintéticas no formato do research R-13a até T021 trazer as reais): query de `GetBookings` com os filtros da FR-010 (`StatusId=0`, `CollectTypeId`=Canal Collect, `PrePaymentStatus=0`, `IntegrationStatusId=0`, `DateTypeId`=Check-in, datas AAAA-MM-DD); total de páginas = `ceil(total / pageSize)`; `BookingDetail` → snapshot correto para cada linha da tabela de mapeamento do R-13a (inclui `justValidate`); `statusId` 3 → `cancelled`; campo obrigatório ausente ou enum desconhecido → `ScreenNotRecognizedError`; item com `collectTypeId` diferente de Canal Collect ou check-in fora do período → `ScreenNotRecognizedError` e o hotel não grava nada (FR-010, H1)
  - **Concluída (2026-11-11)** com fixtures sintéticas (`test/fixtures/hunit/json/bookings-page-1.json`, `booking-detail-*.json`). Decisão da implementação (research R-13a, "Fase 4"): campo obrigatório ausente ou com tipo errado → `ScreenNotRecognizedError`; `prePaymentStatus` desconhecido com cartão → erro de análise (linha 7 da tabela do R-13a), e `statusId` desconhecido → situação `unknown` (FR-014a), sem recusar a resposta. Também testado o gateway real lendo listagem e detalhe pela sessão do navegador (`test/hunit/login.test.ts`)

### Implementation for User Story 2

- [X] T042 [P] [US2] Implementar `classifyReservation(reservationNumber, snapshot | null)` em `packages/domain/src/classification.ts` seguindo a ordem da FR-013 e retornando `{ classification, reason, reservationStatus }`
- [X] T043 [P] [US2] Implementar `mergeVerification(existing | null, observed, now)` e `markNotFound(...)` em `packages/domain/src/verification.ts` conforme "Regras de atualização (FR-018)" do data-model
- [X] T044 [P] [US2] Implementar validação e divisão de período em `packages/domain/src/period.ts`
- [X] T046 [US2] Implementar a coleta pela rede (research R-13a): `apps/server/src/hunit/network/bookings.ts` (`GetBookings` com os filtros fixos da FR-010 — Check-in, Todas, Canal Collect, Todos, Todas —, paginação até `ceil(total / pageSize)`; número da reserva = `channelIdentifier`, `id` interno guardado para o detalhe) e `apps/server/src/hunit/network/booking-detail.ts` (`BookingDetail` → `ReservationSnapshot` pela tabela de mapeamento do R-13a; `lastPaymentEvent` → `payment`); completar `searchReservations` e `readReservation` em `apps/server/src/hunit/playwright-gateway.ts`. Códigos de `DateTypeId`/`CollectTypeId` vêm de constantes únicas confirmadas em T022. Antes de devolver a página, conferir que cada item respeita os filtros (tipo de coleta e período); se não, `ScreenNotRecognizedError` com a resposta como evidência (FR-010)
  - **Concluída (2026-11-11), com constantes a confirmar**: `DateTypeId=2`, `CollectTypeId=2` e `PageSize=50` estão em `BOOKING_FILTERS`/`BOOKINGS_PAGE_SIZE` (`network/bookings.ts`) e serão conferidos com o `hunit:reservations-check` (T022). A paginação usa o `pageSize` devolvido pelo Hunit. `readReservation` passou a receber o item da listagem e a devolver a resposta como evidência (`ReservationDetail`), para o erro de análise ter evidência (US2, cenário 8). Criado `apps/server/src/hunit-reservations-check.ts` para a verificação manual com o Hunit real
- [X] T047 [US2] Implementar o repositório de reservas em `apps/server/src/persistence/reservations-repo.ts`: `commitHotel(executionId, hotelCode, period, records)` em uma transação (upsert com `mergeVerification`, `reservation_observations`, `markNotFound`, atualização de `execution_hotels`), e consulta com filtros e cursor (FR-020)
- [X] T048 [US2] Estender o runner em `apps/server/src/executions/runner.ts`: hotéis solicitados ou todos (FR-009); para cada hotel → blocos de período → páginas → "258-" ignorada sem abrir → `readReservation` → `classifyReservation` → buffer; falha de reserva → `analysis_error` + evidência; falha de hotel → evidência + hotel `failed` e segue; contagens e eventos `hotel_started`, `page_done`, `reservation_classified`, `hotel_completed`, `hotel_failed`
  - **Concluída (2026-11-11)**: a coleta fica em `apps/server/src/executions/hotel-collection.ts`, chamada pelo runner. Processamento sempre sequencial: `HOTEL_CONCURRENCY` ainda não é usado (research R-08, até a T022 confirmar o paralelismo). Hotel pedido que não está no catálogo → `hotel_failed` sem consulta. Reinício do servidor marca como `failed` o hotel que estava em andamento
- [X] T049 [P] [US2] Implementar os handlers `listReservations` e `getReservation` em `apps/server/src/http/handlers/reservations.ts` (valores monetários como string decimal; `guestName` `null` quando anonimizada)
- [X] T050 [P] [US2] Implementar o download de evidências em `apps/server/src/http/handlers/evidence.ts` (410 `evidence_expired` após `expires_at`)
- [X] T063 [US2] Processar hotéis em paralelo (research R-08, verificado no Hunit real em 2026-11-11): `collectHotels` em `apps/server/src/executions/hotel-collection.ts` usa até `HOTEL_CONCURRENCY` hotéis ao mesmo tempo (padrão 1 = um por vez), com a mesma sessão; cada hotel continua gravado na sua própria transação (FR-019). Falha que encerra a execução (sessão expirada, parada) num hotel faz os outros em andamento pararem no próximo ponto de checagem (antes de cada página e de cada reserva) sem gravar nada, e os hotéis não iniciados ficam `pending` para a retomada. Testes em `apps/server/test/integration/execution-hotels.test.ts`: nunca mais que N hotéis ao mesmo tempo; com N = 1, nenhuma sobreposição; sessão expirada num hotel interrompe o outro em andamento
  - **Concluída (2026-11-11)**: fila de hotéis atendida por até `HOTEL_CONCURRENCY` trabalhadores (`collectHotels`). A primeira falha que encerra a execução é guardada e faz os demais hotéis pararem antes da próxima página ou reserva (ficam `failed`, sem gravar); os não iniciados ficam `pending`. Padrão continua 1; subir aos poucos na homologação (T062), observando 429/5xx do Hunit

**Checkpoint**: US1 e US2 funcionam; a consulta de rotina é possível.

---

## Phase 5: User Story 3 - Acompanhamento, cancelamento e retomada (Priority: P3)

**Goal**: acompanhar o andamento com estimativa de tempo, cancelar em até 15 s e retomar a partir
do primeiro hotel não concluído.

**Independent Test**: quickstart.md › US3 — execução com 3+ hotéis, cancelar no 2º, retomar com
novo token e confirmar que o 1º não é reprocessado; chave `reader` recebe 403 nas ações.

### Tests for User Story 3 ⚠️

- [X] T051 [P] [US3] Testes de integração em `apps/server/test/integration/execution-control.test.ts`: cancelamento → `cancelled/cancelled_by_client` em ≤ 15 s sem gravar o hotel em andamento (SC-008); `cancelled_by_client_id` preenchido; retomada cria execução com `parent_execution_id` e `requested_hotel_codes` = hotéis não `completed` (SC-007); retomada sem hotéis pendentes → 409 `nothing_to_resume`
  - **Concluída (2026-11-11)**: também cobre o fechamento forçado do navegador quando a leitura não termina, o prazo padrão de 10 s, hotéis em paralelo (todos os em andamento ficam `cancelled`), cancelamento durante a espera do token, execução já encerrada, execução ativa só no banco, e a retomada de execução `completed` com hotel falho e de execução que falhou antes de definir os hotéis. O 409 `nothing_to_resume` pela API está em `executions-us3.test.ts`
- [X] T052 [P] [US3] Testes unitários da estimativa em `apps/server/test/unit/timing.test.ts`: média por reserva (exclui "258-"), média histórica no início, estimativa restante (R-08a)
- [X] T053 [P] [US3] Testes de contrato de `POST /v1/executions/{id}/cancel`, `POST /v1/executions/{id}/resume`, `GET /v1/executions` (filtro `status`, cursor) e campos `current`, `hotels[].durationSeconds`, `timing` de `GET /v1/executions/{id}` em `apps/server/test/contract/executions-us3.test.ts`
  - **Concluída (2026-11-11)**: com todas as operações implementadas, o teste do 501 em `test/contract/app.test.ts` passou a conferir que toda operação do contrato tem handler (`createOperationHandlers`) e que o handler de reserva (`notImplemented`) responde 501

### Implementation for User Story 3

- [X] T054 [P] [US3] Implementar cálculo de médias e tempo restante em `apps/server/src/executions/timing.ts` (R-08a) e gravar `started_at`, `finished_at` e `reservations_opened` em `execution_hotels` (FR-021a)
  - **Concluída (2026-11-11)**: nova coluna `execution_hotels.reservations_total` (migration `0001_reservations_total`), base das "reservas ainda não processadas"; andamento gravado também após cada listagem e cada reserva; média histórica em `loadTimingHistory` (`persistence/execution-hotels-repo.ts`). Regras em research R-08a, "Implementado"
- [X] T055 [US3] Implementar o cancelamento cooperativo com `AbortController` no runner (`apps/server/src/executions/runner.ts`): checagem entre reservas e páginas, fechamento forçado do contexto do navegador após 10 s, hotel em andamento marcado `cancelled` sem commit
  - **Concluída (2026-11-11)** com `stopReason = cancelled_by_client` no `ActiveRun` (em vez de `AbortController`: os pontos de checagem da T063 já existiam) e `ExecutionRunner.cancel`. Acrescentado um ponto de checagem antes da gravação do hotel. Decisões (corrida com o fim da execução, execução fora do processo) em research R-19
- [X] T056 [US3] Implementar a retomada em `apps/server/src/executions/resume.ts` (valida execução encerrada com hotéis pendentes e ausência de execução ativa na conta; cria a nova execução e inicia o runner com as novas credenciais)
  - **Concluída (2026-11-11)**: execução `completed` com hotéis falhos também pode ser retomada (spec FR-023 e research R-19 atualizados)
  - **Revisão de código (2026-11-11)**: cada execução é retomada no máximo uma vez (`409 execution_already_resumed`, índice único, migration `0002`); corrigidos o cancelamento depois de todos os hotéis terminarem (agora `completed`), o pedido de cancelamento repetido (sempre 202), o cancelamento durante o desligamento (409) e a estimativa "0 s" sem medição (agora `null`). Limitações aceitas da estimativa em research R-19. Em aberto: catálogo de hotéis por conta do Hunit
- [X] T057 [US3] Implementar os handlers `cancelExecution` e `resumeExecution` em `apps/server/src/http/handlers/executions.ts` e completar `getExecution` com `current`, `hotels[]` (duração, contagens, `failureReason`), `timing` e os 50 eventos mais recentes (FR-021)

### Catálogo por conta do Hunit (revisão de código, 2026-11-11 — FR-008, FR-009a, research R-19)

- [X] T068 [US3] Testes antes da implementação: `apps/server/test/integration/hotels-repo.test.ts` (catálogo por conta: a leitura de uma conta não tira a disponibilidade dos hotéis de outra; hotel sem nenhuma conta fica indisponível; catálogo conhecido de uma conta); `apps/server/test/integration/execution-control.test.ts` (hotel pedido que a conta não acessa, mas outra conta acessa, fica `pending` com motivo e evento `warning`, e a execução termina `completed`; aviso antecipado antes do token quando a conta já é conhecida; retomada com a conta que tem acesso processa os pendentes; hotel que nenhuma conta acessa continua `failed`); `apps/server/test/unit/timing.test.ts` (hotel pendente com motivo não entra na estimativa)
- [X] T069 [US3] Catálogo por conta: tabela `account_hotels` no `schema.ts` + migration; `saveCatalog(db, accountKey, catalog)` atualizando o catálogo da conta e `hotels.available` na mesma transação; `knownCatalogOf(db, accountKey)`. Depende de T068
- [X] T070 [US3] Executor: hotel fora do catálogo da conta e acessado por outra conta → `pending` com motivo e evento `warning` (`hotel-collection.ts`); aviso antecipado no início da execução (`runner.ts`); estimativa ignora pendentes com motivo (`timing.ts`); evento `warning` no contrato. Depende de T069
  - **Concluídas T068–T070 (2026-11-11)**: migration `0003_account_hotels`; `FakeHunit` ganhou `accessByUsername` (catálogo por usuário). Conta cujo último catálogo veio vazio conta como desconhecida (sem aviso antecipado), para não precisar de outra tabela

**Checkpoint**: todas as histórias funcionam de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T058 [P] Implementar a rotina diária de manutenção em `apps/server/src/maintenance/retention.ts` (remove arquivos e registros de evidência com `expires_at` vencido — FR-025; anonimiza `guest_name` de reservas com check-in há mais de `RESERVATION_RETENTION_YEARS` anos, preenchendo `anonymized_at` — FR-026/FR-027), agendada no `main.ts` para rodar **ao iniciar** e depois a cada 24 h, recuperando o que atrasou com o servidor desligado (FR-029), com teste em `apps/server/test/integration/retention.test.ts`
  - **Concluída (2026-11-11)**: `runRetention` e `startRetentionSchedule` em `maintenance/retention.ts`. A data de corte usa o dia de São Paulo: o nome fica até o aniversário de N anos do check-in e some no dia seguinte. Os arquivos da evidência são apagados antes do registro (se falhar, a próxima rodada tenta de novo) e a pasta da execução sai quando fica vazia. A falha de uma rodada vai para o log e não interrompe as próximas; o desligamento espera a rodada em andamento
- [X] T059 [P] Escrever o teste de segurança SC-004 em `apps/server/test/security/no-secrets.test.ts`: executa US1+US2 com `FakeHunitGateway` (e com fixtures, se disponíveis) usando senha e token marcadores e procura esses valores em todos os logs capturados, linhas do banco e arquivos de evidência
  - **Concluída (2026-11-11)** com o `FakeHunitGateway`, pela API HTTP: login, token errado, telas não reconhecidas no login, no token, na listagem e no detalhe, e retomada, com telas e respostas que repetem de propósito usuário, senha e token; procura os marcadores em todas as linhas de log, de todas as tabelas e em todos os arquivos de evidência. Conferido que o teste falha quando a limpeza do `SecretRegistry` é desligada. Fica para a T021: repetir com o gateway real contra as fixtures anonimizadas
- [ ] T060 [P] Atualizar `AGENTS.md` (estrutura do repositório e seção "Comandos": instalar, testar, gerar tipos, subir containers, criar cliente) e criar `README.md` na raiz, com a seção de implantação no PC de produção (R-20/R-21): IP fixo ou nome na rede, porta HTTPS no Firewall do Windows, Docker Desktop iniciando com o Windows e sem suspensão, exportar e instalar o certificado raiz do Caddy, escolher o `BACKUP_DIR`, guardar `ACCOUNT_KEY_SECRET` e `BACKUP_PASSPHRASE` fora do PC e o passo a passo da restauração
- [X] T061 Rodar `pnpm --filter @hunit/contracts lint` e corrigir avisos do contrato; confirmar que `packages/contracts/openapi.yaml` e `specs/001-consulta-reservas-hunit/contracts/openapi.yaml` estão iguais
  - **Concluída (2026-11-11)**: os 7 avisos eram de metadados — licença e descrição das tags, corrigidas (contrato 1.1.1, tipos gerados iguais) — e o `GET /health` sem resposta 4XX, que não faz sentido nele: exceção registrada em `packages/contracts/.redocly.lint-ignore.yaml`. Lint sem avisos e as duas cópias do contrato idênticas
- [ ] T062 ⛔ HUNIT Executar a validação de homologação do [quickstart.md](./quickstart.md) (US1, US2, US3, SC-002 com 50 reservas, SC-003, SC-004, e a seção 5: SC-011 a SC-013) e registrar em `specs/001-consulta-reservas-hunit/research.md` a duração da rotina, o tempo médio por hotel e por reserva, a meta resultante da SC-009 e o erro da estimativa de tempo restante medido na metade dos hotéis (SC-010) (R-08, R-08a)

### Implantação e continuidade (FR-028 a FR-032)

- [X] T064 [P] Escrever o teste `apps/server/test/unit/compose-config.test.ts` (projeto `server`), no padrão de `docker-image-version.test.ts`: lê o `docker-compose.yml` e confere que a porta do `server` é publicada só em `127.0.0.1`, que só o `proxy` publica porta em todas as interfaces e que o `backup` usa a mesma imagem do `db` (SC-013, R-20, R-21)
  - **Concluída (2026-11-11)**: também confere a imagem do Caddy numa versão exata, o `tls internal`/`skip_install_trust` e o `flush_interval -1` do Caddyfile, que o proxy publica só a porta 443 e as montagens do `backup` (scripts somente leitura, `BACKUP_DIR` em `/backups`)
- [X] T065 Criar o proxy HTTPS (R-20, FR-032): `deploy/caddy/Caddyfile` com `tls internal` para `{$SERVER_HOSTNAME}` (e `localhost`), sem tentar instalar a CA no sistema, repassando ao `server:3000` sem acumular respostas (SSE); serviço `proxy` no `docker-compose.yml` (imagem oficial do Caddy com versão fixada, volume `caddy-data`, porta `HTTPS_PORT`); porta do `server` presa a `127.0.0.1`; `SERVER_HOSTNAME` e `HTTPS_PORT` no `.env.example`. Depende de T064
  - **Concluída (2026-11-11)**: imagem `caddy:2.11.9-alpine`; sem redirecionamento HTTP→HTTPS (só a porta HTTPS é publicada); `SERVER_HOSTNAME` obrigatório no Compose. Verificado com a imagem real: configuração válida com nome, IP e `localhost`; certificado emitido para IP; SSE repassado sem acúmulo (1º evento em ~0,1 s, 2º em ~3 s, como o servidor enviou); certificado raiz em `/data/caddy/pki/authorities/local/root.crt`. Pilha completa (`docker compose up`) conferida: HTTPS pelo proxy responde e a porta HTTP do `server` só aparece em `127.0.0.1`
- [X] T066 [P] Escrever o teste `apps/server/test/integration/backup-restore.test.ts` (projeto `server-db`, Testcontainers com `postgres:17` e os scripts de `deploy/backup/`): grava reservas fictícias, roda uma cópia (`backup.sh once`), confere que o arquivo está cifrado (o nome fictício do hóspede não aparece no conteúdo) e que a restauração num banco vazio recupera as mesmas linhas (SC-011); confere que não refaz a cópia se a mais nova for recente, que refaz se estiver atrasada (SC-012/FR-029) e que apaga as cópias com mais de `BACKUP_RETENTION_DAYS` dias (FR-030)
  - **Concluída (2026-11-11)**: 16 testes; também cobre a recusa sem `BACKUP_PASSPHRASE`, banco fora do ar (nenhuma cópia gravada e as anteriores mantidas), nunca apagar a cópia mais nova, arquivos de outros nomes na pasta intocados, e que o banco restaurado aceita as migrations do servidor. Conferido que os testes falham quando a cifra é retirada do script
- [X] T067 Criar a cópia de segurança (R-21, FR-029 a FR-031): `deploy/backup/backup.sh` (laço de 15 min; `pg_dump --format=custom` → `gpg --symmetric --cipher-algo AES256`; arquivo temporário renomeado no fim; apaga as antigas; modo `once` para o teste) e `deploy/backup/restore.sh <arquivo>` (decifra → `pg_restore --clean --if-exists`); serviço `backup` no `docker-compose.yml` (imagem `postgres:17`, scripts somente leitura, `BACKUP_DIR` montado em `/backups`); `BACKUP_DIR`, `BACKUP_PASSPHRASE` (obrigatória), `BACKUP_INTERVAL_HOURS` e `BACKUP_RETENTION_DAYS` no `.env.example`; nenhuma senha em log do script. Depende de T066
  - **Concluída (2026-11-11)**: a idade da cópia vem da data no nome (UTC), não da data do arquivo, que a sincronização com a nuvem pode mudar; cada cópia é decifrada e conferida com `pg_restore --list` antes de receber o nome final; a frase vai ao `gpg` por descritor de arquivo, nunca na linha de comando. Restauração com `docker compose run --rm --entrypoint bash backup /scripts/restore.sh <arquivo>`, numa única transação. Verificado no Docker Desktop (Windows): cópia gravada numa pasta local do Windows montada como `BACKUP_DIR` e restauração pelo comando documentado

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: depende do Setup; bloqueia as histórias. T020 → T021 → T022 formam
  a trilha do Hunit e bloqueiam somente as tarefas ⛔ HUNIT (T027, T032, T062).
- **US1 (Phase 3)**: depende da Phase 2 (exceto T020–T022).
- **US2 (Phase 4)**: depende da Phase 2; usa o runner e os repositórios de execução de US1
  (T029, T031) — implemente depois de US1, mas seus testes de domínio (T036–T038) e o domínio
  (T042–T044) podem começar já na Phase 2.
- **US3 (Phase 5)**: depende de US1 (runner) e usa o processamento de hotéis de US2 para
  cancelamento/retomada significativos.
- **Polish (Phase 6)**: após as histórias desejadas; T062 exige o Hunit real. Implantação:
  T064 → T065 e T066 → T067 (testes antes); as duas trilhas são independentes entre si e das
  demais tarefas da fase. T060 documenta o que T065 e T067 criarem.

### Within Each User Story

- Testes primeiro (devem falhar) → domínio/repositórios → runner → handlers → integração.
- Commit ao final de cada tarefa ou grupo lógico, citando `specs/001` e o ID da tarefa.

### Parallel Opportunities

- Phase 1: T002–T005, T007, T008 em paralelo após T001.
- Phase 2: T009, T010, T013, T014, T015, T018, T023, T045 em paralelo; trilha do Hunit (T020–T022) em
  paralelo com todo o restante.
- US2: todo o domínio (T036–T038 testes, T042–T044 implementação) é independente de navegador e
  banco.

---

## Parallel Example: User Story 2

```text
# Testes de domínio juntos:
Task: "T036 Testes de classificação em packages/domain/test/classification.test.ts"
Task: "T037 Testes de histórico em packages/domain/test/verification.test.ts"
Task: "T038 Testes de período em packages/domain/test/period.test.ts"

# Implementação de domínio juntos:
Task: "T042 classifyReservation em packages/domain/src/classification.ts"
Task: "T043 mergeVerification em packages/domain/src/verification.ts"
Task: "T044 período em packages/domain/src/period.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (Setup) + Phase 2 (Foundational), iniciando em paralelo a trilha do Hunit (T020–T022).
2. Phase 3 (US1) com `FakeHunitGateway`; ligar o `PlaywrightHunitGateway` (T032) quando as
   fixtures estiverem prontas.
3. **PARAR E VALIDAR**: quickstart.md › US1 contra o Hunit real.

### Incremental Delivery

1. Setup + Foundational → base pronta.
2. US1 → validar acesso com 2FA (MVP técnico).
3. US2 → validar classificação com 50 reservas (SC-002) — primeiro valor para o Financeiro.
4. US3 → validar cancelamento/retomada e estimativa.
5. Polish → retenção, segurança SC-004, documentação, homologação e medição da SC-009.

---

## Notes

- [P] = arquivos diferentes, sem dependência pendente.
- ⛔ HUNIT = depende de acesso real ou fixtures reais do Hunit; nunca copie seletores do `legacy/`.
- Nenhuma tarefa pode adicionar ação de escrita no Hunit (FR-012); o `read-only-guard` (T045) é a
  rede de segurança.
- Fixtures e HAR brutos nunca entram no Git; somente fixtures anonimizadas (T021).
