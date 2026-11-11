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
para que mudanças de tela do Hunit não toquem regras de negócio (R-06); a coleta fica atrás de uma
interface `HunitGateway` e, conforme o spike R-13a, é feita **pela API JSON do próprio Hunit**:
Playwright faz só login e 2FA na tela; listagem (`GetBookings`) e detalhe (`BookingDetail`) são
lidos com a sessão do navegador, somente GET e somente rotas da lista de permissão. O hotel vai em
cada requisição (`X-Company-Id`); processamento **sequencial** por padrão até o paralelismo ser
verificado no primeiro acesso real (R-08).

## Technical Context

**Language/Version**: TypeScript 5.x (`strict`) sobre Node.js LTS — 24 é o mínimo para
desenvolvimento; em produção vale o Node da imagem oficial do Playwright (26 LTS em 2026-11,
ver research R-18)

**Primary Dependencies**: Fastify 5, fastify-openapi-glue, openapi-typescript, Playwright
(Chromium), Drizzle ORM + drizzle-kit, Pino

**Storage**: PostgreSQL 17 (dados); volume Docker `/data/evidence` (capturas, HTML sanitizado e respostas JSON)

**Testing**: Vitest; Playwright (Chromium) contra fixtures HTML (login/2FA); leitores da API contra fixtures JSON anonimizadas; `fastify.inject` + validação
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
| II | Isolamento do Hunit (v1.1.0) | Seletores, rotas e formatos de resposta do Hunit só na camada `apps/server/src/hunit/` (Page Objects de login/2FA + leitores da API em `network/`); domínio recebe `ReservationSnapshot` neutro (R-06); leitores só fazem GET em rotas permitidas, com bloqueio explícito de cobrança/cartão/alteração (T045); tela ou resposta não reconhecida → `hunit_screen_not_recognized` + evidência (screenshot/HTML ou resposta JSON) | ✅ |
| III | API-First com Contrato | `openapi.yaml` contract-first; tipos gerados para servidor e futuro Electron (R-03) | ✅ |
| IV | Jobs Assíncronos com Intervenção Humana | Estados `queued…cancelled` + `awaiting_2fa`; retomada por hotel; índice único parcial por conta (data-model) | ✅ |
| V | Servidor Central e Containers | `server` + `db` em Docker Compose; config só por env; estado só em volumes declarados (R-18) | ✅ |
| VI | Dados e Segurança | Postgres fonte da verdade; sem credenciais/token/sessão persistidos; chaves de API com hash; redação de logs e máscara em evidências (R-10–R-12); retenção e anonimização (R-16) | ✅ |
| VII | Testes em Camadas (v1.1.0) | Unitários de domínio, Page Objects (HTML) e leitores da API (JSON) contra fixtures anonimizadas, teste da lista de rotas permitidas/bloqueadas (T045), contrato contra OpenAPI, teste automatizado de SC-004 (R-14) | ✅ |
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
package.json                 # scripts raiz (build, typecheck, lint, test)
pnpm-workspace.yaml          # pacotes + política de dependências (idade mínima, scripts de instalação)
tsconfig.base.json           # opções comuns do TypeScript
eslint.config.js             # lint + regra de pureza do domínio (princípio II)
vitest.config.ts             # projetos de teste: domain, contracts, server, server-browser, server-db
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
    ├── drizzle.config.ts        # geração de migrations (pnpm --filter @hunit/server db:generate)
    ├── scripts/                 # apoio ao build (copia as migrations para dist/)
    ├── src/
    │   ├── main.ts              # bootstrap: config, banco, rotinas, HTTP
    │   ├── cli.ts               # create-client / revoke-client (chaves de API)
    │   ├── config.ts            # leitura e validação das variáveis de ambiente
    │   ├── logging.ts           # logger JSON sem dados sensíveis (R-12)
    │   ├── secrets.ts           # registro em memória dos segredos em uso (R-12)
    │   ├── http/                # rotas (handlers do openapi-glue), auth por chave/nível, SSE, erros RFC 9457
    │   ├── executions/          # runner: máquina de estados, 2FA, cancelamento, retomada, eventos
    │   ├── hunit/               # CAMADA DO HUNIT — único lugar com seletores/URLs/textos/requisições do Hunit
    │   │   ├── gateway.ts                    # interface HunitGateway → ReservationSnapshot (R-13a)
    │   │   ├── browser.ts                    # Chromium headless, contexto por execução
    │   │   ├── login-page.ts                 # Page Object (tela)
    │   │   ├── two-factor-page.ts            # Page Object (tela)
    │   │   ├── read-only-guard.ts            # lista de permissão por rota + bloqueio explícito (FR-012)
    │   │   ├── network/
    │   │   │   ├── api-client.ts             # GET via page.request com a sessão; só rotas permitidas
    │   │   │   ├── catalog.ts                # GetCurrentUser → hotéis (FR-008)
    │   │   │   ├── bookings.ts               # GetBookings: filtros fixos FR-010, paginação FR-011
    │   │   │   └── booking-detail.ts         # BookingDetail → ReservationSnapshot (tabela do R-13a)
    │   │   ├── playwright-gateway.ts         # implementação do HunitGateway
    │   │   └── errors.ts                     # ScreenNotRecognizedError etc.
    │   ├── persistence/         # schema Drizzle, migrations, repositórios
    │   ├── evidence/            # captura com máscara, sanitização do HTML, armazenamento
    │   └── maintenance/         # rotina diária: expirar evidências, anonimizar reservas (FR-025–027)
    └── test/
        ├── helpers/             # banco de testes, Hunit simulado, verificador de contrato, logs em memória
        ├── fixtures/hunit/      # HTML (login/2FA) e JSON (API) anonimizados (R-13/R-13a)
        ├── unit/                # sem dependências externas (projeto "server")
        ├── browser/             # abrem o Chromium (projeto "server-browser")
        ├── hunit/               # Page Objects e leitores da API contra fixtures (projeto "server-browser")
        ├── contract/            # respostas validadas contra openapi.yaml (projeto "server-db")
        ├── integration/         # executor + banco (Testcontainers) com o Hunit simulado (projeto "server-db")
        └── security/            # SC-004: credenciais nunca em logs/evidências (projeto "server-db")

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
          └─► GetCurrentUser ─► catálogo de hotéis ─► grava hotels
          └─► para cada hotel pendente (sequencial; HOTEL_CONCURRENCY após verificação do R-08):
                 X-Company-Id = hotel ─► para cada bloco do período (R-09):
                    GetBookings (filtros FR-010) página a página ─► "258-"? ignora
                       : BookingDetail(id) ─► snapshot
                       ─► classifyReservation ─► buffer em memória ─► eventos
                 hotel ok ─► transação única: reservas + observações + "não encontradas"
                 hotel falhou ─► evidência + failed, segue para o próximo
          └─► completed (ou cancelled/failed) ─► fecha o navegador
```

## Riscos e dependências

| Risco | Impacto | Mitigação |
|---|---|---|
| Telas de login/2FA ainda não mapeadas (R-13) | Login não pode ser implementado | Tasks ⛔ HUNIT dependem das fixtures; domínio, banco, API, runner e leitores da API avançam com o Hunit simulado |
| Hunit muda a API interna (não é pública) | Coleta para | Validação de formato em cada resposta → `hunit_screen_not_recognized` + evidência JSON; correção restrita a `hunit/network/` |
| Requisição perigosa por engano (cobrança, cartão) | Ação financeira indevida | `read-only-guard`: lista de permissão por rota + bloqueio explícito (R-13a); teste automatizado |
| Paralelismo entre hotéis não verificado (R-08) | Meta de 30 min | Começa sequencial; `X-Company-Id` por requisição sugere que é viável — verificar no primeiro acesso real |
| Janela curta do token (~1–2 min) | Execuções falham por tempo | SSE ≤ 5 s; Electron futuro deve alertar o operador (notificação) |
| Hunit muda de novo | Falhas em produção | Erro explícito + evidência (SC-006); correção restrita à camada do Hunit + fixtures |
| Limite desconhecido de período no Hunit (R-09) | Consultas retroativas falham | Divisão automática configurável |
| Estimativa de tempo imprecisa no início | Operador planeja mal | Média histórica por reserva; SC-010 mede o erro (R-08a) |

## Complexity Tracking

Nenhuma violação da constitution a justificar.
