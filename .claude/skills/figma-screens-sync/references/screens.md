# Catálogo das telas do espelho

Cada tela tem um número `área.ordem`, usado no nome do frame no Figma (`2.4 Executar — …`), no
nome do print (`2.4-executar-pedido-de-token.png`), no roteiro de captura
(`apps/desktop/test/e2e/screens-capture.test.ts`) e no construtor (`SCREENS['2.4']`).

## Em que página está cada tela

Uma página por feature, com o nome da branch; a página tem só as telas que a feature criou ou
mudou. Versões substituídas ficam com `❌` no nome e ocultas. Atualize esta lista quando uma feature
acrescentar telas à página dela.

| Página | Telas visíveis | Ocultas (❌, substituídas) |
|---|---|---|
| `002-app-desktop` | 1.1 a 1.3, 2.1 a 2.10, 3.1 a 3.4, 5.1, 6.1 | 4.1, 4.2, 4.3, 6.2 (pela 003) |
| `003-tratativas-manuais` | 4.2, 4.5 a 4.9 | 4.1, 4.3, 4.4, 6.2 (pela 004) |
| `004-importacao-historico` | 4.1, 4.3, 4.4, 6.2 (filtro "Origem"), 4.10, 4.11 | — |

## Catálogo

Código: caminhos relativos a `apps/desktop/src/renderer/src/`. Altura: altura do frame no Figma
(largura sempre 1440); acima de 900, o print é da página inteira.

| Nº | Tela | Estado mostrado | Código | Altura | Construtor |
|---|---|---|---|---|---|
| 1.1 | Configuração — primeiro uso | Sem conexão configurada: só a área Configuração, aviso azul, campos vazios, botões desabilitados | `screens/setup/`, `App.tsx` | 900 | `1-configuracao.js` |
| 1.2 | Configuração — conexão confirmada | Certificado escolhido (impressão digital), chave preenchida, teste aprovado | `screens/setup/SetupScreen.tsx` | 1000 | `1-configuracao.js` |
| 1.3 | Configuração — conectado (operador) | Conexão salva, preferências, aviso do token, remover configuração | `screens/setup/` | 1340 | `1-configuracao.js` |
| 2.1 | Executar — vazio | Primeiro acesso à área, sem usuário e senha | `screens/run/` | 900 | `2-executar.js` |
| 2.2 | Executar — escolhendo o período | Calendário de dois meses aberto, intervalo marcado | `screens/run/PeriodPicker.tsx` | 900 | `2-executar.js` |
| 2.3 | Executar — escolher hotéis | Opção "Escolher hotéis" com o seletor de hotéis | `screens/run/HotelSelect.tsx` | 900 | `2-executar.js` |
| 2.4 | Executar — o Hunit pediu o token | Diálogo do token com cronômetro; card "Aguardando token" | `components/TwoFactorDialog.tsx` | 900 | `2-executar.js` |
| 2.5 | Executar — token aceito | Diálogo com confirmação verde | `components/TwoFactorDialog.tsx` | 900 | `2-executar.js` |
| 2.6 | Executar — execução em andamento | Contagens parciais e tabela de hotéis com um em andamento | `screens/run/ExecutionResult.tsx`, `components/ClassificationCountsGrid.tsx` | 1120 | `2-executar.js` |
| 2.7 | Executar — resultado (concluída) | Contagens finais, todos os hotéis concluídos | `screens/run/ExecutionResult.tsx` | 1120 | `2-executar.js` |
| 2.8 | Executar — usuário ou senha incorretos | Resultado "Falhou" com a mensagem de credencial | `screens/run/ExecutionResult.tsx` | 900 | `2-executar.js` |
| 2.9 | Executar — token recusado (diálogo) | Diálogo com recusa vermelha sobre o resultado "Falhou" | `components/TwoFactorDialog.tsx` | 900 | `2-executar.js` |
| 2.10 | Executar — falhou, com "Iniciar de novo" | Resultado "Falhou" com a ação de recomeçar | `screens/run/ExecutionResult.tsx` | 900 | `2-executar.js` |
| 3.1 | Execuções — lista (uma em andamento) | Lista com a execução ativa e o histórico | `screens/executions/ExecutionsScreen.tsx` | 900 | `3-execucoes.js` |
| 3.2 | Execuções — detalhe em andamento | Gaveta: hotel atual, tempo restante, contagens, hotéis, evidências, cancelar | `screens/executions/ExecutionDetail.tsx`, `components/EvidenceList.tsx` | 900 | `3-execucoes.js` |
| 3.3 | Execuções — confirmar cancelamento | Diálogo "Cancelar a execução?" sobre a gaveta | `screens/executions/ExecutionDetail.tsx` | 900 | `3-execucoes.js` |
| 3.4 | Execuções — detalhe concluída | Gaveta da execução concluída com evidências | `screens/executions/ExecutionDetail.tsx` | 900 | `3-execucoes.js` |
| 4.1 | Reservas — lista | Filtros ("Situação da reserva", "Ativa ou cancelada", atalhos "Falta cobrar" e "A verificar"), caixas de seleção e a coluna única "Situação da reserva" | `screens/reservations/ReservationsScreen.tsx`, `ReservationFilters.tsx` | 900 | `4-6-reservas-estados-consulta.js` |
| 4.2 | Reservas — detalhe da reserva | Gaveta: situação no topo, dados, quadro "Status do Hunit" (classificação e motivo), tratativa sem documentos, cobrança, verificações | `screens/reservations/ReservationDetail.tsx` | 900 | `4-6-reservas-estados-consulta.js` |
| 4.3 | Reservas — nenhum resultado | Busca sem resultado | `screens/reservations/ReservationsScreen.tsx` | 900 | `4-6-reservas-estados-consulta.js` |
| 4.4 | Reservas — seleção do lote | Reservas marcadas em pesquisas diferentes, barra da seleção, "Tratativa enviada", "Comprovante enviado" e o alerta "Verificar" na lista | `screens/reservations/ReservationsScreen.tsx`, `state/selection.tsx` | 900 | `4-tratativas.js` |
| 4.5 | Reservas — reservas selecionadas | Gaveta com a lista completa da seleção | `screens/reservations/SelectionDrawer.tsx` | 900 | `4-tratativas.js` |
| 4.6 | Reservas — anexar comprovante em lote | Diálogo: pré-visualização da imagem, aceitas, ignoradas com o motivo e total | `screens/reservations/AttachDialog.tsx`, `components/DocumentPreview.tsx` | 900 | `4-tratativas.js` |
| 4.7 | Reservas — detalhe com tratativa | Gaveta com "Comprovante enviado": status do Hunit, documentos atuais e anterior, valor informado à mão, histórico com 5 itens e "Mostrar mais" | `screens/reservations/TreatmentSection.tsx` | 900 | `4-tratativas.js` |
| 4.8 | Reservas — anexar tratativa (e-mail) | Diálogo com a pré-visualização de um .eml: cabeçalhos, texto e anexos | `screens/reservations/AttachDialog.tsx`, `components/DocumentPreview.tsx` | 900 | `4-tratativas.js` |
| 4.9 | Reservas — detalhe com o alerta "Verificar" | Tratativa enviada e o Hunit passou a "Já cobrada": situação do Hunit com "Verificar", classificação anterior, alerta com "Confirmar", ações de registro desabilitadas | `screens/reservations/TreatmentSection.tsx`, `components/SituationBadge.tsx` | 900 | `4-tratativas.js` |
| 4.10 | Reservas — filtro "Sistema anterior" | Filtro "Origem: Sistema anterior", selo "Sistema anterior" ao lado do número, "A revisar (sistema anterior)" e "Não identificada" | `screens/reservations/ReservationsScreen.tsx`, `ReservationFilters.tsx`, `components/LegacyBadge.tsx` | 900 | `4-sistema-anterior.js` |
| 4.11 | Reservas — detalhe da reserva do sistema anterior | Gaveta: selo, "A revisar (sistema anterior)", tratativa importada com autor "Sistema anterior", "Ainda não verificada pelo HUNIT Control" e a seção "Sistema anterior" | `screens/reservations/ReservationDetail.tsx`, `TreatmentSection.tsx` | 1640 | `4-sistema-anterior.js` |
| 5.1 | Servidor indisponível | Aviso amarelo, dados guardados com horário, menu sem "Executar" | `components/ConnectionBanner.tsx`, `components/StaleDataNotice.tsx`, `App.tsx` | 900 | `4-6-reservas-estados-consulta.js` |
| 6.1 | Consulta — execuções | Perfil consulta: sem "Executar" e sem ações de operador | `App.tsx`, `screens/executions/` | 900 | `4-6-reservas-estados-consulta.js` |
| 6.2 | Consulta — reservas | Perfil consulta na área Reservas: situação da reserva (com o alerta) visível, sem caixas de seleção | `screens/reservations/` | 900 | `4-6-reservas-estados-consulta.js` |

Rótulos e cores das situações (todas as telas): `presentation/labels.ts`. Tema (cor primária, raio,
fonte): `main.tsx`. Ícone: `apps/desktop/resources/icon.png`, componente `Marca/Ícone do app` na
página `Identidade visual`.

O `4-tratativas.js` e o `4-sistema-anterior.js` usam funções do `4-6-reservas-estados-consulta.js`:
envie o 4-6 junto (prelúdio + 4-6 + o arquivo da tela). Prelúdio + 4-6 + 4-tratativas passa um pouco
dos 50 mil caracteres: tire as linhas só de comentário (`// …`) antes de enviar.

A 004 acrescentou o filtro "Origem" ao painel de filtros (`reservationFilters`): toda tela 4.x ou 6.2
reconstruída a partir dela já sai com o filtro.
