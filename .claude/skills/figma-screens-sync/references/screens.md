# Catálogo das telas do espelho

Cada tela tem um número `área.ordem`, usado no nome do frame no Figma (`2.4 Executar — …`), no
nome do print (`2.4-executar-pedido-de-token.png`), no roteiro de captura
(`apps/desktop/test/e2e/screens-capture.test.ts`) e no construtor (`SCREENS['2.4']`).

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
| 4.1 | Reservas — lista | Filtros e tabela de reservas com as situações de cobrança | `screens/reservations/ReservationsScreen.tsx`, `ReservationFilters.tsx` | 900 | `4-6-reservas-estados-consulta.js` |
| 4.2 | Reservas — detalhe da reserva | Gaveta: dados, motivo da classificação, cobrança, verificações | `screens/reservations/ReservationDetail.tsx` | 900 | `4-6-reservas-estados-consulta.js` |
| 4.3 | Reservas — nenhum resultado | Busca sem resultado | `screens/reservations/ReservationsScreen.tsx` | 900 | `4-6-reservas-estados-consulta.js` |
| 5.1 | Servidor indisponível | Aviso amarelo, dados guardados com horário, menu sem "Executar" | `components/ConnectionBanner.tsx`, `components/StaleDataNotice.tsx`, `App.tsx` | 900 | `4-6-reservas-estados-consulta.js` |
| 6.1 | Consulta — execuções | Perfil consulta: sem "Executar" e sem ações de operador | `App.tsx`, `screens/executions/` | 900 | `4-6-reservas-estados-consulta.js` |
| 6.2 | Consulta — reservas | Perfil consulta na área Reservas | `screens/reservations/` | 900 | `4-6-reservas-estados-consulta.js` |

Rótulos e cores das situações (todas as telas): `presentation/labels.ts`. Tema (cor primária, raio,
fonte): `main.tsx`. Ícone: `apps/desktop/resources/icon.png`, componente `Marca/Ícone do app` na
página `Identidade visual`.
