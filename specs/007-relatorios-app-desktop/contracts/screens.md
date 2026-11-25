# Telas da 007

**Feature**: [spec.md](../spec.md) | Figma: arquivo "Hunit Control", página
`007-relatorios-app-desktop` (node `64:3724`), seção "8. Relatórios" (`96:113`). Diferenças entre o
design e o app: [research R-12](../research.md#r-12--diferenças-do-design-levadas-à-ux).

| Tela | Nome no Figma | Node | História | Código (renderer) |
|---|---|---|---|---|
| 8.1 | Relatórios — visão geral | `90:3573` | US1, US2, US3 | `screens/reports/ReportsScreen.tsx`, `ReportPeriodBar.tsx`, `VolumeCards.tsx`, `OpenValueCard.tsx`, `ChargedValueCard.tsx`, `ValueDistributionCard.tsx`, `HotelRankingCard.tsx` |
| 8.2 | Relatórios — escolhendo o período | `96:114` | US2 | `ReportPeriodBar.tsx` com o `ui/PeriodPicker.tsx` |
| 8.3 | Relatórios — detalhe do hotel | `96:345` | US3 | `screens/reports/HotelDetailDrawer.tsx` |
| 8.4 | Relatórios — nenhuma reserva no período | `96:576` | US5 | `ReportsScreen.tsx` com o `ui/EmptyState.tsx` |
| 8.5 | Relatórios — servidor indisponível | `96:807` | US5 | `ReportsScreen.tsx` com o `components/ConnectionBanner.tsx` e o `components/StaleDataNotice.tsx` |
| 8.6 | Consulta — relatórios | `96:1038` | US6 | as mesmas, perfil consulta (menu sem "Executar", `App.tsx`) |
| 8.7 | Relatórios — todos os hotéis | `117:480` | US4 | `screens/reports/AllHotelsDrawer.tsx` |

Fora das telas desenhadas: o item "Relatórios" do menu (`App.tsx`, `ui/icons`), o estado de
carregamento e o aviso de divergência na área Reservas (`screens/reservations/ReservationsScreen.tsx`,
R-07), montados com os padrões da 006.

O roteiro `screens-capture` ganha as sete telas, com os nomes `8.1 relatorios-visao-geral` a
`8.7 relatorios-todos-os-hoteis`, com dados fictícios. A comparação com o design fica em `research.md`
("Comparação com o design"), como na 006 e na 008.
