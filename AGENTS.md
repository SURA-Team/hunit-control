# AGENTS.md

Guia operacional para agentes de código (Claude Code, Codex, Copilot etc.) neste repositório.
As regras de projeto estão na constitution: [.specify/memory/constitution.md](.specify/memory/constitution.md).
Em caso de conflito, a constitution prevalece sobre este arquivo.

## Projeto

HUNIT Control automatiza a consulta de reservas e cartões virtuais na extranet do Hunit
(que não tem API pública) via Playwright/Chromium, e expõe tudo por uma API HTTP consumida
por um app desktop Electron e, futuramente, pelo Sura.

Estado atual: **reescrita em andamento**. O sistema antigo (Python/PySide) parou de
funcionar porque o Hunit mudou a UI.

## Idioma

- Conversas, specs, commits e documentação: **português do Brasil**.
- Código (identificadores, nomes de arquivos): inglês. Mensagens exibidas ao usuário: português.

## Estrutura do repositório

| Caminho | Conteúdo |
|---|---|
| `.specify/memory/constitution.md` | Princípios não negociáveis do projeto |
| `.specify/templates/` | Templates de spec, plan, tasks (não editar sem motivo) |
| `specs/NNN-<feature>/` | `spec.md`, `plan.md`, `tasks.md` de cada feature |
| `apps/server/` | Servidor: API HTTP e executor da automação no mesmo processo (Fastify, Playwright, Drizzle) |
| `packages/domain/` | Regras de negócio puras, sem I/O — o ESLint bloqueia importações de navegador, banco e HTTP |
| `packages/contracts/` | `openapi.yaml` (fonte da verdade da API) e tipos gerados a partir dele |
| `docker-compose.yml`, `apps/server/Dockerfile` | Containers `server` e `db` |
| `legacy/` | Sistema antigo — **somente leitura**, referência de comportamento |

O monorepo (pnpm + TypeScript) foi criado pela feature 001; a estrutura detalhada está em
`specs/001-consulta-reservas-hunit/plan.md`. O app desktop (`apps/desktop`, Electron) ainda não
existe e terá uma feature própria. Atualize esta tabela quando a estrutura mudar.

## Fluxo de trabalho (Spec-Driven Development)

1. `/speckit-specify` → descreve **o quê** e **por quê** (sem tecnologia).
2. `/speckit-clarify` (opcional) → resolve ambiguidades da spec.
3. `/speckit-plan` → define **como**; passa pelo Constitution Check.
4. `/speckit-tasks` → quebra em tarefas pequenas e testáveis.
5. `/speckit-analyze` (opcional) → checa coerência entre spec, plan e tasks.
6. `/speckit-implement` → implementa task a task.

Regras:
- Não escreva código de produção sem uma spec correspondente em `specs/`.
- Se a implementação revelar que a spec está errada ou incompleta, **pare e atualize a spec**
  antes de seguir.
- Uma branch por feature; commits pequenos, em português, citando a spec (ex.: `specs/001`).

## Usando o legado como referência

`legacy/` documenta o comportamento esperado; não copie a arquitetura.

- `legacy/README.md` e `legacy/contexto.md`: visão funcional (fluxos, telas, regras).
- `legacy/src/hunit_automation/automation/browser.py`: navegação no Hunit (login, 2FA,
  seleção de empresa/hotel, paginação, abertura de reservas). **Os seletores estão
  desatualizados** — use apenas para entender o fluxo, nunca para copiar seletores.
- `legacy/src/hunit_automation/core/execution.py`: orquestração por hotel e retomada.
- `legacy/src/hunit_automation/core/reservation_classification.py` e `payment_details.py`:
  regras de classificação de reservas e cobrança — candidatos a portar para o domínio.
- `legacy/src/hunit_automation/core/manual_treatments.py`: tratativas manuais
  (enviada/cobrada com comprovante).
- `legacy/tests/`: casos de teste úteis como exemplos de regras de negócio.

Não altere nada dentro de `legacy/`. O histórico completo está em
`github.com/EduardoKipper/automacao-hunit`.

## Segurança e dados (obrigatório)

- **Nunca** leia, imprima, copie ou commite: `legacy/.env`, `legacy/data/`,
  `legacy/config/hotel_mappings.json`, planilhas (`*.xlsx`, `*.csv`), logs ou evidências de
  execução. Contêm dados pessoais e financeiros (hóspedes, cartões virtuais).
- Credenciais, senha e token 2FA do Hunit nunca vão para logs, banco, fixtures ou mensagens
  de erro.
- Fixtures HTML do Hunit usadas em testes devem ser **anonimizadas** antes do commit.
- Antes de cada commit, confira `git diff --cached --name-only` em busca de arquivos sensíveis.
- No servidor há duas proteções que não podem ser contornadas:
  - `apps/server/src/secrets.ts` (`SecretRegistry`): todo código que recebe usuário, senha ou
    token do Hunit registra esses valores enquanto os usa; logs, evidências e eventos apagam
    qualquer ocorrência deles antes de gravar.
  - `apps/server/src/hunit/read-only-guard.ts`: toda requisição ao Hunit passa por ela. Só as
    rotas de leitura da lista de permissão são aceitas; rotas de cobrança, cartão e alteração
    são bloqueadas. Uma rota nova só entra na lista com teste e registro em `research.md`.
    Limite conhecido: saltos de redirecionamento HTTP não podem ser abortados, só detectados; o
    gateway interrompe o acesso quando detecta um fora da lista (research R-13a).

## Hunit (sistema externo)

- Acesso real ao Hunit só com autorização explícita do usuário — ele exige credenciais e
  token 2FA de um humano.
- Interações com o Hunit ficam exclusivamente na camada do Hunit (`apps/server/src/hunit/`):
  Page Objects para telas (login/2FA) e leitores da API interna (somente GET, lista de rotas
  permitidas; rotas de cobrança, cartão e alteração bloqueadas). Nas telas, prefira localizadores por
  role/label/texto a CSS/XPath.
- Para mapear a UI nova, peça ao usuário para gravar o fluxo com `npx playwright codegen` ou
  salvar o HTML das páginas (anonimizado).
- **Nunca peça nem aceite usuário, senha ou token do Hunit no chat.** Para testar o login real, o
  usuário roda `hunit:login-check` (tabela de comandos) e digita as credenciais no próprio
  terminal.

## Comandos

Pré-requisitos: Node.js 24 LTS ou mais novo, pnpm na versão do campo `packageManager` do
`package.json` e Docker Desktop. Para instalar o pnpm sem precisar de administrador:
`npm install -g pnpm@<versão do packageManager>` (hoje `pnpm@12.18.0`). Com permissão de
administrador, `corepack enable` também funciona.

Os testes precisam de mais duas coisas: o **Docker em execução** (os testes de banco sobem um
PostgreSQL temporário) e o **Chromium do Playwright** instalado (comando na tabela).

| Comando | O que faz |
|---|---|
| `pnpm install` | Instala as dependências do monorepo |
| `pnpm --filter @hunit/server exec playwright install chromium` | Instala o Chromium usado nos testes (uma vez, e de novo quando a versão do Playwright mudar) |
| `pnpm typecheck` | Checa os tipos de todos os pacotes |
| `pnpm lint` | ESLint + Prettier + lint do contrato OpenAPI (falha se os tipos gerados estiverem desatualizados) |
| `pnpm format` | Formata o código com o Prettier |
| `pnpm test` | Roda todos os testes (Vitest) |
| `pnpm test --project <nome>` | Roda um grupo: `domain`, `contracts`, `server` (unidade, sem dependências externas), `server-browser` (abre o Chromium) ou `server-db` (PostgreSQL real; exige o Docker) |
| `pnpm build` | Compila os pacotes para `dist/` |
| `pnpm --filter @hunit/contracts generate` | Regenera `packages/contracts/src/generated.ts` depois de mudar o `openapi.yaml` |
| `pnpm --filter @hunit/server db:generate --name=<descrição>` | Gera uma migration depois de mudar `apps/server/src/persistence/schema.ts` (não precisa de banco) |
| `docker compose up -d --build` | Sobe `server` e `db` (antes, copie `.env.example` para `.env` e preencha) |
| `docker compose exec server node dist/cli.js create-client --name <nome> --role <operator\|reader>` | Cadastra um cliente da API e mostra a chave dele, uma única vez |
| `docker compose exec server node dist/cli.js revoke-client --name <nome>` | Revoga um cliente: a chave deixa de ser aceita |
| `pnpm --filter @hunit/server start` | Sobe o servidor fora do Docker (depois do `pnpm build`; exige as variáveis do `.env.example` no ambiente e um PostgreSQL) |
| `pnpm --filter @hunit/server hunit:login-check --save-dir test/fixtures/hunit/raw` | Verificação manual do login no Hunit **real**, rodada pelo operador num terminal interativo (depois do `pnpm build`): pede e-mail, senha e token (ocultos), mostra o resultado e as rotas barradas pela proteção e guarda as telas sanitizadas na pasta ignorada pelo Git |
| `pnpm --filter @hunit/server hunit:reservations-check --hotel <código> --from AAAA-MM-DD --to AAAA-MM-DD --save-dir test/fixtures/hunit/raw` | Verificação manual da leitura das reservas no Hunit **real** (mesmo modo de uso do `login-check`): lê a listagem de 1 hotel com os filtros fixos, confere que o Hunit os respeitou, abre algumas reservas e mostra número, situação e classificação (nunca o hóspede); `--parallel-hotel <código>` testa a leitura de dois hotéis ao mesmo tempo; guarda as respostas JSON na pasta ignorada pelo Git. `--help` mostra as opções |

Regras ao mexer em dependências e no contrato:

- O `pnpm-workspace.yaml` só aceita versões publicadas há 3 dias ou mais e nega scripts de
  instalação de dependências. Se uma dependência nova exigir script, avalie e registre a decisão
  em `allowBuilds`.
- A versão do pacote `playwright` e a da imagem em `apps/server/Dockerfile` têm de ser iguais
  (há um teste que confere).
- Mudou o contrato da API? Edite `packages/contracts/openapi.yaml` (fonte da verdade), rode o
  `generate` e copie o arquivo para `specs/001-consulta-reservas-hunit/contracts/openapi.yaml`
  — as duas cópias devem ficar idênticas.
- Mudou o schema do banco? Gere a migration com `db:generate` e versione os arquivos criados em
  `apps/server/src/persistence/migrations/`. Nunca edite uma migration já aplicada: crie outra.

O servidor responde à API desde a Fase 3 da feature 001 (login com token e catálogo de hotéis)
e, desde a Fase 4, consulta, classifica e grava as reservas por hotel, com consulta pela API
(`/v1/reservations`) e download de evidências. Os códigos dos filtros e o tamanho de página do
Hunit ainda serão confirmados com o `hunit:reservations-check` (T022). Ainda não existe o app
Electron; documente aqui quando for criado.
