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
| `apps/server/` | Servidor: API HTTP e executor da automação no mesmo processo (Fastify, Playwright, Drizzle). `src/legacy-import/` tem o comando `legacy-import` (importação do histórico do sistema anterior, specs/004). Da 005: `src/commercial-sheet/` (planilha do Comercial: adaptador do Google Sheets, sincronizador, leitura dos retornos e o comando `commercial-sheet`), `src/dispatches/` (envios ao Comercial com a verificação no Hunit) e `src/hunit-session/` (sessão do Hunit compartilhada por execuções e envios). Da 008: `src/persistence/no-charge-repo.ts` (marcação "Cancelada sem cobrança") e `src/persistence/commercial-reports-repo.ts` (relatos do Comercial e a fila "Cobradas no Hunit", verificada pelo executor dos envios). Da 007: `src/persistence/reports-repo.ts` (resumo do período do módulo de Relatórios, sobre a mesma CTE das contagens dos filtros rápidos) |
| `apps/desktop/` | App desktop (Electron + React + Mantine) que opera o servidor só pela API: `src/main` (processo principal: rede, disco e segredos), `src/preload` (ponte `window.hunit`), `src/renderer` (interface, sem Node e sem rede), `src/shared` (contrato da ponte). Estrutura em `specs/002-app-desktop/plan.md`. Desde a 006, `src/renderer/src/ui/` tem os componentes únicos do visual (tokens, tema, ícones, botões, campos, listas, diálogos e gavetas; catálogo em `specs/006-redesign-app-desktop/contracts/ui-components.md`): telas e `components/` só montam a interface com eles e com o layout neutro do Mantine (`Stack`, `Group`, `Text`…), e o ESLint barra nelas os componentes visuais do Mantine (`Button`, `Modal`, `Table`, `Badge`…). `scripts/generate-icon.mjs` gera o ícone a partir da marca. Da 008, `src/main/app-identity.ts` (AUMID e ícone da janela por modo, para a marca na barra de tarefas do Windows). Da 007, `src/renderer/src/screens/reports/` (módulo de Relatórios) e `src/renderer/src/ui/charts/` (barras, legendas e cards de valor; catálogo em `specs/007-relatorios-app-desktop/contracts/ui-components.md`) |
| `packages/domain/` | Regras de negócio puras, sem I/O — o ESLint bloqueia importações de navegador, banco e HTTP |
| `packages/contracts/` | `openapi.yaml` (fonte da verdade da API) e tipos gerados a partir dele |
| `docker-compose.yml`, `apps/server/Dockerfile` | Containers `server`, `db`, `proxy` (HTTPS) e `backup` |
| `deploy/caddy/Caddyfile` | Proxy HTTPS com a autoridade certificadora interna do Caddy (research R-20) |
| `deploy/backup/` | `backup.sh` (cópia cifrada do banco) e `restore.sh` (restauração), rodados no container `backup` (research R-21) |
| `deploy/homolog/` | Ambiente de homologação no PC do servidor, separado da produção (projeto `hunit-homolog`, dados fictícios, clone próprio em `C:\hunit-homolog\hunit-control`): acréscimo ao Compose e modelo do `.env.homolog` (com a planilha de teste do Comercial). Passo a passo padrão (montar, atualizar para uma feature, recomeçar e desmontar) no `README.md`, seção "Homologação"; o quickstart de cada feature diz só o que ela confere |
| `deploy/secrets/` | Chave da conta de serviço da planilha do Comercial, montada só para leitura no `server` (specs/005). **Ignorada pelo Git**, menos o `README.md` dela; nunca leia nem copie o que houver ali |
| `README.md` | Visão geral, implantação no PC de produção, cópia de segurança e restauração |
| `.claude/skills/`, `skills-lock.json` | Skills do Claude Code versionados: os do Spec Kit e o `playwright-best-practices` (MIT, de `currents-dev`, instalado com `npx skills`; o lock guarda a origem e a versão). Atualize com `npx skills update -p` e revise o diff antes do commit. O `figma-screens-sync` é do próprio projeto (fora do lock): marca no Figma as telas em uso (✅) e as obsoletas (❌) (seção "Telas no Figma") |
| `legacy/` | Sistema antigo — **somente leitura**, referência de comportamento. **Não é versionado** (está no `.gitignore`): existe só na máquina de quem desenvolve |

O monorepo (pnpm + TypeScript) foi criado pela feature 001; a estrutura detalhada está em
`specs/001-consulta-reservas-hunit/plan.md`. O app desktop (`apps/desktop`) veio com a feature 002
(`specs/002-app-desktop/`). Atualize esta tabela quando a estrutura mudar.

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

## Telas no Figma

O arquivo [Hunit Control](https://www.figma.com/design/YCbxTAacFxbGuOF8uwoLtt/Hunit-Control) tem uma
página por feature, com o nome da branch (`002-app-desktop`, …, `006-redesign-app-desktop`, …), só
com as telas que a feature criou ou mudou, e a biblioteca da UX (`Componentes — nova identidade`).

- **Desde 18/11/2026, nenhuma spec começa sem passar pela PM**, e toda feature que muda telas chega
  com elas desenhadas pela UX no Figma (da 006 em diante). O design é a fonte da verdade de como o
  app **deve ser**; levá-lo para o código é trabalho da spec. O agente não desenha nem reconstrói
  telas no Figma.
- As páginas `002` a `005` (e `Identidade visual` e `Componentes`) são espelhos antigos, feitos pelo
  agente a partir de prints do app; ficam congeladas.
- **Marcação**: cada tela tem um número (`4.1`); a versão em uso fica com ✅ no nome, visível, e as
  substituídas ficam com ❌, ocultas. Quem marca é a skill `figma-screens-sync`, que varre todas as
  páginas de feature até a concluída.

Regra: ao concluir uma feature que mudou telas do app desktop (`apps/desktop/src/renderer`, rótulos
em `presentation/`, ícone ou tema), depois de comparar o app com o design da feature (prints do
roteiro de captura ao lado dos frames), rode a skill `figma-screens-sync` antes do PR final ou logo
depois do merge.

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

Não altere nada dentro de `legacy/`. Este repositório é **público** e o legado não faz parte dele:
a pasta vem de um clone do repositório privado do legado (`automacao-hunit`) dentro de `legacy/`.
Nunca copie para fora de `legacy/` nomes de hotéis, da empresa ou trechos do legado que os
contenham. Se a pasta não existir, peça ao usuário; sem ela, use as specs como referência.

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

O terminal integrado do VS Code (e o do Claude Code dentro dele) define `ELECTRON_RUN_AS_NODE=1`.
Com ela, o Electron roda como Node e o app não abre. Os testes de ponta a ponta tiram a variável do
processo do app sozinhos; para `pnpm --filter @hunit/desktop dev`, rode antes
`Remove-Item Env:ELECTRON_RUN_AS_NODE` (PowerShell) ou `unset ELECTRON_RUN_AS_NODE` (Git Bash).

| Comando | O que faz |
|---|---|
| `pnpm install` | Instala as dependências do monorepo |
| `pnpm --filter @hunit/server exec playwright install chromium` | Instala o Chromium usado nos testes (uma vez, e de novo quando a versão do Playwright mudar) |
| `pnpm typecheck` | Checa os tipos de todos os pacotes |
| `pnpm lint` | ESLint + Prettier + lint do contrato OpenAPI (falha se os tipos gerados estiverem desatualizados) |
| `pnpm format` | Formata o código com o Prettier |
| `pnpm test` | Roda todos os testes (Vitest) |
| `pnpm test --project <nome>` | Roda um grupo: `domain`, `contracts`, `server` (unidade, sem dependências externas), `server-browser` (abre o Chromium) ou `server-db` (PostgreSQL real; exige o Docker — inclui o teste de segurança SC-004 e o de cópia e restauração, que roda os scripts de `deploy/backup/` num container `postgres:17`). Do app: `desktop` (processo principal, com servidor HTTPS local e certificados gerados no teste), `desktop-ui` (interface, jsdom) e `desktop-e2e` (o app compilado aberto pelo Playwright contra a API da 001 com o Hunit simulado; exige o Docker e abre janelas) |
| `pnpm --filter @hunit/desktop dev` | Abre o app em desenvolvimento (electron-vite, recarga da tela na hora). Sem `ELECTRON_RUN_AS_NODE` no terminal |
| `pnpm --filter @hunit/desktop build` | Compila o app para `apps/desktop/out/` (o `pnpm build` da raiz também compila) |
| `$env:HUNIT_SCREENS_DIR = "<pasta>"; pnpm test --project desktop-e2e screens-capture` | Captura as telas do app para comparar com o design no Figma (PowerShell; ~3 min; exige o Docker): um PNG por tela, com o número da tela no Figma, e `falhas.txt`. Sem a variável, o roteiro fica desligado nas rodadas normais. Use uma pasta fora do repositório. A janela é a do design (1 440 × 900); com `$env:HUNIT_SCREENS_WIDTH = "960"` (ou `"1280"`), as mesmas telas saem em 960 × 640 (ou 1 280 × 820), com os mesmos nomes: use uma pasta por largura |
| `node apps/desktop/scripts/generate-icon.mjs` | Gera de novo o ícone do app (`resources/icon.ico` e `icon.png`) a partir da marca `resources/brand.svg` (specs/006); os arquivos gerados são versionados. Só é preciso quando a marca mudar |
| `pnpm --filter @hunit/desktop dist` | Gera o instalador NSIS em `apps/desktop/release/` (sem assinatura de código; research R-11 da 002). Rode antes o `pnpm build`: o app empacota o `dist` do `@hunit/domain` e do `@hunit/contracts` |
| `pnpm build` | Compila os pacotes para `dist/`, na ordem das dependências. Use sempre este antes dos comandos `hunit:*`: `pnpm --filter @hunit/server build` compila só o servidor e usa o `dist` antigo do `@hunit/contracts` e do `@hunit/domain` (os testes leem o código-fonte e não acusam) |
| `pnpm --filter @hunit/contracts generate` | Regenera `packages/contracts/src/generated.ts` depois de mudar o `openapi.yaml` |
| `pnpm --filter @hunit/server db:generate --name=<descrição>` | Gera uma migration depois de mudar `apps/server/src/persistence/schema.ts` (não precisa de banco) |
| `docker compose up -d --build` | Sobe `server`, `db`, `proxy` e `backup` (antes, copie `.env.example` para `.env` e preencha as obrigatórias: `POSTGRES_PASSWORD`, `ACCOUNT_KEY_SECRET`, `SERVER_HOSTNAME`, `BACKUP_DIR`, `BACKUP_PASSPHRASE`) |
| `docker compose exec server node dist/cli.js create-client --name <nome> --role <operator\|reader>` | Cadastra um cliente da API e mostra a chave dele, uma única vez |
| `docker compose exec server node dist/cli.js revoke-client --name <nome>` | Revoga um cliente: a chave deixa de ser aceita |
| `docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt .\hunit-raiz.crt` | Exporta o certificado raiz do proxy HTTPS, para instalar nas máquinas clientes (passo a passo no `README.md`) |
| `docker compose run --rm --entrypoint bash backup /scripts/restore.sh <arquivo>` | Restaura uma cópia de segurança (com o `server` parado; passo a passo no `README.md`) |
| `docker compose logs backup` | Mostra as cópias de segurança feitas, apagadas e as falhas |
| `pnpm --filter @hunit/server start` | Sobe o servidor fora do Docker (depois do `pnpm build`; exige as variáveis do `.env.example` no ambiente e um PostgreSQL) |
| `pnpm --filter @hunit/server hunit:login-check --save-dir test/fixtures/hunit/raw` | Verificação manual do login no Hunit **real**, rodada pelo operador num terminal interativo (depois do `pnpm build`): pede e-mail, senha e token (ocultos), mostra o resultado e as rotas barradas pela proteção e guarda as telas sanitizadas na pasta ignorada pelo Git |
| `pnpm --filter @hunit/server hunit:reservations-check --hotel <código> --from AAAA-MM-DD --to AAAA-MM-DD --save-dir test/fixtures/hunit/raw` | Verificação manual da leitura das reservas no Hunit **real** (mesmo modo de uso do `login-check`): lê a listagem de 1 hotel com os filtros fixos, confere que o Hunit os respeitou, abre algumas reservas e mostra número, situação e classificação (nunca o hóspede); `--parallel-hotel <código>` testa a leitura de dois hotéis ao mesmo tempo; guarda as respostas JSON na pasta ignorada pelo Git. `--help` mostra as opções |
| `pnpm --filter @hunit/server hunit:login-check --wait-token <segundos> --save-dir test/fixtures/hunit/raw` | Como o `login-check`, mas espera esse tempo com a tela do token aberta antes de pedir o token: mede quanto tempo a tela aceita e captura a tela de token expirado |
| `docker compose run --rm -v "C:\importacao:/import:ro" server node dist/cli.js legacy-import simulate --xlsx /import/planilha.xlsx --files /import/anexos` | Simula a importação do histórico do sistema anterior (specs/004) a partir da cópia .xlsx e da pasta de anexos, montadas só para leitura num container de uso único. Não grava reservas nem documentos e mostra o relatório (só contagens, linhas, chaves e motivos) com o id da simulação. Os outros subcomandos: `hotels` (lista; `--set <código> --hotel <código>`, `--set <código> --none`, `--accept-proposals`), `run --simulation <id> --xlsx … --files …` (importa) e `report --id <id> [--all]` (`--all` lista também cada "já importada", que normalmente vira só uma contagem). Fora do Docker: `pnpm --filter @hunit/server legacy-import <subcomando>`. Nunca acessa o Hunit. Passo a passo no `README.md` |
| `docker compose exec server node dist/cli.js commercial-sheet setup` | Prepara a planilha do Comercial (abas "A cobrar" e "Concluídas", cabeçalhos, proteções e formatos); pode rodar de novo. `check` confere sem mudar nada. Exige `COMMERCIAL_SHEET_ID` e `COMMERCIAL_SHEET_KEY_FILE` e a chave em `deploy/secrets/`; nunca mostra o ID nem a chave. Fora do Docker: `pnpm --filter @hunit/server commercial-sheet <setup\|check>`. Passo a passo no `README.md` ("Planilha do Comercial") e em `specs/005-envio-comercial/contracts/cli.md` |
| `pnpm --filter @hunit/server hunit:anonymize-fixtures` | Gera as fixtures reais anonimizadas (`test/fixtures/hunit/{html,json}/real/` e `real/manifest.json`) a partir de `test/fixtures/hunit/raw/` (depois do `pnpm build`). Não mostra valores; se sobrar algum dado original, não grava nada. Revise o resultado antes do commit |

Regras ao mexer em dependências e no contrato:

- O `pnpm-workspace.yaml` só aceita versões publicadas há 3 dias ou mais e nega scripts de
  instalação de dependências. Se uma dependência nova exigir script, avalie e registre a decisão
  em `allowBuilds`. Hoje só o `electron` tem script liberado (baixa o binário oficial e confere o
  checksum); o `electron-winstaller` fica negado (serve só ao instalador Squirrel, que o app não usa).
- O app desktop não tem `dependencies` no `package.json`: tudo vai em `devDependencies` e é
  empacotado pelo Vite (há um teste que confere). As fuses do instalador ficam no
  `electron-builder.yml` e também são conferidas por teste.
- A versão do pacote `playwright` e a da imagem em `apps/server/Dockerfile` têm de ser iguais
  (há um teste que confere).
- Mudou o contrato da API? Edite `packages/contracts/openapi.yaml` (fonte da verdade), rode o
  `generate` e copie o arquivo para a pasta `contracts/` da feature em andamento (hoje
  `specs/007-relatorios-app-desktop/contracts/openapi.yaml`) — as duas cópias devem ficar
  idênticas. A cópia de cada feature encerrada fica congelada no contrato que ela entregou: a da 001
  continua na 1.3.0, a da 002 na 1.4.0, a da 003 na 1.5.0, a da 004 na 1.6.0, a da 005 na 1.7.0, a
  da 006 na 1.8.0 e a da 008 na 1.9.0, e não devem ser alteradas (a da 007 entrega a 1.11.0)
  (specs/002, research R-15; specs/003, research R-12; specs/004, research R-12; specs/005,
  research R-13). Desde a 1.7.0, enums que o app em uso trata como chave (`ReservationSituation`,
  `TreatmentEvent.type`, `TreatmentStatus`) não ganham valores: um teste confere (specs/005, R-09).
  Desde a 1.9.0, o mesmo vale para `ReservationDetailedSituation`, `CommercialEvent.type`,
  `CommercialReturnState` e `CommercialSheetProblem.kind`: valor novo vai num campo novo; a única
  exceção é `CommercialDispatchItem.outcome = checked`, que só aparece nas verificações da fila
  (`purpose = hunit_check`), fora da lista padrão de envios (specs/008, R-02).
- Mudou o schema do banco? Gere a migration com `db:generate` e versione os arquivos criados em
  `apps/server/src/persistence/migrations/`. Nunca edite uma migration já aplicada: crie outra.
- Mudou o `docker-compose.yml`? O teste `apps/server/test/unit/compose-config.test.ts` confere que
  só o `proxy` publica porta para a rede, que a porta do `server` fica em `127.0.0.1`, que o
  `backup` usa a mesma imagem do `db` e que a pasta da chave da planilha é montada só para leitura. Variável nova vai também para o `.env.example`, com
  comentário.
- Os scripts de `deploy/backup/` rodam em bash dentro do container `postgres:17`; mantenha os
  finais de linha LF (o `.gitattributes` já força) e nunca escreva a `BACKUP_PASSPHRASE` ou a senha
  do banco na saída.

O servidor responde à API desde a Fase 3 da feature 001 (login com token e catálogo de hotéis)
e, desde a Fase 4, consulta, classifica e grava as reservas por hotel, com consulta pela API
(`/v1/reservations`) e download de evidências. Desde a Fase 5, acompanha o andamento com
estimativa de tempo (`current` e `timing` em `GET /v1/executions/{id}`), cancela
(`POST /v1/executions/{id}/cancel`) e retoma execuções a partir dos hotéis não concluídos
(`POST /v1/executions/{id}/resume`). Os códigos dos filtros e o tamanho de página do Hunit foram
confirmados em parte com o `hunit:reservations-check` (T022). Desde a Fase 6, apaga as evidências
vencidas e anonimiza reservas antigas sozinho (`apps/server/src/maintenance/retention.ts`, ao subir e
a cada 24 h), aceita conexões da rede só por HTTPS (container `proxy`) e faz cópias cifradas do
banco (container `backup`); a implantação no PC de produção está no `README.md`.

Desde a feature 002, existe o app desktop (`apps/desktop`): configura a conexão confirmando o
servidor pelo certificado raiz do Caddy (sem instalar nada no Windows), executa a consulta com o
aviso do pedido de token (notificação, janela à frente e som), acompanha, cancela e retoma execuções
e consulta reservas e evidências. O contrato da API passou para a 1.4.0 (só acréscimos: `/me`,
`requestedClient` e `active` na lista de execuções, `warnings` no estado da execução, `q`, `channel`
e `amount` nas reservas, `/channels` e a lista de evidências da execução). A instalação do app está
no `README.md`.

Desde a feature 003 (`specs/003-tratativas-manuais/`), o Financeiro registra por reserva a
tratativa (pedido de cobrança ao Comercial → "Enviada") e o comprovante (→ "Cobrada"), com
pré-visualização no app, substituir, desfazer e reverter por 30 dias, valor cobrado informado à mão
e aplicação em lote com a seleção mantida entre pesquisas. Os documentos ficam no PostgreSQL
(`treatment_files`, `bytea`, deduplicados por SHA-256) e entram nas cópias de segurança. O
contrato passou para a 1.5.0 (só acréscimos: `/treatment-files`, `/treatment-documents` e o
`check`, `/reservations/{hotel}/{número}/treatment` e `manual-amount`, `Reservation.treatment`
e os filtros `treatmentStatus` e `pendingCharge`). Depois da homologação, ainda na 1.5.0: a situação
da reserva numa coluna só (`treatment.situation` e o filtro `situation`), o alerta "Verificar" quando
o Hunit muda a situação de uma reserva só com tratativa (`treatment.needsReview`, o filtro
`needsReview` e `POST …/treatment/review`) e o histórico com "Mostrar mais" (research R-14). A
homologação roda num ambiente separado da produção, no mesmo PC (`deploy/homolog/`, quickstart
§2.1 da 003). O envio de documentos é a única rota com corpo
binário (até 25 MiB). O log do servidor registra as requisições sem a query (nome do arquivo e
busca livre podem ter dados pessoais).

Desde a feature 004 (`specs/004-importacao-historico/`), o comando `legacy-import` importa, uma vez
e de forma repetível, o histórico do sistema anterior (cópia .xlsx da planilha, com as abas
"Reservas" e "Tratativas", e a pasta de anexos). Antes de gravar, uma simulação mostra o que seria
criado, atualizado, ignorado ou recusado; a importação só confirma uma simulação feita com a mesma
planilha, os mesmos arquivos e a mesma associação de hotéis. As reservas importadas ficam com a
origem "Sistema anterior" (`legacy_reservations`; `last_execution_id` nulo até o HUNIT Control
verificá-las), e o HUNIT Control prevalece sobre as que ele já verificou. As tratativas e os
comprovantes importados têm o autor reservado `sistema-anterior` (revogado, sem chave; o
`create-client` recusa esse nome) e a data original. `not_virtual_card` passou a ser **"A revisar
(sistema anterior)"**: aceita tratativa, fica fora do "Falta cobrar" e sai na primeira verificação.
O contrato passou para a 1.6.0 (só acréscimos: `Reservation.legacy`, o filtro `fromLegacy` e
`fromLegacy` nos documentos e no histórico). O comando é administrativo, só no servidor
(constitution 1.2.0, princípio III).

Desde a feature 005 (`specs/005-envio-comercial/`), o Financeiro envia os pedidos de cobrança ao
Comercial por uma planilha do Google, em vez de e-mail. O envio parte da seleção do app, pede o
token do Hunit como as execuções (uma automação por conta do Hunit: execução e envio não rodam ao
mesmo tempo na mesma conta) e verifica cada reserva no Hunit, só lendo, antes de escrevê-la na aba
"A cobrar": a que não exige mais cobrança é retirada. A linha enviada conta como tratativa (situação
"Tratativa enviada"). A planilha é uma projeção do banco: o servidor a reconcilia em rodadas
(`src/commercial-sheet/sync.ts`), restaura células do sistema alteradas e nunca escreve o nome do
hóspede. O Comercial preenche o retorno (código de autorização, hotel da cobrança, valor cobrado e
responsável); o servidor o lê, a reserva fica "Validar comprovante" (`detailedSituation =
return_pending`; `situation` continua `treatment_sent` para o app 1.6.0) e o Financeiro confirma
(vale como comprovante e o valor do Comercial vira o valor cobrado, com a origem) ou recusa com o
motivo. Vieram também "Verificar" em lote (`POST /treatment-reviews`), "selecionar todas do filtro"
(`GET /reservations/selection`, até 2 000), a coluna "Valor cobrado" e "Copiar para e-mail" (tabela
montada no processo principal do app com `@hunit/domain`, sem o hóspede). O contrato passou para a
1.7.0 (só acréscimos: `/commercial-dispatches`, `/commercial-returns`, `/commercial-sheet`,
`/treatment-reviews`, `/reservations/selection`, `/reservations/{h}/{n}/commercial`,
`Reservation.commercial`, `detailedSituation`, `chargedAmountOrigin`), e a área "Comercial" entrou
no app. Sem `COMMERCIAL_SHEET_ID` e `COMMERCIAL_SHEET_KEY_FILE`, o envio fica desligado e o resto
funciona. O ID e a chave da planilha são segredos: entram no `SecretRegistry` e nunca aparecem em
logs, respostas ou mensagens (teste `commercial-markers.test.ts`).

Desde a feature 006 (`specs/006-redesign-app-desktop/`), o app desktop tem o visual do design
oficial da UX (arquivo Hunit Control no Figma): fundo cinza claro com cards brancos, menu lateral
flutuante (só os ícones abaixo de 1 180 px), a fonte Manrope, a marca e o ícone novos, uma ação
principal por bloco (preta, ou lima na superfície escura) e cores de significado fixo nos selos
(verde concluído, âmbar atenção, vermelho erro, lima em andamento, cinza neutro). A lista de
reservas tem cinco colunas, a busca única (texto ou valor), o painel "Filtros avançados", a linha
"Filtros aplicados", os filtros rápidos com contagem (Todas, Falta cobrar, A verificar, Com erro,
Concluídas) e a ordem por hotel e check-in; a seleção em lote usa a barra escura com "Anexar ▾" e
"Confirmar ▾"; as gavetas e os diálogos seguem dois tamanhos padrão; as execuções e os envios em
andamento aparecem em cards escuros no topo, e as encerradas no "Histórico". O contrato passou para
a 1.8.0 (só acréscimos: `quickFilter` e `order` em `/reservations` e `/reservations/selection` e
`GET /reservations/quick-filter-counts`; o app 0.2 continua funcionando). Toda a interface usa os
componentes de `src/renderer/src/ui/`, sem exceções no lint. Dois roteiros de ponta a ponta conferem
as telas em 960, 1 280 e 1 920 px e com zoom de 125 % (`responsive.test.ts`) e o redimensionamento
sem perder o que foi feito (`resize.test.ts`); a comparação com o design fica em
`specs/006-redesign-app-desktop/research.md` ("Comparação com o design").

Desde a feature 008 (`specs/008-ajustes-cobranca-e-aviso/`), o app tem um som de aviso só (o do
app; as notificações do Windows vão sem som), com a chave "Tocar som do aviso" e o volume no card do
aviso da Configuração, gravados na hora e valendo antes da conexão. A planilha do Comercial ganhou as
colunas "Situação da cobrança" (sugestões "Cobrada na maquininha", "Cobrada no Hunit" e
"Cancelada", ou texto livre) e "Data da cobrança", as duas obrigatórias (a data não é pedida na
"Cancelada"; o que faltar vai para "Retornos com problema", e a data não bloqueia a confirmação):
"Cobrada na maquininha" é o retorno completo de antes; "Cobrada no Hunit" (responsável e data) entra
na fila "Cobradas no Hunit" da área Comercial, conferida no Hunit a cada execução ou por "Verificar
agora" (envio de verificação, `purpose = hunit_check`, com o token como os envios): "Confirmada no
Hunit" quando a leitura mostra a cobrança, senão "Não encontrada no Hunit", com a recusa do
Financeiro na planilha. O Financeiro marca uma reserva como "Cancelada sem cobrança"
(`POST /reservations/{h}/{n}/no-charge` e `…/no-charge/undo`, tabela `no_charge_marks`): a
classificação efetiva passa a `cancelled_no_charge` (valor a cobrar R$ 0,00, "Concluídas", fora do
envio, linha da planilha em "Concluídas") e a do Hunit fica guardada; desfazer volta tudo. A
"Cancelada" do Comercial (basta a situação; um texto que comece por "Cancelada" vale) aparece no topo
de "Retornos a validar" com o selo próprio: confirmar faz essa marcação
(`POST /reservations/{h}/{n}/commercial/cancellation/confirm`; desfazer a marcação a devolve para
validar), recusar (`…/cancellation/reject`) leva o motivo à coluna J, e o lote a aceita com
`includeCancellations` (homologação, research R-19; era "Não cobrada", em "Retornos com problema"). A busca
acha também pelo código de autorização do retorno do Comercial confirmado, os seletores dos filtros
aceitam busca pelo teclado (sem acento), o destaque da linha fica dentro do card das listas e o app
usa um AUMID próprio em desenvolvimento e o ícone da marca na janela empacotada (marca na barra de
tarefas). O contrato passou para a 1.9.0 (só acréscimos: `noCharge`, `amountToCharge`,
`commercial.report`, `chargeSituation`, `history`, `/commercial-hunit-charges` e o `check`,
`purpose` nos envios, `reports` na situação da planilha, as rotas da "Cancelada" e
`includeCancellations`), e o app para a 0.4.0; o app 0.3 continua funcionando.

Desde a feature 007 (`specs/007-relatorios-app-desktop/`), concluída depois da 008, o app tem a área
**Relatórios**, nos dois perfis, entre Comercial e Configuração: o panorama do período de check-in
(padrão "Últimos 30 dias", com atalhos e o calendário dos filtros), com Reservas, Tratativas enviadas e
"Hotéis com dados" ("X de Y"), o valor em aberto (solicitado = "Falta cobrar" com tratativa; pendente =
sem tratativa), o valor já cobrado (cobrado anteriormente = sem tratativa; recuperado = com tratativa
antes da cobrança), a distribuição dos valores e o ranking dos hotéis, com o detalhe do hotel (as
reservas em aberto, maiores primeiro) e "Todos os hotéis". As reservas "Ignorada (Hotelbeds 258)", "A
revisar (sistema anterior)" e "Faturada" ficam fora do relatório (FR-008a). "Ver as N reservas" abre
Reservas com o hotel, o período e "Falta cobrar"; se a contagem não bater, a lista avisa que o
relatório pode estar desatualizado. A regra das faixas fica no domínio (`packages/domain/src/report.ts`)
e o servidor a monta em SQL com a mesma CTE das contagens (teste de paridade). O contrato passou para a
1.10.0 (só acréscimos: `GET /reports/overview` e a ordem `amount_desc` das reservas), e o app para a
0.5.0; o app 0.4 continua funcionando. Depois do merge, a pedido do usuário (research R-14), o
relatório ganhou o botão "Filtros" ao lado do período, com o painel da área Reservas (sem o período,
com a Origem), "Filtros aplicados" e os filtros levados à gaveta do hotel e à ida para Reservas: o
contrato passou para a 1.11.0 (filtros opcionais da lista em `/reports/overview`, com as mesmas
condições, `filterConditions`) e o app para a 0.5.1; o servidor sobe antes do app. Para marcar as telas no Figma, rode a skill com a 008 como
feature concluída (a página 007 tem número menor: research R-13).
