# Implementation Plan: Consulta de Reservas de Cartão Virtual no Hunit

**Branch**: `001-consulta-reservas-hunit` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-consulta-reservas-hunit/spec.md`

## Summary

Reconstruir o núcleo da automação HUNIT como um serviço HTTP em container: um cliente autorizado
inicia uma execução, o serviço faz login no Hunit com Playwright/Chromium, pausa aguardando o token
2FA enviado por um operador, percorre hotéis e páginas de reservas (filtros fixos da FR-010,
períodos retroativos), extrai de cada reserva um `ReservationSnapshot` neutro e o classifica com
regras de domínio puras. Os resultados são gravados por hotel em PostgreSQL, com histórico de
verificação, e expostos por uma API contract-first (OpenAPI) com acompanhamento em tempo real (SSE).

Decisões centrais (detalhes em [research.md](./research.md)): API e automação no **mesmo processo**,
para que credenciais e token nunca saiam da memória (R-02); **Page Objects** separados do **domínio**
para que mudanças de tela do Hunit não toquem regras de negócio (R-06); processamento **sequencial**
por padrão, porque a seleção de hotel no Hunit parece ser estado de sessão (R-08).

## Technical Context

**Language/Version**: TypeScript 5.x (`strict`) sobre Node.js 24 LTS

**Primary Dependencies**: Fastify 5, fastify-openapi-glue, openapi-typescript, Playwright
(Chromium), Drizzle ORM + drizzle-kit, Pino

**Storage**: PostgreSQL 17 (dados); volume Docker `/data/evidence` (capturas e HTML sanitizado)

**Testing**: Vitest; Playwright (Chromium) contra fixtures HTML; `fastify.inject` + validação
contra OpenAPI; Testcontainers (PostgreSQL)

**Target Platform**: servidor Linux com Docker Compose (imagem base oficial do Playwright)

**Project Type**: web-service (API) com automação de navegador; monorepo pnpm

**Performance Goals**: rotina (todos os hotéis × 1 semana) ≤ 1 h sequencial, ≤ 30 min se o
paralelismo for validado (SC-009); aviso de token ≤ 5 s (SC-005); cancelamento ≤ 15 s (SC-008)

**Constraints**: credenciais/token só em memória (FR-005); nenhuma ação de escrita no Hunit
(FR-012); uma execução ativa por conta (FR-006); janela do token ~1–2 min (FR-004)

**Scale/Scope**: dezenas de hotéis; centenas a poucos milhares de reservas por semana; consultas
retroativas de meses; poucos clientes (desktop, Sura)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Princípio | Avaliação | Status |
|---|---|---|---|
| I | Spec-First | Spec 001 aprovada e clarificada (5 perguntas) antes deste plano | ✅ |
| II | Isolamento da UI do Hunit | Seletores só em `apps/server/src/hunit/`; domínio recebe `ReservationSnapshot` neutro (R-06); falhas de tela geram `hunit_screen_not_recognized` + evidência (FR-024) | ✅ |
| III | API-First com Contrato | `openapi.yaml` contract-first; tipos gerados para servidor e futuro Electron (R-03) | ✅ |
| IV | Jobs Assíncronos com Intervenção Humana | Estados `queued…cancelled` + `awaiting_2fa`; retomada por hotel; índice único parcial por conta (data-model) | ✅ |
| V | Servidor Central e Containers | `server` + `db` em Docker Compose; config só por env; estado só em volumes declarados (R-18) | ✅ |
| VI | Dados e Segurança | Postgres fonte da verdade; sem credenciais/token/sessão persistidos; chaves de API com hash; redação de logs e máscara em evidências (R-10–R-12); retenção e anonimização (R-16) | ✅ |
| VII | Testes em Camadas | Unitários de domínio, Page Objects contra fixtures anonimizadas, contrato contra OpenAPI, teste automatizado de SC-004 (R-14) | ✅ |
| VIII | Simplicidade | 2 containers, sem fila/Redis/object storage; paralelismo desligado até ser validado | ✅ |

**Nota sobre o princípio V**: a constitution lista "API, worker e PostgreSQL" em containers. Aqui
API e worker são módulos do **mesmo** container `server`. Isso cumpre o princípio (tudo em
containers) e é exigido pelo princípio VI/FR-005 (R-02). Não é violação; se a operação precisar
escalar a automação no futuro, a separação vira uma emenda/spec própria.

**Resultado pré-Fase 0**: aprovado. **Resultado pós-Fase 1** (após data-model e contrato):
aprovado — nenhuma entidade ou endpoint armazena ou devolve credenciais; `HunitCredentials` e
`token` são `writeOnly`; nenhum endpoint executa ação no Hunit fora do fluxo de leitura.

## Project Structure

### Documentation (this feature)

```text
specs/001-consulta-reservas-hunit/
├── spec.md              # O quê e por quê (+ Clarifications)
├── plan.md              # Este arquivo
├── research.md          # Fase 0: decisões técnicas (R-01…R-18)
├── data-model.md        # Fase 1: tabelas, enums, transições
├── quickstart.md        # Fase 1: guia de validação ponta a ponta
├── contracts/
│   └── openapi.yaml     # Fase 1: contrato da API v1
├── checklists/
│   └── requirements.md  # Qualidade da spec
└── tasks.md             # Fase 2 (/speckit-tasks — ainda não criado)
```

### Source Code (repository root)

```text
package.json                 # scripts raiz (test, lint, build)
pnpm-workspace.yaml
tsconfig.base.json
docker-compose.yml           # server + db, volumes pgdata e evidence
.env.example                 # variáveis (sem segredos reais)

packages/
├── contracts/               # FONTE DA VERDADE da API
│   ├── openapi.yaml         # promovido de specs/001-…/contracts/openapi.yaml
│   └── src/generated.ts     # tipos gerados (openapi-typescript) — usados pelo server e pelo Electron
└── domain/                  # regras puras, sem I/O
    ├── src/
    │   ├── classification.ts      # classifyReservation(number, snapshot) — FR-013/014/014a/015
    │   ├── verification.ts        # mesclagem de histórico — FR-017/018/018a
    │   ├── period.ts              # validação e divisão de períodos — FR-010a / R-09
    │   └── types.ts               # ReservationSnapshot, Classification, ReservationStatus
    └── test/

apps/
└── server/
    ├── Dockerfile               # FROM mcr.microsoft.com/playwright:<mesma versão do pacote>
    ├── src/
    │   ├── main.ts              # bootstrap: config, banco, rotinas, HTTP
    │   ├── cli.ts               # create-client / revoke-client (chaves de API)
    │   ├── config.ts            # leitura e validação das variáveis de ambiente
    │   ├── http/                # rotas (handlers do openapi-glue), auth por chave/nível, SSE, erros RFC 9457
    │   ├── executions/          # runner: máquina de estados, 2FA, cancelamento, retomada, eventos
    │   ├── hunit/               # PAGE OBJECTS — único lugar com seletores/URLs/textos do Hunit
    │   │   ├── login-page.ts
    │   │   ├── two-factor-page.ts
    │   │   ├── hotel-selection-page.ts
    │   │   ├── reservations-search-page.ts   # filtros fixos da FR-010
    │   │   ├── reservation-list-page.ts      # paginação dinâmica (FR-011)
    │   │   ├── reservation-detail-page.ts    # → ReservationSnapshot (somente leitura)
    │   │   └── errors.ts                     # ScreenNotRecognizedError etc.
    │   ├── persistence/         # schema Drizzle, migrations, repositórios
    │   ├── evidence/            # captura com máscara, sanitização do HTML, armazenamento
    │   └── maintenance/         # rotina diária: expirar evidências, anonimizar reservas (FR-025–027)
    └── test/
        ├── fixtures/hunit/      # HTML anonimizado das telas atuais (R-13)
        ├── hunit/               # testes dos Page Objects contra fixtures
        ├── contract/            # respostas validadas contra openapi.yaml
        ├── integration/         # runner + banco (Testcontainers) com Hunit simulado por fixtures
        └── security/            # SC-004: credenciais nunca em logs/evidências

# Futuro (fora desta feature): apps/desktop (Electron), consumindo packages/contracts
```

**Structure Decision**: monorepo pnpm com um app (`apps/server`) e dois pacotes (`packages/domain`,
`packages/contracts`). O domínio fica num pacote separado para garantir, pela própria estrutura,
que regras de negócio não importem Playwright nem banco (princípio II). O contrato fica num pacote
para ser consumido pelo futuro `apps/desktop` sem depender do servidor.

## Fluxo de uma execução (referência para as tasks)

```text
POST /executions ─► valida, cria execução (queued), guarda credenciais SÓ na memória do runner
   └─► runner: abre Chromium ─► LoginPage ─► (credenciais inválidas → failed)
          └─► TwoFactorPage detectada ─► status awaiting_2fa + evento SSE (≤5 s) + prazo
                 POST /two-factor ─► token entregue em memória ─► (inválido/expirado → failed)
          └─► descarta credenciais e token da memória
          └─► lê catálogo de hotéis ─► grava hotels
          └─► para cada hotel pendente (sequencial; HOTEL_CONCURRENCY no futuro):
                 seleciona hotel ─► aplica filtros FR-010 ─► para cada bloco do período (R-09):
                    para cada página: lê listagem ─► "258-"? ignora : abre detalhe ─► snapshot
                       ─► classifyReservation ─► buffer em memória ─► eventos
                 hotel ok ─► transação única: reservas + observações + "não encontradas"
                 hotel falhou ─► evidência + failed, segue para o próximo
          └─► completed (ou cancelled/failed) ─► fecha o navegador
```

## Riscos e dependências

| Risco | Impacto | Mitigação |
|---|---|---|
| Telas atuais do Hunit ainda não mapeadas (R-13) | Page Objects não podem ser implementados | Tasks de Page Objects dependem das fixtures; domínio, banco, API e runner avançam em paralelo usando um Hunit simulado |
| Seleção de hotel é estado de sessão (R-08) | Meta de 30 min inviável | Meta de 1 h sequencial; teste de duas abas antes de ligar paralelismo |
| Janela curta do token (~1–2 min) | Execuções falham por tempo | SSE ≤ 5 s; Electron futuro deve alertar o operador (notificação) |
| Hunit muda de novo | Falhas em produção | Erro explícito + evidência (SC-006); correção restrita aos Page Objects + fixtures |
| Limite desconhecido de período no Hunit (R-09) | Consultas retroativas falham | Divisão automática configurável |

## Complexity Tracking

Nenhuma violação da constitution a justificar.
