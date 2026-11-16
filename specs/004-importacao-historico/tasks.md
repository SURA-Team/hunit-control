---

description: "Task list for feature 004 — Importação do histórico do sistema anterior"
---

# Tasks: Importação do histórico do sistema anterior

**Input**: Design documents from `/specs/004-importacao-historico/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/api-changes.md](./contracts/api-changes.md),
[contracts/cli.md](./contracts/cli.md), [contracts/ipc.md](./contracts/ipc.md),
[quickstart.md](./quickstart.md)

**Tests**: INCLUÍDOS, porque a constitution exige (princípio VII: domínio com testes unitários,
contrato com teste, testes junto com cada tarefa). Escreva os testes de cada bloco antes da
implementação e confirme que falham. Grupos: `domain`, `server` (unidade), `server-db` e
`desktop-ui` (research R-14).

**Organization**: tarefas agrupadas por história, na ordem de prioridade da spec: US1 (P1), US2
(P1), US3 (P2) e US4 (P3).

**Base**: a 003 já está na `master` (PR #3); a `004-importacao-historico` parte da `master`.

**Dados**: nenhuma tarefa lê a planilha real nem a pasta de anexos real. Planilhas e anexos de
teste são **gerados no próprio teste**, com dados fictícios e sem nomes de hotéis ou da empresa
(AGENTS.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história atendida (US1, US2, US3, US4)
- **⛔ HOMOLOGAÇÃO / PRODUÇÃO**: depende do PC do servidor e, na produção, da planilha real (nunca
  acessa o Hunit, exceto a execução de rotina do quickstart §3.6)

## Path Conventions

Monorepo pnpm (ver plan.md): `packages/domain/`, `packages/contracts/`, `apps/server/`
(`src/legacy-import`, `src/persistence`, `src/http`, `test/{unit,contract,integration,helpers}`) e
`apps/desktop/` (`src/main`, `src/shared`, `src/renderer`, `test/{renderer,e2e}`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependências e geradores de dados fictícios usados por todos os testes.

- [X] T001 Em `apps/server/package.json`, acrescentar `read-excel-file@^9.3.15` em `dependencies` e `write-excel-file@^4.1.1` em `devDependencies`, e o script `"legacy-import": "node dist/cli.js legacy-import"`. Rodar `pnpm install` e conferir que nenhuma das duas, nem as dependências delas (`fflate`, `saxen`, `unzipper-esm`, `worker-f`), pede script de instalação: o `allowBuilds` do `pnpm-workspace.yaml` não muda. Conferir que o `apps/server/Dockerfile` instala as `dependencies` de produção do servidor sem ajuste (research R-02)
- [X] T002 [P] Criar `apps/server/test/helpers/legacy-fixtures.ts` com `buildLegacyWorkbook(options)` (gera com `write-excel-file` um `.xlsx` em memória com as abas "Reservas" e "Tratativas" e **exatamente** os cabeçalhos da spec, 35 e 14 colunas, na ordem; linhas dadas pelo teste; células de data como `Date` formatada, número de série do Sheets ou texto, conforme a opção, para cobrir a R-03) e `buildLegacyAttachments(dir, specs)` (PDF `%PDF-` mínimo, PNG mínimo, `.eml` com cabeçalhos `From`/`Date`/`Subject`, executável `MZ` renomeado para `.pdf`, arquivo vazio, arquivo de 26 214 401 bytes, subpastas `virtual_cards/manual_treatments/attachments/`). Usar só hotéis `legacy_hml_um` a `legacy_hml_quatro` ("Hotel Homologação Um" …), hóspedes "Hóspede Fictício N" e números `900001…` (sem dados reais)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contrato, regras puras do domínio, banco e as peças do comando que todas as histórias
usam.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

### Contrato da API

- [X] T003 Atualizar `packages/contracts/openapi.yaml` para `info.version: 1.6.0` com **todos** os acréscimos de [contracts/api-changes.md](./contracts/api-changes.md): o parâmetro `fromLegacy` (`boolean`, opcional) em `GET /v1/reservations`; o schema `ReservationLegacyOrigin` (required `importedAt`, `originalClassification`, `firstVerifiedAt`, `lastVerifiedAt`, `verificationCount` com `minimum: 1`, `merged`; `originalPreviousClassification` `[string, 'null']`) e `Reservation.legacy` como `oneOf` null/`ReservationLegacyOrigin`, **fora** do `required`; `fromLegacy` booleano opcional em `TreatmentDocument` e `TreatmentEvent`; as descrições novas de `Classification` (`not_virtual_card` = "A revisar (sistema anterior)"), `lastExecutionId`, `firstVerifiedAt` e `verificationCount`; citar a feature 004 em `info.description`. Rodar `pnpm --filter @hunit/contracts generate` e copiar para `specs/004-importacao-historico/contracts/openapi.yaml`. No `AGENTS.md`, trocar "hoje `specs/003-tratativas-manuais/contracts/openapi.yaml`" por `specs/004-importacao-historico/...` e registrar que a cópia da 003 fica congelada na 1.5.0 (research R-12)

### Domínio: testes primeiro (grupo `domain`)

- [X] T004 [P] Escrever `packages/domain/test/legacy-values.test.ts` (research R-03):
  - data e hora: `Date` de célula, número de série (`45778.5` = 2025-05-01 12:00 de Brasília = `15:00Z`), ISO `2026-05-01T10:15:00`, ISO só data, `01/05/2026 10:15`, `01/05/2026`; o resultado é o instante UTC com +3 h;
  - data (`Entrada`/`Saida`): os mesmos formatos, resultado `AAAA-MM-DD`;
  - dinheiro: `1234.5` → `"1234.50"`, `"1234.56"`, `"1.234,56"`, `"R$ 1.234,56"` → `"1234.56"`; negativo, `"abc"` e `"1,2,3"` são ilegíveis;
  - inteiro: `3`, `"3"` aceitos; `2.5`, `-1` e `"x"` ilegíveis;
  - sim/não: `true`, `"TRUE"`, `"Sim"`, `"não"`; vazio → `null`;
  - vazio em qualquer tipo → `null`;
  - o erro devolve só o código (`unreadable_date`, `unreadable_amount`, `unreadable_number`), nunca o valor
- [X] T005 [P] Ampliar `packages/domain/test/treatment.test.ts` (research R-04, data-model §5):
  - `acceptsTreatment('not_virtual_card') === true`;
  - `requiresCharge`: igual a `acceptsTreatment` para todas as classificações, menos `not_virtual_card` (`false`), com um caso por valor de `CLASSIFICATIONS`;
  - `reservationSituation('not_virtual_card', 'sent') === 'not_virtual_card'` e `('not_virtual_card', 'charged') === 'proof_sent'`;
  - `needsReview` é `false` para `not_virtual_card` só com tratativa, sem confirmação;
  - `isPendingCharge('not_virtual_card', 'none') === false`;
  - `CLASSIFICATIONS_REQUIRING_CHARGE` não contém `not_virtual_card`;
  - os casos atuais das outras classificações continuam iguais
- [X] T006 [P] Escrever `packages/domain/test/legacy-import.test.ts` (research R-04, R-06, R-07, R-10; data-model §3 e §4):
  - **colunas**: obrigatórias da spec ausentes → `missing_column` com o nome; ordem livre; coluna desconhecida ignorada; opcional ausente = vazia.
  - **conversão**: os 6 códigos da tabela de R-04, código desconhecido → `not_virtual_card` com o original guardado, vazio → `missing_value`; "Status anterior" por código e por rótulo, sem diferenciar maiúsculas e acentos.
  - **linha → reserva**: `reservation_status = 'unknown'`, `payment_form = null`, `changed_fields = []`, motivo `Sistema anterior: <Motivo>`, motivo fixo em "A revisar"; `inconsistent_dates` (saída < entrada; primeira > última); `verification_count` < 1 → `unreadable_number`; check-in há mais de 5 anos (relógio fixo) → `anonymize: true` e `guest_name = null`.
  - **precedência** (`mergeLegacyReservation`): reserva nova; já verificada pelo HUNIT Control → só `first_verified_at = min` e `verification_count += anterior`, `merged = true`, `applied_count`; já importada sem mudança de hash → `unchanged`; já importada e não verificada com hash diferente → atualiza; já importada e depois verificada com contagem diferente → ajusta pela diferença.
  - **ordem** importação × coletor: `mergeVerification` ∘ `mergeLegacyReservation` e o inverso dão a mesma contagem e a mesma primeira verificação.
  - **duplicadas na planilha**: vale a de última verificação mais recente, a outra `duplicated_in_sheet`.
  - **anexo antigo**: `proof` se o código original é `virtual_card_pending_charge`, senão `request`; com documento novo do mesmo tipo na linha → `superseded_in_legacy`.
  - **data original** (data-model §3.3): coluna própria → se vazia, "Atualizado em" → se vazia, última verificação com o aviso `original_date_missing`; coluna própria preenchida e ilegível → `unreadable_date`, sem passar para a seguinte.
  - **precedência dos documentos**: atual do HUNIT Control → `kept_hunit_control`; atual importado com o mesmo SHA-256 → `already_imported`; com outro → `replace`; valor manual sem comprovante → `manual_amount_without_proof`.
  - **nomes de hotel**: `normalizeHotelName` ("Hotel  São_José!" ≡ "hotel sao jose"), proposta com um candidato exato, nenhuma com zero ou mais de um

### Domínio: implementação

- [X] T007 [P] Implementar `packages/domain/src/legacy-values.ts`: `parseLegacyDateTime`, `parseLegacyDate`, `parseLegacyMoney`, `parseLegacyInteger`, `parseLegacyBoolean`. Cada uma recebe `Date | number | string | boolean | null` e devolve `{ ok: true, value } | { ok: false, code }`. Época do Sheets 1899-12-30; hora de Brasília = UTC−3 fixo. Sem I/O. Depende de T004
- [X] T008 [P] Em `packages/domain/src/treatment.ts`: `not_virtual_card: true` em `ACCEPTS_TREATMENT`; criar `requiresCharge` e `CLASSIFICATIONS_REQUIRING_CHARGE` (as que aceitam tratativa, menos `not_virtual_card`); `reservationSituation` usa `requiresCharge` para "Tratativa enviada"; `needsReview` devolve `false` quando a classificação é `not_virtual_card`; `isPendingCharge` usa `requiresCharge`. Em `packages/domain/src/types.ts`, documentar `not_virtual_card` como "A revisar (sistema anterior)": não é produzida pelo coletor e só aparece em reservas importadas (research R-04). Exportar o que é novo em `packages/domain/src/index.ts`. Depende de T005
- [X] T009 Implementar `packages/domain/src/legacy-import.ts`:
  - `LEGACY_RESERVATION_COLUMNS` e `LEGACY_TREATMENT_COLUMNS`, com as obrigatórias da spec: Codigo hotel, Hotel, Reserva, Entrada, Saida, Total da reserva, Codigo status, Primeira verificacao, Ultima verificacao e Quantidade de verificacoes; Codigo hotel e Reserva na aba de tratativas;
  - `mapHeaders`, `convertLegacyClassification` e `parseLegacyReservationRow` (→ dados da reserva + origem + `rowHash` SHA-256 dos valores normalizados, sem `node:crypto`: receber a função de hash por parâmetro, para o domínio continuar sem I/O);
  - `mergeLegacyReservation`, `pickDuplicate`, `legacyAttachmentKind`, `originalDate`, `decideDocument` e `decideManualAmount`;
  - `normalizeHotelName` e `proposeHotel`;
  - os códigos de motivo e de aviso de data-model §4 como `as const`.
  Exportar em `index.ts`. Depende de T006, T007, T008

### Banco de dados

- [X] T010 Em `apps/server/src/persistence/schema.ts`:
  - **enums**: `legacy_import_kind` (`simulation`, `import`), `legacy_import_status` (`running`, `completed`, `failed`, `interrupted`) e `legacy_hotel_decision` (`proposed`, `confirmed`, `unmapped`);
  - **tabelas** `legacy_imports`, `legacy_hotel_mappings` e `legacy_reservations`, **exatamente** como em [data-model.md §1](./data-model.md), inclusive o `check` "`decision = 'confirmed'` exige `hotel_code`; `decision = 'unmapped'` exige `hotel_code` nulo", `verification_count >= 1`, a FK composta para `reservations` e a FK `simulation_id` para `legacy_imports`;
  - `reservations.last_execution_id` **anulável**;
  - `legacy_import_id uuid` anulável (FK `legacy_imports`) em `treatment_documents`, `treatment_events` e `reservation_manual_amounts`.

  Gerar a migration com `pnpm --filter @hunit/server db:generate --name=legacy_import` (deve sair `0009_…`). Em `apps/server/src/http/views.ts`, tratar `lastExecutionId` nulo (omitir o campo), e conferir que os testes atuais de reservas passam. Depende de T009

### Peças do comando (grupo `server` e `server-db`)

- [X] T011 [P] Escrever `apps/server/test/integration/legacy-workbook.test.ts` e implementar `apps/server/src/legacy-import/workbook.ts`:
  - `readLegacyWorkbook(path)` lê com `read-excel-file/node` as abas "Reservas" e "Tratativas" pelo nome e devolve `{ sheet, row, cells: Record<coluna, valor> }` com o número da linha da planilha;
  - aba ausente ou coluna obrigatória faltando → erro tipado com o nome da aba ou da coluna;
  - qualquer erro da biblioteca vira `unreadable_workbook`, sem a mensagem original (research R-11).

  Teste com planilhas de T002. Depende de T002, T009
- [X] T012 [P] Escrever `apps/server/test/integration/legacy-attachments.test.ts` e implementar `apps/server/src/legacy-import/attachments.ts` (research R-07):
  - `resolveAttachment(root, storedPath)`: primeiro o caminho relativo dentro da pasta; se não existir, busca pelo nome do arquivo num índice da pasta montado uma vez;
  - nome repetido na pasta, caminho absoluto, com `..` ou que sai da pasta (inclusive por link simbólico, conferido com `realpath`) → `file_not_found`, sem abrir nada fora da pasta;
  - `inspectAttachment(path, name)`: `stat` antes de ler, e acima de 26 214 400 bytes devolve `file_too_large` **sem ler** (espiar a leitura no teste); senão lê, calcula o SHA-256 e aplica `detectTreatmentFile` da 003 (`empty_file`, `unsupported_file_type`, `file_type_mismatch`);
  - `unreferencedCount()` conta os arquivos da pasta que nenhuma linha usou.

  Depende de T002
- [X] T013 Criar `apps/server/src/persistence/legacy-import-repo.ts` e o teste `apps/server/test/integration/legacy-import-repo.test.ts`:
  - `withImportLock(db, fn)`: `pg_try_advisory_lock` com chave fixa na conexão do comando; se o lock já está com outro processo, `ImportInProgressError`;
  - `ensureLegacyAuthor`: `api_clients` `sistema-anterior`, perfil `reader`, `revoked_at` = agora, `key_hash` = SHA-256 de 32 bytes aleatórios descartados; idempotente;
  - CRUD de `legacy_hotel_mappings` (lista, proposta, confirmar, sem associação, aceitar propostas);
  - criar e fechar `legacy_imports` (contagens, `issues`, `differences`, `warnings`, status);
  - ler `legacy_reservations` por chave.

  Em `apps/server/src/cli.ts`, o `create-client` passa a recusar o nome `sistema-anterior` ("Nome reservado"), com teste no `apps/server/test/integration/cli.test.ts` existente (grupo `server-db`). Depende de T010
- [X] T014 [P] Escrever `apps/server/test/unit/legacy-fingerprint.test.ts` e implementar `apps/server/src/legacy-import/fingerprint.ts`: SHA-256 de (SHA-256 da planilha + pares caminho/SHA-256 de cada arquivo referenciado, ordenados + associações confirmadas, ordenadas); qualquer mudança em um dos três muda a impressão digital (research R-08). Depende de T009

**Checkpoint**: domínio, banco e peças do comando prontos. As histórias podem começar.

---

## Phase 3: User Story 1 - Simular a importação e conferir o resultado antes de gravar (Priority: P1) 🎯 MVP

**Goal**: o administrador simula a importação, vê contagens e motivos sem dado pessoal, associa os
hotéis e simula de novo, sem nenhuma reserva, documento ou arquivo gravado.

**Independent Test**: com a planilha fictícia de todos os casos (T002), `legacy-import simulate`
mostra as contagens e os motivos esperados, lista os hotéis com proposta e não grava nada em
`reservations`, `treatment_*` nem `reservation_manual_amounts` (spec US1).

### Tests for User Story 1 ⚠️

- [X] T015 [P] [US1] Escrever `apps/server/test/integration/legacy-simulate.test.ts` (grupo `server-db`):
  - contagens exatas por entidade e desfecho para uma planilha com um caso de cada motivo de data-model §4;
  - zero linhas novas ou alteradas em `reservations`, `legacy_reservations`, `treatment_files`, `treatment_documents`, `treatment_events` e `reservation_manual_amounts` (SC-002), e só uma linha `simulation` em `legacy_imports`;
  - 100% das linhas da planilha em exatamente um desfecho (SC-001);
  - coluna obrigatória ausente → código de saída 1 e o nome da coluna, sem avaliar linhas;
  - hotel novo com proposta → linhas `hotel_not_mapped`, proposta listada; depois de `hotels --accept-proposals`, a nova simulação as conta como `created`;
  - aviso `obsolete_classification_in_use` com uma reserva `not_virtual_card` sem origem;
  - aviso `anonymized_on_import` com a contagem;
  - `unreferenced_files` com a contagem;
  - o `HunitGateway` falso registra zero chamadas (SC-005)
- [X] T016 [P] [US1] Escrever `apps/server/test/security/legacy-no-personal-data.test.ts` (grupo `server-db`, com o `log-capture` existente), research R-11:
  - uma planilha fictícia com marcadores em todas as colunas sensíveis e nos nomes de arquivo (`MARCADOR-HOSPEDE`, `MARCADOR-ARQUIVO.pdf`, `987654.32`, `MARCADOR-TRANSACAO`, a data `2031-01-02`), inclusive em linhas recusadas;
  - simular, importar e mostrar o `report`;
  - nenhum marcador aparece na saída, na saída de erro, no log nem nas colunas `issues`, `differences` e `warnings` de `legacy_imports` (SC-006)
- [X] T017 [P] [US1] Escrever `apps/server/test/integration/legacy-lock.test.ts`: duas simulações ao mesmo tempo → a segunda termina com código 1 e "Já existe uma importação em andamento" (FR-020); depois que a primeira termina, o lock está livre; um processo que cai solta o lock (conexão encerrada)

### Implementation for User Story 1

- [X] T018 [US1] Implementar `apps/server/src/legacy-import/planner.ts` (research R-08):
  - `planImport(input, readState)`: recebe as linhas lidas (T011), o índice de anexos (T012), as associações e uma função de leitura do estado atual (reservas, `legacy_reservations`, documentos atuais com `legacy_import_id` e SHA-256, valores manuais);
  - devolve um plano por reserva (`create`, `update`, `merge`, `ignore`, `reject` com motivo, mais os documentos e o valor manual dela) e as contagens, `issues` e `warnings`, usando **só** as funções do domínio (T009);
  - as tratativas de uma reserva recusada ficam `reservation_rejected`; as de uma reserva fora da aba e fora do banco, `reservation_not_in_sheet`;
  - **não grava nada**.

  Depende de T011, T012, T013, T015
- [X] T019 [US1] Implementar `apps/server/src/legacy-import/report.ts`: texto de [contracts/cli.md](./contracts/cli.md) a partir de uma linha de `legacy_imports`: tabela de contagens, hotéis sem associação com a proposta, ignorados e recusados (aba, linha, código do hotel do sistema anterior, número, tipo, texto do motivo de data-model §4), avisos e a próxima instrução. Só códigos e números, nunca valores. Depende de T018
- [X] T020 [US1] Implementar `apps/server/src/legacy-import/command.ts` e ligar no `apps/server/src/cli.ts`:
  - subcomandos `simulate --xlsx --files`, `hotels` (lista, `--set <código> --hotel <código>`, `--set <código> --none`, `--accept-proposals`), `report --id` e `--help`;
  - `simulate` pega o lock (T013), lê (T011), atualiza as propostas dos códigos novos (`proposeHotel` sobre `hotels`), planeja (T018), grava a linha `simulation` com a impressão digital (T014) e imprime o relatório (T019) com o id;
  - códigos de saída de cli.md;
  - exceção inesperada → "Falha na linha N da aba X" e log JSON sem a mensagem original (R-11);
  - atualizar o `USAGE` do `cli.ts`.

  Os testes T015–T017 passam. Depende de T014, T018, T019

**Checkpoint**: a simulação funciona e é conferível sem gravar nada (MVP: dá para combinar a
importação com o Financeiro).

---

## Phase 4: User Story 2 - Importar as reservas do sistema anterior (Priority: P1)

**Goal**: `legacy-import run` grava as reservas válidas com a classificação convertida e a origem
"Sistema anterior", respeitando a precedência do HUNIT Control; repetir não duplica.

**Independent Test**: importar a planilha fictícia, consultar `GET /v1/reservations` e conferir a
classificação convertida, `legacy` preenchido e as verificações; importar de novo e ver tudo
`ignored` (spec US2).

### Tests for User Story 2 ⚠️

- [X] T021 [P] [US2] Escrever `apps/server/test/integration/legacy-run-reservations.test.ts` (grupo `server-db`):
  - **importação**:
    - criação com os campos de data-model §3.1 (`reservation_status = 'unknown'`, `last_execution_id` nulo, `changed_fields = []`);
    - reserva já verificada pelo HUNIT Control: dados e classificação mantidos, primeira = mínimo, contagem somada, `merged = true` (SC-007).
  - **reimportação**:
    - igual: tudo `unchanged` e nenhuma linha mudou (SC-003);
    - com uma linha mudada numa importada não verificada: `updated`.
  - **confirmação**:
    - `run` com impressão digital diferente (planilha, arquivo ou associação mudados) → código 1, nada gravado;
    - `run` com uma reserva gravada pelo coletor entre a simulação e a importação → aparece em `differences`.
  - **interrupção**: falha forçada no meio deixa as reservas anteriores completas, e um novo `run` completa o resto sem duplicar (FR-021).
  - **mais de 5 anos**: reserva gravada anonimizada (`guest_name` nulo, `anonymized_at` preenchido).
  - **acesso ao Hunit**: zero chamadas ao `HunitGateway` (SC-005)
- [X] T022 [P] [US2] Escrever `apps/server/test/integration/legacy-collector-interplay.test.ts` com o runner e o `FakeHunitGateway` (research R-06):
  - **ordem**: importar e depois coletar dá a mesma `verification_count` e o mesmo `first_verified_at` que coletar e depois importar;
  - **"A revisar"**:
    - uma `not_virtual_card` importada, coletada com resultado `invoiced`, passa a `invoiced` com `previous_classification = 'not_virtual_card'`, `status_changed_at` preenchido e `legacy` mantido;
    - importada fora do resultado de um hotel concluído → `not_found_since` preenchido e continua `not_virtual_card`;
  - **concorrência**: importação e `commitHotel` ao mesmo tempo na mesma reserva terminam sem erro e com o resultado esperado
- [X] T023 [P] [US2] Escrever `apps/server/test/contract/reservations-legacy.test.ts` (arquivo próprio, com as reservas importadas pelo comando real) (respostas validadas contra o `openapi.yaml` 1.6.0):
  - reserva importada sem verificação → `legacy` preenchido e sem `lastExecutionId`;
  - reserva do HUNIT Control → `legacy: null`;
  - `pendingCharge=true` não traz `not_virtual_card`, e traz as importadas `virtual_card_pending_charge` sem comprovante, inclusive com tratativa, junto com as do HUNIT Control (SC-009);
  - `situation=not_virtual_card` traz as "A revisar" com e sem tratativa;
  - `needsReview=true` não traz nenhuma delas

### Implementation for User Story 2

- [X] T024 [US2] Implementar `apps/server/src/legacy-import/applier.ts` para as reservas (research R-06, R-09):
  - **uma transação por reserva**: `SELECT … FOR UPDATE` na reserva (ou `INSERT … ON CONFLICT DO NOTHING` e trava, se for nova), recalcula o plano dela com o estado travado e grava `reservations` e `legacy_reservations` (`first_import_id`, `last_import_id`, `row_hash`, `merged`, `applied_count`);
  - desfecho real devolvido por reserva;
  - andamento "N de M reservas" a cada 500. Depende de T018, T021, T022
- [X] T025 [US2] Acrescentar o subcomando `run --simulation <id> --xlsx --files` em `apps/server/src/legacy-import/command.ts`:
  - pega o lock e confere que o id é uma `simulation` `completed`;
  - recalcula a impressão digital e recusa se diferente, com a mensagem de research R-08;
  - cria a linha `import` (`running`), aplica (T024), grava contagens, `issues` e `differences` (desfechos diferentes dos da simulação) e fecha com `completed`, ou com `interrupted` ao receber `SIGINT`/`SIGTERM`;
  - a simulação seguinte avisa `previous_import_incomplete` se houver `import` `running` ou `interrupted`.

  Depende de T020, T024
- [X] T026 [US2] Em `apps/server/src/persistence/reservations-repo.ts`:
  - trocar `CLASSIFICATIONS_ACCEPTING_TREATMENT` por `CLASSIFICATIONS_REQUIRING_CHARGE` nos filtros `pendingCharge`, `needsReview` e `situation` (os três usos de research R-04);
  - em `listReservations` e `getReservation`, juntar `legacy_reservations` (com o `started_at` da `first_import_id` como `importedAt`) sem consulta por linha.

  Em `apps/server/src/http/views.ts`, montar `Reservation.legacy`. Os testes T023 passam. Depende de T008, T010, T023
- [X] T046 [US2] Em `apps/desktop/src/renderer/src/presentation/labels.ts`, renomear `not_virtual_card` para `{ name: 'A revisar (sistema anterior)', tone: 'warning' }` e colocá-la logo depois de `analysis_error` em `CLASSIFICATION_ORDER` e `SITUATION_ORDER`, para o app mostrar as importadas certo já na US2 (spec US2, Independent Test). Atualizar `apps/desktop/test/renderer/labels.test.ts`. Numerada depois das demais por ter vindo da análise. Depende de T003

**Checkpoint**: reservas importadas, consultáveis pela API e pelo app (com o nome "A revisar
(sistema anterior)") e reimportáveis sem duplicar.

---

## Phase 5: User Story 3 - Importar as tratativas e os comprovantes com os documentos (Priority: P2)

**Goal**: as tratativas, os comprovantes e os valores manuais do sistema anterior viram tratativas
da 003, com os documentos idênticos, a autoria "Sistema anterior" e a data original.

**Independent Test**: importar a planilha fictícia com tratativas, comprovantes, anexo antigo,
valor manual e arquivos fora das regras; conferir a situação de cada reserva, o download idêntico,
o histórico "Sistema anterior" com a data original e os recusados no relatório (spec US3).

### Tests for User Story 3 ⚠️

- [X] T027 [P] [US3] Escrever `apps/server/test/integration/legacy-run-treatments.test.ts` (grupo `server-db`):
  - **documentos importados**:
    - tratativa → `treatment.status = 'sent'`;
    - comprovante → `charged`;
    - anexo antigo em pendente → comprovante e, em erro na cobrança, → tratativa;
    - documento `current` com `legacy_import_id`, `attached_by` = `sistema-anterior` e `attached_at` = data original;
    - evento `attached` com a mesma autoria e data.
  - **arquivos**:
    - download por `getTreatmentDocumentFile` idêntico ao arquivo de origem (SC-004);
    - mesmo arquivo em duas reservas → uma linha em `treatment_files`.
  - **valor manual** com comprovante: `amount_set` e data original.
  - **recusas**:
    - arquivo ausente, vazio, `.exe` renomeado, 26 MB e tipo não aceito → recusados com o motivo, e a reserva e o outro documento entram;
    - valor manual sem comprovante → `manual_amount_without_proof`.
  - **reserva fora da aba de reservas**:
    - que já existe no HUNIT Control → a tratativa é importada para ela;
    - que não existe → `reservation_not_in_sheet`.
  - **precedência**:
    - comprovante já registrado no HUNIT Control → `kept_hunit_control` e o documento dele intacto;
    - "já cobrada" com tratativa → importada (FR-017) e `needsReview = true`;
    - "A revisar" com tratativa → situação `not_virtual_card`, sem alerta (FR-007a).
  - **reimportação**:
    - igual → `already_imported`, sem documento nem evento novo (SC-003);
    - com o conteúdo do arquivo mudado → o importado é substituído (`replaced`, evento `replaced`).
  - **retenção**: reserva com check-in há mais de 5 anos → documentos `purged`, sem `treatment_files`.
  - **perfis**: a reserva importada aceita desfazer e reverter pelo operador como as demais (FR-016)

### Implementation for User Story 3

- [X] T028 [US3] Em `apps/server/src/legacy-import/planner.ts` e `applier.ts`, planejar e gravar, **na mesma transação da reserva** (FR-021):
  - `treatment_files` (`ON CONFLICT (sha256) DO NOTHING`, `uploaded_by` = autor reservado);
  - `treatment_documents` (`current`, `legacy_import_id`, `attached_at` original; ou `purged` para mais de 5 anos);
  - substituição de um importado anterior (`replaced`, `ended_at` = agora, `ended_by` = autor reservado);
  - `reservation_manual_amounts` e os `treatment_events` (`attached`, `replaced`, `amount_set`) com `legacy_import_id`, `client_id` = autor reservado e `at` = data original.

  `ensureLegacyAuthor` (T013) é chamado no início do `run`. Depende de T024, T025, T027
- [X] T029 [US3] Em `apps/server/src/persistence/treatments-repo.ts` e `apps/server/src/http/views.ts`, devolver `fromLegacy: true` em `TreatmentDocument` e `TreatmentEvent` quando `legacy_import_id` estiver preenchido (omitido nos demais); conferir no `apps/server/test/contract/treatments-us1.test.ts` que as respostas continuam válidas contra o 1.6.0. Depende de T010, T028

**Checkpoint**: histórico completo importado: reservas, tratativas, comprovantes e valores.

---

## Phase 6: User Story 4 - Identificar e filtrar o que veio do sistema anterior (Priority: P3)

**Goal**: na API e no app, filtrar pela origem, ver o selo "Sistema anterior", a seção do detalhe,
o nome "A revisar (sistema anterior)" e o autor "Sistema anterior" no histórico.

**Independent Test**: com reservas importadas, do HUNIT Control e das duas origens, filtrar por
origem sozinha e combinada (API e app, perfis operador e consulta) e conferir o selo, o detalhe e
o histórico (spec US4).

### Tests for User Story 4 ⚠️

- [X] T030 [P] [US4] Ampliar `apps/server/test/contract/reservations-legacy.test.ts`: `fromLegacy=true` traz só as importadas, inclusive as verificadas depois; `fromLegacy=false` traz o complemento; combinado com `hotelCode`, `situation` e `pendingCharge`; liberado aos dois perfis
- [ ] T031 [P] [US4] Escrever `apps/desktop/test/renderer/legacy-origin.test.tsx` (o nome de `not_virtual_card` já vem da T046):
  - **lista**: selo "Sistema anterior" nas reservas com `legacy`;
  - **filtro "Origem"** (Todas / Sistema anterior / HUNIT Control): enviado como `fromLegacy` `undefined`/`true`/`false`;
  - **detalhe**: seção "Sistema anterior" com a classificação original pelo nome do sistema anterior (código desconhecido aparece como está), verificações e data da importação, e "Ainda não verificada pelo HUNIT Control" sem `lastExecutionId`;
  - **histórico**: autor "Sistema anterior" nos eventos `fromLegacy`;
  - **perfil consulta**: vê tudo, sem ações novas

### Implementation for User Story 4

- [X] T032 [US4] Em `apps/server/src/persistence/reservations-repo.ts`, filtro `fromLegacy` (`EXISTS`/`NOT EXISTS` em `legacy_reservations`), e repassar o parâmetro em `apps/server/src/http/handlers/reservations.ts`. Os testes T030 passam. Depende de T026, T030
- [ ] T033 [P] [US4] Em `apps/desktop/src/shared/ipc-schemas.ts` (`fromLegacy: z.boolean().optional()`), `apps/desktop/src/shared/ipc-types.ts` (`fromLegacy?: boolean | undefined` e os tipos da API 1.6.0) e `apps/desktop/src/main/api-client.ts` (envia `fromLegacy` na query quando definido), conforme [contracts/ipc.md](./contracts/ipc.md); teste em `apps/desktop/test/main/api-client.test.ts`. Depende de T003
- [ ] T034 [US4] Em `apps/desktop/src/renderer/src/presentation/labels.ts`, acrescentar os nomes da classificação original (data-model §6) e "Sistema anterior". Criar `apps/desktop/src/renderer/src/components/LegacyBadge.tsx`. Usar o selo em `ReservationsScreen.tsx`, o filtro "Origem" em `ReservationFilters.tsx`, a seção "Sistema anterior" em `ReservationDetail.tsx` e o autor "Sistema anterior" em `TreatmentSection.tsx` (todos em `apps/desktop/src/renderer/src/screens/reservations/`). Os testes T031 passam. Depende de T031, T033
- [ ] T035 [US4] Em `apps/desktop/test/e2e/screens-capture.test.ts`, inserir no servidor de teste uma reserva importada (com `legacy_reservations`, uma "A revisar" e um documento `fromLegacy`), para as capturas mostrarem o selo, o filtro, a seção do detalhe e o histórico. Os demais testes `desktop-e2e` continuam verdes. Depende de T034

**Checkpoint**: todas as histórias funcionando e testadas.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T036 [P] Ampliar o teste de cópia e restauração (grupo `server-db`, o que roda `deploy/backup/`) com uma reserva importada, com `legacy_reservations` e um documento importado: depois de restaurar, a origem, o documento e o download idêntico voltam (FR-023)
- [ ] T037 [P] Escrever `apps/server/test/integration/legacy-retention.test.ts`: a rotina de `apps/server/src/maintenance/retention.ts` anonimiza uma importada quando o check-in passa de 5 anos (relógio fixo) e purga os documentos dela como os da 003, mantendo `legacy_reservations` (FR-022); nenhum ajuste no código é esperado: se for preciso, corrigir e registrar em research.md
- [ ] T038 [P] Escrever `apps/server/test/integration/legacy-import-perf.test.ts`, que só roda com `HUNIT_LEGACY_PERF=1`: simulação de 20 000 linhas e 2 000 anexos pequenos em até 5 min, e importação em até 15 min (SC-008); anotar os tempos medidos em research.md
- [ ] T039 [P] Escrever `apps/server/test/integration/legacy-homolog-prepare.test.ts`, que só roda com `HUNIT_HOMOLOG_DATABASE_URL` e `HUNIT_LEGACY_HOMOLOG_DIR`:
  - gera `planilha.xlsx` e `anexos\` fictícios para os hotéis `HML1` a `HML4` da homologação da 003 (códigos do sistema anterior `hml_um`… com nomes iguais aos do catálogo, mais um hotel sem correspondência);
  - cobre os casos do quickstart §2.2, inclusive reservas que já existem na homologação;
  - recusa um banco sem os hotéis `HML*`
- [ ] T040 [P] Atualizar `AGENTS.md`:
  - tabela de comandos com `legacy-import` (simulate, hotels, run, report) e o uso com `docker compose run --rm -v …:/import:ro`;
  - parágrafo "Desde a feature 004…" com a importação, a origem "Sistema anterior", "A revisar (sistema anterior)" e o contrato 1.6.0;
  - na tabela de estrutura, `apps/server/src/legacy-import/`
- [ ] T041 [P] Em `README.md`, acrescentar a seção "Importar o histórico do sistema anterior" com o passo a passo de [quickstart.md §3](./quickstart.md): cópia em `C:\importacao`, simular, hotéis, simular de novo, importar, execução no Hunit do período e apagar a pasta
- [ ] T042 Rodar `pnpm typecheck`, `pnpm lint` e `pnpm test` (grupos `domain`, `server`, `server-db`, `desktop`, `desktop-ui` e `desktop-e2e`). Antes de cada commit, conferir `git diff --cached --name-only`: nenhum `.xlsx`, nenhum anexo e nenhuma pasta de importação. Depende de tudo
- [ ] T043 ⛔ HOMOLOGAÇÃO: seguir [quickstart.md §2](./quickstart.md) na pilha `hunit-homolog` (com T039), registrando as contagens, o tamanho da cópia de segurança antes e depois e o que for observado em research.md. Depende de T042
- [ ] T044 Atualizar o espelho no Figma com a skill `figma-screens-sync`: página `004-importacao-historico` com as telas mudadas (lista com selo e filtro "Origem", detalhe com a seção "Sistema anterior", histórico, "A revisar (sistema anterior)"), a partir das capturas de T035 com dados fictícios. Depende de T035, T043
- [ ] T045 ⛔ PRODUÇÃO: com autorização do usuário, seguir [quickstart.md §3](./quickstart.md): simular com a planilha real, revisar recusas e hotéis com o Financeiro, importar, conferir por amostragem, rodar a execução do período do sistema anterior e **apagar `C:\importacao`**. Registrar só as contagens em research.md, nunca dados. Depende de T043 e do PR mesclado

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 → T002.
- **Foundational (Phase 2)**: depende do Setup; bloqueia as histórias. Trilhas:
  - **contrato**: T003;
  - **domínio**: T004, T005, T006 → T007, T008 → T009;
  - **banco**: T009 → T010 → T013;
  - **peças do comando**: T002 + T009 → T011; T002 → T012; T009 → T014.
- **US1 (Phase 3)**: depende da Phase 2. É o MVP: a simulação já serve para combinar a importação
  com o Financeiro.
- **US2 (Phase 4)**: depende da US1 (planner, comando e relatório: T018–T020). A T046 (nome no
  app) só depende de T003 e pode ser feita a qualquer momento da fase.
- **US3 (Phase 5)**: depende da US2 (transação por reserva e `run`: T024, T025).
- **US4 (Phase 6)**:
  - servidor (T030, T032): depende da US2 (T026);
  - app (T031, T033, T034): depende só de T003 e pode andar em paralelo com a US2/US3;
  - captura (T035): depende de T034.
- **Polish (Phase 7)**:
  - T036 e T037 dependem da US3;
  - T038 depende da US3;
  - T039 depende de T002 e da US3;
  - T040 e T041 podem ser feitos a qualquer momento depois da US2;
  - T042 → T043 → T044 → T045.

### Within Each User Story

- Testes primeiro (devem falhar) → planner → applier → comando → repositório → views → app.
- Commit ao final de cada tarefa ou grupo lógico, em português, citando `specs/004` e o ID.

### Parallel Opportunities

- Phase 2: T004, T005 e T006; T007 e T008; T011, T012 e T014 depois de T009 (T012 já depois de
  T002); T003 em paralelo com o domínio.
- US1: T015, T016 e T017.
- US2: T021, T022 e T023; T046 em paralelo com o servidor.
- US4: T030 e T031; T033 em paralelo com qualquer tarefa do servidor depois de T003.
- Polish: T036 a T041.

---

## Parallel Example: User Story 1

```text
# Testes da US1 juntos:
Task: "T015 Simulação: contagens, nada gravado, propostas, avisos em apps/server/test/integration/legacy-simulate.test.ts"
Task: "T016 Marcadores fora da saída, do log e de legacy_imports em apps/server/test/security/legacy-no-personal-data.test.ts"
Task: "T017 Uma importação por vez em apps/server/test/integration/legacy-lock.test.ts"

# Depois, em sequência:
Task: "T018 apps/server/src/legacy-import/planner.ts"
Task: "T019 apps/server/src/legacy-import/report.ts"
Task: "T020 apps/server/src/legacy-import/command.ts + cli.ts"
```

## Parallel Example: Foundational

```text
Task: "T004 packages/domain/test/legacy-values.test.ts"
Task: "T005 packages/domain/test/treatment.test.ts (requiresCharge, not_virtual_card)"
Task: "T006 packages/domain/test/legacy-import.test.ts"
Task: "T003 packages/contracts/openapi.yaml 1.6.0"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 e Phase 2: dependências, contrato, domínio, banco e as peças do comando.
2. Phase 3 (US1): simulação, associação de hotéis e relatório.
3. **Parar e validar**: rodar a simulação com a planilha fictícia e conferir o relatório. Com isso
   já se pode simular a planilha real (só leitura) e discutir as recusas com o Financeiro antes de
   gravar qualquer coisa.

### Incremental Delivery

1. Setup + Foundational → base pronta.
2. US1 → simulação conferível (MVP).
3. US2 → reservas importadas, "A revisar" e precedência do HUNIT Control.
4. US3 → tratativas, comprovantes e valores manuais com os documentos.
5. US4 → filtro "Origem" e apresentação no app.
6. Polish → cópia e restauração, retenção, desempenho, documentação, homologação, Figma e a
   importação real.

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- O app não tem regra de negócio (constitution, princípio III): a origem, "A revisar" e a autoria
  vêm prontas do servidor.
- Nenhuma tarefa acessa o Hunit; testes garantem zero chamadas ao `HunitGateway` na simulação e na
  importação.
- Nenhum `.xlsx`, anexo ou relatório com dados reais entra no repositório; o `.gitignore` já
  bloqueia `*.xlsx` e `*.csv`.
