# Catálogo das telas

Cada tela tem um número `área.ordem`, usado no nome do frame no Figma (`2.4 Executar — …`, com ✅ ou
❌ na frente depois da marcação), no nome do print do roteiro de captura
(`2.4-executar-pedido-de-token.png`, em `apps/desktop/test/e2e/screens-capture.test.ts`) e neste
catálogo. Número novo: o próximo livre da área, combinado com a UX no design.

"Ativa em": a página de feature com a versão em uso da tela (a que fica com ✅). Atualize ao
concluir uma feature (passo 4 da skill). As telas de uma feature em desenvolvimento entram aqui
quando ela for concluída.

Situação em 18/11/2026: a 006 (redesign, página `006-redesign-app-desktop`, telas 1.1 a 7.14 e a 4.12
nova) e a 007 (relatórios, 8.1 a 8.7) estão em desenvolvimento; ao concluir a 006, todas as telas
abaixo passam a ser as da página dela, e o código delas muda conforme
`specs/006-redesign-app-desktop/contracts/screens.md`.

## Catálogo

Código: caminhos relativos a `apps/desktop/src/renderer/src/`. Altura: altura do frame no Figma
(largura sempre 1440); acima de 900, o print é da página inteira.

| Nº | Tela | Estado mostrado | Código | Altura | Ativa em |
|---|---|---|---|---|---|
| 1.1 | Configuração — primeiro uso | Sem conexão configurada: só a área Configuração, aviso azul, campos vazios, botões desabilitados | `screens/setup/`, `App.tsx` | 900 | `002` |
| 1.2 | Configuração — conexão confirmada | Certificado escolhido (impressão digital), chave preenchida, teste aprovado | `screens/setup/SetupScreen.tsx` | 1000 | `002` |
| 1.3 | Configuração — conectado (operador) | Conexão salva, preferências, aviso do token, remover configuração | `screens/setup/` | 1340 | `002` |
| 2.1 | Executar — vazio | Primeiro acesso à área, sem usuário e senha | `screens/run/` | 900 | `002` |
| 2.2 | Executar — escolhendo o período | Calendário de dois meses aberto, intervalo marcado | `screens/run/PeriodPicker.tsx` | 900 | `002` |
| 2.3 | Executar — escolher hotéis | Opção "Escolher hotéis" com o seletor de hotéis | `screens/run/HotelSelect.tsx` | 900 | `002` |
| 2.4 | Executar — o Hunit pediu o token | Diálogo do token com cronômetro; card "Aguardando token" | `components/TwoFactorDialog.tsx` | 900 | `002` |
| 2.5 | Executar — token aceito | Diálogo com confirmação verde | `components/TwoFactorDialog.tsx` | 900 | `002` |
| 2.6 | Executar — execução em andamento | Contagens parciais e tabela de hotéis com um em andamento | `screens/run/ExecutionResult.tsx`, `components/ClassificationCountsGrid.tsx` | 1120 | `002` |
| 2.7 | Executar — resultado (concluída) | Contagens finais, todos os hotéis concluídos | `screens/run/ExecutionResult.tsx` | 1120 | `002` |
| 2.8 | Executar — usuário ou senha incorretos | Resultado "Falhou" com a mensagem de credencial | `screens/run/ExecutionResult.tsx` | 900 | `002` |
| 2.9 | Executar — token recusado (diálogo) | Diálogo com recusa vermelha sobre o resultado "Falhou" | `components/TwoFactorDialog.tsx` | 900 | `002` |
| 2.10 | Executar — falhou, com "Iniciar de novo" | Resultado "Falhou" com a ação de recomeçar | `screens/run/ExecutionResult.tsx` | 900 | `002` |
| 3.1 | Execuções — lista (uma em andamento) | Lista com a execução ativa e o histórico | `screens/executions/ExecutionsScreen.tsx` | 900 | `002` |
| 3.2 | Execuções — detalhe em andamento | Gaveta: hotel atual, tempo restante, contagens, hotéis, evidências, cancelar | `screens/executions/ExecutionDetail.tsx`, `components/EvidenceList.tsx` | 900 | `002` |
| 3.3 | Execuções — confirmar cancelamento | Diálogo "Cancelar a execução?" sobre a gaveta | `screens/executions/ExecutionDetail.tsx` | 900 | `002` |
| 3.4 | Execuções — detalhe concluída | Gaveta da execução concluída com evidências | `screens/executions/ExecutionDetail.tsx` | 900 | `002` |
| 4.1 | Reservas — lista | Filtros ("Situação da reserva", "Ativa ou cancelada", atalhos "Falta cobrar" e "A verificar"), caixas de seleção e a coluna única "Situação da reserva" | `screens/reservations/ReservationsScreen.tsx`, `ReservationFilters.tsx` | 900 | `005` |
| 4.2 | Reservas — detalhe da reserva | Gaveta: situação no topo, dados, quadro "Status do Hunit" (classificação e motivo), tratativa sem documentos, cobrança, verificações | `screens/reservations/ReservationDetail.tsx` | 900 | `005` |
| 4.3 | Reservas — nenhum resultado | Busca sem resultado | `screens/reservations/ReservationsScreen.tsx` | 900 | `004` |
| 4.4 | Reservas — seleção do lote | Reservas marcadas em pesquisas diferentes, barra da seleção, "Tratativa enviada", "Comprovante enviado" e o alerta "Verificar" na lista | `screens/reservations/ReservationsScreen.tsx`, `state/selection.tsx` | 900 | `005` |
| 4.5 | Reservas — reservas selecionadas | Gaveta com a lista completa da seleção | `screens/reservations/SelectionDrawer.tsx` | 900 | `003` |
| 4.6 | Reservas — anexar comprovante em lote | Diálogo: pré-visualização da imagem, aceitas, ignoradas com o motivo e total | `screens/reservations/AttachDialog.tsx`, `components/DocumentPreview.tsx` | 900 | `003` |
| 4.7 | Reservas — detalhe com tratativa | Gaveta com "Comprovante enviado": status do Hunit, documentos atuais e anterior, valor informado à mão, histórico com 5 itens e "Mostrar mais" | `screens/reservations/TreatmentSection.tsx` | 900 | `005` |
| 4.8 | Reservas — anexar tratativa (e-mail) | Diálogo com a pré-visualização de um .eml: cabeçalhos, texto e anexos | `screens/reservations/AttachDialog.tsx`, `components/DocumentPreview.tsx` | 900 | `003` |
| 4.9 | Reservas — detalhe com o alerta "Verificar" | Tratativa enviada e o Hunit passou a "Já cobrada": situação do Hunit com "Verificar", classificação anterior, alerta com "Confirmar", ações de registro desabilitadas | `screens/reservations/TreatmentSection.tsx`, `components/SituationBadge.tsx` | 900 | `005` |
| 4.10 | Reservas — filtro "Sistema anterior" | Filtro "Origem: Sistema anterior", selo "Sistema anterior" ao lado do número, "A revisar (sistema anterior)" e "Não identificada" | `screens/reservations/ReservationsScreen.tsx`, `ReservationFilters.tsx`, `components/LegacyBadge.tsx` | 900 | `005` |
| 4.11 | Reservas — detalhe da reserva do sistema anterior | Gaveta: selo, "A revisar (sistema anterior)", tratativa importada com autor "Sistema anterior", "Ainda não verificada pelo HUNIT Control" e a seção "Sistema anterior" | `screens/reservations/ReservationDetail.tsx`, `TreatmentSection.tsx` | 1300 | `005` |
| 4.12 | Reservas — filtros avançados | Painel "Filtros avançados" aberto, com a lista de "Ativa ou cancelada" aberta (a 006 acrescenta "Só não identificadas") | `screens/reservations/ReservationFilters.tsx`, `ui/FilterBar.tsx` | 1145 | — (entra com a 006) |
| 5.1 | Servidor indisponível | Aviso amarelo, dados guardados com horário, menu sem "Executar" | `components/ConnectionBanner.tsx`, `components/StaleDataNotice.tsx`, `App.tsx` | 900 | `002` |
| 6.1 | Consulta — execuções | Perfil consulta: sem "Executar" e sem ações de operador | `App.tsx`, `screens/executions/` | 900 | `002` |
| 6.2 | Consulta — reservas | Perfil consulta na área Reservas: situação da reserva (com o alerta) visível, sem caixas de seleção | `screens/reservations/` | 900 | `005` |
| 7.1 | Envio — conferência | Diálogo "Enviar ao Comercial": aceitas e total, as que ficam de fora com o motivo, acesso ao Hunit | `screens/dispatch/DispatchDialog.tsx`, `components/HunitAccess.tsx` | 900 | `005` |
| 7.2 | Envio — em andamento | Acompanhamento: verificadas e restantes, reserva em verificação, resultado de cada reserva, "Cancelar envio" | `screens/dispatch/DispatchView.tsx` | 900 | `005` |
| 7.3 | Envio — pedido de token | O mesmo diálogo do token, com "Envio ao Comercial" | `components/TwoFactorDialog.tsx` | 900 | `005` |
| 7.4 | Envio — concluído | Resultado: enviadas, retiradas (Hunit mostrou cobrada) e não verificadas | `screens/dispatch/DispatchView.tsx` | 900 | `005` |
| 7.5 | Reservas — detalhe "Validar comprovante" | Gaveta inteira: "Valor cobrado", seção "Comercial" com a aba, os envios e o retorno (hotel da cobrança em laranja com "Diferente do hotel da reserva", valores e diferença, "Confirmar" e "Recusar"), histórico mesclado | `screens/reservations/CommercialSection.tsx`, `TreatmentSection.tsx` | 1560 | `005` |
| 7.6 | Reservas — recusar retorno | Diálogo: aviso de que o Comercial vê o motivo, sugestões e motivo obrigatório | `screens/reservations/CommercialSection.tsx` (`RejectDialog`) | 900 | `005` |
| 7.7 | Comercial — Envios | Lista dos envios com quem, quando, estado e contagens | `screens/commercial/DispatchesTab.tsx` | 900 | `005` |
| 7.8 | Comercial — Retornos a validar | Retornos aguardando validação, com confirmação individual, em lote e recusa | `screens/commercial/ReturnsTab.tsx` | 900 | `005` |
| 7.9 | Comercial — Retornos com problema | Retorno incompleto com o que falta | `screens/commercial/ProblemsTab.tsx` | 900 | `005` |
| 7.10 | Comercial — Planilha | Situação, pendências e desde quando, última leitura, "Ler retornos agora" | `screens/commercial/SheetTab.tsx` | 900 | `005` |
| 7.11 | Reservas — selecionar todas do filtro | Aviso das selecionadas, barra da seleção com "Enviar ao Comercial", "Confirmar retornos" e "Confirmar 'Verificar'" | `screens/reservations/ReservationsScreen.tsx`, `state/selection.tsx` | 900 | `005` |
| 7.12 | Reservas — confirmar retornos em lote | Diálogo com a lista de revisão (código, hotel da cobrança ao lado do hotel da reserva, valores, diferença) | `screens/reservations/ConfirmBatchDialog.tsx` | 900 | `005` |
| 7.13 | Reservas — confirmar "Verificar" em lote | Diálogo: quantas têm o alerta, quantas ficam de fora, contagem por status do Hunit | `screens/reservations/ConfirmBatchDialog.tsx` | 900 | `005` |
| 7.14 | Reservas — copiar para e-mail | Diálogo: copiar as selecionadas ou o resultado da pesquisa | `screens/reservations/CopyDialog.tsx` | 900 | `005` |

Rótulos e cores das situações (todas as telas): `presentation/labels.ts`. Tema e ícone até a 005:
`main.tsx` e `apps/desktop/resources/icon.png`; com a 006, `renderer/src/ui/` e a marca
"Marca/Ícone — nova identidade" da página `Componentes — nova identidade`.
