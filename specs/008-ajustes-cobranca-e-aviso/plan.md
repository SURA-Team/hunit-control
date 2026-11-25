# Implementation Plan: Ajustes de cobrança e do aviso de token

**Branch**: `008-ajustes-cobranca-e-aviso` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-ajustes-cobranca-e-aviso/spec.md`

## Summary

Leva para o app e o servidor os ajustes da página `008-ajustes-cobranca-e-aviso` do Figma e dois
ajustes vistos no uso: um único som no aviso do token, com volume e mudo; as colunas "Situação da
cobrança" e "Data da cobrança" na planilha do Comercial, mostradas no retorno; a fila "Cobradas no
Hunit" com o "Verificar agora"; a marcação "Cancelada sem cobrança", com confirmação e desfazer; o
ícone certo na barra de tarefas do Windows; a busca pelo teclado em todos os seletores de filtro; e a
correção da busca, que passa a achar a reserva pelo código de autorização do retorno do Comercial
confirmado (item 1 do doc de ajustes da PM).

Abordagem técnica (detalhes em [research.md](./research.md)):

- **Som**: a notificação do Windows passa a ir sem som e o app toca o seu com o volume salvo
  (`soundVolume`, padrão 100); o card "Aviso do pedido de token" grava na hora e toca a amostra (R-03,
  R-04).
- **Planilha**: colunas O e P no fim, com lista sugerida não estrita e data estrita; `readReturn` lê as
  seis colunas e separa **retorno a validar** (como hoje) de **relato** ("Cobrada no Hunit", "Não
  cobrada"), guardado em `commercial_reports` (R-05, R-06).
- **Fila "Cobradas no Hunit"**: situação **derivada** da última leitura da reserva no Hunit depois do
  relato (vale o "Verificar agora" e as execuções). O "Verificar agora" é o executor dos envios com o
  propósito `hunit_check`: mesmo token, cancelamento, retomada e trava por conta, sem escrever na
  planilha (R-07).
- **Cancelada sem cobrança**: marcação em `no_charge_marks` que dá à reserva a **classificação
  efetiva** `cancelled_no_charge`; situação, "Falta cobrar", "Concluídas", envio e linha da planilha
  seguem sozinhos pelas regras que já existem, e a classificação do Hunit não muda (R-08).
- **Contrato 1.8.0 → 1.9.0**, só acréscimos: valores novos só em campos novos; o teste de enums
  congelados passa a cobrir as que o app 0.3 usa como chave (R-01, R-02;
  [contracts/api-changes.md](./contracts/api-changes.md)).
- **Ícone**: AUMID próprio para desenvolvimento e testes, ícone explícito na janela empacotada e
  `setAppDetails`; a implementação começa reproduzindo o problema (R-10).
- **Filtros**: busca pelo teclado como padrão dos componentes de seleção (R-11).
- **Busca pelo código do Comercial**: uma alternativa a mais na condição da busca livre (retorno
  confirmado com o mesmo código), que vale para lista, contagens e seleção de uma vez; sem campo novo
  na API (R-15).
- **Destaque da linha**: o card das listas corta o conteúdo no arredondado (`overflow: clip`), e o
  lima da seleção e o cinza do mouse deixam de sair dos cantos (R-16).
- **Regra da fila** (decisão do usuário): só é "Confirmada no Hunit" quando o Hunit mostra a cobrança;
  senão a planilha mostra "Recusado pelo Financeiro: cobrança não encontrada no Hunit" (R-07).

## Technical Context

**Language/Version**: TypeScript 5.9 (`strict`); Node 24 no servidor; Electron 45 e React 19 no app
(sem mudança de versão)

**Primary Dependencies**: as que já existem — Fastify, Drizzle, Playwright, googleapis no servidor;
Mantine 9 (`Slider`, `Combobox`), TanStack Query e electron-vite no app. Nenhuma dependência nova

**Storage**: PostgreSQL — 2 tabelas novas (`no_charge_marks`, `commercial_reports`), colunas novas em
`commercial_returns`, `commercial_dispatches` e `commercial_dispatch_items`, valores novos em 2 enums do
banco; uma migration ([data-model.md](./data-model.md)). App: `soundVolume` no arquivo de configuração

**Testing**: Vitest nos grupos existentes — `domain`, `contracts`, `server`, `server-db`,
`server-browser`, `desktop`, `desktop-ui`, `desktop-e2e` (R-12)

**Target Platform**: servidor Linux em container; app Windows 10/11 x64, janela de 960 × 640 a
monitores grandes

**Project Type**: web-service + desktop-app (monorepo)

**Performance Goals**: fila e contagem em até 1 s com 20 000 reservas (mesma meta da 006); verificação
de 50 reservas com resultado para cada uma (SC-005), no ritmo do envio de hoje; marcar ou desfazer em
menos de 1 minuto, com a resposta da API em até 1 s (SC-006)

**Constraints**: Hunit só leitura (lista de rotas permitidas sem mudança); app 0.3 funcionando contra
a 1.9.0; nenhum bloqueio por data da cobrança (FR-011); planilha sem nome do hóspede; servidor antes do
app e `commercial-sheet setup` logo depois do servidor (R-01, R-05); dados fictícios em prints e
testes

**Scale/Scope**: 10 telas do design (7 alteradas, 3 novas), 4 rotas novas, ~12 campos novos na API,
uma condição a mais na busca livre, 2 componentes de `ui/` (um novo, um alterado), 4 usuárias no app e
o Comercial na planilha

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Princípio | Avaliação | Status |
|---|---|---|---|
| I | Spec-First | Spec da PM clarificada; as perguntas abertas, a premissa errada sobre a 005, os dois ajustes novos e o bug da busca (item 1 do doc da PM, autorizado por ela) foram decididos com o usuário e registrados na spec (sessão "plano", histórias 6 e 7) antes deste plano; nenhum `[NEEDS CLARIFICATION]` restante | ✅ |
| II | Isolamento do Hunit | A verificação da fila reusa `findReservation` da camada do Hunit, só com leituras já permitidas; nenhuma rota nova na lista do `read-only-guard`; domínio e API recebem só objetos neutros | ✅ |
| III | API-First com Contrato | Tudo pela API 1.9.0 (marcar, desfazer, fila, verificação, situação e data); só acréscimos e enums do app 0.3 congelados por teste; o app só apresenta: regras no domínio e no servidor | ✅ |
| IV | Jobs Assíncronos com Intervenção Humana | "Verificar agora" é um job com os estados da constitution, token do operador, cancelamento e retomada, e respeita uma automação por conta; nada roda sozinho em segundo plano | ✅ |
| V | Servidor Central e Containers | Nenhum serviço, variável ou volume novo | ✅ |
| VI | Dados e Segurança | PostgreSQL continua a fonte da verdade: a planilha só informa relatos e retornos, que o servidor valida; nenhum dado do hóspede vai para a planilha; a observação da marcação e o texto livre da situação são apagados na anonimização; credenciais só no cofre e em memória | ✅ |
| VII | Testes em Camadas | Domínio com testes unitários; rotas com testes de contrato; paridade SQL × domínio; verificação contra o Hunit simulado com fixtures anonimizadas; telas e jornadas no app (R-12) | ✅ |
| VIII | Simplicidade | Nenhuma dependência nova; a verificação reusa o executor dos envios em vez de um job novo; a marcação reusa as regras existentes pela classificação efetiva; a fila não tem estado próprio (derivada) | ✅ |

**Resultado pré-Fase 0**: aprovado.

**Resultado pós-Fase 1** (após data-model e contratos): aprovado. Valores novos para o app 0.3 ficam em
campos novos; a única exceção (`CommercialDispatchItem.outcome` + `checked`) só aparece em
verificações, que o app 0.3 nunca recebe, e tem teste (R-02).

## Project Structure

### Documentation (this feature)

```text
specs/008-ajustes-cobranca-e-aviso/
├── spec.md              # especificação da PM + clarificações (sessão "plano")
├── plan.md              # este arquivo
├── research.md          # decisões técnicas e diferenças levadas à UX (Fase 0)
├── data-model.md        # tabelas, regras do domínio, estados e preferência do app (Fase 1)
├── quickstart.md        # testes, homologação, cenários, ícone, Figma e produção (Fase 1)
├── contracts/
│   ├── api-changes.md   # API 1.8.0 → 1.9.0 (Fase 1)
│   ├── sheet-layout.md  # colunas O e P e textos novos da planilha (Fase 1)
│   ├── ipc.md           # acréscimos à ponte do app (Fase 1)
│   ├── ui-components.md # Switch desligado, VolumeField, seletores com busca (Fase 1)
│   ├── screens.md       # as 10 telas da página 008, com node, história e código (Fase 1)
│   └── openapi.yaml     # espelho do contrato 1.9.0 (criado na implementação)
├── checklists/
│   └── requirements.md  # checklist de qualidade da spec
└── tasks.md             # Fase 2 (/speckit-tasks — não criado por este comando)
```

### Source Code (repository root)

```text
packages/domain/src/
├── commercial-return.ts      # seis colunas; recognizeChargeSituation, parseChargeDate; readReturn com `report`
├── commercial-report.ts      # NOVO — hunitChargeStatus, HUNIT_QUEUE_CONFIRMED_DAYS
├── commercial-sheet.ts       # 16 cabeçalhos; textos e tons novos da coluna J; valor a cobrar
├── commercial-dispatch.ts    # elegibilidade com a marcação; hunitCheckResult
├── treatment.ts              # effectiveClassification, amountToCharge, noChargeEligibility, hunitShowsCharge
└── index.ts
packages/domain/test/         # um arquivo por módulo alterado ou novo

packages/contracts/openapi.yaml     # 1.9.0 (contracts/api-changes.md)
packages/contracts/src/generated.ts # regenerado

apps/server/src/
├── persistence/schema.ts            # tabelas, colunas e enums novos
├── persistence/migrations/          # NOVO — próxima migration (db:generate)
├── persistence/reservations-repo.ts # classificação efetiva no SQL (situação, pendências, filtros rápidos, contagens); amountToCharge; busca pelo código do Comercial confirmado (freeTextCondition)
├── persistence/no-charge-repo.ts    # NOVO — marcar, desfazer, histórico
├── persistence/commercial-reports-repo.ts # NOVO — relatos, fila (SQL da situação derivada)
├── persistence/commercial-returns-repo.ts # situação e data no retorno
├── persistence/dispatches-repo.ts   # purpose, outcome `checked`, check_result
├── commercial-sheet/                # returns.ts (relatos), sync.ts (textos da J, valor), google-sheet-gateway.ts e sheet-appearance.ts (O, P, validação, proteção), layout.ts, command.ts (setup/check)
├── dispatches/runner.ts             # propósito hunit_check (verifica sem abrir linha)
├── maintenance/retention.ts         # apaga a observação e o texto livre da situação na anonimização
└── http/handlers/, http/views.ts, http/commercial-views.ts # rotas e campos novos
apps/server/test/
├── unit/contract-frozen-enums.test.ts  # enums do app 0.3
├── contract/                        # rotas e campos 1.9.0
└── integration/                     # paridade, fila, marcação, setup, verificação (server-db, server-browser)

apps/desktop/
├── electron-builder.yml             # extraResources: icon.ico
└── src/
    ├── shared/ipc-types.ts, ipc-schemas.ts, ipc-channels.ts   # contracts/ipc.md
    ├── main/attention.ts            # notificação sem som; volume no pedido de som
    ├── main/config-store.ts         # soundVolume (padrão 100)
    ├── main/index.ts                # AUMID por modo
    ├── main/window.ts               # ícone nos dois modos; setAppDetails
    ├── main/execution-watcher.ts    # envios e verificações
    ├── main/api-client.ts, ipc-handlers.ts, commercial-handlers.ts
    ├── preload/index.ts
    └── renderer/src/
        ├── App.tsx                  # som com volume
        ├── ui/fields/               # SwitchField (desligado), VolumeField (NOVO), SelectField e MultiSelectField com busca
        ├── ui/icons/                # som baixo e alto
        ├── ui/lists/ReservationRow.tsx  # valor a cobrar e selo da marcação
        ├── ui/lists/lists.module.css    # card e caixa interna cortam o destaque da linha (R-16)
        ├── presentation/labels.ts   # situações da cobrança, fila, marcação
        ├── screens/setup/           # card do aviso; Preferências sem a chave
        ├── screens/commercial/      # aba "Cobradas no Hunit" (HunitChargesTab NOVO), Retornos a validar, Retornos com problema
        └── screens/reservations/    # NoChargeSection (NOVO), CommercialSection, ConfirmBatchDialog, TreatmentSection, ReservationDetail, ReservationFilters
apps/desktop/test/                   # main (volume, AUMID, ícone, builder), renderer (telas), e2e (jornadas, screens-capture, larguras)

AGENTS.md                            # contrato 1.9.0 e cópia em specs/008; tabela de estrutura; parágrafo da feature 008
README.md                            # passo do `commercial-sheet setup` na atualização; colunas novas para o Comercial
```

**Structure Decision**: nenhum pacote ou app novo. As regras novas ficam em `packages/domain`; o
servidor ganha dois repositórios e estende o executor dos envios; o app ganha um componente de `ui/` e
duas telas (fila e card da marcação).

## Fluxos de referência

### Retorno da planilha → o que acontece

```text
Planilha (K..P) ──rodada do sincronizador──► readReturn (domínio)
   empty ─────────────► nada
   complete ──────────► commercial_returns (awaiting_validation, + situação e data) ─► "Retornos a validar"
   report hunit ──────► commercial_reports ─► fila "Cobradas no Hunit" (situação derivada) ─► J "Aguardando verificação no Hunit"
   report cancelada ► commercial_reports (aguardando validação) ─► "Retornos a validar" (CommercialSheetStatus.reports) ─► J "Cancelada: aguardando validação do Financeiro" (homologação, R-19; era "Não cobrada" em "Retornos com problema")
   incomplete/illegible ► return_problem (como hoje) ─► "Retornos com problema"
```

### "Verificar agora"

```text
App (operador) ─► POST /commercial-hunit-charges/check (credenciais do cofre)
  └─► CommercialDispatch purpose=hunit_check (queued → running → awaiting_2fa → running → completed)
        para cada relato awaiting ou not_found que ainda exige cobrança:
          findReservation (só leitura) ─► commitVerifiedReservation (dados, classificação, last_verified_at)
          └─► item checked: confirmed | not_found  (ou not_verified: situação na fila não muda)
        refreshCommercialLine: confirmada ─► linha para "Concluídas"
  App: card de andamento e token como no envio; ao terminar, recarrega a fila
```

### Marcar como cancelada sem cobrança

```text
Detalhe (operador) ─► diálogo (valor → R$ 0,00, "Concluídas", observação)
  └─► POST …/no-charge { expectedSituation, note }
        noChargeEligibility + situação conferida ─► 409 com o motivo | grava no_charge_marks
        classificação efetiva cancelled_no_charge ─► situação, filtros, contagens, envio
        refreshCommercialLine ─► linha "Concluídas", E = R$ 0,00, J "Cancelada sem cobrança pelo Financeiro"
  Desfazer ─► POST …/no-charge/undo { markId } ─► tudo volta a derivar da classificação do Hunit
```

## Riscos e dependências

| Risco | Impacto | Mitigação |
|---|---|---|
| Planilha da 005 fica "Formato alterado" até o `setup` | Envios e retornos param de ir para a planilha | `setup` é o passo 2 da atualização (quickstart §6); o `check` confirma; o estado aparece no app |
| Comercial escreve situações fora da lista | Relato não reconhecido | Lista sugerida na planilha; texto não reconhecido aparece como veio e segue as regras de hoje (FR-007a) |
| Classificação efetiva esquecida num lugar (SQL ou domínio) | Reserva marcada aparece como pendente em algum filtro | Uma função no domínio, uma expressão no SQL e o teste de paridade da 006 com reservas marcadas |
| App 0.3 recebe valor que não conhece | Tela quebra nas máquinas ainda não atualizadas | Valores novos só em campos novos; teste de enums congelados ampliado; lista de envios sem verificações por padrão (R-02) |
| Causa do ícone não ser nenhuma das duas hipóteses | Ícone continua errado | A tarefa começa reproduzindo; as três medidas são independentes; passo de limpar o cache no README se preciso (R-10) |
| Busca em seletores de 3 opções muda o visual (campo digitável) | Diferença pequena do design | O campo continua com a aparência do design; só aceita digitar; prints na comparação |
| 007 (relatórios) em paralelo mexer no contrato | Conflito de versão | 008 primeiro (1.9.0); a 007 parte dela (spec, premissas) |
| Diferenças do design (7.18 "Fora da planilha", telas não desenhadas) | Retrabalho com a UX | Levadas à UX no research (R-13) antes da implementação das telas |
| Subconsulta do SQL compara a coluna errada (visto na implementação, T028) | Num `select` de uma tabela só, o Drizzle escreve as colunas dos campos sem a tabela: dentro de uma subconsulta em `commercial_reports` ou `commercial_returns`, `hotel_code` vira o da subconsulta e a condição fica sempre verdadeira | As colunas da reserva vão por `qualified()` (`commercial-repo.ts`) em `noChargeMarkedCondition` e na busca pelo código do Comercial; testes com reservas que não deveriam combinar |

## Complexity Tracking

Nenhuma violação da constitution a justificar.
