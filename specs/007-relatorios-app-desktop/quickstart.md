# Quickstart: validar a 007

Roteiro para provar que a feature funciona de ponta a ponta. Regras em [data-model.md](./data-model.md),
contratos em [contracts/](./contracts/). Dados sempre fictícios (homologação, testes e prints).

## 1. Testes automáticos

Pré-requisitos do `AGENTS.md` (Node 24, pnpm, Docker em execução, Chromium do Playwright).

```powershell
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Esperado: tudo verde. Grupos que cobrem a 007 (research R-11): `domain` (faixas, valores,
percentuais, atalhos), `contracts` (1.10.0, cópias idênticas), `server` (rota e `order=amount_desc`),
`server-db` (paridade relatório × domínio × lista, volume de 35 000 reservas em até 1 s), `desktop`
(ponte `reports.overview`), `desktop-ui` (estados, gavetas, preset para Reservas) e `desktop-e2e`
(jornada, servidor desligado, larguras).

Prints para comparar com o design (PowerShell, pasta fora do repositório):

```powershell
$env:HUNIT_SCREENS_DIR = "C:\prints-007"; pnpm test --project desktop-e2e screens-capture
```

Conferir 8.1 a 8.7 ao lado dos frames da página `007-relatorios-app-desktop` e registrar em
`research.md` ("Comparação com o design"); as diferenças já decididas estão no R-12.

## 2. Homologação

Ambiente padrão do `README.md` ("Homologação": atualizar para uma feature). Sem migration e sem passo
na planilha: subir o servidor da 007 e instalar o app 0.5 gerado pelo `dist`. A base de homologação
precisa de reservas em várias situações e hotéis (as da homologação da 008 servem); para conferir os
números, usar a área Reservas com o mesmo período.

## 3. Cenários

| # | Cenário | Esperado |
|---|---|---|
| 3.1 | Abrir "Relatórios" (operador) | Item no menu entre Comercial e Configuração, com o ícone de gráfico; período "Últimos 30 dias"; os três grupos de indicadores; subtítulo com a hora dos dados e a "Última verificação das reservas" (US1, FR-001, FR-004, FR-010) |
| 3.2 | Conferir "Reservas" com a área Reservas, mesmo período | Igual a "Todas" menos as Ignorada (Hotelbeds 258), A revisar (sistema anterior) e Faturada (FR-008a, SC-004) |
| 3.3 | Conferir "Valor em aberto" | Igual à soma do "Falta cobrar" da lista no mesmo período; solicitado = com tratativa, pendente = sem (FR-012, FR-013) |
| 3.4 | Conferir "Valor já cobrado" | Reserva cobrada sem tratativa em "Cobrado anteriormente"; com tratativa antes (comprovante, retorno do Comercial confirmado ou o Hunit mostrou a cobrança depois) em "Recuperado"; "Cancelada sem cobrança" fora (FR-014) |
| 3.5 | Distribuição dos valores | Quatro linhas com valor e percentual; somam 100 %; fatia muito pequena aparece como "<0,1%" (FR-015, FR-016, SC-008) |
| 3.6 | Trocar o atalho (7 dias, 30 dias, este mês) | Números trocam sem botão de confirmação; atalho ativo destacado; "N reservas no recorte" acompanha (US2) |
| 3.7 | "Personalizado": escolher início e fim no calendário | Calendário dos filtros (hoje em lima); relatório atualiza ao escolher o fim (US2-3) |
| 3.8 | Período sem reservas | "Nenhuma reserva neste período" com "Ver os últimos 30 dias", que aplica o atalho (8.4, FR-024) |
| 3.9 | Ranking | Hotéis com valor em aberto, numerados, maior primeiro, barras na mesma escala, sem rede; rola dentro do card (US3, FR-018, FR-019) |
| 3.10 | Clicar num hotel | Gaveta com valor em aberto, resumo e as reservas em aberto (hóspede, número, período, valor e selo), maiores primeiro (8.3, FR-021) |
| 3.11 | "Ver as N reservas em Reservas" | Área Reservas filtrada pelo hotel, período e "Falta cobrar", com N reservas (FR-022, SC-002) |
| 3.12 | "Ver reservas em aberto" (card escuro) | Área Reservas com o período e "Falta cobrar", todos os hotéis; a quantidade bate com o card (US3-5) |
| 3.13 | Fechar a gaveta | Volta ao relatório com o mesmo período e a mesma rolagem do ranking (FR-023) |
| 3.14 | "Ver todos os hotéis" | Gaveta "Todos os hotéis", inclusive os de R$ 0,00 no fim; busca sem acento; "Maior valor", "Mais pendente" e "Nome A-Z"; clicar abre o detalhe (8.7, US4) |
| 3.15 | Busca sem resultado na gaveta | Estado vazio com "Limpar busca" (US4-5) |
| 3.16 | Parar o servidor com o relatório aberto | Alerta do app, "dados de HH:MM — servidor indisponível", números legíveis, "Atualizar dados", "Ver reservas em aberto" e os hotéis desabilitados (8.5, FR-025) |
| 3.17 | Subir o servidor e "Atualizar dados" | Alerta some, selo "Dados atualizados" (US5-5) |
| 3.18 | Abrir o app com o servidor parado e ir a Relatórios | Só o alerta, sem números (US5-4) |
| 3.19 | Perfil consulta | Mesmo relatório, gavetas e ida para Reservas; menu sem "Executar" (8.6, US6) |
| 3.20 | Janela estreita (960 px) e zoom de 125 % | Grupos em coluna, sem rolagem horizontal, card de valor em aberto visível (Edge Cases) |
| 3.21 | Mudar uma reserva entre o relatório e "Ver as N reservas" | A área Reservas mostra a situação atual e o aviso de que o relatório pode estar desatualizado (Edge Cases, R-07) |
| 3.22 | Tempo de troca de período com a base de homologação | Relatório completo em até 3 s (SC-003) |
| 3.23 | "Filtros" ao lado dos atalhos (app 0.5.1, servidor 1.11.0) | Painel "Filtros avançados" com Hotéis, Situação da reserva (sem Ignorada, A revisar e Faturada), Ativa ou cancelada, Canal, Origem e "Só as não encontradas…"; sem campo de período (FR-005a) |
| 3.24 | Escolher um hotel e um canal | Números, ranking e "X de Y" trocam na hora; chips em "Filtros aplicados"; "Reservas" bate com a área Reservas com os mesmos filtros, menos as três situações (FR-028) |
| 3.25 | "Ver reservas em aberto" e "Ver as N reservas" com filtros | A área Reservas abre com os mesmos filtros e a mesma quantidade, sem o aviso de divergência (FR-022) |
| 3.26 | Voltar a Relatórios; tirar um chip; "Limpar filtros" | Filtros guardados ao voltar; cada chip tira o seu; "Limpar filtros" volta ao relatório do período (FR-005a) |
| 3.27 | Filtros sem reservas | "Nenhuma reserva com estes filtros" e "Limpar filtros" (FR-024) |
| 3.28 | "Personalizado" e fechar o calendário sem escolher | O atalho do período em vigor volta a ficar ativo (R-14) |

O SC-007 (teste com as 4 usuárias) é feito pela PM depois da homologação; registrar o resultado no
`research.md` ("Homologação").

## 4. Figma

Depois de comparar o app com o design: skill `figma-screens-sync` com
`FEATURE = '008-ajustes-cobranca-e-aviso'` e sem `SKIP` (research R-13): simular, mostrar o
relatório ao usuário e só aplicar com o ok dele. Esperado: 8.1 a 8.7 com ✅ e nada mais mudando.

## 5. Produção

Pelo passo 9 do `README.md` ("Atualizar para uma versão nova"):

1. Servidor na 1.10.0 (sem migration, sem passo na planilha).
2. Instalador 0.5 nas máquinas do Financeiro e da Controladoria.
3. Conferir numa máquina a versão 0.5.0 e abrir "Relatórios" com os últimos 30 dias.

Registrar o resultado em `research.md` ("Produção").
