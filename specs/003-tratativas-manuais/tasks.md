---

description: "Task list for feature 003 — Tratativas manuais das reservas"
---

# Tasks: Tratativas manuais das reservas

**Input**: Design documents from `/specs/003-tratativas-manuais/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/api-changes.md](./contracts/api-changes.md),
[contracts/ipc.md](./contracts/ipc.md), [quickstart.md](./quickstart.md)

**Tests**: INCLUÍDOS — exigidos pela constitution (princípio VII: domínio com testes unitários,
teste de contrato para cada operação nova, testes junto com cada tarefa). Escreva os testes de cada
bloco antes da implementação e confirme que falham. Grupos: `domain`, `server-db`, `desktop`,
`desktop-ui` e `desktop-e2e` (research R-11).

**Organization**: tarefas agrupadas por história, na ordem de prioridade da spec: US1 (P1), US2
(P2), US4 (P2) e US3 (P3).

**Pré-requisito da implementação**: o PR da 002 (#1) mesclado na `master` e a `master` trazida para
a `003-tratativas-manuais` (a branch partiu da `002-app-desktop`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história atendida (US1, US2, US3, US4)
- **⛔ HOMOLOGAÇÃO**: depende do servidor de produção e das máquinas Windows dos usuários (não
  acessa o Hunit)

## Path Conventions

Monorepo pnpm (ver plan.md): `packages/domain/`, `packages/contracts/`, `apps/server/`
(`src/persistence`, `src/http`, `src/maintenance`, `test/{unit,contract,integration}`) e
`apps/desktop/` (`src/main`, `src/preload`, `src/renderer`, `src/shared`, `test/{main,renderer,e2e}`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependências novas do app e ajustes de build e segurança da interface.

- [X] T001 Em `apps/desktop/package.json`, adicionar em `devDependencies` (nunca em `dependencies`, specs/002 R-11): `pdfjs-dist@^6`, `postal-mime@^4`, `@kenjiuno/msgreader@^1` e, só para os testes, `cfb` (monta `.msg` sintéticos, T016); rodar `pnpm install` e conferir que nenhuma delas (nem `iconv-lite` e `@kenjiuno/decompressrtf`, dependências do msgreader) pede script de instalação — `allowBuilds` do `pnpm-workspace.yaml` não muda (research R-08)
- [X] T002 [P] Em `apps/desktop/src/renderer/index.html`, mudar a CSP para `img-src 'self' data: blob:` e acrescentar `worker-src 'self'`, mantendo `connect-src 'none'`, `object-src 'none'` e o resto; conferir que `apps/desktop/test/e2e/security-hardening.test.ts` continua passando (o `fetch` da interface segue bloqueado) — research R-08
- [X] T003 [P] Em `apps/desktop/electron.vite.config.ts`, garantir que o *worker* do pdf.js (`pdfjs-dist/build/pdf.worker.min.mjs`) é empacotado como arquivo do próprio app (import `?url`), sem CDN; conferir com `pnpm --filter @hunit/desktop build` que o worker aparece em `apps/desktop/out/renderer/` — research R-08

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contrato 1.5.0, regras do domínio, tabelas, leitura do corpo binário, perfis, resumo
da tratativa na reserva, ponte do app e pré-visualização — tudo o que as quatro histórias usam.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

### Contrato da API

- [X] T004 Atualizar `packages/contracts/openapi.yaml` para `info.version: 1.5.0` com **todos** os acréscimos de [contracts/api-changes.md](./contracts/api-changes.md) (§1 a §11), usando os `operationId`: `uploadTreatmentFile`, `checkTreatmentDocuments`, `registerTreatmentDocuments`, `removeTreatmentDocument`, `revertTreatmentDocument`, `getTreatmentDocumentFile`, `setManualChargedAmount`, `clearManualChargedAmount`, `getReservationTreatment`, todos com a tag `treatments`; `Reservation.treatment` obrigatório; corpo de `uploadTreatmentFile` como `application/octet-stream: {}` **sem `schema`** (research R-03); `reservations.maxItems: 200` em check e register; citar a feature 003 em `info.description`; rodar `pnpm --filter @hunit/contracts generate`; copiar para `specs/003-tratativas-manuais/contracts/openapi.yaml` (research R-12) e, no `AGENTS.md`, trocar "hoje `specs/002-app-desktop/contracts/openapi.yaml`" por `specs/003-tratativas-manuais/...` e registrar que a cópia da 002 fica congelada na 1.4.0

### Domínio — testes primeiro (grupo `domain`)

- [X] T005 [P] Escrever `packages/domain/test/document-type.test.ts` (research R-03): aceita `.pdf` com `%PDF-`, `.png` com a assinatura PNG, `.jpg`/`.jpeg` com `FF D8 FF`, `.msg` com `D0 CF 11 E0 A1 B1 1A E1`, `.eml` de texto com bloco de cabeçalhos incluindo `From`, `Date` ou `Subject`; extensão em maiúsculas aceita; recusa `empty_file` (0 byte), `file_too_large` (26 214 401 bytes; 26 214 400 aceito), `unsupported_file_type` para extensão fora da lista, executável (`MZ`) renomeado para `.pdf`, `.eml` com byte nulo e PNG com extensão `.jpg`; nome do arquivo "1 a 255 caracteres, sem `/`, `\` nem caracteres de controle"
- [X] T006 [P] Escrever `packages/domain/test/treatment.test.ts` (research R-04, data-model §3 e §4): `acceptsTreatment` → `true` para `virtual_card_pending_charge`, `virtual_card_charge_error`, `virtual_card_validated_only`, `analysis_error`, `charge_at_terminal` e `false` para `ignored_hotelbeds_258`, `invoiced`, `cancelled_no_charge`, `virtual_card_already_charged`, `not_virtual_card` (um caso por valor de `CLASSIFICATIONS`, para nenhum ficar de fora); `treatmentStatus` → `charged` com comprovante (com ou sem tratativa), `sent` só com tratativa, `none` sem nenhum; `revertDeadline` = fim + 30 dias e `isRevertible` falso no instante exato do prazo e depois; `effectiveChargedAmount` prefere o do Hunit e só usa o manual com comprovante atual; `isPendingCharge` ("Falta cobrar") → `true` só para classificação que aceita tratativa com `treatmentStatus` `none` ou `sent`, `false` com `charged` e para classificações que não exigem cobrança

### Domínio — implementação

- [X] T007 [P] Implementar `packages/domain/src/document-type.ts`: `MAX_TREATMENT_FILE_BYTES = 26_214_400`, `ACCEPTED_EXTENSIONS`, `validateTreatmentFileName(name)` e `detectTreatmentFile(name, bytes: Uint8Array)` → `{ ok: true, mediaType }` (`application/pdf`, `image/png`, `image/jpeg`, `message/rfc822`, `application/vnd.ms-outlook`) ou `{ ok: false, code: 'empty_file' | 'file_too_large' | 'unsupported_file_type' }`; sem I/O. Depende de T005
- [X] T008 [P] Implementar `packages/domain/src/treatment.ts`: `TREATMENT_DOCUMENT_KINDS = ['request', 'proof']`, `TREATMENT_STATUSES = ['none', 'sent', 'charged']`, `TREATMENT_DOCUMENT_STATES = ['current', 'replaced', 'removed', 'purged']`, `TREATMENT_REVERT_DAYS = 30`, `acceptsTreatment`, `treatmentStatus`, `revertDeadline`, `isRevertible`, `effectiveChargedAmount`, `isPendingCharge` (research R-04); exportar os dois módulos em `packages/domain/src/index.ts`. Depende de T006

### Banco de dados

- [X] T009 Em `apps/server/src/persistence/schema.ts`, criar os enums `treatment_document_kind`, `treatment_document_state` e `treatment_event_type` (`attached`, `replaced`, `removed`, `reverted`, `amount_set`, `amount_cleared`) e as tabelas `treatment_files`, `treatment_documents`, `reservation_manual_amounts` e `treatment_events` **exatamente** como em [data-model.md §1](./data-model.md) — inclusive o índice único parcial "no máximo um `current` por (`hotel_code`, `reservation_number`, `kind`)", os `check` "`state = 'current'` ⇔ `ended_at is null`" e "`state = 'purged'` ⇔ `file_sha256 is null` e `original_name is null`", `amount > 0`, o índice por reserva e o índice parcial em `ended_at` para a purga; gerar a migration com `pnpm --filter @hunit/server db:generate --name=treatments`; em `apps/server/test/unit/contract-consistency.test.ts`, conferir que os três enums do banco são iguais às listas de T008 e aos `enum` do contrato (T004). Depende de T004 e T008

### Servidor — base

- [X] T010 Em `apps/server/src/http/problem.ts`, acrescentar os códigos de [api-changes §1](./contracts/api-changes.md) com o status de cada um (`empty_file` 400, `file_too_large` 413, `unsupported_file_type` 415, `file_not_found` 422, `not_eligible_for_treatment` 409, `document_not_current` 409, `document_not_revertible` 409, `proof_required` 409, `document_purged` 410) e os títulos em português. Depende de T004
- [X] T011 Em `apps/server/src/http/app.ts`, ler `application/octet-stream` como `Buffer` **somente** na operação `uploadTreatmentFile`, com `bodyLimit` de 26 214 400 bytes nessa rota (as demais continuam com o padrão de 1 MiB); corpo acima do limite vira `file_too_large` (413), e octet-stream em qualquer outra rota continua recusado como hoje; testes em `apps/server/test/contract/app.test.ts`. Depende de T010 — research R-03
- [X] T012 Em `apps/server/src/http/auth.ts`, acrescentar a `OPERATOR_ONLY_OPERATIONS`: `uploadTreatmentFile`, `checkTreatmentDocuments`, `registerTreatmentDocuments`, `removeTreatmentDocument`, `revertTreatmentDocument`, `setManualChargedAmount`, `clearManualChargedAmount` (FR-014); `getTreatmentDocumentFile` e `getReservationTreatment` ficam abertos aos dois perfis; o teste existente em `contract-consistency.test.ts` confere que nenhuma operação que não é `GET` ficou de fora. Depende de T004
- [X] T013 Criar `apps/server/src/persistence/treatment-files-repo.ts` (`saveTreatmentFile` com `ON CONFLICT (sha256) DO NOTHING` — o mesmo conteúdo devolve o mesmo id —, `findTreatmentFileContent`) e o teste `apps/server/test/integration/treatment-files-repo.test.ts` (deduplicação, conteúdo idêntico na leitura). Depende de T009
- [X] T014 Em `apps/server/src/persistence/reservations-repo.ts` e `apps/server/src/http/views.ts`, montar `Reservation.treatment` em `listReservations` e `getReservation` (documentos atuais de cada tipo, valor manual, `status` por `treatmentStatus`, `effectiveChargedAmount`, `acceptsDocuments` por `acceptsTreatment`, nome do cliente em `attachedBy`) sem consulta por linha (uma junção ou um `IN` por página); `TreatmentDocument` e `TreatmentEvent` em `views.ts`; os testes de contrato de reservas que já existem passam com `treatment.status = 'none'`. Depende de T009

- [X] T055 Escrever `apps/server/test/security/no-personal-data-in-logs.test.ts` (grupo `server-db`, com o `log-capture` existente): um envio com `?name=` contendo um marcador fictício de nome de hóspede e uma busca `GET /v1/reservations?q=<outro marcador>` não deixam nenhum dos marcadores no log; depois, em `apps/server/src/logging.ts`, acrescentar o serializador de `req` que registra só método, caminho **sem a query**, id da requisição e cliente, sem cabeçalhos nem corpo (research R-13; corrige também a busca da 002). Depende de T004

### App — ponte (contrato em [contracts/ipc.md](./contracts/ipc.md))

- [X] T015 Em `apps/desktop/src/shared/ipc-types.ts`, `ipc-channels.ts` e `ipc-schemas.ts`, acrescentar a área `treatments` (`pickFile`, `discardFile`, `check`, `apply`, `get`, `remove`, `revert`, `setManualAmount`, `clearManualAmount`, `saveDocument`) e `treatmentStatus` e `pendingCharge` em `reservations.list`, com `PickedFile`, `DocumentPreview` e `ApplyResult` (com `retryable`); validação zod: `selectionId` e `documentId` UUID, `kind` em `request`/`proof`, `reservations` com 1 a 2 000 itens `{ hotelCode, reservationNumber }` não vazios, `amount` `^[0-9]+\.[0-9]{2}$` maior que zero; a interface **não** envia nome de arquivo (contracts/ipc.md); expor em `apps/desktop/src/preload/index.ts`. Depende de T004

### App — pré-visualização no processo principal (grupo `desktop`)

- [X] T016 [P] Escrever `apps/desktop/test/main/picked-files.test.ts` e `apps/desktop/test/main/document-preview.test.ts` com arquivos **gerados no teste** (sem dados reais): arquivo de 26 MB recusado com `file_too_large` **sem ser lido** (espiar a leitura); extensão fora da lista → `unsupported_file_type`; o id de seleção expira após 15 min sem uso (relógio falso) e some ao descartar; nada gravado em disco (pasta temporária vazia); `.eml` sintético → remetente, destinatários, cópia, assunto, data ISO, texto e anexos (nome, tipo, tamanho), sem abrir anexos; `.eml` só com HTML → `html` preenchido e `text` nulo; `.msg` sintético montado com `cfb` (assunto, remetente, corpo) → o mesmo modelo; `.msg` corrompido → `{ type: 'unavailable', reason: 'unreadable' }`; PDF e imagem → bytes. Depende de T015
- [X] T017 Implementar `apps/desktop/src/main/picked-files.ts`: `dialog.showOpenDialog` com filtros das extensões aceitas, `stat` antes de ler (recusa acima de 26 214 400 bytes), leitura para a memória, mapa `selectionId → { bytes, fileName, sizeBytes, mediaType }` com expiração de 15 min e liberação explícita; nunca grava em disco (FR-018a). Depende de T016
- [X] T018 Implementar `apps/desktop/src/main/document-preview.ts`: `.eml` com `postal-mime`, `.msg` com `@kenjiuno/msgreader`, ambos para o modelo `email` de contracts/ipc.md; qualquer erro de leitura vira `unavailable`; PDF e imagem devolvem os bytes. Depende de T016
- [X] T019 Em `apps/desktop/src/main/api-client.ts`, acrescentar as 9 operações novas e `treatmentStatus` na lista de reservas; o envio do arquivo manda os bytes da memória como `application/octet-stream` com o nome em `?name=`; o download devolve `{ content, fileName }` lendo `filename*` do `content-disposition`; testes em `apps/desktop/test/main/api-client.test.ts` contra o servidor HTTPS de teste. Depende de T004

### App — interface base (grupo `desktop-ui`)

- [X] T020 [P] Escrever `apps/desktop/test/renderer/document-preview.test.tsx`: PDF entregue ao pdf.js (simulado no jsdom) com `isEvalSupported: false` e `enableScripting: false`; imagem por URL `blob:`; e-mail mostra remetente, destinatários, assunto, data, texto e lista de anexos; HTML num `iframe` com atributo `sandbox` vazio e `srcdoc` iniciando pela CSP `default-src 'none'; style-src 'unsafe-inline'; img-src data:`; `unavailable` mostra "Não foi possível pré-visualizar", nome, tipo e tamanho. Depende de T015
- [X] T021 Implementar `apps/desktop/src/renderer/src/components/DocumentPreview.tsx` (pdf.js com o worker de T003, primeira página logo e as demais sob demanda; imagem; e-mail; aviso de indisponível) e `apps/desktop/src/renderer/src/components/TreatmentBadge.tsx` (Enviada / Cobrada); acrescentar em `apps/desktop/src/renderer/src/presentation/labels.ts` os nomes de [data-model §7](./data-model.md) e as mensagens dos códigos novos; `apps/desktop/test/renderer/labels.test.ts` confere que todo valor dos enums novos tem nome. Depende de T020

**Checkpoint**: contrato 1.5.0, domínio, tabelas, perfis e ponte prontos; a lista de reservas já
traz `treatment` (vazio) e o app consegue escolher e pré-visualizar um arquivo.

---

## Phase 3: User Story 1 - Registrar o comprovante de cobrança (Priority: P1) 🎯 MVP

**Goal**: o Financeiro anexa o comprovante (com pré-visualização) a uma reserva que exige cobrança,
que passa a "Cobrada"; substitui e reverte por 30 dias; informa e remove o valor cobrado à mão;
qualquer perfil baixa o documento.

**Independent Test**: com reservas pendentes gravadas (dados fictícios), anexar um comprovante e
conferir "Cobrada" na API e no app, o download idêntico ao enviado, o autor e o momento; substituir
e reverter; recusar reserva faturada, arquivo de 26 MB e executável renomeado (quickstart §3).

### Tests for User Story 1 ⚠️

- [X] T022 [P] [US1] Escrever `apps/server/test/contract/treatments-us1.test.ts` (grupo `server-db`, respostas validadas contra o `openapi.yaml` 1.5.0): `uploadTreatmentFile` → 201 com `fileId`, mesmo arquivo de novo → mesmo `fileId`, vazio 400 `empty_file`, 26 214 401 bytes 413, executável renomeado 415, perfil consulta 403; `registerTreatmentDocuments` de `proof` numa reserva `virtual_card_pending_charge` → `registered` e `treatment.status = 'charged'`; outro comprovante → `replaced`, o anterior com `state: 'replaced'` e `revertibleUntil`; mesmo arquivo → `ignored`/`same_file`; reserva `invoiced` e `virtual_card_already_charged` → `ignored`/`not_eligible`; `charge_at_terminal` aceita; `fileId` desconhecido → 422; `revertTreatmentDocument` troca atual e substituído, 409 `document_not_revertible` com o prazo vencido (relógio fixo) e 409 `not_eligible_for_treatment` se a classificação mudou; `setManualChargedAmount` sem comprovante → 409 `proof_required`, com comprovante → valor e `effectiveChargedAmount`, com valor do Hunit → o do Hunit prevalece; `clearManualChargedAmount`; `getTreatmentDocumentFile` → bytes idênticos (SC-005), `content-disposition` com `filename*`, `nosniff` e `content-security-policy: sandbox`, liberado ao perfil consulta; `getReservationTreatment` → documentos e eventos com o nome do cliente
- [X] T023 [P] [US1] Escrever `apps/server/test/integration/treatments-repo.test.ts` (grupo `server-db`): dois registros simultâneos de `proof` na mesma reserva → um único `current`, dois eventos (R-05); uma nova coleta da mesma reserva pelo runner com o `FakeHunitGateway` deixa documentos, valor manual e eventos iguais (SC-004); nenhuma operação de tratativa chama o `HunitGateway` (SC-003); registro que falha no meio não deixa documento nem evento (FR-011)
- [X] T024 [P] [US1] Escrever `apps/desktop/test/main/treatments.test.ts`: `apply` envia o arquivo uma vez e registra; libera a memória quando tudo foi processado, mesmo com reservas `ignored` ou `failed`; com o servidor fora do ar no envio ou numa parte do registro, devolve `retryable: true`, **mantém** o arquivo em memória e uma nova chamada com o mesmo `selectionId` conclui sem escolher o arquivo de novo (caso-limite da spec, research R-08); `saveDocument` abre "Salvar como" com o nome original (trocando caracteres inválidos no Windows) e a interface só recebe o caminho; `revert`, `setManualAmount` e `clearManualAmount` repassam o resultado do servidor
- [X] T025 [P] [US1] Escrever `apps/desktop/test/renderer/attach-dialog.test.tsx` e ampliar `apps/desktop/test/renderer/reservation-detail.test.tsx`: escolher arquivo → pré-visualização → confirmação; numa substituição, mostra o documento que será substituído (nome, quem anexou, quando); cancelar chama `discardFile` e não chama `apply`; detalhe mostra documentos atuais e substituídos com "Reverter" até `revertibleUntil`, histórico, valor manual com o rótulo "informado à mão" e campo que aceita "1.234,56"; perfil consulta não vê nenhuma ação de registro (FR-017)

### Implementation for User Story 1

- [X] T026 [US1] Criar `apps/server/src/persistence/treatments-repo.ts`: `registerDocuments(kind, fileId, fileName, keys, clientId)` com **uma transação por reserva** (`SELECT … FOR UPDATE` na reserva, `acceptsTreatment` no momento, `same_file`, encerra o `current` do tipo como `replaced`, insere o novo, evento `attached` ou `replaced`, mesmo `batchId` para o pedido) e desfecho por reserva (`registered`, `replaced`, `ignored` com motivo, `failed`); `revertDocument`; `setManualAmount`/`clearManualAmount` (exige comprovante atual; evento `amount_set`/`amount_cleared`); `getTreatmentDetail`. Depende de T013, T014, T022, T023
- [X] T027 [US1] Criar `apps/server/src/http/handlers/treatments.ts` com `uploadTreatmentFile` (valida o nome e o conteúdo por `detectTreatmentFile`, calcula o SHA-256, grava), `registerTreatmentDocuments` (o `fileName` precisa ter extensão do mesmo tipo do arquivo, senão 415), `revertTreatmentDocument`, `getTreatmentDocumentFile` (cabeçalhos de api-changes §8; 410 se purgado), `getReservationTreatment`, `setManualChargedAmount` e `clearManualChargedAmount`; registrar em `apps/server/src/http/app.ts`. Depende de T011, T012, T026
- [X] T028 [US1] Criar `apps/desktop/src/main/treatments.ts` (`apply`, `get`, `revert`, `setManualAmount`, `clearManualAmount`, `saveDocument`, `discardFile`, `pickFile` usando T017/T018) e registrar os canais em `apps/desktop/src/main/ipc-handlers.ts`. Depende de T017, T018, T019, T024
- [X] T029 [US1] Criar `apps/desktop/src/renderer/src/screens/reservations/AttachDialog.tsx` (modo de uma reserva: escolher → `DocumentPreview` → documento que será substituído → confirmar → resultado; com `retryable`, mostra o erro e "Tentar de novo" sem escolher o arquivo outra vez) e, em `ReservationDetail.tsx`, a seção "Tratativa": documentos, histórico, "Anexar comprovante", "Reverter", valor manual (usa `format.ts` para "1.234,56" ↔ "1234.56"), "Baixar"; ações ocultas no perfil consulta; atualizar a lista e o detalhe com novo `GET` depois de cada ação. Depende de T021, T025, T028
- [X] T030 [US1] Escrever e passar `apps/desktop/test/e2e/us1-proof.test.ts` (app real, servidor de teste, dados fictícios): anexar comprovante PDF a uma pendente → "Cobrada"; valor manual; substituir e reverter (SC-009 em menos de 30 s); recusa de faturada, de 26 MB e de executável renomeado; baixar e comparar com o original. Depende de T027, T029

**Checkpoint**: US1 funcional — o Financeiro já tira reservas da lista do que falta cobrar.

---

## Phase 4: User Story 2 - Registrar a tratativa ("Enviada") (Priority: P2)

**Goal**: o Financeiro anexa o pedido de cobrança ao Comercial (e-mail .eml/.msg, PDF ou imagem):
a reserva fica "Enviada" e continua pendente; o comprovante depois a deixa "Cobrada"; qualquer
documento pode ser desfeito e revertido por 30 dias.

**Independent Test**: anexar uma tratativa .eml a uma pendente (pré-visualização sem conteúdo
externo), conferir "Enviada" e que continua no filtro "pendente de cobrança"; anexar o comprovante
→ "Cobrada" com os dois documentos; desfazer o comprovante → "Enviada" (quickstart §4).

### Tests for User Story 2 ⚠️

- [X] T031 [P] [US2] Escrever `apps/server/test/contract/treatments-us2.test.ts`: `request` → `status: 'sent'` e a reserva continua em `classification=virtual_card_pending_charge`; `request` + `proof` → `charged` com os dois documentos; `proof` e depois `request` → continua `charged`; `removeTreatmentDocument` do comprovante → `sent`, documento `removed` com `revertibleUntil`, evento `removed` com o cliente; desfazer documento que não é o atual → 409 `document_not_current`; reverter o desfeito dentro do prazo → volta a `charged`; perfil consulta → 403 em desfazer
- [X] T032 [P] [US2] Ampliar `apps/desktop/test/renderer/reservation-detail.test.tsx`: "Anexar tratativa" e "Anexar comprovante" lado a lado; "Desfazer" pede confirmação antes de chamar `treatments.remove`; badge "Enviada" ou "Cobrada" conforme `treatment.status`

### Implementation for User Story 2

- [X] T033 [US2] Em `apps/server/src/persistence/treatments-repo.ts` e `apps/server/src/http/handlers/treatments.ts`, implementar `removeTreatmentDocument` (só o `current`; vira `removed` com `ended_at`, `ended_by_client_id` e evento `removed`; o valor manual não é apagado — data-model §1.3). Depende de T026, T027, T031
- [X] T034 [US2] Acrescentar `remove` em `apps/desktop/src/main/treatments.ts` e no `ipc-handlers.ts`; em `ReservationDetail.tsx`, "Anexar tratativa", "Desfazer" com confirmação e o `TreatmentBadge`; o `AttachDialog` passa a receber o `kind`. Depende de T029, T032, T033
- [X] T035 [US2] Escrever e passar `apps/desktop/test/e2e/us2-request.test.ts`: tratativa `.eml` sintético com imagem remota e script no HTML — pré-visualização mostra os cabeçalhos e o texto sem nenhuma requisição de rede (contar pelas requisições da sessão do Electron) → "Enviada"; o mesmo com `.msg` sintético; comprovante → "Cobrada"; desfazer o comprovante → "Enviada". Depende de T034

**Checkpoint**: US1 e US2 funcionam juntas e separadas.

---

## Phase 5: User Story 4 - Consultar e filtrar pelas tratativas (Priority: P2)

**Goal**: Financeiro e Controladoria filtram pela situação da tratativa combinada com os filtros
existentes, veem documentos e histórico e baixam os arquivos; o perfil consulta não registra nada.

**Independent Test**: com reservas em cada situação, filtrar "pendente de cobrança" + "Sem
tratativa", "Enviada" e "Cobrada" (com hotel e período) e conferir os resultados; com chave de
consulta, baixar documentos e não ver ações (quickstart §6).

### Tests for User Story 4 ⚠️

- [X] T036 [P] [US4] Escrever `apps/server/test/contract/reservations-treatment-filter.test.ts`: `treatmentStatus=none`, `sent`, `charged` e combinações (`none&sent`) com `classification`, `hotelCode`, `checkInFrom/To` e `reservationStatus`; `pendingCharge=true` traz as reservas que exigem cobrança sem comprovante (inclusive "Enviadas" e `charge_at_terminal`) e nenhuma "Cobrada", faturada ou já cobrada, e `pendingCharge=false` o complemento (FR-002); `amount` acha o valor manual; com 20 000 reservas fictícias e 2 000 com documentos, "pendente + sem tratativa" responde em menos de 5 s e traz exatamente as esperadas (SC-008); perfil consulta: lista, detalhe, histórico e download liberados, todas as ações de registro com 403 (SC-006)
- [X] T037 [P] [US4] Ampliar `apps/desktop/test/renderer/reservations-screen.test.tsx`: atalho "Falta cobrar" enviado como `pendingCharge: true` (a tela não monta a lista de classificações sozinha); filtro "Tratativa" (Sem tratativa, Enviada, Cobrada; múltipla escolha) enviado como `treatmentStatus`; coluna com o `TreatmentBadge`; perfil consulta sem coluna de seleção nem ações

### Implementation for User Story 4

- [X] T038 [US4] Em `apps/server/src/persistence/reservations-repo.ts`, filtro `treatmentStatus` com `EXISTS` sobre `treatment_documents` em `state = 'current'` (usa os índices de T009), filtro `pendingCharge` (classificações em que `acceptsTreatment` é verdadeiro — lista tirada do domínio, não repetida no SQL à mão — e sem comprovante atual) e `amount` também em `reservation_manual_amounts.amount`; repassar o parâmetro em `apps/server/src/http/handlers/reservations.ts`. Depende de T014, T036
- [X] T039 [US4] Em `apps/desktop/src/renderer/src/screens/reservations/ReservationFilters.tsx` e `ReservationsScreen.tsx`, o atalho "Falta cobrar", o filtro "Tratativa" e a coluna com o badge; repassar `treatmentStatus` e `pendingCharge` no canal `reservations.list` (`apps/desktop/src/main/ipc-handlers.ts`). Depende de T021, T037, T038
- [X] T040 [US4] Escrever e passar `apps/desktop/test/e2e/us4-consult.test.ts`: com chave de perfil consulta, filtrar por tratativa, abrir uma reserva Cobrada, ver documentos e histórico, baixar o arquivo e não encontrar nenhuma ação de registro. Depende de T039

**Checkpoint**: a Controladoria acompanha as tratativas pelo perfil consulta.

---

## Phase 6: User Story 3 - Aplicar o mesmo documento a várias reservas (Priority: P3)

**Goal**: o operador marca reservas em pesquisas diferentes sem perder a seleção, vê a lista
completa, aplica um documento a todas com confirmação (aceitas, ignoradas, substituições, total) e
recebe o desfecho de cada uma; só as que falharam continuam marcadas.

**Independent Test**: marcar 10 reservas em 10 pesquisas diferentes (2 já cobradas), conferir as 10
marcadas, aplicar um comprovante: 8 Cobradas, 2 ignoradas com o motivo, mesmo arquivo nas 8
(quickstart §5).

### Tests for User Story 3 ⚠️

- [X] T041 [P] [US3] Escrever `apps/server/test/contract/treatments-batch.test.ts`: `checkTreatmentDocuments` não grava nada e devolve desfecho por reserva, `acceptedCount`, `replacingCount`, `ignoredCount` e `acceptedTotalAmount`; reserva inexistente → `ignored`/`not_found`; 201 reservas → 400; `registerTreatmentDocuments` com aceitas, ignoradas e inexistentes → desfechos certos e um único `batchId` nos eventos; uma reserva que falha (gatilho de teste no banco que recusa a inserção para uma chave) → `failed` e as demais gravadas
- [X] T042 [P] [US3] Escrever `apps/desktop/test/renderer/selection.test.tsx` (US3 cenários 4 a 6, FR-006a): marcar, pesquisar de novo, trocar filtros e mudar de página mantém as marcas; reserva que reaparece vem marcada; barra com quantidade e total; "Ver seleção" lista também as que não estão no resultado, permite desmarcar e "Limpar seleção"; depois de aplicar, só as `failed` continuam marcadas; trocar de tela e voltar mantém a seleção; ao passar de 2 000 (inclusive pela caixa do cabeçalho), marca até o limite e mostra "Selecione no máximo 2 000 reservas" (FR-006a)
- [X] T043 [P] [US3] Ampliar `apps/desktop/test/main/treatments.test.ts`: `check` e `apply` com 450 reservas vão em 3 partes de no máximo 200, com resultado único e `failedKeys`; o arquivo é enviado uma vez só

### Implementation for User Story 3

- [X] T044 [US3] Em `apps/server/src/persistence/treatments-repo.ts` e `apps/server/src/http/handlers/treatments.ts`, implementar `checkTreatmentDocuments` (mesmas regras do registro, sem gravar; soma do valor total das aceitas). Depende de T026, T041
- [X] T045 [US3] Acrescentar `check` em `apps/desktop/src/main/treatments.ts` e as partes de 200 em `check` e `apply`; registrar no `ipc-handlers.ts`. Depende de T028, T043, T044
- [X] T046 [US3] Criar `apps/desktop/src/renderer/src/state/selection.tsx` (provider no `App.tsx`; mapa por hotel + número com número, hotel, hóspede, valor e situação; no máximo 2 000, com o aviso; só em memória — research R-09) e `apps/desktop/src/renderer/src/screens/reservations/SelectionDrawer.tsx`; em `ReservationsScreen.tsx`, coluna de seleção (marca as linhas pela chave), caixa do cabeçalho para a página e barra da seleção com "Ver seleção", "Anexar tratativa", "Anexar comprovante" e "Limpar". Depende de T039, T042
- [X] T047 [US3] No `AttachDialog.tsx`, modo lote: pré-visualização + resultado do `check` (aceitas, ignoradas com motivo, quantas substituem, total) → confirmar → resultado por reserva; atualizar a seleção para só as `failed`; com `retryable`, "Tentar de novo" reenvia só as reservas que faltaram, sem escolher o arquivo outra vez. Depende de T045, T046
- [X] T048 [US3] Escrever e passar `apps/desktop/test/e2e/us3-batch.test.ts`: 10 reservas marcadas em 10 pesquisas (por número, trocando hotel e período), 2 já cobradas; aplicar comprovante → 8 Cobradas, 2 ignoradas, seleção vazia; o arquivo baixado de duas delas é o mesmo (SC-002, SC-005). Depende de T047

**Checkpoint**: todas as histórias funcionam de forma independente.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T049 [P] Em `apps/server/src/maintenance/retention.ts`, acrescentar à rodada diária (research R-07): (1) documentos `replaced`/`removed` com `ended_at` há mais de 30 dias → `purged` (`file_sha256` e `original_name` nulos, `purged_at`); (2) documentos de reservas com `anonymized_at` preenchido → `purged`, inclusive os atuais, mantendo `treatment.status` e o valor manual (FR-016); (3) `treatment_files` sem documento e criados há mais de 24 h → apagados; contar cada passo no resultado do log; testes em `apps/server/test/integration/retention.test.ts` (prazo exato, atraso recuperado, órfão recente preservado, download de purgado → 410)
- [X] T050 [P] Em `apps/server/test/integration/backup-restore.test.ts`, gravar um documento antes da cópia e conferir, depois da restauração, que o arquivo baixado é idêntico e o histórico está completo (SC-007, FR-010)
- [X] T051 [P] Ampliar `apps/desktop/test/e2e/no-sensitive-data-on-disk.test.ts`: depois de escolher, pré-visualizar (PDF, imagem, .eml com HTML) e cancelar ou confirmar, a pasta de dados do app e a pasta temporária do usuário não têm cópia do documento (busca por um marcador único do conteúdo) e não houve requisição de rede da interface (SC-011, FR-018a)
- [X] T052 [P] Atualizar `README.md` (tratativas: quem registra e quem consulta, tipos e limite de 25 MB, 30 dias para reverter, retenção, as cópias de segurança passam a incluir os documentos e crescem com eles) e o `AGENTS.md` (estado do sistema: contrato 1.5.0 e tratativas; tabela de estrutura, se mudou)
- [X] T053 Rodar `pnpm typecheck`, `pnpm lint` e `pnpm test` (com o Docker) e corrigir o que falhar; conferir que `packages/contracts/openapi.yaml` e `specs/003-tratativas-manuais/contracts/openapi.yaml` estão idênticos e que a cópia da 002 continua na 1.4.0
- [X] T056 Preparar o ambiente de homologação ([quickstart.md](./quickstart.md) §2.1): `deploy/homolog/` com o arquivo do Compose que só acrescenta a porta do banco em `127.0.0.1` e o modelo de variáveis (portas, banco, volumes e cópias separados dos de produção; endereço do Hunit inválido, para o servidor de homologação nunca acessá-lo); `apps/desktop/test/homolog/homolog-prepare.test.ts`, desligado nas rodadas normais, que recusa banco com reservas, grava hotéis e reservas fictícios de todas as classificações e gera os arquivos de teste sintéticos (PDF, PNG, .eml, .msg, 26 MB, executável renomeado)
- [X] T054 ⛔ HOMOLOGAÇÃO Executar o [quickstart.md](./quickstart.md) §3 a §6 no **ambiente de homologação** (T056), nunca no banco de produção: pilha separada no PC do servidor, com dados fictícios; o app compilado aberto duas vezes, com pastas de dados próprias, uma com a chave de operador e outra com a de consulta; só arquivos de teste sem dados reais. Registrar em `specs/003-tratativas-manuais/research.md` ("Resultados da homologação") os tempos de SC-001, SC-002, SC-009 e SC-010, o tamanho da cópia de segurança antes e depois, e o resultado de cada passo. Depende de T056

---

## Phase 8: Ajustes da homologação — situação da reserva numa coluna só, alerta "Verificar" e histórico

**Purpose**: pendências da homologação (T054; spec, clarificações de 2026-11-16: FR-002, FR-002a,
FR-015, FR-017, FR-017a; research R-14). O contrato continua na 1.5.0, que não chegou à produção.

- [X] T057 [P] Em `packages/domain/src/treatment.ts`, acrescentar `ReservationSituation` (`proof_sent`, `treatment_sent` e as classificações), `reservationSituation(classification, status)` e `needsReview({ classification, status, statusChangedAt, lastReviewAt })` (R-14); testes em `packages/domain/test/treatment.test.ts` com a tabela do data-model §3 (inclusive confirmação anterior à última mudança e `statusChangedAt` nulo)
- [X] T058 [P] Em `packages/contracts/openapi.yaml` (1.5.0), acrescentar `ReservationSituation`, `situation` e `needsReview` em `ReservationTreatment`, `review_confirmed` e `classification` em `TreatmentEvent`, os filtros `situation` e `needsReview` em `GET /reservations` e `POST /reservations/{hotelCode}/{reservationNumber}/treatment/review` (api-changes §12); rodar o `generate` e copiar para `specs/003-tratativas-manuais/contracts/openapi.yaml`
- [X] T059 Em `apps/server/src/persistence/schema.ts`, acrescentar `review_confirmed` ao enum dos eventos e a coluna `classification` em `treatment_events`; gerar a migration com `db:generate --name=treatment_review`. Depende de T058
- [X] T060 No servidor, calcular `situation` e `needsReview` em toda `ReservationTreatment` (com `status_changed_at` e a última confirmação), os filtros `situation` e `needsReview` em `reservations-repo.ts` (mesma regra do domínio, em SQL) e a confirmação em `treatments-repo.ts` + handler + `OPERATOR_ONLY_OPERATIONS`; testes de contrato e integração (`server-db`): cada situação filtrada bate com a coluna, alerta depois de reclassificar, confirmar tira o alerta e grava o evento, nova mudança no Hunit faz o alerta voltar, sem alerta = 200 sem evento, perfil consulta = 403. Depende de T057, T059
- [X] T061 No app, processo principal e ponte: `treatments.confirmReview` (`main/treatments.ts`, `ipc-handlers.ts`, preload e `shared/ipc-types.ts`) e os filtros `situation` e `needsReview` em `reservations.list` (ipc.md); testes no grupo `desktop`. Depende de T058
- [X] T062 Na interface: nomes e cores de cada situação e do evento novo em `presentation/labels.ts`; um badge de situação com o alerta "Verificar"; na lista, a coluna única "Situação da reserva" no lugar de "Situação de cobrança" e "Tratativa"; nos filtros, "Situação da reserva" (único), "Ativa ou cancelada" (o antigo "Situação da reserva") e o atalho "A verificar"; no detalhe, a situação no topo e o campo "Status do Hunit" (com o motivo e a classificação anterior); na seção da tratativa, o alerta com o botão "Confirmar" (só operador) e o histórico com 5 itens e "Mostrar mais" (+10). Testes no grupo `desktop-ui`. Depende de T061
- [X] T063 Atualizar os E2E (`apps/desktop/test/e2e/`) aos nomes novos e acrescentar: reserva com tratativa reclassificada como "Já cobrada" no banco de teste → alerta na lista e no filtro "A verificar"; confirmar → alerta some e o histórico mostra a confirmação; histórico com mais de 5 itens → "Mostrar mais". Depende de T060, T062
- [X] T064 Atualizar o roteiro de captura (`screens-capture.test.ts`) e `.claude/skills/figma-screens-sync/references/screens.md` com as telas que mudaram (lista, filtros, detail, alerta, histórico) e rodar a skill `figma-screens-sync` para a página `003-tratativas-manuais`. Depende de T063
- [X] T065 Rodar `pnpm typecheck`, `pnpm lint` e `pnpm test` e corrigir o que falhar; conferir as duas cópias do `openapi.yaml`. Depende de T060 a T064
- [X] T066 ⛔ HOMOLOGAÇÃO dos ajustes: no ambiente de homologação (T056), com o servidor e o app atualizados, executar o [quickstart.md](./quickstart.md) §6.1 (situação da reserva, filtros, alerta e histórico) e registrar no `research.md`. Depende de T065

---

## Dependencies & Execution Order

### Phase Dependencies

- **Antes de tudo**: PR da 002 mesclado e a `master` trazida para a `003-tratativas-manuais`.
- **Setup (Phase 1)**: T001 → T002, T003 em paralelo.
- **Foundational (Phase 2)**: depende do Setup; bloqueia as histórias. Trilhas internas: contrato
  `T004`; domínio `T005, T006 → T007, T008`; banco `T004 + T008 → T009 → T013, T014`; servidor
  `T004 → T010 → T011`, `T004 → T012` e `T004 → T055` (logs sem a query; numerada depois das
  demais por ter vindo da análise, mas faz parte desta fase); app `T004 → T015 → T016 → T017, T018`, `T004 → T019`,
  `T015 → T020 → T021`.
- **US1 (Phase 3)**: depende da Phase 2. É o MVP.
- **US2 (Phase 4)**: depende da US1 (usa o registro, o diálogo e o detalhe: T026, T027, T029).
- **US4 (Phase 5)**: depende só da Phase 2 no servidor (T036, T038); a tela usa o badge (T021).
  Pode andar em paralelo com a US1/US2; o E2E (T040) precisa de documentos gravados, que o servidor
  de teste insere direto no banco.
- **US3 (Phase 6)**: depende da US1 (registro e diálogo) e da US4 (coluna e filtros da lista, T039).
- **Polish (Phase 7)**: T049 e T050 dependem de T026; T051 de T029; T056 de T053; T054 de tudo.
- **Ajustes da homologação (Phase 8)**: T057 e T058 em paralelo; T058 → T059 → T060 (com T057); T058 → T061 → T062; T060 + T062 → T063 → T064; T065 → T066.

### Within Each User Story

- Testes primeiro (devem falhar) → repositório → handler → processo principal → canais → telas →
  teste de ponta a ponta.
- Commit ao final de cada tarefa ou grupo lógico, em português, citando `specs/003` e o ID.

### Parallel Opportunities

- Phase 1: T002 e T003.
- Phase 2: T005 e T006; T007 e T008; T010–T012 em paralelo com T013–T014; trilha do app (T015–T021)
  em paralelo com a do servidor depois de T004.
- US1: T022, T023, T024 e T025 (testes) em paralelo; servidor (T026, T027) em paralelo com o
  principal do app (T028) até o T029.
- US2: T031 e T032.
- US4: T036 e T037; a US4 inteira em paralelo com a US2.
- US3: T041, T042 e T043; T044 (servidor) em paralelo com T046 (seleção).
- Polish: T049, T050, T051 e T052.

---

## Parallel Example: User Story 1

```text
# Testes da US1 juntos:
Task: "T022 Contrato do envio, registro, reversão, valor manual e download em apps/server/test/contract/treatments-us1.test.ts"
Task: "T023 Concorrência, coleta e zero chamadas ao Hunit em apps/server/test/integration/treatments-repo.test.ts"
Task: "T024 apply e saveDocument em apps/desktop/test/main/treatments.test.ts"
Task: "T025 Diálogo de anexar e detalhe em apps/desktop/test/renderer/attach-dialog.test.tsx"

# Servidor e app em paralelo (depois dos testes):
Task: "T026 apps/server/src/persistence/treatments-repo.ts"
Task: "T028 apps/desktop/src/main/treatments.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 e Phase 2: contrato, domínio, tabelas e pré-visualização.
2. Phase 3 (US1): comprovante, substituir, reverter, valor manual, download.
3. **Parar e validar**: E2E T030 e o quickstart §3. Com isso o Financeiro já marca o que foi cobrado.

### Incremental Delivery

1. Setup + Foundational → base pronta.
2. US1 → MVP (comprovante → "Cobrada").
3. US2 → tratativa → "Enviada", desfazer.
4. US4 → filtro por tratativa e consulta pela Controladoria.
5. US3 → lote com a seleção que não se perde.
6. Polish → retenção, cópia e restauração, varredura de disco, documentação e homologação (T054).

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- O app não tem regra de negócio (constitution, princípio III): elegibilidade, situação, prazo de
  reversão e totais vêm do servidor.
- Nenhuma tarefa acessa o Hunit; um teste garante que as tratativas não chamam o `HunitGateway`.
- Arquivos de teste (PDF, imagens, `.eml`, `.msg`) são gerados no próprio teste, sem dados de
  hóspedes, hotéis ou da empresa.
- Antes de cada commit, conferir `git diff --cached --name-only` em busca de arquivos sensíveis.
