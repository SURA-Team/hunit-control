# Feature Specification: Módulo de Relatórios do app desktop

**Feature Branch**: `007-relatorios-app-desktop`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Módulo de Relatórios do app desktop, redesenhado a partir da tela antiga 'Visão geral' (design oficial da UX, página 007 / telas 8.1 a 8.7 do Figma). Sete telas cobrem o fluxo completo: 8.1 Visão geral; 8.2 escolha do período (calendário aberto); 8.3 detalhe do hotel (gaveta ao clicar num hotel do ranking); 8.4 nenhuma reserva no período; 8.5 servidor indisponível; 8.6 consulta (relatórios sem o botão 'Executar'); 8.7 todos os hotéis (gaveta do 'Ver todos os hotéis'). Topo: selo 'Dados atualizados' e botão 'Atualizar dados', com a hora da última atualização no subtítulo; um único campo de período com atalhos (Últimos 7 dias · 30 dias · Este mês · Personalizado) aplicados na hora, sem 'Aplicar filtros' e 'Limpar'; '34.526 reservas no recorte' alinhado à direita, com separador de milhar. Indicadores em 3 grupos: volume (Reservas · Tratativas enviadas · Hotéis com dados, escrito '79 de 83'), valor em aberto (card escuro 'Valor em aberto' com a barra solicitado/pendente e o botão 'Ver reservas em aberto') e valor já cobrado (um card com 'Cobrado anteriormente', antes 'Cobrado comercial', e 'Recuperado'). Gráficos: a pizza vira barra de 100% com legenda, valor e percentual em cada linha; o ranking de hotéis é numerado, com barras na mesma escala, valor à direita e seta para o detalhe, sem repetir o nome da rede, com rolagem no card e 'Ver todos os hotéis' com busca e ordenação; cores: cinza = solicitado (tratativa enviada), lima = pendente, verde = cobrado anteriormente, preto = recuperado. Detalhe do hotel: valor em aberto, resumo e reservas em aberto, com 'Ver as N reservas em Reservas'. Item 'Relatórios' no menu, com ícone de gráfico, nos dois perfis. Estados: servidor indisponível usa o mesmo alerta da tela 5.1, mostra 'dados de HH:MM' e desabilita as ações; estado vazio com explicação e 'Ver os últimos 30 dias'; o calendário do filtro é o mesmo componente do filtro de período das outras telas, com o dia de hoje selecionado em lima."

## Contexto

O app desktop (feature 002) e as tratativas manuais (feature 003) permitem consultar, classificar e
tratar reservas uma a uma, ou em lote. Falta uma visão do conjunto: quanto ainda está em aberto, quanto
já foi cobrado, em quais hotéis está o problema e se os dados na tela são confiáveis. A tela antiga
"Visão geral" tentava responder a isso, mas só mostrava o caso feliz: sete cards iguais, uma pizza em
que quase tudo cabia numa fatia, um ranking cortado, filtros em dois campos com dois botões, e nenhum
caminho do número até a reserva que o explica.

Esta feature entrega o módulo de **Relatórios**: uma área própria do menu, para os dois perfis de
acesso, que responde em poucos segundos "quanto falta cobrar e onde?" e leva dali às reservas que
resolvem o problema. O redesenho foi feito pela UX (design oficial no Figma) e cobre também os estados
de vazio, erro e carregamento, para que ninguém precise inventá-los na implementação.

É uma área de **leitura**: nada nela altera reservas, tratativas ou o Hunit. O visual segue a
identidade da feature 006 (cards, selos, alerta de servidor indisponível, gaveta, calendário e
hierarquia de botões); esta spec descreve o conteúdo e o comportamento do módulo.

Ficam **fora do escopo**: exportação (planilha ou PDF) e impressão dos relatórios, comparação entre
períodos, gráficos de evolução no tempo, relatórios por hóspede ou por canal, agendamento ou envio dos
relatórios por e-mail, e mudança nas regras de classificação e de tratativa.

## Clarifications

### Session 2026-11-25

- Q: Como o relatório separa "Cobrado anteriormente" e "Recuperado"? → A: Pela tratativa: "Cobrado
  anteriormente" = reserva cobrada que nunca teve tratativa (o Hunit já mostrava a cobrança, ou o
  comprovante foi anexado sem tratativa); "Recuperado" = reserva cobrada que teve tratativa enviada
  antes (comprovante anexado, retorno do Comercial confirmado ou o Hunit passou a mostrar a cobrança
  depois da tratativa). "Cancelada sem cobrança" não entra em nenhum dos dois (R$ 0,00).
- Q: O que a barra de 100% distribui? → A: Os valores, como no design (tela 8.1, "Distribuição dos
  valores"): cobrado anteriormente, recuperado, pendente e solicitado, cada um com valor e percentual
  sobre a soma dos quatro ("Do total de R$ … em cartão virtual"); não as reservas por situação.
- Q: A lista de reservas em aberto na gaveta do hotel mostra o hóspede? → A: Sim, como no design (tela
  8.3): hóspede, número, período, valor e selo de cada reserva; os dois perfis já veem o hóspede em
  Reservas. Indicadores, ranking e "Todos os hotéis" continuam sem dado de hóspede.
- Q: Quais reservas entram em "Reservas" e em "N reservas no recorte"? → A: As do período, menos as
  "Ignorada (Hotelbeds 258)", as "A revisar (sistema anterior)" e as "Faturada", que não importam
  para a cobrança (conferidas situação a situação com o usuário: as outras dez entram); o total deixa
  de bater com "Todas" da área Reservas e passa a bater com a soma das demais situações.
- Q: Como o ranking trata o nome da rede dos hotéis? → A: Sem rede: o app não tem cadastro de rede; o
  subtítulo do ranking fica "Solicitado + pendente · maiores primeiro", o da gaveta do hotel "1º com
  mais valor em aberto · check-in de …", e cada linha mostra o nome do hotel como está no catálogo.

### Session 2026-11-25 (plano)

- Q: A gaveta "Ver todos os hotéis" (tela 8.7) lista só os hotéis com valor em aberto, como no design?
  → A: Não: lista todos os hotéis com reservas no período, os sem valor em aberto no fim com
  R$ 0,00, e o título é "Todos os hotéis" (diferença levada à UX).
- Q: Quais ordenações a gaveta oferece? → A: As do design: "Maior valor" (valor em aberto), "Mais
  pendente" (maior valor pendente, sem tratativa) e "Nome A-Z".

### Session 2026-11-25 (ajuste depois do merge)

- Q: O relatório pode ser recortado também pelos filtros da área Reservas? → A: Sim (pedido do
  usuário depois do merge, sem esperar o design; a tela vai como sugestão para a UX na página 007):
  o botão "Filtros", ao lado dos atalhos do período, abre o painel "Filtros avançados" com Hotéis,
  Situação da reserva (sem as três do FR-008a), Ativa ou cancelada, Canal, Origem e "Só as não
  encontradas na última verificação", valendo na hora; os filtros em vigor aparecem em "Filtros
  aplicados" e valem para todo o relatório e para a ida a Reservas (FR-005a).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver o panorama do período e o valor em aberto (Priority: P1)

A pessoa abre "Relatórios" e vê, na tela principal, o resumo do período: quantas reservas existem,
quantas tratativas foram enviadas, em quantos hotéis há dados, quanto está em aberto — em destaque —
e quanto já foi cobrado, além de como o valor se distribui entre cobrado, recuperado, pendente e
solicitado.

**Why this priority**: é a razão de existir do módulo. Sozinha, já responde "quanto falta cobrar" e
"o que mudou" e permite acompanhar a operação sem abrir lista nenhuma.

**Independent Test**: com reservas gravadas em várias situações, abrir Relatórios e conferir cada
número, o card escuro de valor em aberto, o card de valor já cobrado e a barra de distribuição contra
a soma das reservas da lista, no mesmo período.

**Acceptance Scenarios**:

1. **Given** reservas gravadas no período, **When** a pessoa abre Relatórios, **Then** vê três grupos de
   indicadores: volume (Reservas, Tratativas enviadas, Hotéis com dados), valor em aberto e valor já
   cobrado, nesta ordem, cada grupo com seu peso visual.
2. **Given** o grupo de volume, **When** exibido, **Then** "Hotéis com dados" aparece como "79 de 83"
   (hotéis com reservas do relatório no período, de todos os hotéis cadastrados), nunca com barra.
3. **Given** valor em aberto, **When** exibido, **Then** o card escuro mostra o total em reais (por
   exemplo, "R$ 211.120,47"), a barra dividida em solicitado (cinza, com tratativa enviada) e
   pendente (lima, sem tratativa), com os valores de cada parte, e o botão "Ver reservas em aberto".
4. **Given** valor já cobrado, **When** exibido, **Then** um único card mostra o total e os dois
   detalhes: "Cobrado anteriormente" (verde, "sem precisar de tratativa") e "Recuperado" (preto,
   "cobrado depois da tratativa").
5. **Given** a distribuição dos valores, **When** exibida, **Then** é uma barra de 100% com legenda em
   que cada linha traz o nome da faixa (cobrado anteriormente, recuperado, pendente e solicitado), o
   valor e o percentual sobre a soma das quatro, de modo que as fatias pequenas
   (por exemplo, 1,9%, 1,0% e 0,5%) são lidas na legenda mesmo quando quase invisíveis na barra.
6. **Given** qualquer número do relatório, **When** exibido, **Then** segue o formato brasileiro:
   separador de milhar, vírgula decimal, "R$" nos valores e "%" nos percentuais.
7. **Given** o topo da tela, **When** exibido, **Then** mostra o selo "Dados atualizados", o botão
   "Atualizar dados" e, no subtítulo, a hora da última atualização; **When** a pessoa aciona "Atualizar
   dados", **Then** os números são recarregados e a hora é atualizada.

---

### User Story 2 - Escolher o período sem passos extras (Priority: P1)

A pessoa troca o período do relatório num único campo, com atalhos para os recortes mais usados, e o
resultado aparece na hora, sem confirmar. O total de reservas do recorte fica visível ao lado.

**Why this priority**: todo número do relatório depende do período; trocar de recorte é a ação mais
repetida da tela.

**Independent Test**: escolher cada atalho e um período personalizado e conferir que os números
mudam sem nenhum botão de confirmação e que o total de reservas do recorte acompanha.

**Acceptance Scenarios**:

1. **Given** a tela de Relatórios, **When** exibida, **Then** há um campo de período e os atalhos
   "Últimos 7 dias", "Últimos 30 dias", "Este mês" e "Personalizado", sem os botões "Aplicar filtros" e
   "Limpar".
2. **Given** a tela, **When** a pessoa escolhe um atalho, **Then** o relatório inteiro passa a refletir
   o período escolhido e o atalho ativo fica destacado.
3. **Given** a tela, **When** a pessoa escolhe "Personalizado" ou toca no campo, **Then** o calendário
   abre (o mesmo componente dos filtros de período das outras telas), com o dia de hoje selecionado em
   lima; ao escolher início e fim, o relatório é atualizado sem passo extra.
4. **Given** o período aplicado, **When** exibido, **Then** o texto "34.526 reservas no recorte" aparece
   alinhado à direita do filtro, com separador de milhar e no singular quando houver uma só ("1 reserva
   no recorte").
5. **Given** o período, **When** a pessoa o escolhe, **Then** ele se refere ao check-in das reservas,
   como nos demais filtros do app.
6. **Given** o calendário aberto, **When** a pessoa clica primeiro num dia posterior e depois num
   anterior, **Then** o período fica ordenado (o dia menor é o início), como nos outros filtros; um
   período com início depois do fim nunca chega ao relatório (o servidor também o recusa).

---

### User Story 3 - Do hotel com mais valor em aberto às reservas que resolvem (Priority: P2)

O ranking mostra os hotéis com mais valor em aberto, numerados e com barras na mesma escala. Clicar num
hotel abre uma gaveta com o resumo dele e as reservas em aberto, e um botão leva à lista de Reservas já
filtrada para ele. O botão "Ver reservas em aberto" do card escuro faz o mesmo para todos os hotéis.

**Why this priority**: transforma o relatório em ponto de partida da ação: a pessoa vê o problema e
chega em poucos cliques nas reservas para resolvê-lo.

**Independent Test**: com reservas em aberto em vários hotéis, abrir a gaveta de um hotel, conferir seu
valor e sua contagem e acionar o botão para chegar em Reservas, conferindo que a lista mostra o mesmo
número de reservas anunciado.

**Acceptance Scenarios**:

1. **Given** o ranking, **When** exibido, **Then** os hotéis aparecem numerados por valor em aberto
   (do maior para o menor), com barras na mesma escala, o valor à direita e uma seta que indica que a
   linha abre o detalhe; o nome do hotel é o do catálogo, sem rede no subtítulo.
2. **Given** mais hotéis do que cabem no card, **When** a pessoa rola dentro do card, **Then** vê os
   demais hotéis sem que a página inteira role.
3. **Given** o ranking, **When** a pessoa clica em um hotel, **Then** abre uma gaveta com o nome do
   hotel, o valor em aberto, um resumo (por exemplo, quanto está solicitado e quanto está pendente) e a
   lista das reservas em aberto (hóspede, número, período, valor e selo da situação, maiores valores
   primeiro).
4. **Given** a gaveta de um hotel com 37 reservas em aberto, **When** exibida, **Then** o botão diz
   "Ver as 37 reservas em Reservas"; **When** acionado, **Then** o app abre a área Reservas já filtrada
   por esse hotel, pelo período do relatório e pelas reservas em aberto, e a quantidade listada é a
   mesma anunciada no botão.
5. **Given** o card escuro de valor em aberto, **When** a pessoa aciona "Ver reservas em aberto",
   **Then** o app abre Reservas filtrada pelo período e pelas reservas em aberto, de todos os hotéis.
6. **Given** a gaveta aberta, **When** a pessoa a fecha, **Then** volta ao relatório no mesmo estado
   (período, rolagem do ranking).
7. **Given** um hotel sem nenhum valor em aberto no período, **When** a pessoa o procura, **Then** ele
   aparece em "Ver todos os hotéis" com valor R$ 0,00 e não no ranking principal.

---

### User Story 4 - Ver todos os hotéis, com busca e ordenação (Priority: P3)

Quem precisa de um hotel que não está no topo do ranking abre a lista completa, procura pelo nome e
ordena do jeito que precisar.

**Why this priority**: completa o ranking para quem investiga um hotel específico; o dia a dia se
resolve com o topo da lista.

**Independent Test**: abrir "Ver todos os hotéis", buscar um nome parcial, trocar a ordenação e abrir
o detalhe de um hotel a partir dali.

**Acceptance Scenarios**:

1. **Given** o ranking, **When** a pessoa aciona "Ver todos os hotéis", **Then** abre uma gaveta com
   todos os hotéis do período, cada um com o valor em aberto e o mesmo formato de linha do ranking.
2. **Given** a gaveta, **When** a pessoa digita parte do nome, **Then** a lista mostra só os hotéis
   cujo nome contém o texto, ignorando maiúsculas e acentos.
3. **Given** a gaveta, **When** a pessoa troca a ordenação ("Maior valor", "Mais pendente", "Nome
   A-Z"), **Then** a lista é reordenada e a ordenação escolhida fica visível.
4. **Given** uma linha da gaveta, **When** a pessoa a clica, **Then** abre o detalhe do hotel (história
   3).
5. **Given** uma busca sem resultado, **When** exibida, **Then** aparece o estado vazio com a opção de
   limpar a busca.

---

### User Story 5 - Saber sempre em que estado estão os dados (Priority: P2)

A pessoa nunca fica sem saber o que acontece: enquanto os números carregam, quando não há reservas no
período e quando o servidor não responde, a tela diz o que está havendo e o que fazer.

**Why this priority**: um relatório com números desatualizados ou em branco, sem aviso, leva a decisões
erradas sobre dinheiro; os estados fazem parte do produto, não são acabamento.

**Independent Test**: provocar cada estado (período sem reservas, servidor desligado com o relatório já
aberto, abertura com o servidor desligado, carregamento lento) e conferir mensagem, ações e hora dos
dados.

**Acceptance Scenarios**:

1. **Given** o relatório sendo carregado ou recarregado, **When** a pessoa espera, **Then** vê um estado
   de carregamento no lugar dos números (nunca zeros que pareçam dados reais) e o selo informa que
   está atualizando.
2. **Given** um período sem nenhuma reserva, **When** o relatório é exibido, **Then** aparece o estado
   vazio "Nenhuma reserva no período", com explicação do motivo e o botão "Ver os últimos 30 dias",
   que aplica esse atalho.
3. **Given** o relatório aberto, **When** o servidor deixa de responder, **Then** o app mostra o mesmo
   alerta de servidor indisponível usado no resto do app, com "dados de HH:MM" (hora da última
   atualização bem-sucedida), mantém os números já exibidos legíveis e desabilita as ações que
   dependem do servidor ("Atualizar dados", "Ver reservas em aberto", abrir hotel).
4. **Given** o servidor indisponível ao abrir Relatórios pela primeira vez na sessão, **When** a tela é
   exibida, **Then** aparece o alerta e nenhum número, sem exibir dados antigos de outro período.
5. **Given** o servidor indisponível, **When** volta a responder, **Then** a pessoa pode acionar
   "Atualizar dados" e o alerta some quando a atualização conclui.
6. **Given** os dados exibidos, **When** o selo é visto, **Then** "Dados atualizados" só aparece quando os
   números correspondem ao período e ao momento mostrados; de outro modo o selo diz o que há de
   errado: "Atualizando…" durante a consulta ou "dados de HH:MM — servidor indisponível". Quando a
   área Reservas encontra outra quantidade de reservas em aberto, ela avisa que o relatório pode estar
   desatualizado (Edge Cases).

---

### User Story 6 - Consultar os relatórios com o perfil de consulta (Priority: P2)

Quem tem o perfil de consulta (somente leitura) vê o mesmo relatório, com o menu do seu perfil, que
não tem o item "Executar", pois ele não pode iniciar execuções.

**Why this priority**: o relatório é útil a quem só acompanha; esconder o que o perfil não pode fazer
evita cliques que falham.

**Independent Test**: abrir Relatórios com cada perfil e conferir que o conteúdo é o mesmo e que "Executar" só
existe para o perfil operador.

**Acceptance Scenarios**:

1. **Given** o app com qualquer um dos dois perfis, **When** o menu é exibido, **Then** contém o item
   "Relatórios", com ícone de gráfico, junto das demais áreas.
2. **Given** o perfil operador, **When** Relatórios é exibido, **Then** o item "Executar" do menu está
   disponível e leva à área Executar, como hoje.
3. **Given** o perfil de consulta, **When** Relatórios é exibido, **Then** o item "Executar" não
   aparece no menu (regra já existente) e todo o resto (números, ranking, gavetas, navegação para Reservas) funciona igual.
4. **Given** o perfil de consulta, **When** a pessoa vai de Relatórios a Reservas, **Then** vê as
   reservas normalmente, sem ações de registro (regra já existente da feature 003).

---

### Edge Cases

- Período muito grande (todo o histórico gravado): o relatório continua exibido, com o indicador de
  carregamento enquanto calcula; os números continuam batendo com a lista de Reservas.
- Valor em aberto igual a zero: o card escuro mostra "R$ 0,00", a barra aparece vazia e o botão "Ver
  reservas em aberto" fica desabilitado com a explicação "Nada em aberto neste período".
- Só solicitado ou só pendente: a barra mostra um único segmento e a legenda mostra o outro como R$
  0,00.
- Fatias menores que 0,1% na distribuição: aparecem na legenda como "<0,1%", nunca como 0,0%; os
  percentuais exibidos somam 100% (arredondamento ajustado).
- Hotel com nome muito longo: o nome é cortado numa linha na lista e inteiro na gaveta.
- Dois hotéis com o mesmo valor em aberto: a ordem entre eles é estável (por nome) a cada atualização.
- Reserva que muda de situação entre o relatório e o clique em "Ver reservas": a lista de Reservas
  mostra a situação atual; o app avisa que os dados do relatório podem estar desatualizados quando
  houver divergência de contagem.
- Janela estreita: os três grupos de indicadores se reorganizam em coluna, sem rolagem horizontal e sem
  esconder o card de valor em aberto.
- Troca de período rápida e repetida: vale sempre o último período escolhido; respostas de períodos
  anteriores nunca sobrepõem a tela.
- Reserva com valor ausente: não entra na soma de valores e é contada em "Reservas"; o relatório
  indica quantas reservas ficaram sem valor.
- O relatório mostra nomes de hotéis reais do cliente; nenhum dado de hóspede aparece nos indicadores,
  no ranking nem na lista de hotéis.

## Requirements *(mandatory)*

### Functional Requirements

**Estrutura e navegação**

- **FR-001**: O app MUST ter a área "Relatórios", com ícone de gráfico, no menu lateral dos dois perfis
  de acesso, junto das demais áreas.
- **FR-002**: O módulo MUST oferecer as telas e estados: Visão geral, escolha do período, detalhe do
  hotel, nenhuma reserva no período, servidor indisponível, versão de consulta (sem "Executar") e
  todos os hotéis.
- **FR-003**: O módulo MUST ser somente de leitura: nada nele altera reservas, tratativas ou dados do
  Hunit, e as permissões dos perfis não mudam.

**Topo e período**

- **FR-004**: O topo MUST mostrar o selo de situação dos dados ("Dados atualizados" quando os números
  correspondem ao período e ao momento exibidos), o botão "Atualizar dados" e, no subtítulo, a hora da
  última atualização.
- **FR-005**: O período MUST ser um único campo, com os atalhos "Últimos 7 dias", "Últimos 30
  dias", "Este mês" e "Personalizado", aplicados na hora, sem botões "Aplicar filtros" ou "Limpar".
- **FR-005a**: Ao lado dos atalhos, o botão "Filtros" MUST abrir o painel "Filtros avançados", o mesmo
  da área Reservas, com Hotéis, Situação da reserva (as dez do FR-008a), Ativa ou cancelada, Canal,
  Origem e "Só as não encontradas na última verificação", aplicados na hora. Os filtros em vigor MUST
  aparecer na linha "Filtros aplicados", um chip removível por filtro e "Limpar filtros", e MUST valer
  para todos os números, o ranking, as gavetas e a ida para Reservas (FR-022). Com filtro de hotéis,
  "Hotéis com dados" conta só os hotéis escolhidos (FR-011). Os filtros ficam guardados ao trocar de
  área, como o período.
- **FR-006**: O calendário do período MUST ser o mesmo componente dos filtros de período das outras
  telas, com o dia de hoje selecionado em lima; o app MUST impedir períodos com início posterior ao fim
  (o calendário ordena o intervalo escolhido).
- **FR-007**: O período MUST se referir ao check-in das reservas e MUST ser o mesmo critério usado na
  área Reservas, de modo que as contagens sejam comparáveis.
- **FR-008**: O total de reservas do período MUST aparecer alinhado à direita do filtro, com separador
  de milhar e concordância de número ("1 reserva", "34.526 reservas").
- **FR-008a**: As reservas do relatório MUST ser as do período, menos as das situações "Ignorada
  (Hotelbeds 258)", "A revisar (sistema anterior)" e "Faturada", que não importam para a cobrança.
  Esse recorte vale para "Reservas", "N reservas no recorte", "Tratativas enviadas", "Hotéis com
  dados", o total de reservas de cada hotel e as faixas de valor. Entram as outras dez: Pendente de
  cobrança, Cobrar na maquininha, Cartão validado (não cobrado), Erro na cobrança e Erro de análise
  (pendente, ou solicitado com tratativa), Tratativa enviada e Validar comprovante (solicitado),
  Comprovante enviado e Já cobrada (cobrado anteriormente ou recuperado) e Cancelada sem cobrança
  (conta em "Reservas", sem valor).
- **FR-009**: Enquanto os números carregam, o app MUST mostrar um estado de carregamento no lugar dos
  valores; MUST NOT mostrar zeros como se fossem dados.

**Indicadores**

- **FR-010**: Os indicadores MUST ser agrupados em: volume (Reservas, Tratativas enviadas, Hotéis com
  dados), valor em aberto e valor já cobrado.
- **FR-011**: "Hotéis com dados" MUST ser escrito como "X de Y" (hotéis com reservas do relatório no
  período, de todos os hotéis cadastrados; com filtro de hotéis, dos hotéis escolhidos).
- **FR-012**: O valor em aberto MUST ser o total das reservas que exigem cobrança e ainda não foram
  cobradas, ou seja, as que continuam como "Falta cobrar" na área Reservas, somando o que tem
  tratativa enviada ("solicitado") e o que não tem ("pendente").
- **FR-013**: O valor em aberto MUST aparecer num card escuro de destaque com o total, a barra
  solicitado (cinza) / pendente (lima), os valores de cada parte e o botão "Ver reservas em aberto".
- **FR-014**: O valor já cobrado MUST aparecer num único card com o total e dois detalhes: "Cobrado
  anteriormente" (verde), a reserva cobrada que nunca teve tratativa (o Hunit já mostrava a cobrança,
  ou o comprovante foi anexado sem tratativa), e "Recuperado" (preto), a reserva cobrada que teve
  tratativa enviada antes da cobrança (comprovante anexado, retorno do Comercial confirmado ou o Hunit
  passou a mostrar a cobrança depois da tratativa). A reserva marcada como "Cancelada sem cobrança" não
  entra em nenhum dos dois. O rótulo antigo "Cobrado comercial" MUST ser substituído por "Cobrado
  anteriormente".
- **FR-015**: A distribuição dos valores MUST ser uma barra de 100% com legenda, nas faixas cobrado
  anteriormente, recuperado, pendente e solicitado, sobre a soma das quatro ("Do total de R$ … em
  cartão virtual"); cada linha da legenda MUST trazer o nome, o valor e o percentual, inclusive das
  fatias muito pequenas.
- **FR-016**: Valores MUST seguir o formato brasileiro (R$ 1.234,56; 96,6%); percentuais menores que
  0,1% MUST aparecer como "<0,1%", e os percentuais mostrados MUST somar 100%.
- **FR-017**: As cores MUST ser as da identidade: cinza = solicitado, lima = pendente, verde =
  cobrado anteriormente, preto = recuperado; nenhuma informação MUST depender só de cor (toda barra
  tem legenda com texto).

**Ranking e detalhe**

- **FR-018**: O ranking MUST listar os hotéis por valor em aberto, do maior para o menor, numerados, com
  barras na mesma escala entre si, valor à direita e seta de detalhe; cada linha MUST mostrar o nome
  do hotel como está no catálogo, e o app MUST NOT mostrar nome de rede (não há cadastro de rede).
- **FR-019**: O card do ranking MUST rolar internamente quando houver mais hotéis do que cabem, e MUST
  oferecer "Ver todos os hotéis".
- **FR-020**: A gaveta "Todos os hotéis" MUST listar todos os hotéis com reservas no período (os sem
  valor em aberto no fim, com R$ 0,00), com busca por nome (sem diferenciar maiúsculas e acentos) e
  as ordenações "Maior valor" (valor em aberto), "Mais pendente" (maior valor pendente, sem
  tratativa) e "Nome A-Z"; nas duas primeiras, empate pelo nome.
- **FR-021**: A gaveta de detalhe do hotel MUST mostrar o valor em aberto, um resumo (solicitado e
  pendente) e as reservas em aberto, com o botão "Ver as N reservas em Reservas".
- **FR-022**: "Ver as N reservas em Reservas" e "Ver reservas em aberto" MUST abrir a área Reservas já
  filtrada pelo período do relatório, pelos filtros em vigor (FR-005a) e pelas reservas em aberto (e
  pelo hotel, no primeiro caso), e a quantidade listada MUST ser igual à anunciada.
- **FR-023**: O fechamento de qualquer gaveta MUST devolver a pessoa ao relatório no mesmo estado.

**Estados e perfis**

- **FR-024**: Sem reservas no período, a tela MUST mostrar o estado vazio com explicação e o botão "Ver
  os últimos 30 dias"; com filtros em vigor (FR-005a), a explicação MUST citar os filtros e o botão
  MUST ser "Limpar filtros".
- **FR-025**: Com o servidor indisponível, o app MUST usar o mesmo alerta do resto do app, mostrar "dados
  de HH:MM", manter legíveis os números já exibidos e desabilitar as ações que dependem do servidor;
  sem dados anteriores, MUST mostrar só o alerta.
- **FR-026**: O item "Executar" do menu MUST continuar só no perfil operador (regra já existente); o
  perfil de consulta MUST ver todo o restante do módulo igual.
- **FR-027**: Os indicadores, o ranking e a gaveta "Todos os hotéis" MUST NOT exibir dados de
  hóspedes; só valores agregados, nomes de hotéis e contagens. A exceção é a lista de reservas em
  aberto da gaveta do hotel, que mostra em cada linha o hóspede, o número da reserva, o período, o
  valor e o selo da situação, como a área Reservas mostra aos dois perfis.
- **FR-028**: Os números do relatório MUST ser consistentes com os da área Reservas para o mesmo período
  e filtros: o valor em aberto e a quantidade de reservas em aberto MUST coincidir com o que a lista
  mostra; o total de reservas MUST coincidir com a soma das situações da lista, menos as três que o
  FR-008a deixa de fora.

### Key Entities

- **Relatório do período**: o conjunto de números calculados sobre as reservas gravadas com check-in no
  período escolhido, sem as três situações do FR-008a: totais de volume, valor em aberto (solicitado e pendente), valor já cobrado
  (cobrado anteriormente e recuperado), distribuição dos valores e hora em que foi calculado.
- **Resumo por hotel**: para cada hotel, no mesmo período, o valor em aberto (solicitado e pendente), a
  quantidade de reservas em aberto, o total de reservas, as tratativas enviadas e o valor já cobrado
  (cobrado anteriormente e recuperado).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma pessoa do Financeiro abre Relatórios e lê o valor em aberto do período em até 5
  segundos, sem rolar a tela nem usar filtros.
- **SC-002**: A partir da tela principal, a pessoa chega à lista das reservas em aberto de um hotel
  (do ranking) em no máximo 3 cliques.
- **SC-003**: Trocar o período (atalho ou personalizado) mostra o relatório completo em até 3 segundos
  em uma base com 35 mil reservas, sem nenhum clique de confirmação.
- **SC-004**: Em 100% dos casos verificados, o valor em aberto e a quantidade de reservas em aberto do
  relatório coincidem com os da área Reservas para o mesmo período, e o total de reservas coincide com
  o da área Reservas sem as três situações deixadas de fora (FR-008a).
- **SC-005**: Todas as 7 telas do módulo coincidem com o design oficial na revisão lado a lado feita
  por quem mantém o Figma, incluindo os estados vazio e de erro (o de carregamento não foi desenhado e
  segue os padrões da 006).
- **SC-006**: Com o servidor indisponível, 100% das ações que dependem dele aparecem desabilitadas e
  a hora dos dados exibidos fica visível; nenhuma tela mostra números sem indicar o momento a que se
  referem.
- **SC-007**: Em teste com as 4 usuárias iniciais, pelo menos 3 de 4 respondem corretamente, sem
  ajuda, "qual hotel tem mais valor em aberto?" e "quanto já foi cobrado?" em até 30 segundos.
- **SC-008**: Todas as fatias da distribuição, mesmo as menores que 2%, têm seu valor legível na
  legenda sem passar o mouse sobre nada.

## Assumptions

- **Fonte da verdade do visual**: o design oficial no Figma (página 007, telas 8.1 a 8.7); em caso de
  dúvida de detalhe, vale o Figma, e esta spec é atualizada se ele mudar.
- **Dependências**: o módulo parte do app com as features 002, 003 (tratativas, usadas para
  "solicitado", "pendente" e "recuperado") e 006 (identidade visual, componentes de calendário, gaveta,
  selos e alerta de servidor indisponível, que o design reutiliza), todas na `master` desde 2026-11-19.
  Também valem as regras da 005 ("Validar comprovante" conta como solicitado, pois continua em "Falta
  cobrar") e da 008 ("Cancelada sem cobrança" vale R$ 0,00 e fica fora de todas as faixas de valor).
- **Significado dos valores**: "em aberto" = reservas que ainda faltam cobrar; "solicitado" = parte
  delas com tratativa enviada; "pendente" = parte sem tratativa; "cobrado anteriormente" = cobrada sem
  nunca ter tido tratativa (antes chamado "cobrado comercial"); "recuperado" = cobrada depois de uma
  tratativa (clarificação de 2026-11-25, FR-014).
- **Distribuição dos valores**: a barra de 100% distribui o valor do período entre cobrado
  anteriormente, recuperado, pendente e solicitado; a legenda mostra valor e percentual
  (clarificação de 2026-11-25, FR-015).
- **Período padrão**: ao abrir o módulo vale "Últimos 30 dias", o mesmo recorte oferecido no estado
  vazio; o app lembra o último período escolhido só enquanto estiver aberto.
- **"Executar"**: é o item do menu que leva à área Executar (telas 8.1 e 8.6), já escondido do perfil
  de consulta; o módulo não tem botão "Executar" próprio; "perfil de consulta" é o perfil somente leitura já existente (nas telas do Figma
  a versão sem "Executar" aparece rotulada para o Financeiro; o critério aqui é o perfil de acesso,
  não o setor).
- **Dados do servidor**: os totais por período e por hotel vêm de uma rota nova, só acréscimo à API
  (plano, research R-02).
- **Atualização**: os dados são recalculados quando a pessoa abre o módulo, troca o período ou aciona
  "Atualizar dados"; não há atualização automática em segundo plano.
- **Uso**: 4 pessoas do Financeiro e da Controladoria, em computadores Windows, em tela de computador;
  só tema claro; rótulos em português do Brasil, exatamente como no design oficial.
- **Dados de demonstração**: os nomes de hotéis do design são fictícios; no app aparecem os nomes
  reais dos hotéis do cliente, e as telas do espelho no Figma continuam usando dados fictícios.
