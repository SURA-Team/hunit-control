# Componentes de `ui/` da 007

**Feature**: [spec.md](../spec.md) | **Research**: [R-10](../research.md#r-10--componentes-de-interface) | Catálogo da 006: `specs/006-redesign-app-desktop/contracts/ui-components.md`

As telas da 007 só usam componentes de `apps/desktop/src/renderer/src/ui/` e o layout neutro do
Mantine (regra da 006, barrada pelo ESLint). Novos:

| Componente | Props | Uso |
|---|---|---|
| `ui/charts/StackedBar` | `segments: { value: number; tone: 'requested' \| 'pending' \| 'previous' \| 'recovered' }[]`, `max?: number` (escala comum; padrão = soma), `size: 'sm' \| 'md'`, `label: string` (nome acessível) | card "Valor em aberto" (fundo escuro), distribuição (100 %), linhas do ranking e de "Todos os hotéis" (escala do maior hotel), gaveta do hotel |
| `ui/charts/LegendList` | `items: { tone; name; detail?; value: string; percent?: string }[]` | distribuição dos valores, card "Valor já cobrado", legenda do ranking |
| `ui/lists/RankingRow` | `position: number`, `name: string`, `bar: ReactNode`, `value: string`, `onOpen: () => void`, `disabled?: boolean` | ranking e "Todos os hotéis"; a linha inteira é um botão com nome acessível "Abrir o detalhe de <hotel>" |
| `ui/icons` → `ReportsIcon` | — | item "Relatórios" do menu |
| `ui/FilterBar` → `FilterAnchor` (R-14) | `children`, `panel?: ReactNode` | âncora do painel "Filtros avançados" fora da `FilterBar`: o card do período do relatório, com o painel aberto abaixo, à direita |
| `ui/FilterBar` → `AppliedFilters` (R-14) | `clearLabel?: string` (padrão "Limpar busca e filtros") | "Limpar filtros" no relatório, que não tem busca |

Cores (tokens da 006, FR-017): cinza = solicitado, lima = pendente, verde = cobrado anteriormente,
preto = recuperado (no fundo escuro, os mesmos tons do design). Barra sem valor: só o fundo. Toda barra
tem legenda em texto ao lado ou abaixo.

Reaproveitados sem mudança: `Surface dark` (card escuro), `FilterChip` sem contagem (atalhos do
período), `PeriodPicker`, `AppDrawer`, `EmptyState`, `StatusBadge`/`SituationBadges` (selos das
reservas e "Dados atualizados"), `Notice`, `Action`, `Card`, `IndicatorCard` (volume).

Testes em `apps/desktop/test/renderer/ui-charts.test.tsx` (segmentos e escala, nome acessível,
legenda) e no catálogo de componentes da 006, se houver captura do catálogo.
