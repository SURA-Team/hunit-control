# Implementation Plan: Envio dos pedidos de cobrança ao Comercial

**Branch**: `005-envio-comercial` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-envio-comercial/spec.md`

## Summary

O Financeiro envia ao Comercial as reservas que precisam de cobrança por uma planilha do Google Sheets
controlada pelo sistema. Cada envio faz login no Hunit com token, verifica cada reserva (só leitura) e
retira as que já foram cobradas. O Comercial preenche o retorno na própria linha; o servidor o lê e o
deixa em "Validar comprovante" até o Financeiro confirmar (individual ou em lote) ou recusar. Junto:
valor cobrado na lista, cópia das reservas para o corpo do e-mail, "Verificar" em lote e "selecionar
todas do filtro".

Abordagem técnica (detalhes em [research.md](./research.md)):

- **Envio como job próprio** (`commercial_dispatches`), com os estados e motivos das execuções; login,
  token e segredos extraídos do `ExecutionRunner` para um módulo comum; "uma automação por conta" entre
  execuções e envios com *advisory lock* (R-01).
- **Verificação por reserva** com as rotas já permitidas: listagem do hotel no dia do check-in +
  detalhe. Nenhuma rota nova no `read-only-guard`; grava com uma função de commit por reserva extraída
  da coleta (R-02).
- **Planilha** pela API REST do Google Sheets com `google-auth-library` (conta de serviço), atrás de
  `CommercialSheetGateway` (real e em memória). Chave como Docker secret; integração desligada sem
  configuração (R-03, R-04).
- **Preparação da planilha** pelo comando administrativo `commercial-sheet setup|check` (abas,
  cabeçalhos, formatos, proteções) (R-05).
- **Projeção por reconciliação**: estado desejado em `commercial_lines`; rodadas que leem as duas abas,
  processam os retornos e aplicam as diferenças num `batchUpdate`, sem tocar no retorno de linhas
  abertas; a cada mudança, a cada 10 min, na hora e com novas tentativas (R-06, R-07).
- **Retorno** interpretado por regras puras do domínio; retornos com problema só são relatados (R-08).
- **"Validar comprovante" como campo novo** (`detailedSituation`), não como valor novo de `situation`,
  que quebraria o app atual; histórico do Comercial em lista própria (R-09).
- **Contrato 1.6.0 → 1.7.0**, só acréscimos ([contracts/api-changes.md](./contracts/api-changes.md)).
- **App**: ações no lote, área "Comercial", envio com o mesmo aviso de token das execuções, cópia para
  e-mail pelo processo principal (R-12, R-14).

## Technical Context

**Language/Version**: TypeScript 5.9 (`strict`), Node 24 no servidor; Electron 45 no app (sem mudança
de versão)

**Primary Dependencies**: servidor — `google-auth-library` (nova, token da conta de serviço, R-03);
Sheets por `fetch`. Já existentes: Fastify, Drizzle, Playwright, Zod. App — nenhuma nova (área de
transferência pelo `clipboard` do Electron)

**Storage**: PostgreSQL — 7 tabelas novas, 5 enums novos e `reservations.last_dispatch_id`, numa
migration do `db:generate` ([data-model.md](./data-model.md)). Nenhum arquivo em disco além do Docker
secret com a chave da planilha

**Testing**: Vitest nos grupos existentes — `domain`, `contracts`, `server` (adaptador do Sheets com
`MockAgent` do `undici`), `server-db`, `desktop`, `desktop-ui`, `desktop-e2e` (R-16)

**Target Platform**: servidor Linux em container (PC de produção), com saída para a internet (Hunit e
APIs do Google); app Windows 10/11 x64

**Project Type**: web-service (job novo, sincronizador e acréscimos compatíveis na API) +
desktop-app cliente + comando administrativo

**Performance Goals**: 20 reservas na planilha em até 5 min depois do token (SC-002); retorno no app em
até 15 min sozinho ou 1 min sob pedido (SC-004); pendências aplicadas até 15 min depois de a planilha
voltar (SC-010); selecionar 2 000 do filtro em até 5 s (SC-015)

**Constraints**: só leituras no Hunit (SC-008) e sem rota nova; nada do Comercial muda uma reserva sem
o Financeiro (SC-006); zero nome de hóspede na planilha e na cópia (SC-007, FR-027); zero segredo da
planilha fora do servidor (SC-009); API só com acréscimos, sem quebrar o app atual (R-09); uma
automação por conta do Hunit (constitution IV)

**Scale/Scope**: dezenas de reservas por envio e alguns envios por dia (até 2 000 por envio e por
lote); centenas de linhas em "A cobrar"; ~20 rotas novas; 1 área nova e 1 tela alterada no app
(Reservas)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Princípio | Avaliação | Status |
|---|---|---|---|
| I | Spec-First | Spec 005 escrita e clarificada (colunas e 5 decisões, mais 3 pedidos acrescentados, 2026-11-17). O plano não mudou comportamento da spec; as escolhas de "como" que tocam a spec estão registradas como compatíveis com ela (R-09: "Validar comprovante" como campo novo; R-11: desfazer o envio como ação própria) | ✅ |
| II | Isolamento do Hunit | A verificação por reserva fica na camada do Hunit (`findReservation` no `HunitGateway`) e usa só `GetBookings` e `BookingDetail`, já permitidas e testadas; nenhuma rota nova no `read-only-guard` (R-02). O envio e o sincronizador só recebem objetos do domínio | ✅ |
| III | API-First com Contrato | Tudo o que os clientes usam entra antes no `openapi.yaml` 1.7.0, só com acréscimos; um teste garante que enums usados pelo app atual não ganharam valores (R-09, R-13). O app só apresenta. `commercial-sheet setup/check` é **comando administrativo de implantação** (exceção do princípio III): não é usado pelos clientes, não acessa o Hunit, e o estado que ele afeta fica visível em `GET /commercial-sheet` (R-05) | ✅ |
| IV | Jobs Assíncronos com Intervenção Humana | O envio é um job com os estados `queued`, `running`, `awaiting_2fa`, `completed`, `failed`, `cancelled`, token aceito de qualquer cliente autorizado com o tempo limite da 001, retomável (envio filho com as reservas não verificadas, o equivalente ao "último hotel concluído") e sujeito à regra de uma automação por conta, agora entre execuções e envios (R-01) | ✅ |
| V | Servidor Central e Containers | Tudo no container `server`, configurado por variáveis de ambiente (`COMMERCIAL_SHEET_ID`, `COMMERCIAL_SHEET_KEY_FILE`, `COMMERCIAL_SHEET_DONE_RETENTION_DAYS`); a chave é um Docker secret, não estado em disco. Nenhum serviço novo | ✅ |
| VI | Dados e Segurança | PostgreSQL continua a fonte da verdade: a planilha é **projeção** (reconstruída do banco, R-06) e **entrada** do retorno, que só muda a reserva depois da validação do Financeiro (R-08) — leitura como entrada, não como fonte da verdade. Sem nome de hóspede na planilha e na cópia; chave da planilha só no servidor, registrada no `SecretRegistry`, erros convertidos em códigos (R-04). Credenciais do Hunit como nas execuções. Tudo entra nas cópias cifradas | ✅ |
| VII | Testes em Camadas | Domínio com testes unitários; rotas com testes de contrato 1.7.0; camada do Hunit testada com as fixtures existentes (`findReservation`); a lista de rotas do guard não muda e seu teste continua; adaptador do Sheets com HTTP falso; marcadores para SC-007 e SC-009 (R-16) | ✅ |
| VIII | Simplicidade | Uma dependência nova; sem fila, serviço ou processo novo (sincronizador e envio no processo do servidor, como a retenção e as execuções); reaproveita estados, eventos SSE, aviso de token, seleção e padrão de lotes. As 7 tabelas novas correspondem a entidades da spec (envio, itens, eventos, linha, retorno, histórico, estado da planilha) | ✅ |

**Resultado pré-Fase 0**: aprovado.

**Resultado pós-Fase 1** (após data-model e contratos): aprovado. As rotas de escrita novas são todas
de perfil operador e não acessam o Hunit, exceto o envio, que só lê. A planilha recebe só as colunas do
[sheet-layout.md](./contracts/sheet-layout.md). O único dado que vem de fora (retorno do Comercial) é
validado no domínio e não muda a situação da reserva sem a confirmação de um operador.

## Project Structure

### Documentation (this feature)

```text
specs/005-envio-comercial/
├── spec.md              # especificação (/speckit-specify + clarificações)
├── plan.md              # este arquivo
├── research.md          # decisões técnicas (Fase 0)
├── data-model.md        # tabelas, regras do domínio e estados (Fase 1)
├── quickstart.md        # testes, cenários de aceite e homologação (Fase 1)
├── contracts/
│   ├── api-changes.md   # acréscimos à API 1.6.0 → 1.7.0 (Fase 1)
│   ├── sheet-layout.md  # abas, colunas e proteções da planilha (Fase 1)
│   ├── cli.md           # comando commercial-sheet (Fase 1)
│   ├── ipc.md           # acréscimos à ponte do app (Fase 1)
│   └── openapi.yaml     # espelho do contrato 1.7.0 (criado na implementação)
├── checklists/
│   └── requirements.md  # checklist de qualidade da spec
└── tasks.md             # Fase 2 (/speckit-tasks — não criado por este comando)
```

### Source Code (repository root)

```text
packages/domain/src/
├── commercial-dispatch.ts          # NOVO — elegibilidade, desfecho, desfazer/reverter linha (data-model §3.1)
├── commercial-return.ts            # NOVO — leitura e validação do retorno (R-08)
├── commercial-sheet.ts             # NOVO — abas, colunas, rótulos, linha e cópia sem hóspede
├── treatment.ts                    # detailedSituation, effectiveChargedAmount com origem, lineState (R-09, R-10)
└── index.ts
packages/domain/test/               # um .test.ts por arquivo acima

packages/contracts/openapi.yaml     # 1.7.0 (+ src/generated.ts regenerado)

apps/server/src/
├── hunit-session/                  # NOVO — login, token, segredos, retry (extraído do ExecutionRunner, R-01)
├── executions/runner.ts            # passa a usar hunit-session; lock da conta compartilhado com os envios
├── dispatches/                     # NOVO
│   ├── runner.ts                   # DispatchRunner: estados, verificação por reserva, cancelar, retomar
│   ├── events.ts                   # eventos SSE (como executions/events.ts)
│   └── resume.ts
├── hunit/
│   ├── gateway.ts                  # findReservation (R-02)
│   ├── playwright-gateway.ts       # implementação com searchBookings + readBookingDetail
│   └── read-only-guard.ts          # sem mudança (teste confere)
├── commercial-sheet/               # NOVO
│   ├── gateway.ts                  # CommercialSheetGateway (interface)
│   ├── google-sheet-gateway.ts     # REST do Sheets + google-auth-library; erros → códigos (R-03, R-04)
│   ├── memory-sheet-gateway.ts     # para os testes e o desktop-e2e
│   ├── key.ts                      # carrega a chave do secret e registra no SecretRegistry
│   ├── layout.ts                   # setup/check do formato (R-05)
│   ├── sync.ts                     # rodadas de reconciliação, gatilhos e novas tentativas (R-06, R-07)
│   └── returns.ts                  # aplica os retornos lidos (R-08)
├── cli.ts                          # subcomando commercial-sheet setup|check
├── config.ts                       # COMMERCIAL_SHEET_ID, COMMERCIAL_SHEET_KEY_FILE, COMMERCIAL_SHEET_DONE_RETENTION_DAYS
├── main.ts                         # inicia o sincronizador
├── persistence/
│   ├── schema.ts                   # 7 tabelas, 5 enums, reservations.last_dispatch_id
│   ├── dispatches-repo.ts          # NOVO
│   ├── commercial-repo.ts          # NOVO — linhas, retornos, eventos, estado da planilha
│   ├── reservations-repo.ts        # commitVerifiedReservation; filtros detailedSituation, sentToCommercial; seleção
│   ├── treatments-repo.ts          # situação com linha e retorno; "Verificar" em lote
│   └── migrations/                 # 0011 gerada pelo db:generate
├── legacy-import/applier.ts        # "verificada pelo HUNIT Control" inclui last_dispatch_id (R-02)
├── http/
│   ├── handlers/dispatches.ts      # NOVO
│   ├── handlers/commercial.ts      # NOVO — por reserva, retornos, planilha
│   ├── handlers/treatments.ts      # POST /treatment-reviews
│   ├── handlers/reservations.ts    # filtros novos e /reservations/selection
│   └── views.ts                    # campos novos
└── maintenance/retention.ts        # anonimização apaga motivo e último retorno lido e tira a linha (R-15)
apps/server/package.json            # google-auth-library; script commercial-sheet
apps/server/test/
├── unit/                           # adaptador do Sheets (MockAgent), segredos, compose-config (secret)
├── contract/                       # rotas e campos 1.7.0; enums congelados
└── integration/                    # dispatch*, commercial-sync*, commercial-returns*, batches, selection, markers

apps/desktop/src/
├── shared/ipc-schemas.ts, ipc-types.ts      # contracts/ipc.md
├── main/
│   ├── api-client.ts                        # rotas novas
│   ├── dispatches.ts                        # NOVO — start/resume com o cofre de credenciais
│   ├── clipboard.ts                         # NOVO — monta HTML + texto e grava na área de transferência
│   ├── execution-watcher.ts                 # também os envios
│   └── ipc-handlers.ts
└── renderer/src/
    ├── presentation/labels.ts               # "Validar comprovante", origens do valor, estados do retorno e do envio
    ├── state/selection.tsx                  # selecionar todas do filtro
    ├── screens/reservations/                # ações do lote, coluna "Valor cobrado", filtros, seção "Comercial" no detalhe
    ├── screens/dispatch/                    # NOVO — diálogo de envio e acompanhamento
    └── screens/commercial/                  # NOVO — Envios, Retornos a validar, Retornos com problema, Planilha
apps/desktop/test/                           # main/, renderer/, e2e/ (screens-capture com as telas novas)

docker-compose.yml                  # secret commercial_sheet_key; variáveis novas
.env.example                        # variáveis novas, com comentário
.gitignore                          # deploy/secrets/
deploy/homolog/                     # planilha e chave próprias da homologação (R-17)
AGENTS.md                           # comando commercial-sheet, contrato 1.7.0, espelho em specs/005, feature 005
README.md                           # "Planilha do Comercial": criar, compartilhar, setup, check
```

**Structure Decision**: nenhum pacote ou app novo. Dois módulos novos no servidor: `dispatches/` (o job,
irmão de `executions/`) e `commercial-sheet/` (a integração com a planilha, isolada atrás de uma
interface como a camada do Hunit). O que é comum às execuções e aos envios (login, token, segredos)
sai para `hunit-session/`. As regras de negócio novas ficam em `packages/domain`. O app ganha uma área
e as ações no lote, sem regra de negócio.

## Fluxos de referência

### Envio

```text
App (operador)            API / DispatchRunner                 Hunit (só leitura)      PostgreSQL / Planilha
──────────────            ────────────────────                 ──────────────────      ─────────────────────
check (seleção) ────────► elegibilidade (domínio) ◄───────────────────────────────────── reservas, linhas, retornos
start + credenciais ────► lock da conta (execuções + envios) ─────────────────────────► commercial_dispatches
                          hunit-session: login ──────────────► login
aviso do token ◄───────── awaiting_2fa (SSE)
token ──────────────────► submitToken ────────────────────────► 2FA
                          por reserva, uma por vez:
                            findReservation ─────────────────► GetBookings (dia) + BookingDetail
                            classificar (domínio)
                            commitVerifiedReservation ─────────────────────────────────► reservations
                            sent → linha open + evento; withdrawn/not_verified → item ─► commercial_lines/events
                            agenda rodada da planilha (5 s)
acompanhamento ◄───────── eventos SSE                                                   sincronizador ─► planilha
```

### Rodada da planilha

```text
gatilho (mudança, 10 min, "Ler agora", nova tentativa)
  └─► lê "A cobrar" e "Concluídas" (batchGet) ─► confere formato
      ├─► retornos das linhas abertas → domínio (readReturn) → retornos e problemas no banco
      └─► diferenças por linha (Hotel + Reserva) → um batchUpdate:
            células do sistema, linhas novas, mover para "Concluídas", reconstruir, apagar vencidas
      └─► synced_version = version; commercial_sheet_state
  falha → códigos (R-04), próxima tentativa em 1, 2, 4, 5 min
```

## Riscos e dependências

| Risco | Impacto | Mitigação |
|---|---|---|
| Comercial digita numa linha no instante em que ela é movida | Perde a digitação naquela linha | Só move linhas sem retorno esperado (concluídas ou canceladas); o lido antes fica no histórico (R-06) |
| Check-in da reserva mudou no Hunit | Reserva "não encontrada" no envio | Relatada com o motivo; avaliar o filtro por número na homologação (R-02) |
| Mudança de formato na planilha (aba renomeada, cabeçalho apagado) | Rodadas param | Estado `layout_invalid` visível no app; `setup` refaz o formato (R-05) |
| Erro da biblioteca do Google com token ou endereço | Segredo em log | Erros convertidos em códigos no adaptador; marcadores nos testes (R-04) |
| Cota da API do Google | Rodadas recusadas | 2–3 chamadas por rodada; `sheet_rate_limited` entra nas novas tentativas |
| Refatorar login/token do `ExecutionRunner` | Regressão nas execuções | Testes existentes das execuções rodam antes e depois da extração; extração numa task própria, sem mudar comportamento |
| App atual (0.x) contra a API 1.7.0 | Tela quebrada | Enums congelados por teste; campos e filtros novos são opcionais (R-09) |
| Conta de serviço sem acesso (planilha não compartilhada) | Envios ficam pendentes na planilha | `check` antes de liberar; pendência e falha visíveis no app |

## Complexity Tracking

Nenhuma violação da constitution a justificar.
