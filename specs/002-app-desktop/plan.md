# Implementation Plan: App desktop para operar o HUNIT Control

**Branch**: `002-app-desktop` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-app-desktop/spec.md`

## Summary

App desktop em **Electron** (`apps/desktop`) para o Financeiro (perfil operador) e a Controladoria
(perfil consulta) usarem, sem conhecimento técnico, tudo o que o servidor da feature 001 já faz:
iniciar a consulta ao Hunit, responder ao pedido de token a tempo, acompanhar, cancelar e retomar
execuções, e consultar reservas e evidências.

Abordagem técnica (detalhes em [research.md](./research.md)):

- **Fronteira de segurança entre processos**: o processo principal concentra tudo o que é sensível
  ou acessa rede e disco — chave da API (cifrada com DPAPI), certificado do servidor, usuário e
  senha do Hunit (só em memória, com prazo de inatividade), chamadas HTTP e fluxo de eventos. A
  interface React roda isolada, sem Node e sem rede, e só fala com o principal por uma ponte
  estreita e validada ([contracts/ipc.md](./contracts/ipc.md)).
- **Confiança no servidor** só na autoridade interna do Caddy (feature 001, R-20), fixada no
  cliente HTTP do app, com verificação de nome — sem instalar nada no Windows.
- **Tempo real** pelo fluxo de eventos (SSE) aberto no principal: o pedido de token vira
  notificação do Windows, janela à frente e diálogo com contagem regressiva em segundos, mesmo com o
  app minimizado. O estado exibido vem sempre de `GET` na API; o app não recalcula nada (princípio
  III).
- **Servidor fora do ar**: cache só em memória (TanStack Query) mantém o que estava na tela, com o
  horário; nada de reservas no disco.
- **Acréscimos compatíveis à API** (contrato 1.3.0 → 1.4.0): `/me`, quem iniciou e filtro de ativas
  na lista de execuções, busca livre, canal e valor nas reservas, lista de canais e lista de
  evidências da execução ([contracts/api-changes.md](./contracts/api-changes.md)).
- **Instalador** NSIS por usuário (sem administrador), com as *fuses* de segurança do Electron.

## Technical Context

**Language/Version**: TypeScript 5.9 (`strict`); Electron 45 (Chromium 156, Node 24.22 — mesma
linha do Node 24 do monorepo); servidor inalterado (Node 24/26, ver 001 R-18)

**Primary Dependencies**: Electron 45, electron-vite 6 (Vite 8), electron-builder 26, React 19.3,
Mantine 9 (`core`, `hooks`, `dates`) + dayjs, TanStack Query 5, openapi-fetch (tipos de
`@hunit/contracts`), undici 8 (TLS com a raiz fixada), eventsource-parser 4, zod 4 (já usado no
servidor). No servidor: nenhuma dependência nova.

**Storage**: app — só `config.json` na pasta de dados do usuário (endereço, certificado raiz,
chave cifrada com `safeStorage`/DPAPI, preferências); nenhum dado de reserva ou credencial em disco.
Servidor — PostgreSQL da 001, sem tabela nem coluna nova; uma migration cria a extensão `unaccent`.

**Testing**: Vitest em três grupos novos — `desktop` (processo principal, Node), `desktop-ui`
(interface com Testing Library em `jsdom`) e `desktop-e2e` (Playwright `_electron` contra a API da
001 com `FakeHunitGateway`, PostgreSQL do Testcontainers e TLS com certificados gerados no teste por
`@peculiar/x509`) — mais testes de contrato dos acréscimos no `server-db`.

**Target Platform**: Windows 10/11 x64, instalação por usuário; servidor da 001 na rede local por
HTTPS.

**Project Type**: desktop-app (Electron) cliente da web-service existente, com acréscimos
compatíveis à API.

**Performance Goals**: aviso de token na tela em até 5 s após o pedido (SC-002); estado da execução
com atraso máximo de 5 s (FR-016); volta sozinho em até 30 s depois que o servidor reaparece
(SC-006); busca de reservas respondendo em menos de 1 s com o volume de 5 anos (meta interna para o
SC-005, medida na homologação).

**Constraints**: chave e senha nunca na interface nem no disco (FR-003, FR-007); nenhum dado de
reserva em disco (FR-008a); conexão só com o servidor de identidade confirmada (FR-002, SC-007);
app sem regra de negócio (FR-028, princípio III); sem execução em segundo plano depois de fechada a
janela (FR-026); instalador sem assinatura de código (R-11).

**Scale/Scope**: 4 usuários iniciais (2 operadores, 2 consulta), podendo chegar a algumas dezenas
se o Comercial entrar; 4 áreas de tela (Executar, Execuções, Reservas, Configuração) mais o diálogo
de token; cerca de 25 funções na ponte; reservas na casa de centenas de milhares em 5 anos.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Princípio | Avaliação | Status |
|---|---|---|---|
| I | Spec-First | Spec 002 especificada e clarificada (5 decisões) antes deste plano; o plano corrigiu a spec onde ela pedia algo inviável (detectar notificações bloqueadas → "Testar aviso", R-07) | ✅ |
| II | Isolamento do Hunit | O app não fala com o Hunit; nenhum acréscimo da API toca a camada do Hunit nem o `read-only-guard` | ✅ |
| III | API-First com Contrato | Tudo o que o app precisa entra primeiro no `openapi.yaml` (1.4.0, só acréscimos compatíveis); o app usa cliente tipado pelos tipos gerados; não acessa banco nem navegador automatizado; sem regra de negócio — o estado vem de `GET`, eventos são só sinais (R-06), e o que existe no app é apresentação (nomes, cores, formatos) e política local de segurança (cofre, inatividade) | ✅ |
| IV | Jobs Assíncronos com Intervenção Humana | O app usa os estados existentes; o token pode ser enviado de qualquer cliente operador (detalhe da execução), o aviso automático vai só para a máquina que iniciou (FR-012); retomada pela API existente | ✅ |
| V | Servidor Central e Containers | Servidor inalterado. O `config.json` do app é configuração da máquina cliente, não estado do servidor — o princípio V trata do servidor | ✅ |
| VI | Dados e Segurança | Chave cifrada por usuário do Windows; senha e token só na memória do processo principal; nenhuma reserva nem registro em disco; uma chave própria por máquina; interface isolada sem rede; conexão só com o servidor confirmado | ✅ |
| VII | Testes em Camadas | Testes de contrato para cada acréscimo da API; processo principal e interface com testes unitários; ponta a ponta com o app real (R-12) | ✅ |
| VIII | Simplicidade | Sem roteador, sem banco local, sem atualização automática, sem *logs* em arquivo; cada dependência justificada no research; os acréscimos à API são os mínimos exigidos pela spec | ✅ |

**Nota sobre "Observabilidade" (Restrições Técnicas)**: os logs estruturados em JSON valem para os
jobs, que rodam no servidor e continuam registrando tudo. O app não grava *logs* (R-14) para não
abrir uma via de vazamento de dados pessoais; erros aparecem na tela com um código.

**Resultado pré-Fase 0**: aprovado. **Resultado pós-Fase 1** (após data-model e contratos):
aprovado — nenhuma função da ponte devolve a chave ou a senha; nenhum acréscimo da API grava ou
devolve credenciais; todos os acréscimos são de leitura e compatíveis.

## Project Structure

### Documentation (this feature)

```text
specs/002-app-desktop/
├── spec.md              # especificação (/speckit-specify, /speckit-clarify)
├── plan.md              # este arquivo
├── research.md          # decisões técnicas (Fase 0)
├── data-model.md        # dados locais, estados e tabela de apresentação (Fase 1)
├── quickstart.md        # roteiro de validação (Fase 1)
├── contracts/
│   ├── api-changes.md   # acréscimos à API 1.3.0 → 1.4.0 (Fase 1)
│   ├── ipc.md           # ponte interface ↔ processo principal (Fase 1)
│   └── openapi.yaml     # espelho do contrato 1.4.0 (criado na implementação, R-15)
├── checklists/
│   └── requirements.md  # checklist de qualidade da spec
└── tasks.md             # Fase 2 (/speckit-tasks — não criado por este comando)
```

### Source Code (repository root)

```text
apps/desktop/                       # NOVO — app Electron
├── package.json                    # productName "HUNIT Control"; sem "dependencies" de execução (tudo empacotado pelo Vite, R-11)
├── electron.vite.config.ts         # main, preload e renderer
├── electron-builder.yml            # NSIS por usuário, appId, asar, fuses (R-11)
├── tsconfig.json                   # referências: tsconfig.node.json (main/preload/shared) e tsconfig.web.json (renderer)
├── resources/                      # ícone e som do aviso
├── src/
│   ├── shared/                     # usado pelos três processos
│   │   ├── ipc-channels.ts         # nomes dos canais
│   │   ├── ipc-schemas.ts          # zod: entrada de cada canal (contracts/ipc.md)
│   │   └── ipc-types.ts            # Result, ErrorCode, ConnectionState, TwoFactorRequest...
│   ├── main/                       # processo principal (Node) — único com rede, disco e segredos
│   │   ├── index.ts                # ciclo de vida: instância única, janela, fechamento (R-13)
│   │   ├── window.ts               # BrowserWindow endurecida, navegação e permissões bloqueadas (R-02)
│   │   ├── config-store.ts         # config.json atômico + safeStorage (R-04)
│   │   ├── certificate.ts          # leitura do PEM e impressão digital (X509Certificate)
│   │   ├── api-client.ts           # openapi-fetch + undici com a raiz fixada; diferença de relógio (R-03, R-07)
│   │   ├── connection.ts           # máquina de estados da conexão; health a cada 5 s (R-08)
│   │   ├── credentials-vault.ts    # cofre em memória com prazo de inatividade (R-05)
│   │   ├── execution-watcher.ts    # SSE com Last-Event-ID; execuções desta máquina (R-06)
│   │   ├── attention.ts            # notificação, janela à frente, som (R-07)
│   │   ├── evidence-download.ts    # download + "Salvar como" (FR-024)
│   │   └── ipc-handlers.ts         # registra os canais, valida a entrada, converte erros
│   ├── preload/
│   │   └── index.ts                # contextBridge → window.hunit
│   └── renderer/                   # interface React — sem Node, sem rede (CSP connect-src 'none')
│       ├── index.html              # CSP
│       └── src/
│           ├── main.tsx            # MantineProvider (pt-BR), QueryClient sem persistência
│           ├── App.tsx             # AppShell: Executar, Execuções, Reservas, Configuração
│           ├── hunit.ts            # window.hunit tipado + hooks do TanStack Query
│           ├── presentation/       # labels.ts (data-model §6), format.ts (datas, BRL, campo de valor)
│           ├── components/         # ConnectionBanner, StaleDataNotice, StatusBadge, TwoFactorDialog
│           └── screens/            # setup/, run/ (US1), executions/ (US2), reservations/ (US3)
└── test/
    ├── main/                       # grupo "desktop"
    ├── renderer/                   # grupo "desktop-ui"
    ├── e2e/                        # grupo "desktop-e2e" (Playwright _electron)
    └── helpers/                    # certificados gerados no teste, terminador TLS, servidor de teste

apps/server/                        # acréscimos compatíveis (R-10)
├── src/http/handlers/
│   ├── clients.ts                  # NOVO — GET /me
│   ├── executions.ts               # requestedClient na lista; filtro active; GET /executions/{id}/evidence
│   └── reservations.ts             # q, channel, amount; GET /channels
├── src/persistence/
│   ├── executions-repo.ts          # junção com api_clients na lista; filtro de ativas
│   ├── reservations-repo.ts        # condições de busca (unaccent)
│   └── migrations/                 # nova: CREATE EXTENSION IF NOT EXISTS unaccent
├── src/evidence/store.ts           # lista de evidências por execução
└── test/
    ├── contract/                   # um teste de contrato por acréscimo
    └── helpers/e2e-server.ts       # NOVO — sobe a API de teste para o desktop-e2e

packages/contracts/openapi.yaml     # 1.4.0 (+ generated.ts regenerado)
vitest.config.ts                    # grupos desktop, desktop-ui, desktop-e2e
eslint.config.js                    # renderer sem electron/node:*/undici e sem localStorage; plugin react-hooks
pnpm-workspace.yaml                 # allowBuilds: electron = true (download do binário, R-11)
AGENTS.md                           # estrutura (apps/desktop), comandos e regra do espelho do contrato (R-15)
```

**Structure Decision**: o app entra como `apps/desktop`, ao lado de `apps/server`, consumindo só os
tipos de `packages/contracts` — como previsto na constitution ("monorepo com pacote de tipos
compartilhados entre API e Electron") e no plano da 001. Dentro do app, a separação por processo
(`main`, `preload`, `renderer`, `shared`) é a própria fronteira de segurança: o ESLint impede o
renderer de importar Electron, Node ou o cliente HTTP, do mesmo jeito que já impede o domínio de
importar infraestrutura.

## Fluxo de referência: iniciar e responder ao token

```text
Interface                         Processo principal                         Servidor (API 001)
─────────                         ──────────────────                         ──────────────────
credentials.set(usuário, senha) ─► cofre (memória)
executions.start(período, hotéis)► lê o cofre ─► POST /executions ─────────► queued → running
                                  ◄─ Execution (202) ─ watch: GET /executions/{id}/events (SSE)
                                                         ◄── status_changed: awaiting_2fa (≤ 5 s)
                                  GET /executions/{id} → twoFactorDeadline
                                  notificação + janela à frente + som
twoFactor.onRequested ◄────────── (prazo, diferença de relógio)
diálogo + contagem regressiva
executions.sendToken(token) ─────► POST /executions/{id}/two-factor ────────► 202
                                                         ◄── status_changed: running / failed
twoFactor.onClosed ◄────────────── executions.onChanged → interface faz GET do estado
```

## Riscos e dependências

| Risco | Impacto | Mitigação |
|---|---|---|
| Windows impede o app de tomar o foco do teclado | Operador perde segundos para achar o diálogo | Janela à frente e piscando + notificação + som; foco no campo ao clicar; medido na homologação (R-07, SC-002) |
| Notificações do app desativadas no Windows | Aviso do sistema não aparece | Aviso dentro do app independe delas; "Testar aviso" na configuração (R-07) |
| Instalador sem assinatura (SmartScreen) | Usuário assustado ou bloqueio por política da TI | Passo a passo no quickstart; reavaliar assinatura se o Comercial entrar (R-11) |
| Electron grava *minidump* com a memória do processo | Senha em disco | Verificar na implementação; esvaziar a pasta ao iniciar; varredura do SC-004 inclui a pasta (R-14) |
| Busca sem índice fica lenta com o volume de anos | SC-005 em risco | Medir na homologação; índice de trigramas sem mudar o contrato (R-10) |
| Relógio da máquina diferente do servidor | Contagem do token errada | Diferença calculada pelo cabeçalho `Date` das respostas (R-07) |
| Electron-builder com a estrutura de pastas do pnpm | Pacote sem dependências | Tudo empacotado pelo Vite; `package.json` sem `dependencies` de execução (R-11) |
| Homologação da 001 (T062) ainda pendente | API pode mudar antes do app ficar pronto | Implementar a 002 depois do merge da 001; acréscimos desta feature são compatíveis |

## Complexity Tracking

Nenhuma violação da constitution a justificar. O pacote novo (`apps/desktop`) e o grupo de testes
com Docker (`desktop-e2e`) são previstos pela constitution (Electron como cliente) e pelo padrão de
testes do projeto; cada dependência nova está justificada no research.
