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
cada requisição (`X-Company-Id`); o paralelismo entre hotéis com a mesma sessão foi verificado no
Hunit real e é controlado por `HOTEL_CONCURRENCY` (padrão 1, subir aos poucos na homologação —
R-08).

**Revisão 2026-11-11 (forma de pagamento, R-22)**: reserva sem pré-pagamento é classificada pela
forma de pagamento que o Hunit informa no detalhe — faturada (`invoiced`), cobrar na maquininha
(`charge_at_terminal`) ou erro de análise. A camada do Hunit converte `paymentTypeId` e o rótulo da
forma num valor neutro do `ReservationSnapshot`; o domínio aplica a regra. `not_virtual_card` fica
obsoleta (não é removida do banco nem do contrato) e o contrato vai a 1.2.0, só com acréscimos.
Em 2026-11-12, a cancelada sem pré-pagamento e sem forma ganhou a situação "cancelada sem cobrança"
(`cancelled_no_charge`, contrato 1.3.0); a ativa nessa condição continua erro de análise.

## Technical Context

**Language/Version**: TypeScript 5.x (`strict`) sobre Node.js LTS — 24 é o mínimo para
desenvolvimento; em produção vale o Node da imagem oficial do Playwright (26 LTS em 2026-11,
ver research R-18)

**Primary Dependencies**: Fastify 5, fastify-openapi-glue, openapi-typescript, Playwright
(Chromium), Drizzle ORM + drizzle-kit, Pino

**Storage**: PostgreSQL 17 (dados); volume Docker `/data/evidence` (capturas, HTML sanitizado e respostas JSON)

**Testing**: Vitest; Playwright (Chromium) contra fixtures HTML (login/2FA); leitores da API contra fixtures JSON anonimizadas; `fastify.inject` + validação
contra OpenAPI; Testcontainers (PostgreSQL)

**Target Platform**: containers Linux com Docker Compose (imagem base oficial do Playwright).
Produção, por enquanto, num PC Windows da rede da empresa com Docker Desktop, ligado manualmente,
acessado por 2 máquinas da mesma rede via HTTPS (R-20); nuvem (AWS) em spec futura, com o Sura

**Project Type**: web-service (API) com automação de navegador; monorepo pnpm

**Performance Goals**: rotina (todos os hotéis × 1 semana) ≤ 30 min, com o paralelismo
verificado no R-08 (≤ 1 h se for preciso voltar a um hotel por vez) (SC-009); aviso de token ≤ 5 s (SC-005); cancelamento ≤ 15 s (SC-008)

**Constraints**: credenciais/token só em memória (FR-005); nenhuma ação de escrita no Hunit
(FR-012); uma execução ativa por conta (FR-006); espera do token de 5 min por padrão, dentro dos 491 s que o Hunit aceitou na medição (FR-004)

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
| V | Servidor Central e Containers | `server` + `db` + `proxy` + `backup` em Docker Compose; config só por env; estado só em volumes declarados (R-18); o "servidor central" é, por enquanto, um PC da rede local (R-20) | ✅ |
| VI | Dados e Segurança | Postgres fonte da verdade; sem credenciais/token/sessão persistidos; chaves de API com hash; redação de logs e máscara em evidências (R-10–R-12); retenção e anonimização (R-16); HTTPS para acesso pela rede (R-20); cópias diárias cifradas fora do PC (R-21) | ✅ |
| VII | Testes em Camadas (v1.1.0) | Unitários de domínio, Page Objects (HTML) e leitores da API (JSON) contra fixtures anonimizadas, teste da lista de rotas permitidas/bloqueadas (T045), contrato contra OpenAPI, teste automatizado de SC-004 (R-14) | ✅ |
| VIII | Simplicidade | Sem fila/Redis/object storage; paralelismo entre hotéis com a mesma sessão, sem fila (`HOTEL_CONCURRENCY`, padrão 1); `proxy` e `backup` exigidos pela spec (FR-030, FR-032) e usam imagens prontas, sem código novo no `server` (ver Complexity Tracking) | ✅ |

**Nota sobre o princípio V**: a constitution lista "API, worker e PostgreSQL" em containers. Aqui
API e worker são módulos do **mesmo** container `server`. Isso cumpre o princípio (tudo em
containers) e é exigido pelo princípio VI/FR-005 (R-02). Não é violação; se a operação precisar
escalar a automação no futuro, a separação vira uma emenda/spec própria.

**Resultado pré-Fase 0**: aprovado. **Resultado pós-Fase 1** (após data-model e contrato):
aprovado — nenhuma entidade ou endpoint armazena ou devolve credenciais; `HunitCredentials` e
`token` são `writeOnly`; nenhum endpoint executa ação no Hunit fora do fluxo de leitura.

**Reavaliação após a R-22 (forma de pagamento)**: aprovado. A leitura da forma de pagamento fica na
camada do Hunit e chega ao domínio como valor neutro (II); o contrato muda só com acréscimos e
sobe para 1.2.0 (III); a mudança de classificação vai para o histórico sem apagar dados (VI);
nenhuma estrutura nova além de uma coluna e dois valores de enum (VIII).

## Project Structure

### Documentation (this feature)

```text
specs/001-consulta-reservas-hunit/
├── spec.md              # O quê e por quê (+ Clarifications)
├── plan.md              # Este arquivo
├── research.md          # Fase 0: decisões técnicas (R-01…R-21)
├── data-model.md        # Fase 1: tabelas, enums, transições
├── quickstart.md        # Fase 1: guia de validação ponta a ponta
├── contracts/
│   └── openapi.yaml     # Fase 1: contrato da API v1
├── checklists/
│   └── requirements.md  # Qualidade da spec
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
package.json                 # scripts raiz (build, typecheck, lint, test)
pnpm-workspace.yaml          # pacotes + política de dependências (idade mínima, scripts de instalação)
tsconfig.base.json           # opções comuns do TypeScript
eslint.config.js             # lint + regra de pureza do domínio (princípio II)
vitest.config.ts             # projetos de teste: domain, contracts, server, server-browser, server-db
docker-compose.yml           # server + db + proxy (HTTPS, R-20) + backup (R-21); volumes pgdata, evidence, caddy-data
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
    │   │   ├── login-pages.ts                # Page Objects das telas de login e do token 2FA
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

deploy/
├── caddy/Caddyfile          # proxy HTTPS com certificado da CA interna do Caddy (R-20)
└── backup/
    ├── backup.sh            # laço: cópia cifrada quando a mais nova tiver > BACKUP_INTERVAL_HOURS; apaga as antigas (R-21)
    └── restore.sh           # decifra e restaura uma cópia escolhida (FR-031)

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
          └─► GetCurrentUser ─► catálogo de hotéis DA CONTA ─► grava hotels + account_hotels
          └─► hotel pedido fora do catálogo da conta: pendente com aviso se outra conta o acessa
                 (FR-009a); falha se nenhuma conta o acessa
          └─► para cada hotel (até HOTEL_CONCURRENCY ao mesmo tempo, mesma sessão — R-08):
                 X-Company-Id = hotel ─► para cada bloco do período (R-09):
                    GetBookings (filtros FR-010) página a página ─► "258-"? ignora
                       : BookingDetail(id) ─► snapshot
                    (cada leitura: sem resposta/429/5xx ─► até 5 novas tentativas + aviso, R-23)
                       ─► classifyReservation ─► buffer em memória ─► eventos
                 hotel ok ─► transação única: reservas + observações + "não encontradas"
                 hotel falhou ─► evidência + failed, segue para o próximo
          └─► completed (ou cancelled/failed) ─► fecha o navegador

POST /cancel ─► parada antes da próxima página, reserva ou gravação; navegador fechado à força
   após 10 s; hotéis em andamento → cancelled, não iniciados → pending (R-19)
POST /resume ─► nova execução (parent_execution_id) só com os hotéis não concluídos, novo login e
   token; cada execução é retomada no máximo uma vez (R-19)
```

## Riscos e dependências

| Risco | Impacto | Mitigação |
|---|---|---|
| Telas de login/2FA ainda não mapeadas (R-13) | Login não pode ser implementado | Tasks ⛔ HUNIT dependem das fixtures; domínio, banco, API, runner e leitores da API avançam com o Hunit simulado |
| Hunit muda a API interna (não é pública) | Coleta para | Validação de formato em cada resposta → `hunit_screen_not_recognized` + evidência JSON; correção restrita a `hunit/network/` |
| Requisição perigosa por engano (cobrança, cartão) | Ação financeira indevida | `read-only-guard`: lista de permissão por rota + bloqueio explícito (R-13a); teste automatizado |
| Limite de requisições simultâneas do Hunit (R-08) | Erros 429/5xx com muitos hotéis ao mesmo tempo | Medido na homologação (T062): com 5 hotéis, a frequência de 503 por leitura foi parecida com a do modo sequencial; `HOTEL_CONCURRENCY=5` em produção, voltando para 1 no `.env` se o Hunit recusar muito |
| Indisponibilidade passageira do Hunit (homologação: 503 que atinge todos os hotéis em andamento por 7 a 17 s, às vezes mais) | Um único erro descarta o hotel inteiro | Até 5 novas tentativas (2 a 30 s, cobrindo ~67 s) ou `Retry-After`, com aviso ao operador; a espera é interrompida pelo cancelamento (R-23, FR-011a) |
| Operador demora a informar o token | Execuções falham por tempo | Espera padrão de 5 min (o Hunit aceitou 491 s, R-13); SSE ≤ 5 s; Electron futuro deve alertar o operador (notificação) |
| Hunit muda de novo | Falhas em produção | Erro explícito + evidência (SC-006); correção restrita à camada do Hunit + fixtures |
| Limite desconhecido de período no Hunit (R-09) | Consultas retroativas falham | Divisão automática configurável |
| Código de "faturado" e preenchimento da forma de pagamento sem cartão ainda não vistos (R-22) | Reservas faturadas caem em erro de análise | Rótulo "faturad…" já reconhecido; forma vazia → erro de análise (lado seguro); confirmar na captura (T020) |
| Estimativa de tempo imprecisa no início | Operador planeja mal | Média histórica por reserva; SC-010 mede o erro (R-08a) |
| Disco do PC de produção falha ou o PC é perdido | Perda do histórico de reservas | Cópia diária cifrada fora do PC + restauração testada (R-21, SC-011); `.env` guardado à parte |
| PC desligado na hora das rotinas | Evidências vencidas e anonimização atrasadas; dia sem cópia | Rotinas verificam o atraso ao subir (FR-029): manutenção roda ao iniciar, backup olha a idade da cópia mais nova |
| Credenciais do Hunit trafegando na rede local | Vazamento de senha e token | HTTPS obrigatório entre máquinas; porta HTTP só em `127.0.0.1` (R-20, SC-013) |

## Complexity Tracking

| Acréscimo | Por que é necessário | Alternativa mais simples descartada |
|---|---|---|
| Container `proxy` (Caddy) | FR-032: credenciais do Hunit vão das máquinas dos operadores ao servidor pela rede | HTTP puro (credenciais legíveis na rede); TLS dentro do `server` (certificado manual e código que some na AWS) — R-20 |
| Container `backup` | FR-030/FR-031: o banco fica num PC comum, sem backup gerenciado | Rotina no `server` (sem `pg_dump` 17 na imagem); Agendador do Windows (fora do repositório, não recupera atraso) — R-21 |

Os dois usam imagens prontas e um arquivo de configuração/script cada; nenhum código de produção
novo no `server`. Na AWS, ambos podem ser trocados por serviços do provedor sem mudar o `server`.
