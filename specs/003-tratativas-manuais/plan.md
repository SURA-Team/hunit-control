# Implementation Plan: Tratativas manuais das reservas

**Branch**: `003-tratativas-manuais` | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-tratativas-manuais/spec.md`

## Summary

O Financeiro (perfil operador) passa a registrar, por reserva, a **tratativa** (pedido de cobrança
ao Comercial → "Enviada") e o **comprovante** (→ "Cobrada"), substituir, desfazer e reverter esses
documentos por 30 dias, informar o valor cobrado à mão e aplicar o mesmo documento a várias
reservas de uma vez. A Controladoria (perfil consulta) filtra pela situação da tratativa e baixa os
documentos. Nada disso toca o Hunit.

Abordagem técnica (detalhes em [research.md](./research.md)):

- **Documentos no PostgreSQL** (`bytea`, deduplicados pelo SHA-256): entram na cópia de segurança e
  na restauração que já existem, e registro e arquivo são gravados na mesma transação (R-01).
- **Envio em duas etapas**: o arquivo vai uma vez (`POST /treatment-files`, corpo binário só nessa
  rota, até 25 MiB) e é registrado em 1 a 200 reservas por pedido, cada uma na sua transação, com
  desfecho por reserva; antes, um `check` sem gravar mostra quem aceita e o total (R-02, R-05).
- **Regras no domínio**: tipo do arquivo pelo conteúdo, elegibilidade por classificação, situação
  derivada, prazo de reversão e valor efetivo são funções puras de `@hunit/domain` (R-03, R-04).
- **Camada ao lado da reserva**: tabelas novas (`treatment_files`, `treatment_documents`,
  `reservation_manual_amounts`, `treatment_events`); `reservations` e o coletor não mudam, então
  uma nova verificação não toca nas tratativas (FR-007).
- **Retenção** na rotina diária existente: purga 30 dias depois de substituído ou desfeito, purga
  na anonimização dos 5 anos e limpeza de arquivos órfãos (R-07).
- **App**: pré-visualização montada em memória no processo principal (pdf.js, `postal-mime`,
  `@kenjiuno/msgreader`), sem rede nem cópia em disco; seleção do lote guardada fora do resultado
  da pesquisa, para não se perder ao pesquisar de novo (R-08, R-09).
- **"Falta cobrar"**: filtro do servidor (`pendingCharge`) com as reservas que exigem cobrança e
  ainda não têm comprovante; o filtro por classificação continua mostrando o que o Hunit informou
  (FR-002).
- **Logs sem a query das requisições**: o nome do arquivo e a busca livre (que pode ter o nome do
  hóspede, desde a 002) deixam de ir para o log do servidor (R-13).
- **Contrato 1.4.0 → 1.5.0**, só acréscimos ([contracts/api-changes.md](./contracts/api-changes.md)).

## Technical Context

**Language/Version**: TypeScript 5.9 (`strict`), Node 24 no servidor; Electron 45 no app (sem
mudança de versão)

**Primary Dependencies**: servidor — nenhuma nova (Fastify 5, fastify-openapi-glue, Drizzle,
`node:crypto` para o SHA-256). App — `pdfjs-dist` 6 (PDF), `postal-mime` 4 (.eml) e
`@kenjiuno/msgreader` 1 (.msg), em `devDependencies` e empacotadas pelo Vite (R-08)

**Storage**: PostgreSQL da 001 — 4 tabelas novas e 3 enums, numa migration nova gerada pelo
`db:generate`; conteúdo em `bytea`. App — nada em disco (seleção e arquivo escolhido só em memória)

**Testing**: Vitest nos grupos existentes — `domain`, `server-db` (contrato, perfis, lote,
concorrência, retenção, cópia e restauração), `desktop`, `desktop-ui` e `desktop-e2e` (R-11)

**Target Platform**: servidor Linux em container (PC de produção, depois AWS); app Windows 10/11 x64

**Project Type**: web-service (acréscimos compatíveis) + desktop-app cliente

**Performance Goals**: pré-visualização em até 3 s para 25 MB (SC-010); filtro "pendente + sem
tratativa" em até 5 s (SC-008, com índices em `treatment_documents`); lote de 20 reservas em até
2 min com a confirmação (SC-002); reverter em até 30 s (SC-009)

**Constraints**: zero requisições ao Hunit (FR-007, SC-003); documentos só para clientes
autorizados, nas cópias cifradas (FR-010); tudo ou nada por reserva (FR-011); nada da
pré-visualização em disco nem na rede (FR-018a, SC-011); app sem regra de negócio (princípio III);
arquivo de até 25 MiB nos tipos .eml, .msg, .pdf, .png, .jpg, .jpeg (FR-008)

**Scale/Scope**: dezenas de documentos por semana, até 25 MB cada (alguns GB em 5 anos no pior
caso); 2 a 4 operadores do Financeiro e a Controladoria em consulta; 9 operações novas na API (e um filtro
novo), 10 canais novos na ponte; 1 tela alterada (Reservas: lista, detalhe, seleção) e 2 componentes novos
(pré-visualização, confirmação do lote)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Princípio | Avaliação | Status |
|---|---|---|---|
| I | Spec-First | Spec 003 escrita e clarificada (5 decisões em 2026-11-13) antes deste plano; nada no plano contradiz a spec | ✅ |
| II | Isolamento do Hunit | Nenhuma operação nova chama a camada do Hunit; o `read-only-guard` não muda; um teste confere zero chamadas ao `HunitGateway` (SC-003) | ✅ |
| III | API-First com Contrato | Tudo entra antes no `openapi.yaml` 1.5.0 (só acréscimos); o app usa a API pelos tipos gerados; elegibilidade, situação, prazo e total vêm do servidor — o app só apresenta (R-04, contracts/ipc.md) | ✅ |
| IV | Jobs Assíncronos | Não se aplica: registros são operações curtas e síncronas; nenhum job novo, nenhum estado de execução muda | ✅ |
| V | Servidor Central e Containers | Documentos no PostgreSQL, sem volume novo; nenhuma variável de ambiente nova (limites fixados pela spec) | ✅ |
| VI | Dados e Segurança | PostgreSQL é a fonte da verdade, inclusive dos arquivos; documentos só com chave válida, nas cópias cifradas; nomes de arquivo apagados na purga; pré-visualização sem rede nem disco; download com `nosniff` e `sandbox`; nenhum documento de teste com dados reais | ✅ |
| VII | Testes em Camadas | Domínio com testes unitários; cada operação com teste de contrato; retenção e restauração com teste de banco; app com testes do principal, da interface e ponta a ponta (R-11) | ✅ |
| VIII | Simplicidade | Sem serviço de arquivos, sem multipart, sem fila; três bibliotecas novas só no app, cada uma justificada (R-08); o `check` existe porque a confirmação do lote precisa da regra do servidor | ✅ |

**Resultado pré-Fase 0**: aprovado. **Resultado pós-Fase 1** (após data-model e contratos):
aprovado — todas as operações de escrita estão restritas ao operador; nenhuma resposta devolve
credenciais; o conteúdo dos documentos só sai por uma rota autenticada com cabeçalhos que impedem
execução; a única abertura nova no servidor (corpo binário) vale para uma rota só, com limite
próprio (R-03).

## Project Structure

### Documentation (this feature)

```text
specs/003-tratativas-manuais/
├── spec.md              # especificação (/speckit-specify + clarificações)
├── plan.md              # este arquivo
├── research.md          # decisões técnicas (Fase 0)
├── data-model.md        # tabelas, estados, elegibilidade, nomes no app (Fase 1)
├── quickstart.md        # roteiro de validação e homologação (Fase 1)
├── contracts/
│   ├── api-changes.md   # acréscimos à API 1.4.0 → 1.5.0 (Fase 1)
│   ├── ipc.md           # acréscimos à ponte do app (Fase 1)
│   └── openapi.yaml     # espelho do contrato 1.5.0 (criado na implementação, R-12)
├── checklists/
│   └── requirements.md  # checklist de qualidade da spec
└── tasks.md             # Fase 2 (/speckit-tasks — não criado por este comando)
```

### Source Code (repository root)

```text
packages/domain/src/
├── treatment.ts                    # NOVO — elegibilidade, situação, prazo de reversão, valor efetivo (R-04)
├── document-type.ts                # NOVO — tipo pelo conteúdo + extensão, limites (R-03)
└── index.ts                        # exporta os dois
packages/domain/test/               # treatment.test.ts, document-type.test.ts

packages/contracts/openapi.yaml     # 1.5.0 (+ src/generated.ts regenerado)

apps/server/src/
├── persistence/
│   ├── schema.ts                   # 4 tabelas e 3 enums novos (data-model §1)
│   ├── treatments-repo.ts          # NOVO — registrar (transação por reserva), desfazer, reverter, valor, histórico
│   ├── treatment-files-repo.ts     # NOVO — gravar com deduplicação, ler conteúdo
│   ├── reservations-repo.ts        # filtros treatmentStatus e pendingCharge; amount também no valor manual; resumo da tratativa
│   └── migrations/                 # 0007 gerada pelo db:generate
├── http/
│   ├── app.ts                      # leitor de application/octet-stream só na rota de envio, limite de 25 MiB (R-03)
│   ├── auth.ts                     # operações novas em OPERATOR_ONLY_OPERATIONS
│   ├── problem.ts                  # códigos novos (api-changes §1)
│   ├── views.ts                    # Reservation.treatment, TreatmentDocument, TreatmentEvent
│   └── handlers/treatments.ts      # NOVO — as 9 operações
├── maintenance/retention.ts        # purga de 30 dias, purga na anonimização, órfãos (R-07)
└── logging.ts                      # requisições registradas sem a query: nome do arquivo e busca fora do log (R-13)
apps/server/test/
├── contract/treatments.test.ts     # NOVO
├── integration/                    # retenção, concorrência, coletor não toca as tratativas
└── (teste de cópia e restauração)  # ganha um documento (SC-007)

apps/desktop/src/
├── shared/ipc-channels.ts, ipc-schemas.ts, ipc-types.ts   # área treatments (contracts/ipc.md)
├── main/
│   ├── picked-files.ts             # NOVO — diálogo, leitura em memória, expiração em 15 min (R-08)
│   ├── document-preview.ts         # NOVO — .eml (postal-mime) e .msg (msgreader) → modelo; PDF/imagem → bytes
│   ├── treatments.ts               # NOVO — check/apply em partes de 200, download com "Salvar como"
│   ├── api-client.ts               # envio binário e operações novas
│   └── ipc-handlers.ts             # registra os canais novos
└── renderer/src/
    ├── state/selection.tsx         # NOVO — seleção do lote fora do resultado da pesquisa (R-09)
    ├── components/DocumentPreview.tsx      # NOVO — PDF (pdf.js), imagem (blob:), e-mail (iframe isolado)
    ├── components/TreatmentBadge.tsx       # NOVO — Enviada / Cobrada
    ├── screens/reservations/
    │   ├── ReservationsScreen.tsx  # coluna de seleção, barra da seleção, filtro de tratativa
    │   ├── ReservationFilters.tsx  # filtro treatmentStatus
    │   ├── ReservationDetail.tsx   # documentos, histórico, ações, valor manual
    │   ├── SelectionDrawer.tsx     # NOVO — lista completa da seleção
    │   └── AttachDialog.tsx        # NOVO — escolha → pré-visualização → check → confirmação → resultado
    ├── presentation/labels.ts      # nomes de data-model §7
    └── index.html                  # CSP: img-src blob:, worker-src 'self'
apps/desktop/test/                  # main/, renderer/, e2e/ (R-11)

AGENTS.md                           # contrato 1.5.0, espelho em specs/003 (R-12)
```

**Structure Decision**: a feature não cria pacotes nem apps: acrescenta tabelas, handlers e a rotina
de retenção ao `apps/server`, regras puras ao `packages/domain` (onde o ESLint já impede I/O) e
componentes à tela de Reservas do `apps/desktop`. A divisão de processos do app (R-02 da 002) se
mantém: arquivo, disco e rede no principal; a interface só desenha.

## Fluxo de referência: aplicar um comprovante a várias reservas

```text
Interface                          Processo principal                       Servidor
─────────                          ──────────────────                       ────────
seleção (N reservas, em memória)
treatments.pickFile(proof) ──────► diálogo → lê em memória → preview
PickedFile (preview) ◄────────────
mostra pré-visualização
treatments.check(proof, N) ──────► POST /treatment-documents/check (×⌈N/200⌉) ─► domínio: elegível? já tem?
confirmação: aceitas, ignoradas, ◄─ soma das partes ◄──────────────────────────
total, quantas substituem
[Confirmar]
treatments.apply(sel, proof, N) ─► POST /treatment-files (bytes) ───────────► confere tipo, SHA-256, grava
                                   POST /treatment-documents (×⌈N/200⌉) ────► por reserva: trava, confere,
                                                                               encerra atual, grava, evento
ApplyResult ◄────────────────────── libera a memória ◄──────────────────────── desfecho por reserva
resultado; seleção = só as failed
GET da lista (TanStack Query)
```

## Riscos e dependências

| Risco | Impacto | Mitigação |
|---|---|---|
| `.msg` que a biblioteca não lê | Sem pré-visualização desse e-mail | Aviso "não foi possível pré-visualizar" com confirmação (FR-018a); fixtures sintéticas variadas no teste (R-08) |
| Banco cresce com os documentos | Cópias maiores e mais lentas | Deduplicação; purga em 30 dias e aos 5 anos; medir o tamanho da cópia na homologação |
| Corpo binário abre uma porta nova no servidor | Abuso de memória ou tipo inesperado | Só uma rota, só operador, limite de 25 MiB nela, conteúdo conferido antes de gravar (R-03) |
| HTML de e-mail com rastreadores ou scripts | Vazamento ou execução | `iframe` com `sandbox=""` e CSP `default-src 'none'`; teste ponta a ponta sem acesso à rede (SC-011) |
| Seleção grande (centenas) | Pedidos grandes | Partes de 200 com resultado único (R-05) |
| PR da 002 (#1) ainda sem merge | Base da branch diferente da `master` | A 003 parte da `002-app-desktop`; fazer o merge da 002 antes de abrir o PR da 003 |

## Complexity Tracking

Nenhuma violação da constitution a justificar.
