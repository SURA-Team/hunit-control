# Telas do design e onde ficam no código

As 45 telas do design oficial (página `006-redesign-app-desktop` do arquivo "Hunit Control",
`fileKey` `YCbxTAacFxbGuOF8uwoLtt`), na largura de referência de 1 440 px. É a lista de aceite do
SC-001: cada tela é comparada com o print do roteiro `screens-capture`, que usa os mesmos números.

Código: caminhos relativos a `apps/desktop/src/renderer/src/`. O mapeamento tela → arquivo atual
está no catálogo da skill ([references/screens.md](../../../.claude/skills/figma-screens-sync/references/screens.md));
a coluna "Código" abaixo diz onde a tela fica depois da 006.

Para implementar uma tela: `get_screenshot` e `get_design_context` com o `node-id` (o ID abaixo, com
`:` trocado por `-` na URL), adaptando o resultado aos componentes de `ui/`
([ui-components.md](./ui-components.md)), nunca copiando o código gerado.

| Nº | Tela | Node | História | Código depois da 006 |
|---|---|---|---|---|
| 1.1 | Configuração — primeiro uso | `24:757` | US1 | `screens/setup/` |
| 1.2 | Configuração — conexão confirmada | `24:786` | US1 | `screens/setup/` |
| 1.3 | Configuração — conectado (operador) | `24:821` | US1, US3 ("Limpar acesso") | `screens/setup/` |
| 2.1 | Executar — vazio | `24:871` | US1 | `screens/run/` |
| 2.2 | Executar — escolhendo o período | `24:902` | US1 | `ui/PeriodPicker` |
| 2.3 | Executar — escolher hotéis | `24:1115` | US1 | `screens/run/HotelSelect.tsx` |
| 2.4 | Executar — o Hunit pediu o token | `24:1149` | US1, US9 | `components/TwoFactorDialog.tsx` (`AppDialog` escuro) |
| 2.5 | Executar — token aceito | `24:1190` | US1 | idem |
| 2.6 | Executar — execução em andamento | `24:1228` | US6 | `screens/run/ExecutionResult.tsx` |
| 2.7 | Executar — resultado (concluída) | `24:1323` | US6 | idem |
| 2.8 | Executar — usuário ou senha incorretos | `24:1418` | US1 | idem |
| 2.9 | Executar — token recusado (diálogo) | `24:1449` | US1 | `components/TwoFactorDialog.tsx` |
| 2.10 | Executar — falhou, com "Iniciar de novo" | `24:1490` | US1 | `screens/run/ExecutionResult.tsx` |
| 3.1 | Execuções — lista (uma em andamento) | `24:1524` | US6 | `screens/executions/ExecutionsScreen.tsx` |
| 3.2 | Execuções — detalhe em andamento | `24:1596` | US6 | `screens/executions/ExecutionDetail.tsx` |
| 3.3 | Execuções — confirmar cancelamento | `24:1766` | US3 ("Sim, cancelar") | idem |
| 3.4 | Execuções — detalhe concluída | `24:1945` | US6 | idem |
| 4.1 | Reservas — lista | `71:9228` | US2 | `screens/reservations/ReservationsScreen.tsx`, `ReservationFilters.tsx` |
| 4.2 | Reservas — detalhe da reserva | `71:9562` | US5 | `screens/reservations/ReservationDetail.tsx` |
| 4.3 | Reservas — nenhum resultado | `71:10005` | US2 | `ui/EmptyState` |
| 4.4 | Reservas — seleção do lote | `71:10052` | US4 | `ui/SelectionBar` |
| 4.5 | Reservas — reservas selecionadas | `71:10360` | US4 | `screens/reservations/SelectionDrawer.tsx` |
| 4.6 | Reservas — anexar comprovante em lote | `71:11055` | US4 | `screens/reservations/AttachDialog.tsx` |
| 4.7 | Reservas — detalhe com tratativa | `71:11390` | US3, US5 | `screens/reservations/TreatmentSection.tsx` |
| 4.8 | Reservas — anexar tratativa (e-mail) | `71:11840` | US3 | `screens/reservations/AttachDialog.tsx` |
| 4.9 | Reservas — detalhe com o alerta "Verificar" | `122:3385` | US5 | `screens/reservations/TreatmentSection.tsx` |
| 4.10 | Reservas — filtro "Sistema anterior" | `150:4883` | US7 | `screens/reservations/` |
| 4.11 | Reservas — detalhe da reserva do sistema anterior | `150:5826` | US7 | `screens/reservations/ReservationDetail.tsx` |
| 4.12 | Reservas — filtros avançados | `125:3670` | US2 | `screens/reservations/ReservationFilters.tsx` |
| 5.1 | Servidor indisponível | `24:2824` | US1 | `components/ConnectionBanner.tsx`, `App.tsx` |
| 6.1 | Consulta — execuções | `24:2874` | US6 | `screens/executions/` |
| 6.2 | Consulta — reservas | `71:6490` | US2 | `screens/reservations/` |
| 7.1 | Envio — conferência | `184:5328` | US8 | `screens/dispatch/DispatchDialog.tsx` |
| 7.2 | Envio — em andamento | `187:5685` | US8 | `screens/dispatch/DispatchView.tsx` |
| 7.3 | Envio — pedido de token | `187:6220` | US8 | `components/TwoFactorDialog.tsx` |
| 7.4 | Envio — concluído | `187:6771` | US8 | `screens/dispatch/DispatchView.tsx` |
| 7.5 | Reservas — detalhe "Validar comprovante" | `188:6983` | US8 | `screens/reservations/CommercialSection.tsx` |
| 7.6 | Reservas — recusar retorno | `188:7521` | US8 | idem (`RejectDialog`) |
| 7.7 | Comercial — Envios | `190:7635` | US8 | `screens/commercial/DispatchesTab.tsx` |
| 7.8 | Comercial — Retornos a validar | `190:7730` | US8 | `screens/commercial/ReturnsTab.tsx` |
| 7.9 | Comercial — Retornos com problema | `190:7863` | US8 | `screens/commercial/ProblemsTab.tsx` |
| 7.10 | Comercial — Planilha | `190:7959` | US8 | `screens/commercial/SheetTab.tsx` |
| 7.11 | Reservas — selecionar todas do filtro | `193:7789` | US8 | `screens/reservations/ReservationsScreen.tsx` |
| 7.12 | Reservas — confirmar retornos em lote | `193:8205` | US8 | `screens/reservations/ConfirmBatchDialog.tsx` |
| 7.13 | Reservas — confirmar "Verificar" em lote | `193:8288` | US8 | idem |
| 7.14 | Reservas — copiar para e-mail | `193:8355` | US8 | `screens/reservations/CopyDialog.tsx` |

Biblioteca de componentes: página `Componentes — nova identidade`, frame `135:1361`.

O roteiro de captura ganha a tela 4.12 (o painel "Filtros avançados"), que hoje não tem print.

## Tela para aprovação

| Nº | Tela | Onde | História | Situação |
|---|---|---|---|---|
| 7.7a | Comercial — Envios com envio em andamento (para aprovação) | Seção "Para aprovação da UX" da página `006-redesign-app-desktop`, montada pelo agente com os componentes de `Componentes — nova identidade` (research R-13) | US8, FR-039 | Montada em 2026-11-18 (seção `211:9211`, frame `211:9212`); aguardando a UX. A implementação do card do envio espera a aprovação |

Depois de aprovada, a UX decide se ela vira a tela 7.7 (ou um número novo) da página; a marcação ✅/❌
só considera frames com número `x.y`, então a 7.7a não entra nela.
