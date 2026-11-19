# Implementation Plan: Importação do histórico do sistema anterior

**Branch**: `004-importacao-historico` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-importacao-historico/spec.md`

## Summary

Quem administra a implantação importa, uma vez e de forma repetível, o histórico do sistema anterior
(cópia .xlsx da planilha, com as abas "Reservas" e "Tratativas", e a pasta de anexos) para o HUNIT
Control, por um comando no servidor. Antes, uma simulação mostra o que seria criado, atualizado,
ignorado ou recusado, e por quê, sem dado pessoal. As reservas importadas ficam marcadas como
"Sistema anterior". As tratativas e os comprovantes viram tratativas da 003. Nada acessa o Hunit.

Abordagem técnica (detalhes em [research.md](./research.md)):

- **Comando `legacy-import`** no `cli.ts` do servidor (`simulate`, `hotels`, `run`, `report`), rodado
  num container de uso único com a pasta montada só para leitura; um *advisory lock* garante uma
  importação por vez (R-01).
- **Leitura do .xlsx** com `read-excel-file` (nova dependência do servidor); a interpretação de
  datas, valores e sim/não fica em funções puras do domínio (R-02, R-03).
- **"A revisar (sistema anterior)"** reaproveita o valor obsoleto `not_virtual_card`. Ele passa a
  aceitar tratativa e sai do "Falta cobrar" com a função nova `requiresCharge` (R-04). Nenhum valor
  novo de enum.
- **Autor reservado `sistema-anterior`** (revogado, sem chave) nos registros de tratativa importados,
  com a data original e `legacy_import_id` (R-05).
- **Reservas sem execução**: `last_execution_id` passa a anulável. A origem fica em
  `legacy_reservations`, e a regra de precedência (FR-010) é uma função pura. O coletor não muda e a
  ordem entre importação e coleta não altera o resultado (R-06).
- **Documentos** pela mesma conferência e guarda da 003, com deduplicação, regra do anexo antigo,
  precedência do HUNIT Control e caminho preso à pasta montada (R-07).
- **Simulação com impressão digital**: a importação só confirma a simulação feita com a mesma
  planilha, os mesmos arquivos e a mesma associação de hotéis. Uma transação por reserva (R-08, R-09).
- **Contrato 1.5.0 → 1.6.0**, só acréscimos: `Reservation.legacy`, filtro `fromLegacy` e `fromLegacy`
  nos documentos e eventos ([contracts/api-changes.md](./contracts/api-changes.md)).
- **App**: selo "Sistema anterior", filtro "Origem", seção no detalhe, autor no histórico e o nome
  "A revisar (sistema anterior)" (R-13).

## Technical Context

**Language/Version**: TypeScript 5.9 (`strict`), Node 24 no servidor; Electron 45 no app (sem
mudança de versão)

**Primary Dependencies**: servidor — `read-excel-file` 9 (leitura do .xlsx, R-02), em
`dependencies`; `write-excel-file` 4 em `devDependencies`, só para gerar planilhas fictícias nos
testes. App — nenhuma nova

**Storage**: PostgreSQL da 001/003 — 3 tabelas e 3 enums novos, `last_execution_id` anulável e
`legacy_import_id` em 3 tabelas da 003, numa migration gerada pelo `db:generate`. Documentos
importados em `treatment_files` (bytea), como na 003. Nenhum arquivo em disco (a pasta de origem é
montada só para leitura e apagada depois)

**Testing**: Vitest nos grupos existentes — `domain`, `server-db` (simulação, importação, coletor,
retenção, contrato, cópia e restauração, marcadores), `desktop-ui`; planilha fictícia gerada no
teste (R-14)

**Target Platform**: servidor Linux em container (PC de produção); comando rodado com `docker
compose run`; app Windows 10/11 x64

**Project Type**: web-service (comando administrativo + acréscimos compatíveis na API) + desktop-app
cliente

**Performance Goals**: simulação de 20 000 linhas e 2 000 documentos em até 5 min; importação em até
15 min (SC-008)

**Constraints**: zero acessos ao Hunit (SC-005); nenhum dado pessoal em logs, saída ou relatório
(FR-018, SC-006); tudo ou nada por reserva (FR-021); simulação não grava (SC-002); reimportação
idempotente (SC-003); documentos da 003 nos tipos e no limite de 25 MiB (FR-013); nada fora da pasta
montada é lido (R-07)

**Scale/Scope**: alguns milhares de reservas e centenas de documentos (alguns meses do sistema
anterior); 1 comando com 4 subcomandos; 1 filtro e 3 campos novos na API; 1 tela alterada no app
(Reservas: lista, filtros, detalhe)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Princípio | Avaliação | Status |
|---|---|---|---|
| I | Spec-First | Spec 004 escrita e clarificada (4 decisões em 2026-11-16). Os dois ajustes que o plano revelou foram feitos **antes** na spec: "Saida" e "Total da reserva" obrigatórias (colunas sem valor padrão no banco) e a situação de "A revisar" com só tratativa (FR-007a) | ✅ |
| II | Isolamento do Hunit | A importação não usa a camada do Hunit nem o `HunitGateway`; um teste confere zero chamadas (SC-005). Nenhuma rota nova no `read-only-guard` | ✅ |
| III | API-First com Contrato | Tudo o que os clientes usam (marcação, filtro, origem dos registros) entra antes no `openapi.yaml` 1.6.0, só com acréscimos. A importação é um **comando administrativo de implantação** (exceção do princípio III, constitution 1.2.0), decidido na clarificação (FR-002). Cumpre as três condições: não é usada pelos clientes, não acessa o Hunit e tudo o que grava (reservas, tratativas, documentos) fica visível pela API. O app só apresenta os campos novos | ✅ |
| IV | Jobs Assíncronos | Não se aplica: nenhuma automação do Hunit nova. A exclusão mútua das importações usa um *advisory lock*, sem estado preso (R-01) | ✅ |
| V | Servidor Central e Containers | Roda na imagem do `server`, configurado só por `DATABASE_URL`. A pasta de origem é uma entrada só de leitura montada num container de uso único, não estado. Nenhum volume nem variável de ambiente nova | ✅ |
| VI | Dados e Segurança | PostgreSQL continua a fonte da verdade e a planilha é só entrada (lida uma vez, da cópia). Relatórios e logs só com códigos, linhas e números de reserva (R-11), e a planilha e a pasta nunca entram no Git (`*.xlsx` já ignorado). O autor reservado não tem credencial (R-05). Os dados importados entram nas cópias cifradas e na retenção | ✅ |
| VII | Testes em Camadas | Domínio com testes unitários (valores, conversão, precedência); banco com testes de integração; contrato 1.6.0 com teste; teste de marcadores para SC-006 | ✅ |
| VIII | Simplicidade | Uma dependência nova (leitura de .xlsx), sem serviço, fila ou rota nova; reaproveita `not_virtual_card`, a guarda de documentos e o autor das tabelas da 003 em vez de criar estruturas paralelas | ✅ |

**Resultado pré-Fase 0**: aprovado.

**Resultado pós-Fase 1** (após data-model e contratos): aprovado. Nenhuma operação de escrita nova
na API. Os campos novos não expõem dados que o perfil consulta já não visse. A única entrada de
arquivos externos é local, só para leitura e presa à pasta montada, e passa pela mesma conferência
de tipo da 003.

## Project Structure

### Documentation (this feature)

```text
specs/004-importacao-historico/
├── spec.md              # especificação (/speckit-specify + clarificações)
├── plan.md              # este arquivo
├── research.md          # decisões técnicas (Fase 0)
├── data-model.md        # tabelas, mapeamento das colunas, motivos, "A revisar" (Fase 1)
├── quickstart.md        # testes, homologação e importação real (Fase 1)
├── contracts/
│   ├── api-changes.md   # acréscimos à API 1.5.0 → 1.6.0 (Fase 1)
│   ├── cli.md           # comando legacy-import (Fase 1)
│   ├── ipc.md           # acréscimos à ponte do app (Fase 1)
│   └── openapi.yaml     # espelho do contrato 1.6.0 (criado na implementação)
├── checklists/
│   └── requirements.md  # checklist de qualidade da spec
└── tasks.md             # Fase 2 (/speckit-tasks — não criado por este comando)
```

### Source Code (repository root)

```text
packages/domain/src/
├── legacy-values.ts                # NOVO — datas (Brasília), dinheiro, inteiros, sim/não (R-03)
├── legacy-import.ts                # NOVO — colunas, conversão, linha → reserva, precedência, anexo antigo, nomes de hotel, motivos (R-04, R-06, R-07, R-10)
├── treatment.ts                    # requiresCharge; not_virtual_card aceita tratativa; situação e alerta (R-04)
├── types.ts                        # documentação de not_virtual_card
└── index.ts
packages/domain/test/               # legacy-values.test.ts, legacy-import.test.ts, treatment.test.ts

packages/contracts/openapi.yaml     # 1.6.0 (+ src/generated.ts regenerado)

apps/server/src/
├── cli.ts                          # subcomando legacy-import; create-client recusa "sistema-anterior"
├── legacy-import/                  # NOVO
│   ├── command.ts                  # argumentos, lock, saída no terminal (só códigos e contagens)
│   ├── workbook.ts                 # read-excel-file → linhas por nome de coluna
│   ├── attachments.ts              # caminho preso à pasta, busca por nome, SHA-256, conferência da 003
│   ├── planner.ts                  # desfecho de cada linha e documento (usado por simulate e run)
│   ├── applier.ts                  # grava reserva a reserva (transação, FOR UPDATE)
│   ├── fingerprint.ts              # impressão digital (R-08)
│   └── report.ts                   # relatório em texto a partir de legacy_imports
├── persistence/
│   ├── schema.ts                   # 3 tabelas, 3 enums, last_execution_id anulável, legacy_import_id
│   ├── legacy-import-repo.ts       # NOVO — legacy_imports, legacy_hotel_mappings, legacy_reservations, autor reservado
│   ├── reservations-repo.ts        # filtro fromLegacy; join com legacy_reservations; CLASSIFICATIONS_REQUIRING_CHARGE
│   ├── treatments-repo.ts          # fromLegacy em documentos e eventos
│   └── migrations/                 # 0009 gerada pelo db:generate
├── http/views.ts                   # Reservation.legacy, fromLegacy, lastExecutionId opcional
└── maintenance/retention.ts        # sem mudança de regra (importados seguem a retenção); conferido por teste
apps/server/package.json            # read-excel-file; script legacy-import
apps/server/test/
├── contract/reservations.test.ts   # fromLegacy, legacy
├── integration/legacy-import*.test.ts   # simulação, importação, reimportação, coletor, retenção, marcadores, lock
└── (cópia e restauração)           # ganha uma reserva importada com documento

apps/desktop/src/
├── shared/ipc-schemas.ts, ipc-types.ts      # fromLegacy (contracts/ipc.md)
├── main/api-client.ts                        # fromLegacy na query
└── renderer/src/
    ├── presentation/labels.ts                # "A revisar (sistema anterior)", nomes do sistema anterior, "Sistema anterior"
    ├── components/LegacyBadge.tsx            # NOVO — selo "Sistema anterior"
    └── screens/reservations/
        ├── ReservationsScreen.tsx            # selo na lista
        ├── ReservationFilters.tsx            # filtro "Origem"
        ├── ReservationDetail.tsx             # seção "Sistema anterior"
        └── TreatmentSection.tsx              # autor "Sistema anterior" no histórico
apps/desktop/test/                            # renderer/ (desktop-ui); e2e/screens-capture ganha uma importada

AGENTS.md                           # comando legacy-import, contrato 1.6.0, espelho em specs/004
README.md                           # passo a passo da importação real (quickstart §3)
```

**Structure Decision**: nenhum pacote ou app novo. O comando fica no `apps/server`, numa pasta
própria (`legacy-import/`), porque usa o banco e o sistema de arquivos. As regras de interpretação,
conversão e precedência ficam em `packages/domain`, onde o ESLint já impede I/O. O app só ganha
apresentação.

## Fluxo de referência: simular e importar

```text
Administrador (terminal)          Comando legacy-import                     PostgreSQL
────────────────────────          ─────────────────────                     ──────────
simulate --xlsx --files ────────► advisory lock (uma por vez) ─────────────► pg_try_advisory_lock
                                  workbook: abas e colunas (FR-003)
                                  domínio: valores, conversão, linha → reserva
                                  attachments: caminho na pasta, SHA-256, tipo
                                  planner: desfecho por linha/documento ◄──── leitura: reservas, docs, mapeamentos
                                  fingerprint ─────────────────────────────► legacy_imports (simulation)
relatório + id ◄──────────────────
hotels --accept-proposals ──────► ──────────────────────────────────────────► legacy_hotel_mappings
simulate (de novo) …
run --simulation <id> ──────────► fingerprint == simulação? senão recusa
                                  por reserva: transação, FOR UPDATE ──────► reservations, legacy_reservations,
                                  planner + applier                          treatment_files/documents/events,
                                                                             reservation_manual_amounts
relatório + diferenças ◄────────── ────────────────────────────────────────► legacy_imports (import)
```

## Riscos e dependências

| Risco | Impacto | Mitigação |
|---|---|---|
| Datas da cópia .xlsx em formato inesperado | Linhas recusadas em massa | Aceita `Date`, número de série, ISO e `DD/MM/AAAA` (R-03); a simulação mostra antes; ajuste no domínio e nova simulação |
| Pasta de anexos copiada de outro nível | Documentos "não encontrados" | Busca pelo nome do arquivo quando o caminho não existe (R-07) |
| Hotel associado errado | Milhares de reservas no hotel errado | Só associações confirmadas valem; simulação mostra as contagens por hotel antes (R-10) |
| `not_virtual_card` gravado antes da R-22 | Reserva antiga aparecendo como "A revisar" | Aviso na simulação com a contagem (R-04); a R-22 registrou que não há |
| Importação longa com execução no Hunit ao mesmo tempo | Travas e resultado dependente da ordem | Transação por reserva e regra de precedência independente da ordem, conferida por teste (R-06, R-09) |
| Banco cresce com os documentos importados | Cópias maiores | Deduplicação; medir o tamanho da cópia antes e depois na homologação |
| `read-excel-file` com mudanças frequentes | Versão nova quebrar a leitura | Versão fixada pelo lock; teste com planilha gerada cobre as abas e os tipos de célula |

## Complexity Tracking

Nenhuma violação da constitution a justificar.
