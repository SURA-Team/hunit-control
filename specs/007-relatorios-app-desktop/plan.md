# Implementation Plan: Módulo de Relatórios do app desktop

**Branch**: `007-relatorios-app-desktop` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-relatorios-app-desktop/spec.md`

## Summary

Leva para o app a área "Relatórios" da página `007-relatorios-app-desktop` do Figma (telas 8.1 a 8.7):
o resumo do período de check-in (reservas, tratativas enviadas, hotéis com dados), o valor em aberto
(solicitado e pendente), o valor já cobrado (cobrado anteriormente e recuperado), a distribuição dos
valores, o ranking dos hotéis com o detalhe e o caminho até as reservas em aberto, para os dois
perfis, com os estados de carregamento, vazio e servidor indisponível. Tudo só leitura.

Abordagem técnica (detalhes em [research.md](./research.md)):

- **Regra no domínio**: módulo `report.ts` com as reservas do relatório (sem Ignorada, A revisar e
  Faturada), a faixa de cada reserva, o valor, os percentuais e os atalhos do período (R-03).
- **Servidor**: uma rota `GET /reports/overview` com os totais e uma linha por hotel, numa consulta
  que reaproveita a CTE dos fatos da tratativa das contagens da 006; paridade SQL × domínio × lista
  (R-02, R-04, R-05).
- **Contrato 1.9.0 → 1.10.0**, só acréscimos: a rota e a ordem `amount_desc` das reservas, usada pela
  gaveta do hotel (R-01, R-07; [contracts/api-changes.md](./contracts/api-changes.md)).
- **App 0.5**: área nova no menu; período com atalhos e o `PeriodPicker`; cache por período sem
  atualização automática; ranking e "Todos os hotéis" ordenados no app; a ida para Reservas leva os
  filtros e a quantidade anunciada (R-06 a R-09).
- **Interface**: três componentes novos em `ui/` (barra em segmentos, legenda, linha do ranking) e um
  ícone; o resto vem da 006 (R-10).
- **Sem banco novo**: nenhuma tabela, coluna ou migration.

## Technical Context

**Language/Version**: TypeScript 5.9 (`strict`); Node 24 no servidor; Electron 45 e React 19 no app
(sem mudança de versão)

**Primary Dependencies**: as que já existem — Fastify e Drizzle no servidor; Mantine 9 (layout),
TanStack Query, dayjs e electron-vite no app. Nenhuma dependência nova (sem biblioteca de gráficos)

**Storage**: PostgreSQL, sem mudança (leitura de `reservations`, `hotels` e das tabelas da tratativa,
do Comercial e da marcação). App: nada em disco (período só enquanto aberto)

**Testing**: Vitest nos grupos existentes — `domain`, `contracts`, `server`, `server-db`, `desktop`,
`desktop-ui`, `desktop-e2e` (R-11)

**Target Platform**: servidor Linux em container; app Windows 10/11 x64, janela de 960 × 640 a
monitores grandes

**Project Type**: web-service + desktop-app (monorepo)

**Performance Goals**: resumo em até 1 s no servidor com 35 000 reservas no período; relatório
completo em até 3 s na troca de período (SC-003); busca e ordenação dos hotéis instantâneas (no app)

**Constraints**: só leitura (FR-003); sem acesso ao Hunit; app 0.4 funcionando contra a 1.10.0;
nenhum dado de hóspede no resumo (FR-027; a gaveta do hotel usa a lista de reservas, liberada aos dois
perfis); números iguais aos da área Reservas pelas mesmas regras (FR-028); dados fictícios em prints
e testes

**Scale/Scope**: 7 telas do design (todas novas), 1 rota nova, 1 valor novo em `order`, 1 módulo de
domínio, 3 componentes de `ui/`, 4 usuárias, dezenas de hotéis e ~35 000 reservas por período longo

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Princípio | Avaliação | Status |
|---|---|---|---|
| I | Spec-First | Spec da PM (16/11) clarificada em 2026-11-25 (cinco perguntas, a lista das situações conferida uma a uma com o usuário e duas decisões do plano sobre a tela 8.7), alinhada ao design e à `master` atual; nenhum `[NEEDS CLARIFICATION]` | ✅ |
| II | Isolamento do Hunit | O módulo não acessa o Hunit; lê só o que as execuções e os envios já gravaram | ✅ |
| III | API-First com Contrato | Os números vêm da API 1.10.0 (rota nova, só acréscimos); as regras ficam no domínio e no servidor; o app só formata, ordena e filtra a lista de hotéis que recebeu | ✅ |
| IV | Jobs Assíncronos | Nenhum job novo; consulta síncrona e curta | ✅ |
| V | Servidor Central e Containers | Nenhum serviço, variável ou volume novo | ✅ |
| VI | Dados e Segurança | O resumo só tem agregados e nomes de hotéis; o hóspede só aparece na gaveta, pela rota de reservas que os dois perfis já usam; log das requisições sem a query, como hoje | ✅ |
| VII | Testes em Camadas | Domínio com testes unitários; rota com teste de contrato; paridade SQL × domínio × lista; telas e jornada no app (R-11) | ✅ |
| VIII | Simplicidade | Nenhuma dependência, tabela, cache no servidor ou job; uma rota; a CTE da 006 é reaproveitada, não copiada; barras simples em componentes próprios | ✅ |

**Resultado pré-Fase 0**: aprovado.

**Resultado pós-Fase 1** (após data-model e contratos): aprovado. A única mudança em rota existente é
um valor novo no parâmetro de entrada `order`, que o app 0.4 não manda; nenhuma enumeração congelada
muda.

## Project Structure

### Documentation (this feature)

```text
specs/007-relatorios-app-desktop/
├── spec.md              # especificação da PM + clarificações de 2026-11-25
├── plan.md              # este arquivo
├── research.md          # decisões técnicas e diferenças do design (Fase 0)
├── data-model.md        # regras do domínio e formato do resumo (Fase 1)
├── quickstart.md        # testes, homologação, cenários, Figma e produção (Fase 1)
├── contracts/
│   ├── api-changes.md   # API 1.9.0 → 1.10.0 (Fase 1)
│   ├── ipc.md           # acréscimos à ponte do app (Fase 1)
│   ├── ui-components.md # componentes novos de ui/ (Fase 1)
│   ├── screens.md       # as 7 telas da página 007, com node, história e código (Fase 1)
│   └── openapi.yaml     # espelho do contrato 1.10.0 (criado na implementação)
├── checklists/
│   └── requirements.md  # checklist de qualidade da spec
└── tasks.md             # Fase 2 (/speckit-tasks — não criado por este comando)
```

### Source Code (repository root)

```text
packages/domain/src/
├── report.ts                 # NOVO — REPORT_EXCLUDED_SITUATIONS, reportBucket, reportAmount, distributionPercentages, reportPeriod
└── index.ts
packages/domain/test/report.test.ts   # NOVO

packages/contracts/openapi.yaml       # 1.10.0 (contracts/api-changes.md)
packages/contracts/src/generated.ts   # regenerado

apps/server/src/
├── persistence/reservations-repo.ts  # CTE dos fatos extraída (treatmentFactsSql) e reusada; order amount_desc (cursor)
├── persistence/reports-repo.ts       # NOVO — reportOverview (agrupa por hotel, soma no servidor)
├── http/handlers/reports.ts          # NOVO — GET /reports/overview (dois perfis)
├── http/report-views.ts              # NOVO — linha do banco → ReportOverview
└── http/app.ts                       # registra a rota
apps/server/test/
├── contract/                         # /reports/overview e order=amount_desc
└── integration/                      # paridade relatório × domínio × lista; volume; cursor (server-db)

apps/desktop/
├── package.json                      # 0.5.0
└── src/
    ├── shared/ipc-channels.ts, ipc-types.ts, ipc-schemas.ts   # contracts/ipc.md
    ├── main/api-client.ts, ipc-handlers.ts (ou reports-handlers.ts)
    ├── preload/index.ts
    └── renderer/src/
        ├── App.tsx                   # área "reports"; ReservationsPreset (generaliza initialExecutionId)
        ├── ui/charts/                # NOVO — StackedBar, LegendList
        ├── ui/lists/RankingRow.tsx   # NOVO
        ├── ui/icons/                 # ReportsIcon
        ├── presentation/report.ts    # NOVO — rótulos, ordenação e busca dos hotéis, textos do período
        ├── state/reports.ts          # NOVO — consulta por período (TanStack Query)
        ├── screens/reports/          # NOVO — ReportsScreen, ReportPeriodBar, VolumeCards, OpenValueCard, ChargedValueCard, ValueDistributionCard, HotelRankingCard, HotelDetailDrawer, AllHotelsDrawer
        └── screens/reservations/ReservationsScreen.tsx  # filtros iniciais do preset e aviso de divergência
apps/desktop/test/                    # main (ponte), renderer (telas, componentes), e2e (jornada, larguras, screens-capture 8.1–8.7)

AGENTS.md                             # contrato 1.10.0 e cópia em specs/007 (a da 008 congelada na 1.9.0); tabela de estrutura; parágrafo da 007
README.md                             # "Relatórios" na visão geral do app
```

**Structure Decision**: nenhum pacote ou app novo. A regra fica em `packages/domain`; o servidor ganha
um repositório e uma rota; o app ganha uma área, três componentes de `ui/` e os filtros iniciais da
área Reservas.

## Fluxos de referência

### Abrir ou trocar o período

```text
ReportsScreen (período) ─► state/reports (chave ['reports', from, to]) ─► window.hunit.reports.overview
  └─► main: valida ─► GET /reports/overview?checkInFrom&checkInTo
        reports-repo: treatmentFactsSql(período) ─► agrupa por hotel (FR-008a, faixas, valores)
        ─► ReportOverview { totais, hotelRows, generatedAt, lastVerifiedAt }
  App: carregando (sem números) ─► dados ("Dados atualizados") | vazio (8.4) | indisponível (8.5)
```

### Do ranking às reservas

```text
RankingRow ─► HotelDetailDrawer (linha do hotel do resumo)
  └─► GET /reservations?hotelCode&checkInFrom&checkInTo&quickFilter=pending_charge&order=amount_desc (50)
  "Ver as N reservas em Reservas" ─► App.ReservationsPreset { hotel, período, pending_charge, N }
        ─► área Reservas com os filtros ─► contagem "Falta cobrar" ≠ N? ─► aviso de divergência
```

## Riscos e dependências

| Risco | Impacto | Mitigação |
|---|---|---|
| Regra do relatório diverge da lista | Números que não batem (FR-028) | Regra no domínio, SQL a partir das listas do domínio, CTE compartilhada e teste de paridade com a lista |
| Consulta lenta em período longo | SC-003 não atendido | CTE materializada já medida; índice de check-in; teste de volume com 35 000 reservas |
| Valor cobrado ausente em reservas antigas | Soma menor que a real | Sem valor cobrado, vale o total (como o legado); `withoutAmount` conta as sem valor nenhum |
| Mudança na CTE das contagens quebra a 006 | Filtros rápidos errados | Extração sem mudar a regra; os testes de paridade da 006 continuam |
| Marcação no Figma com a feature errada | Telas da 006 voltam a ✅ | R-13: rodar com a 008, sem `SKIP` |
| Diferenças do design (rede, "Todos os hotéis", período padrão) | Retrabalho com a UX | Registradas no R-12, levadas à UX antes das telas |

## Complexity Tracking

Nenhuma violação da constitution a justificar.
