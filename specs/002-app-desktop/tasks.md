---

description: "Task list for feature 002 — App desktop para operar o HUNIT Control"
---

# Tasks: App desktop para operar o HUNIT Control

**Input**: Design documents from `/specs/002-app-desktop/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/api-changes.md](./contracts/api-changes.md),
[contracts/ipc.md](./contracts/ipc.md), [quickstart.md](./quickstart.md)

**Tests**: INCLUÍDOS — exigidos pela constitution (princípio VII: testes de contrato para cada
endpoint novo; testes junto com cada tarefa). Escreva os testes de cada bloco antes da
implementação e confirme que falham. Grupos de teste definidos no research R-12: `desktop`,
`desktop-ui`, `desktop-e2e` e `server-db`.

**Organization**: tarefas agrupadas por história de usuário (US1 = P1, US2 = P2, US3 = P3).

**Pré-requisito da implementação**: a feature 001 homologada (T062 da 001) e mesclada na branch
principal; trazê-la para a `002-app-desktop` antes de começar (ver Dependencies).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história atendida (US1, US2, US3)
- **⛔ HUNIT**: depende de acesso real ao Hunit e das máquinas Windows dos usuários

## Path Conventions

Monorepo pnpm (ver plan.md): `apps/desktop/` (novo), `apps/server/`, `packages/contracts/`.
Dentro do app: `src/main` (processo principal), `src/preload`, `src/renderer` (interface),
`src/shared` (contrato da ponte) e `test/{main,renderer,e2e,helpers}`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: criar o pacote do app, as ferramentas de build e os grupos de teste.

- [ ] T001 Criar `apps/desktop/package.json`: `"name": "@hunit/desktop"`, `"private": true`, `"productName": "HUNIT Control"` (define a pasta de dados `%APPDATA%\HUNIT Control`), `"main": "out/main/index.js"`, scripts `dev` (`electron-vite dev`), `build` (`electron-vite build`), `typecheck` (as duas configurações do T003), `dist` (`electron-vite build && electron-builder --win`); **sem `dependencies`** — tudo em `devDependencies` para o Vite empacotar (research R-11): `electron@45`, `electron-vite@6`, `electron-builder@26`, `vite@8`, `@vitejs/plugin-react`, `react@19`, `react-dom@19`, `@types/react`, `@types/react-dom`, `@mantine/core@9`, `@mantine/hooks@9`, `@mantine/dates@9`, `dayjs`, `@tanstack/react-query@5`, `openapi-fetch`, `undici@8`, `eventsource-parser@4`, `zod@4`, `@hunit/contracts` (`workspace:*`), e para testes `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@peculiar/x509`, `yaml` e `playwright` (mesma versão fixa do `apps/server`); adicionar `apps/desktop/release/` ao `.gitignore`
- [ ] T002 Em `pnpm-workspace.yaml`, adicionar `electron: true` em `allowBuilds` com o comentário "baixa o binário oficial do Electron e confere o checksum; sem ele o app não abre (specs/002, research R-11)"; rodar `pnpm install` e conferir `pnpm --filter @hunit/desktop exec electron --version` → `v45.x`. Depende de T001
- [ ] T003 [P] Criar as configurações TypeScript em `apps/desktop/`: `tsconfig.node.json` (estende `../../tsconfig.base.json`; `src/main`, `src/preload`, `src/shared`, `electron.vite.config.ts`, `test/main`, `test/e2e`, `test/helpers`; tipos `node`), `tsconfig.web.json` (estende a base; `lib` `ES2023`, `DOM`, `DOM.Iterable`; `jsx: "react-jsx"`; `module: "ESNext"`, `moduleResolution: "Bundler"`; `src/renderer`, `src/shared`, `test/renderer`) e `tsconfig.json` que permita ao `projectService` do typescript-eslint encontrar todos esses arquivos
- [ ] T004 [P] Criar `apps/desktop/electron.vite.config.ts`: `main` (alvo Node 24), `preload` compilado como **CommonJS num arquivo único** (exigência do preload com `sandbox: true`) e `renderer` com `@vitejs/plugin-react`, raiz em `src/renderer`; nenhuma dependência externa nos bundles além de `electron` e dos módulos `node:` (conferir a opção equivalente ao antigo `externalizeDepsPlugin` no electron-vite 6) — research R-11
- [ ] T005 [P] Criar `apps/desktop/electron-builder.yml`: `appId: io.github.sura-team.hunit-control`, `productName: HUNIT Control`, `directories.output: release`, `files: [out/**]`, `asar: true`, `win.target: nsis` (x64), `nsis.oneClick: true`, `nsis.perMachine: false`, sem `publish`, e `electronFuses` com `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `enableEmbeddedAsarIntegrityValidation: true`, `onlyLoadAppFromAsar: true`, `enableCookieEncryption: true` (research R-11)
- [ ] T006 [P] Criar os recursos do app em `apps/desktop/resources/`: ícone provisório próprio (`icon.png` 256×256 e `icon.ico`, sem marca de terceiros) e o som do aviso `sounds/token-alert.wav` gerado por um script Node (`apps/desktop/scripts/generate-alert-sound.mjs`: bipe curto, sem áudio de terceiros)
- [ ] T007 [P] Em `vitest.config.ts` (raiz), adicionar os grupos: `desktop` (raiz `apps/desktop`, `test/main/**/*.test.ts`, ambiente `node`), `desktop-ui` (`test/renderer/**/*.test.tsx`, ambiente `jsdom`, `setupFiles` com `@testing-library/jest-dom/vitest`) e `desktop-e2e` (`test/e2e/**/*.test.ts`, um arquivo por vez, `testTimeout` 60 000, `hookTimeout` 180 000), com comentários no padrão dos grupos existentes
- [ ] T008 [P] Em `eslint.config.js`, adicionar para `apps/desktop/src/renderer/**`: `no-restricted-imports` de `electron`, `node:*`, `undici`, `openapi-fetch`, `eventsource-parser` e de qualquer caminho em `src/main` (mensagem citando research R-02); `no-restricted-globals`/`no-restricted-properties` para `localStorage`, `sessionStorage` e `indexedDB` (research R-14); o plugin `eslint-plugin-react-hooks` (regras recomendadas). Para `apps/desktop/src/main/**`: proibir `react` e `@mantine/*`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contrato da API 1.4.0 e `/me`, a ponte entre os processos, o processo principal com
conexão confirmada, cofre e configuração, a base da interface e o ambiente de testes de ponta a
ponta.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

### Contrato da API e `/me`

- [ ] T009 Atualizar `packages/contracts/openapi.yaml` para `info.version: 1.4.0` com **todos** os acréscimos de [contracts/api-changes.md](./contracts/api-changes.md) (§1 a §5: `getCurrentClient` em `/me` com a tag `clients`, `ClientRole`, `ClientIdentity`, parâmetro `active` e `ExecutionSummary.requestedClient` obrigatório, parâmetros `q` (`minLength: 2, maxLength: 100`), `channel` (`minLength: 1, maxLength: 100`) e `amount` (`pattern: '^[0-9]+\.[0-9]{2}$'`) em `listReservations`, `listChannels` em `/channels`, `listExecutionEvidence` em `/executions/{executionId}/evidence` e `EvidenceSummary`); citar a feature 002 em `info.description`; rodar `pnpm --filter @hunit/contracts generate`; copiar para `specs/002-app-desktop/contracts/openapi.yaml` (research R-15); em `apps/server/test/unit/contract-consistency.test.ts`, conferir que `ClientRole` = `clientRoleEnum.enumValues` e `EvidenceSummary.kind` = `evidenceKindEnum.enumValues`; conferir que o servidor sobe com as operações novas ainda sem implementação
- [ ] T010 [P] Escrever o teste de contrato `apps/server/test/contract/clients.test.ts` (grupo `server-db`): `GET /v1/me` com chave de operador e de consulta → 200 `{ name, role }` validado contra o contrato; sem chave → 401; chave revogada → 401. Depende de T009
- [ ] T011 Implementar `GET /v1/me` em `apps/server/src/http/handlers/clients.ts` (devolve `request.client` como `{ name, role }`) e registrar em `apps/server/src/http/app.ts` junto dos demais handlers; a operação **não** entra em `OPERATOR_ONLY_OPERATIONS`. Depende de T010

### Ponte entre os processos (contrato em [contracts/ipc.md](./contracts/ipc.md))

- [ ] T012 [P] Criar `apps/desktop/src/shared/ipc-types.ts`: `Result<T>`, `ErrorCode` (todos os códigos de `Problem.code` da API mais `offline`, `untrusted_server`, `not_configured`, `credentials_missing`, `credentials_expired`, `key_storage_unavailable`, `invalid_input` — data-model §6.5), `ConnectionStatus` (`not_configured`, `connecting`, `online`, `offline`, `untrusted_server`, `unauthorized`), `ConnectionState`, `PublicConfig`, `CertificateInfo`, `CredentialsStatus`, `TwoFactorRequest`, o motivo de fechamento do pedido (`accepted`, `rejected`, `expired`, `finished`, `answered_elsewhere`) e a interface `HunitApi` de `window.hunit` com todas as funções e eventos do contrato
- [ ] T013 [P] Criar `apps/desktop/src/shared/ipc-channels.ts` (um nome fixo `<área>:<ação>` por função) e `apps/desktop/src/shared/ipc-schemas.ts` com `zod` para a entrada de cada canal, citando as regras: `serverUrl` "`https://` obrigatório; só origem (sem caminho, consulta ou fragmento)"; `idleHours` "inteiro 1–24"; token `^[0-9]{4,10}$`; período em `YYYY-MM-DD` com início ≤ fim; `hotelCodes` lista não vazia ou `null`; `q` 2 a 100 caracteres depois de tirar os espaços das pontas; `channel` 1 a 100; `amount` `^[0-9]+\.[0-9]{2}$`; `executionId` e `evidenceId` UUID; `file` em `screenshot`, `html`, `response`; `limit` 1 a 500

### Processo principal — testes primeiro (grupo `desktop`)

- [ ] T014 [P] Criar os auxiliares de teste em `apps/desktop/test/helpers/certificates.ts` (gera em tempo de execução, com `@peculiar/x509`, uma autoridade raiz, uma segunda raiz "estranha", certificados de servidor para `localhost`/`127.0.0.1`, para outro nome e um vencido — nada de chave privada versionada) e `apps/desktop/test/helpers/https-server.ts` (servidor HTTPS local que usa esses certificados, registra as requisições recebidas e permite respostas programadas, inclusive SSE)
- [ ] T015 [P] Escrever `apps/desktop/test/main/certificate.test.ts`: lê PEM e devolve `fingerprint256`, `subject`, `issuer`, `validTo` e `isCertificateAuthority`; recusa certificado que não é de autoridade e arquivo que não é PEM válido. Depende de T014
- [ ] T016 [P] Escrever `apps/desktop/test/main/config-store.test.ts` com `safeStorage` simulado: grava `config.json` no formato do data-model §1 com a chave **só cifrada**; recusa salvar com `key_storage_unavailable` quando a cifra não está disponível; arquivo inválido → "não configurado"; escrita atômica; `idleHours` fora de 1–24 recusado; `remove` apaga o arquivo
- [ ] T017 [P] Escrever `apps/desktop/test/main/api-client.test.ts` contra o servidor do T014 (SC-007): raiz e nome certos → sucesso com `Authorization: Bearer <chave>`; certificado de outra raiz, de outro nome ou vencido → `untrusted_server` **sem a requisição chegar ao manipulador do servidor**; 401 → `unauthorized`; `application/problem+json` → `code` e `detail`; sem resposta/tempo esgotado → `offline`; diferença de relógio calculada pelo cabeçalho `Date`; nenhum erro contém a chave. Depende de T014
- [ ] T018 [P] Escrever `apps/desktop/test/main/connection.test.ts` com relógio simulado: sem configuração → `not_configured`; `/health` + `/me` ok → `online` com o cliente; falha de rede → `offline` e novo teste a cada 5 s até voltar; falha de TLS → `untrusted_server`; 401 → `unauthorized`; cada mudança emite o estado (data-model §4.1)
- [ ] T019 [P] Escrever `apps/desktop/test/main/credentials-vault.test.ts` com relógio simulado (data-model §4.3): `status` nunca devolve a senha; `clear` manual emite `{ reason: 'manual' }`; após `idleHours` (padrão 8) sem atividade esvazia e emite `{ reason: 'idle' }`; `activity` renova o prazo; eventos em segundo plano não renovam; retirar as credenciais com o cofre vazio devolve `credentials_missing`, e depois de esvaziar por inatividade devolve `credentials_expired`
- [ ] T020 [P] Escrever `apps/desktop/test/main/ipc-handlers.test.ts` para os canais da fundação (`app`, `connection`, `preferences`, `credentials`, `activity`): entrada inválida → `invalid_input` sem chamar a API nem o disco; nenhum resultado serializado contém a chave da API ou a senha (procurar valores-marcadores)

### Processo principal — implementação

- [ ] T021 Implementar `apps/desktop/src/main/certificate.ts` com `crypto.X509Certificate` do Node. Depende de T015
- [ ] T022 Implementar `apps/desktop/src/main/config-store.ts` (caminho `app.getPath('userData')/config.json`, escrita atômica, `safeStorage` para a chave, sem gravação em texto puro — research R-04). Depende de T016
- [ ] T023 Implementar `apps/desktop/src/main/api-client.ts`: `openapi-fetch` com os tipos `paths` de `@hunit/contracts` e `fetch` + `Agent({ connect: { ca } })` do **mesmo** pacote `undici` (só a raiz configurada é aceita; verificação de nome padrão), tempo limite por requisição, conversão de respostas e erros para `Result`, medição da diferença de relógio pelo `Date` (research R-03, R-07). Depende de T017
- [ ] T024 Implementar `apps/desktop/src/main/connection.ts` (máquina de estados do data-model §4.1; `/health` a cada 5 s quando `offline`). Depende de T018 e T023
- [ ] T025 Implementar `apps/desktop/src/main/credentials-vault.ts` (research R-05). Depende de T019
- [ ] T026 Implementar `apps/desktop/src/main/window.ts` e `apps/desktop/src/main/index.ts`: `BrowserWindow` com `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webviewTag: false`, `spellcheck: false` e `devTools` só fora do pacote; `will-navigate` bloqueado, `setWindowOpenHandler` negando tudo, `setPermissionRequestHandler` negando tudo; `app.requestSingleInstanceLock()` trazendo a janela existente à frente (FR-027); `app.setAppUserModelId('io.github.sura-team.hunit-control')`; pasta de dados alternativa pela variável `HUNIT_DESKTOP_USER_DATA_DIR` **só quando `!app.isPackaged`** (isolamento dos testes); nunca chamar `crashReporter.start()` (research R-02, R-13, R-14)
- [ ] T027 Implementar `apps/desktop/src/main/ipc-handlers.ts` com os canais da fundação — `app.info`, `connection.getState`/`getConfig`/`pickCertificate` (diálogo de arquivo com `.crt`, `.cer`, `.pem`)/`test`/`save` (só depois de um teste bem-sucedido com os mesmos dados)/`remove`, `preferences.set`, `credentials.status`/`set`/`clear`, `activity.ping` e os eventos `connection.onState` e `credentials.onCleared` —, validando toda entrada com os esquemas do T013. Depende de T020 a T025
- [ ] T028 Implementar `apps/desktop/src/preload/index.ts`: `contextBridge.exposeInMainWorld('hunit', …)` com **todas** as funções e eventos de [contracts/ipc.md](./contracts/ipc.md) (os canais das histórias passam a responder quando cada história registrar o seu manipulador), sem expor o `ipcRenderer`, com eventos que devolvem a função de cancelar a inscrição. Depende de T012 e T013

### Interface — testes primeiro (grupo `desktop-ui`)

- [ ] T029 [P] Escrever `apps/desktop/test/renderer/labels.test.ts`: lê os enums de `packages/contracts/openapi.yaml` (com `yaml`) e confere que **todo** valor de `Classification`, `ReservationStatus`, `ExecutionStatus`, `HotelRunStatus`, `ExecutionEndReason` e `Problem.code` tem nome (ou mensagem) e tom; os nomes de `Classification` são exatamente os do data-model §6.1
- [ ] T030 [P] Escrever `apps/desktop/test/renderer/format.test.ts`: valores em BRL com `Intl` `pt-BR`; datas em DD/MM/AAAA; conversão do campo de valor `"1.234,56"` → `"1234.56"`, `"1234,5"` → `"1234.50"`, `"R$ 10"` → `"10.00"` e texto inválido → `null`
- [ ] T031 [P] Escrever `apps/desktop/test/renderer/connection-banner.test.tsx`: estado `offline` mostra "servidor indisponível" e o aviso "dados de HH:MM" sobre dados antigos; `untrusted_server` e `unauthorized` levam à configuração sem opção de continuar; `online` não mostra aviso
- [ ] T032 [P] Escrever `apps/desktop/test/renderer/setup-screen.test.tsx`: escolher o certificado mostra impressão digital, emissor e validade; "Testar conexão" mostra nome do cliente e perfil; "Salvar" só habilita depois do teste bem-sucedido; erro `untrusted_server` mostra "não foi possível confirmar a identidade do servidor" sem botão de continuar; preferências com prazo de inatividade 1–24 h e som ligado/desligado; "Testar aviso" chama `attention.test`; a versão do app aparece (FR-025)

### Interface — implementação

- [ ] T033 [P] Implementar `apps/desktop/src/renderer/src/presentation/labels.ts` com as tabelas do data-model §6 (nomes, mensagens e tons `sucesso`, `atenção`, `erro`, `informação`, `neutro`), tipadas por `Record<Enum, …>` com os tipos de `@hunit/contracts`. Depende de T029
- [ ] T034 [P] Implementar `apps/desktop/src/renderer/src/presentation/format.ts` (datas, BRL, prazo restante, conversão do campo de valor). Depende de T030
- [ ] T035 Montar a base da interface: `apps/desktop/src/renderer/index.html` com a CSP do research R-02 (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`), `src/renderer/src/main.tsx` (`MantineProvider`, `DatesProvider` com `locale: 'pt-br'` e o idioma do `dayjs` carregado, `QueryClient` **sem persistência**), `src/renderer/src/hunit.ts` (`window.hunit` tipado e conversão de `Result` em erro com código para o TanStack Query) e `src/renderer/src/App.tsx` (`AppShell` com Executar, Execuções, Reservas e Configuração; navegação por estado, sem roteador; ações de operador escondidas para o perfil consulta; `activity.ping` em tecla ou clique, no máximo 1 vez por minuto; abre a Configuração quando `not_configured`, `untrusted_server` ou `unauthorized`). Depende de T028, T033 e T034
- [ ] T036 Implementar `apps/desktop/src/renderer/src/components/ConnectionBanner.tsx`, `StaleDataNotice.tsx` (usa `dataUpdatedAt` da consulta) e `StatusBadge.tsx` (tons → cores do Mantine: verde, amarelo, vermelho, azul, cinza). Depende de T031 e T035
- [ ] T037 Implementar `apps/desktop/src/renderer/src/screens/setup/SetupScreen.tsx` e `PreferencesForm.tsx` (FR-001 a FR-003). Depende de T032 e T036

### Ambiente de ponta a ponta (grupo `desktop-e2e`)

- [ ] T038 [P] Criar `apps/server/test/helpers/e2e-server.ts`: sobe PostgreSQL pelo Testcontainers, aplica as migrations, cria a API com `FakeHunitGateway` programável (login ok/recusado, pedido de token, token aceito/recusado, hotéis com reservas e hotel com falha e evidência) a partir dos auxiliares existentes (`app.ts`, `fake-hunit-gateway.ts`, `factories.ts`), cria clientes `operator` e `reader` devolvendo as chaves, escuta HTTP em `127.0.0.1` numa porta livre e expõe controles (trocar cenário, inserir reservas, parar e voltar)
- [ ] T039 Criar `apps/desktop/test/helpers/tls-terminator.ts` (servidor `tls` que repassa para a porta HTTP do T038, imitando o Caddy; pode ser parado e religado) e `apps/desktop/test/e2e/app-fixture.ts` (compila o app com `electron-vite build` antes da rodada; abre com `_electron.launch` do Playwright usando uma pasta de dados temporária em `HUNIT_DESKTOP_USER_DATA_DIR`; substitui `dialog.showOpenDialog`/`showSaveDialog`/`showMessageBox` e `Notification` no processo principal via `electronApp.evaluate`, registrando as chamadas; função `configureApp` que preenche a configuração pela interface). Depende de T014, T026 e T038

**Checkpoint**: o app abre, configura a conexão com a autoridade fixada, mostra o estado da
conexão e o perfil — pronto para as histórias.

---

## Phase 3: User Story 1 - Executar a consulta e responder ao token (Priority: P1) 🎯 MVP

**Goal**: o operador configura o app, informa o acesso ao Hunit, período e hotéis, inicia a
execução, recebe o pedido de token de forma impossível de ignorar e vê o resultado.

**Independent Test**: numa máquina nova, configurar a conexão, iniciar uma execução de um hotel
por uma semana, responder ao token com o app minimizado e ver o resumo final com as contagens por
situação (quickstart §3 e §4 US1; E2E T051).

### Tests for User Story 1 ⚠️

- [ ] T040 [P] [US1] Escrever `apps/desktop/test/main/execution-watcher.test.ts` com o servidor do T014: lê o fluxo SSE com `eventsource-parser`, emite `executions.onChanged` a cada evento, reconecta com `Last-Event-ID` depois de uma queda, para no `status_changed` final; numa execução **desta máquina** que entra em `awaiting_2fa`, busca `twoFactorDeadline` e dispara o pedido de token uma única vez; fecha o pedido com o motivo certo — `running` depois do token → `accepted`, `failed`/`invalid_token` → `rejected`, `failed`/`two_factor_timeout` → `expired`, outros finais → `finished`, saída da espera sem token enviado daqui → `answered_elsewhere`
- [ ] T041 [P] [US1] Escrever `apps/desktop/test/main/attention.test.ts` com `Notification` e janela simuladas: o pedido de token mostra a notificação com som, restaura e mostra a janela, liga e desliga o "sempre por cima", pisca na barra de tarefas e manda tocar o som do app só com `soundEnabled`; `attention.test` faz o mesmo; o fim de uma execução desta máquina mostra notificação com o resultado resumido (FR-014)
- [ ] T042 [P] [US1] Escrever `apps/desktop/test/renderer/two-factor-dialog.test.tsx` com relógio simulado: contagem regressiva = prazo − (agora + `clockOffsetMs`); campo em foco; aceita só `^[0-9]{4,10}$`; enviar chama `executions.sendToken` e mostra "token entregue, aguardando o Hunit"; fecha com a mensagem de cada motivo; `not_awaiting_two_factor` mostra "a execução não aguarda mais o token"; pedidos simultâneos entram em fila
- [ ] T043 [P] [US1] Escrever `apps/desktop/test/renderer/run-screen.test.tsx`: informar usuário e senha chama `credentials.set` e a tela passa a mostrar o usuário e "senha guardada"; "Limpar acesso" esvazia (FR-008); período com fim antes do início não envia; datas exibidas em DD/MM/AAAA; hotéis "todos" ou seleção com busca por nome ou código; catálogo vazio → só "todos", com a explicação (caso de borda); `credentials_expired` explica a inatividade e pede de novo; `execution_already_active` leva à execução ativa; perfil consulta não vê o formulário
- [ ] T044 [P] [US1] Escrever `apps/desktop/test/renderer/execution-result.test.tsx`: contagens por situação com os nomes do data-model §6.1; hotéis concluídos e com falha, com o motivo; mensagem do motivo de término (§6.4); senha nunca aparece em mensagem (FR-007)

### Implementation for User Story 1

- [ ] T045 [US1] Implementar `apps/desktop/src/main/execution-watcher.ts` (research R-06: eventos como sinal, estado sempre por `GET`, no máximo uma busca por segundo; marca as execuções iniciadas por esta máquina). Depende de T040 e T024
- [ ] T046 [US1] Implementar `apps/desktop/src/main/attention.ts` (research R-07: notificação, `restore`/`show`, `setAlwaysOnTop(true)` seguido de `setAlwaysOnTop(false)`, `flashFrame`, som `resources/sounds/token-alert.wav` tocado pela interface conforme a preferência; notificação de fim de execução). Depende de T041 e T006
- [ ] T047 [US1] Registrar em `apps/desktop/src/main/ipc-handlers.ts` os canais `hotels.list`, `executions.start` (retira as credenciais do cofre; cofre vazio → `credentials_missing`/`credentials_expired`; passa a acompanhar a execução), `executions.get`, `executions.sendToken`, `executions.watch`/`unwatch`, `attention.test` e os eventos `executions.onChanged`, `twoFactor.onRequested` e `twoFactor.onClosed`. Depende de T045 e T046
- [ ] T048 [US1] Implementar `apps/desktop/src/renderer/src/components/TwoFactorDialog.tsx` (global no `App.tsx`; contagem regressiva; fila; som quando pedido pelo principal). Depende de T042 e T047
- [ ] T049 [US1] Implementar `apps/desktop/src/renderer/src/screens/run/RunScreen.tsx` com `CredentialsForm.tsx`, `PeriodPicker.tsx` (`DatePickerInput` em modo intervalo, `pt-br`, formato `DD/MM/YYYY`) e `HotelSelect.tsx` (`MultiSelect` com busca por nome e código a partir de `hotels.list`). Depende de T043 e T047
- [ ] T050 [US1] Implementar `apps/desktop/src/renderer/src/screens/run/ExecutionResult.tsx` (resultado ao terminar, dentro de Executar) e ligar a notificação de fim (FR-014). Depende de T044, T048 e T049
- [ ] T051 [US1] Escrever e passar `apps/desktop/test/e2e/us1-run-and-token.test.ts`: configuração no primeiro uso (cenário 1); iniciar; **minimizar** a janela pelo processo principal; o servidor pede o token → notificação registrada, janela restaurada (`isMinimized()` falso) e diálogo com contagem em até 5 s (SC-002); token aceito → execução conclui e o resumo aparece; senha errada → mensagem sem a senha (cenário 8); token recusado → mensagem (FR-013); usuário continua preenchido depois de iniciar (cenário 6). Depende de T039 e T050

**Checkpoint**: MVP — o app substitui o uso manual da API para executar a consulta.

---

## Phase 4: User Story 2 - Acompanhar, cancelar e retomar (Priority: P2)

**Goal**: acompanhar execuções longas, cancelar, retomar a partir dos hotéis que faltaram e ver
as execuções das outras máquinas.

**Independent Test**: iniciar uma execução de vários hotéis, acompanhar progresso e estimativa,
cancelar, retomar e confirmar que só os hotéis pendentes foram processados (quickstart §4 US2;
E2E T060).

### Tests for User Story 2 ⚠️

- [ ] T052 [P] [US2] Escrever o teste de contrato `apps/server/test/contract/executions-list-002.test.ts` (grupo `server-db`): todo item de `GET /v1/executions` traz `requestedClient` igual ao nome do cliente que iniciou ou retomou; `active=true` só devolve `queued`, `running` e `awaiting_2fa`; `active=false` só as encerradas; `active` combinado com `status`; respostas validadas contra o contrato 1.4.0
- [ ] T053 [P] [US2] Escrever `apps/desktop/test/main/execution-watcher-resume.test.ts`: ao ficar `online`, busca `active=true` e acompanha só as execuções com `requestedClient` igual ao nome do `/me`; reabre o pedido de token de uma execução desta máquina que está aguardando com prazo no futuro, com o tempo restante correto (FR-019); ignora execuções de outros clientes; nova reconexão não duplica acompanhamentos
- [ ] T054 [P] [US2] Escrever `apps/desktop/test/renderer/executions-screen.test.tsx`: a lista mostra quem iniciou, período em DD/MM/AAAA, estado, motivo de término e datas, mais recentes primeiro, e se atualiza a cada 10 s enquanto está na tela; o detalhe mostra estado, hotel atual, progresso de cada hotel, tempo estimado restante e contagens por situação; cancelar pede confirmação (FR-017); retomar usa o cofre e pede o acesso quando vazio; mostra a ligação entre a execução original e a retomada (FR-018); perfil consulta não vê cancelar, retomar nem token; perfil operador vê o campo de token numa execução de outra máquina que aguarda token (research R-07)

### Implementation for User Story 2

- [ ] T055 [US2] Em `apps/server/src/persistence/executions-repo.ts`, juntar `api_clients` na lista para devolver o nome do cliente e aplicar o filtro de ativas com a regra já existente (`isActiveExecutionStatus`); em `apps/server/src/http/handlers/executions.ts` e `apps/server/src/http/views.ts`, aceitar `active` e incluir `requestedClient` em `toExecutionSummary`. Depende de T052
- [ ] T056 [US2] Em `apps/desktop/src/main/execution-watcher.ts`, acrescentar a busca de execuções ativas desta máquina ao conectar e ao reconectar (research R-06). Depende de T053 e T055
- [ ] T057 [US2] Registrar em `apps/desktop/src/main/ipc-handlers.ts` os canais `executions.list`, `executions.cancel` e `executions.resume` (retira as credenciais do cofre; acompanha a nova execução). Depende de T056
- [ ] T058 [US2] Implementar `apps/desktop/src/renderer/src/screens/executions/ExecutionsScreen.tsx` (lista com atualização a cada 10 s) e `ExecutionDetail.tsx` (painel lateral com progresso, estimativa, contagens, cancelar com confirmação, retomar, ligação original/retomada, campo de token para operador; hotel que a conta não acessa aparece pendente com o motivo). Depende de T054 e T057
- [ ] T059 [US2] Em `apps/desktop/src/main/index.ts`, ao fechar a janela com execução ativa desta máquina, mostrar o aviso da FR-026 ("a execução continua no servidor, mas o pedido de token não será recebido enquanto o app estiver fechado") com confirmar/cancelar; ao encerrar, esvaziar o cofre. Depende de T056
- [ ] T060 [US2] Escrever e passar `apps/desktop/test/e2e/us2-monitor-cancel-resume.test.ts`: execução de vários hotéis com progresso e estimativa se atualizando; cancelar → `cancelled`; retomar com token → processa só os hotéis pendentes e mostra a ligação; outra chave de operador inicia uma execução direto pela API (outra máquina) → aparece na lista com quem iniciou e **sem** aviso neste app (FR-012); fechar com execução própria aguardando token → aviso; reabrir → o pedido reaparece com o tempo restante (FR-019); `execution_already_active` leva à execução ativa (cenário 6). Depende de T051, T058 e T059

**Checkpoint**: US1 e US2 funcionam juntas; execuções longas e interrompidas são controladas pelo
app.

---

## Phase 5: User Story 3 - Consultar reservas e evidências (Priority: P3)

**Goal**: encontrar reservas por filtros, busca livre e valor, ver o detalhe e baixar evidências.

**Independent Test**: com reservas gravadas, filtrar as pendentes de cobrança de um hotel numa
semana, achar uma reserva pelo código de autorização e pelo valor do extrato, abrir o detalhe e
salvar a evidência de um hotel que falhou (quickstart §5; E2E T071).

### Tests for User Story 3 ⚠️

- [ ] T061 [P] [US3] Escrever `apps/server/test/contract/reservations-search.test.ts` (grupo `server-db`) com os exemplos de [api-changes.md §3](./contracts/api-changes.md): `q=aut-0042` acha `authorizationCode = "AUT-0042"` em qualquer hotel; `q=joao` acha "João Silva" e "JOÃO PEREIRA" e não acha reserva anonimizada; `q=258-1234&hotelCode=H1` só a do hotel H1; `amount=1234.50` acha total **ou** valor cobrado iguais; `q=a` → `400 validation_error`; `amount=1.234,50` → `400 validation_error`; também transação e referência da operadora, `channel` exato, combinação com os filtros antigos e paginação por cursor; `GET /v1/channels` devolve os canais distintos em ordem alfabética
- [ ] T062 [P] [US3] Escrever `apps/server/test/contract/execution-evidence.test.ts` (grupo `server-db`): `GET /v1/executions/{id}/evidence` lista as evidências da execução, mais recentes primeiro, com `files` conforme os arquivos existentes (`screenshot`, `html`, `response`); execução inexistente → 404; perfil consulta pode listar; resposta validada contra `EvidenceSummary`
- [ ] T063 [P] [US3] Escrever `apps/desktop/test/renderer/reservations-screen.test.tsx`: filtros combinados (hotel, período, situação de cobrança, situação da reserva, canal, "não encontrada", execução); a busca livre envia `q` sem espaços nas pontas e só com 2 ou mais caracteres; o campo de valor converte "1.234,56" e mostra erro com texto inválido; "carregar mais" mantém os filtros (cursor); colunas da FR-021; reserva anonimizada mostra "nome anonimizado" em vez de vazio; aviso de dados antigos com o servidor indisponível
- [ ] T064 [P] [US3] Escrever `apps/desktop/test/renderer/reservation-detail.test.tsx`: dados da cobrança da FR-022 (data, responsável, valor, transação, autorização, parcelamento, estado do pré-pagamento) formatados; motivo; classificação anterior quando mudou; primeira e última verificação e quantidade
- [ ] T065 [P] [US3] Escrever `apps/desktop/test/main/evidence-download.test.ts` com o servidor do T014: baixa com a chave e abre "Salvar como" com nome padrão `evidencia-<hotel ou execução>-<id>.<png|html|json>`; cancelado → `null`; `evidence_expired` → erro com esse código; o conteúdo nunca vai para a interface

### Implementation for User Story 3

- [ ] T066 [US3] Criar a migration da extensão: `pnpm --filter @hunit/server db:generate --custom --name=unaccent` e preencher com `CREATE EXTENSION IF NOT EXISTS unaccent;`; em `apps/server/src/persistence/reservations-repo.ts`, acrescentar as condições de `q` (número, transação, código de autorização e referência iguais sem diferenciar maiúsculas, **ou** `unaccent(lower(guest_name))` contendo `unaccent(lower(q))`; nome nulo nunca coincide), `amount` (`total_amount` ou `charged_amount` iguais) e `channel`, e a função de canais distintos. Depende de T061
- [ ] T067 [US3] Em `apps/server/src/http/handlers/reservations.ts`, repassar `q` (sem espaços nas pontas), `channel` e `amount` e implementar `listChannels`; em `apps/server/src/evidence/store.ts`, listar evidências por execução, e em `apps/server/src/http/handlers/evidence.ts` (ou `executions.ts`), implementar `listExecutionEvidence`. Depende de T062 e T066
- [ ] T068 [US3] Implementar `apps/desktop/src/main/evidence-download.ts` e registrar em `apps/desktop/src/main/ipc-handlers.ts` os canais `reservations.list`, `reservations.get`, `reservations.channels`, `evidence.list` e `evidence.save`. Depende de T065 e T067
- [ ] T069 [US3] Implementar `apps/desktop/src/renderer/src/screens/reservations/ReservationsScreen.tsx`, `ReservationFilters.tsx` (busca livre, valor, canal a partir de `reservations.channels`) e `ReservationDetail.tsx` (painel lateral). Depende de T063, T064 e T068
- [ ] T070 [US3] Implementar `apps/desktop/src/renderer/src/components/EvidenceList.tsx` (evidências por execução e hotel, com "Salvar") e usá-lo no resultado da execução (T050) e, se a US2 estiver pronta, no detalhe da execução (T058). Depende de T068
- [ ] T071 [US3] Escrever e passar `apps/desktop/test/e2e/us3-reservations.test.ts`: com reservas inseridas pelo servidor de teste (nomes com acento, códigos e valores conhecidos), achar uma reserva pelo código de autorização sem informar o hotel e depois pelo valor (cenário 2), pelo nome sem acento, filtrar por canal, abrir o detalhe e salvar uma evidência (arquivo existe no caminho escolhido); com a chave de consulta, nenhuma ação de operador aparece e a consulta funciona (SC-009). Depende de T039, T069 e T070

**Checkpoint**: as três histórias funcionam de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T072 [P] Escrever e passar `apps/desktop/test/e2e/offline-recovery.test.ts` (FR-005, SC-006): com uma lista na tela, parar o terminador TLS → aviso "servidor indisponível", lista mantida com "dados de HH:MM" e ações desabilitadas; religar → o app volta sozinho em até 30 s; abrir o app com o servidor fora do ar → sem dados até conectar
- [ ] T073 [P] Escrever e passar `apps/desktop/test/e2e/no-sensitive-data-on-disk.test.ts` (SC-004, FR-008a): depois de um ciclo completo (execução, retomada, senha errada, token errado, consulta de reservas), fechar o app e varrer a pasta de dados temporária (e a pasta de *minidumps*) atrás da senha, do token, da chave em texto puro e dos nomes de hóspedes exibidos → nenhuma ocorrência; o `config.json` só tem a chave cifrada
- [ ] T074 [P] Escrever e passar `apps/desktop/test/e2e/untrusted-server.test.ts` (SC-007, FR-002): servidor apresentando certificado de outra raiz e certificado de outro nome → "Testar conexão" recusa com "não foi possível confirmar a identidade do servidor", sem opção de continuar e sem salvar
- [ ] T075 [P] Escrever `apps/desktop/test/main/builder-config.test.ts`: lê `apps/desktop/electron-builder.yml` e confere `appId`, `nsis.oneClick: true`, `nsis.perMachine: false`, `asar: true` e cada valor de `electronFuses` do T005; confere que `apps/desktop/package.json` não tem `dependencies` (research R-11)
- [ ] T076 Verificar no Windows se o Electron 45 grava *minidumps* em `app.getPath('crashDumps')` sem `crashReporter.start()` (research R-14, "A verificar"); se gravar, esvaziar a pasta ao iniciar em `apps/desktop/src/main/index.ts`; registrar o resultado em `specs/002-app-desktop/research.md` (R-14)
- [ ] T077 Revisar o código do app com o checklist de segurança da skill `electron-best-practices` (seções 1 a 5 e 8) e a fronteira do research R-02 — janela, preload, validação da ponte, CSP, navegação e empacotamento —, corrigindo o que faltar e registrando a revisão em `specs/002-app-desktop/research.md`
- [ ] T078 [P] Atualizar `AGENTS.md`: linha de `apps/desktop` na tabela de estrutura; comandos (`pnpm --filter @hunit/desktop dev`, `build`, `dist`; grupos `desktop`, `desktop-ui`, `desktop-e2e`); regra do espelho do contrato passando a "copie para a pasta `contracts/` da feature em andamento; a cópia da 001 fica congelada na 1.3.0" (research R-15); `electron` em `allowBuilds`; parágrafo de estado ("Desde a feature 002, existe o app desktop…"). Atualizar `README.md` com a seção do app: instalar, aviso do SmartScreen, configurar a conexão com o certificado raiz e "Testar aviso"
- [ ] T079 Rodar `pnpm lint`, `pnpm typecheck` e `pnpm test` (todos os grupos, com o Docker em execução) e corrigir o que falhar; confirmar que `packages/contracts/openapi.yaml` e `specs/002-app-desktop/contracts/openapi.yaml` estão iguais e que a cópia da 001 continua na 1.3.0
- [ ] T080 ⛔ HUNIT Executar a homologação do [quickstart.md](./quickstart.md) (§2 a §7) nas máquinas Windows dos usuários, com o servidor de produção e o Hunit real; registrar em `specs/002-app-desktop/research.md` ("Resultados da homologação") os tempos de SC-001, SC-002, SC-005, SC-006 e SC-008 e o resultado dos itens "A verificar" do R-07 (foco do teclado e notificações)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Antes de tudo**: a feature 001 homologada e mesclada na branch principal; trazer a branch
  principal para a `002-app-desktop` (os acréscimos à API partem do servidor final da 001).
- **Setup (Phase 1)**: T001 → T002; T003–T008 em paralelo depois de T001.
- **Foundational (Phase 2)**: depende do Setup; bloqueia as histórias. Trilhas internas:
  contrato `T009 → T010 → T011`; ponte `T012`, `T013` → `T028`; principal `T014 → T015–T020` (testes)
  → `T021–T025` → `T026` → `T027`; interface `T029–T032` (testes) → `T033`, `T034` → `T035 → T036 →
  T037`; ponta a ponta `T038 → T039`.
- **US1 (Phase 3)**: depende da Phase 2. É o MVP.
- **US2 (Phase 4)**: depende da Phase 2 e do acompanhamento de eventos da US1 (T045, T047); o E2E
  (T060) usa o fluxo da US1.
- **US3 (Phase 5)**: depende só da Phase 2 (servidor e app); o `EvidenceList` (T070) se liga ao
  resultado da US1 (T050) e, se pronta, ao detalhe da US2 (T058).
- **Polish (Phase 6)**: depois das histórias desejadas; T080 exige o Hunit real e as máquinas
  Windows.

### Within Each User Story

- Testes primeiro (devem falhar) → servidor (repositório, handler) → processo principal → canais
  da ponte → telas → teste de ponta a ponta.
- Commit ao final de cada tarefa ou grupo lógico, citando `specs/002` e o ID da tarefa.

### Parallel Opportunities

- Phase 1: T003–T008 em paralelo depois de T001.
- Phase 2: T010 em paralelo com T012–T020 e T029–T032; T033 e T034 em paralelo; T038 em paralelo com
  toda a trilha do app.
- US1: T040–T044 (testes) em paralelo; T045 e T046 em paralelo.
- US2: T052, T053 e T054 (testes) em paralelo.
- US3: T061–T065 (testes) em paralelo; a parte do servidor (T066, T067) em paralelo com as telas
  até T068.
- Com duas pessoas: depois da Phase 2, uma segue US1 → US2 e a outra US3.

---

## Parallel Example: User Story 1

```text
# Testes da US1 juntos:
Task: "T040 Fluxo de eventos e pedido de token em apps/desktop/test/main/execution-watcher.test.ts"
Task: "T041 Aviso (notificação, janela, som) em apps/desktop/test/main/attention.test.ts"
Task: "T042 Diálogo do token em apps/desktop/test/renderer/two-factor-dialog.test.tsx"
Task: "T043 Tela Executar em apps/desktop/test/renderer/run-screen.test.tsx"
Task: "T044 Resultado da execução em apps/desktop/test/renderer/execution-result.test.tsx"

# Processo principal da US1 juntos:
Task: "T045 apps/desktop/src/main/execution-watcher.ts"
Task: "T046 apps/desktop/src/main/attention.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (Setup) e Phase 2 (Foundational): app que abre, configura a conexão confirmada e mostra
   o perfil.
2. Phase 3 (US1): executar e responder ao token.
3. **Parar e validar**: E2E T051 e, se possível, quickstart §3 e §4 (US1) numa máquina Windows.
   Com isso o Financeiro e a Controladoria já operam sem chamar a API à mão.

### Incremental Delivery

1. Setup + Foundational → base pronta.
2. US1 → MVP (executar com aviso de token).
3. US2 → acompanhar, cancelar, retomar e ver as outras máquinas.
4. US3 → consulta de reservas, conciliação pelo extrato e evidências.
5. Polish → segurança (SC-004, SC-007), servidor indisponível (SC-006), documentação e
   homologação (T080).

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- O app não tem regra de negócio (FR-028, constitution princípio III): se uma tarefa parecer exigir
  decidir algo sobre reservas ou execuções no app, a decisão pertence ao servidor e à API.
- Nunca usar dados reais de hóspedes nos testes; o servidor de teste usa só dados fictícios.
- Credenciais do Hunit nunca no chat, em fixtures ou em testes: os testes usam valores-marcadores
  e o `FakeHunitGateway`.
- Antes de cada commit, conferir `git diff --cached --name-only` em busca de arquivos sensíveis.
