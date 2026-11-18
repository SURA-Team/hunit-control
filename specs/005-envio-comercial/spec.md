# Feature Specification: Envio dos pedidos de cobrança ao Comercial

**Feature Branch**: `005-envio-comercial`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "Envio dos pedidos de cobrança ao Comercial por uma planilha do Google Sheets, com verificação no Hunit antes do envio e retorno do Comercial para o sistema. Hoje o Financeiro encontra no HUNIT Control as reservas que precisam de cobrança, pede a cobrança ao Comercial por e-mail e registra a tratativa (feature 003) anexando esse e-mail. O Comercial, que faz todas as cobranças, não usa o sistema e responde também por e-mail. O problema: os pedidos ficam espalhados em e-mails, o Comercial não tem uma lista única do que falta cobrar, e uma reserva pode ser pedida já cobrada, porque a situação no Hunit muda entre a última verificação e o pedido. Envio: o operador do Financeiro escolhe reservas que exigem ação (as que já aceitam tratativa na 003, inclusive a seleção em lote) e as envia ao Comercial. Todo envio começa com login no Hunit e token 2FA, informado pelo operador como numa execução e com o mesmo aviso do pedido de token. Depois, o sistema verifica cada reserva escolhida, uma por uma, e retira as que já aparecem como cobradas: elas são mostradas com o motivo e têm a situação atualizada. As que não puderem ser verificadas (erro, reserva não encontrada) não são enviadas e são relatadas. A verificação só lê o Hunit, nunca altera nada lá. As reservas confirmadas entram numa planilha nova, criada para isso e controlada pelo sistema, com uma linha por reserva (chave: hotel + número da reserva) e sem duplicar; reenviar atualiza a linha. O envio registra a tratativa "Enviada" sem exigir documento anexado, e a auditoria guarda quem enviou, quando e em qual envio. A tratativa com e-mail anexado da 003 continua aceita: os dois caminhos convivem. Planilha: é compartilhada com o Comercial, então leva só o necessário para cobrar, sem o nome do hóspede: hotel, número da reserva, check-in, canal, valor a cobrar, motivo/classificação e situação. O Comercial acha o hóspede no Hunit pelo número. As colunas preenchidas pelo sistema ficam protegidas contra edição. O Comercial só preenche as colunas de retorno: código de autorização, hotel da cobrança, valor cobrado e responsável pela cobrança. Uma aba mostra o que falta cobrar; quando a reserva fica "Cobrada" (confirmada pelo Financeiro ou mostrada como cobrada pelo Hunit), a linha vai para uma aba de concluídas. O usuário informa os nomes das colunas na especificação, nunca os dados. Retorno do Comercial: o servidor lê as colunas de retorno sozinho, de tempos em tempos, e o operador também pode pedir uma leitura na hora. Quando o Comercial preenche o retorno, os dados são gravados na reserva no HUNIT Control, mas a reserva não vira "Cobrada" direto: passa para uma nova situação, "Validar comprovante". O Financeiro confere o código de autorização e o pagamento direto na adquirente e então confirma ou recusa. Ao confirmar, a reserva vira "Cobrada" com o valor cobrado informado pelo Comercial. Ao recusar (código errado, valor diferente, pagamento não encontrado), informa o motivo: a reserva volta para pendente e a linha da planilha mostra a recusa e o motivo, para o Comercial corrigir. Retornos ilegíveis ou incompletos não mudam nada no sistema e são relatados. Confirmação, recusa e retorno entram na auditoria e no histórico da reserva. O app passa a filtrar por "Validar comprovante" e por enviadas ao Comercial. Valor cobrado na lista: a lista de reservas do app passa a mostrar o valor efetivamente cobrado (o informado à mão ou o vindo do Comercial, quando existir), e não só o total vindo do Hunit, que hoje só aparece no detalhe. Regras gerais: o sistema continua sendo a fonte da verdade, e a planilha é uma projeção dele mais um canal de retorno. Se a planilha estiver indisponível, nada se perde: envios e atualizações ficam pendentes, são refeitos sozinhos e a pendência é visível no app. O acesso à planilha fica só no servidor e nunca aparece no app, em logs, em mensagens de erro ou no repositório. O perfil operador envia, confirma e recusa; o perfil consulta vê os envios, os retornos e a situação de cada um. A API cresce só com acréscimos, sem quebrar o app desktop atual. Fora do escopo: o Comercial usar o app ou anexar comprovantes no sistema, envio de e-mail pelo sistema, consulta automática à adquirente (a conferência continua manual, feita pelo Financeiro), relatórios e painéis, exportação de planilhas e os ajustes pós-homologação do app desktop."

## Contexto

A divisão do trabalho continua a da spec 003: todas as cobranças são feitas pelo **Comercial**, que
não usa o sistema. O **Financeiro** encontra no HUNIT Control as reservas que precisam de cobrança,
pede a cobrança ao Comercial e registra a tratativa; a **Controladoria** só consulta.

Hoje o pedido ao Comercial é um e-mail, anexado à reserva como tratativa (spec 003), e a resposta do
Comercial também chega por e-mail. Isso causa três problemas:

1. os pedidos ficam espalhados em e-mails, e o Comercial não tem uma lista única do que falta cobrar;
2. uma reserva pode ser pedida já cobrada, porque a situação no Hunit muda entre a última verificação
   e o pedido;
3. a resposta do Comercial (código de autorização, valor cobrado) volta solta, e o Financeiro a
   transcreve à mão.

Esta feature acrescenta o **envio ao Comercial**: o Financeiro escolhe as reservas, o sistema as
verifica uma por uma no Hunit (só leitura), retira as que já foram cobradas e coloca as demais numa
**planilha do Comercial**, controlada pelo sistema. O Comercial cobra e preenche, na própria linha,
as **colunas de retorno**. O sistema lê esse retorno e o deixa para o Financeiro **validar** na
adquirente antes de a reserva contar como cobrada.

O sistema continua sendo a fonte da verdade (constitution, princípio VI). A planilha é uma
**projeção** dele, refeita a partir do sistema sempre que preciso, mais um **canal de entrada** para
o retorno: o que o Comercial escreve nunca muda uma reserva sozinho, só depois da validação do
Financeiro.

Nomes usados nesta spec, conforme a homologação da 003 (spec 003, sessão 2026-11-16): o "Enviada" da
descrição é a situação **"Tratativa enviada"**, e o "Cobrada" é a situação **"Comprovante enviado"**
(conta como cobrada).

Junto com isso, a feature acrescenta a **confirmação em lote do alerta "Verificar"** da spec 003,
que hoje só é individual e trava a revisão das reservas importadas do sistema anterior, e o
**"selecionar todas do filtro"**, porque hoje só dá para selecionar as reservas da página visível.

O pedido por e-mail continua existindo ao lado da planilha. Para ele, o app passa a **copiar as
reservas da pesquisa** numa tabela formatada como a planilha do Comercial, pronta para colar no corpo
do e-mail.

Ficam **fora do escopo**: o Comercial usar o app ou anexar comprovantes no sistema, envio de e-mail
pelo sistema, consulta automática à adquirente (a conferência continua manual, feita pelo
Financeiro), relatórios e painéis, exportação de planilhas em arquivo (a cópia para o e-mail não gera
arquivo) e os ajustes pós-homologação do app desktop.

## Clarifications

### Session 2026-11-17

- Q: Quais os nomes das colunas da planilha do Comercial? → A: Os propostos (FR-010). Do sistema:
  Hotel, Reserva, Check-in, Canal, Valor a cobrar, Motivo, Ativa ou cancelada, Situação, Enviada em e
  Validação do Financeiro. De retorno: Código de autorização, Hotel da cobrança, Valor cobrado e
  Responsável pela cobrança.
- Q: Como pedir a cobrança por e-mail com a mesma informação da planilha? → A: Pelo app, que copia as
  reservas da pesquisa (ou as selecionadas) numa tabela formatada como a planilha, para colar no corpo
  do e-mail (US5, FR-027 e FR-028). O usuário aceitava exportação ou copiar e colar; a cópia foi
  escolhida porque vai direto para o corpo do e-mail, sem arquivo intermediário com dados de reservas
  no disco da máquina (spec 002, SC-004) e sem entrar na exportação de planilhas, que está fora do
  escopo. Copiar não envia nada, não verifica no Hunit e não registra tratativa: o e-mail enviado
  continua sendo anexado como tratativa (spec 003).
- Q: Uma reserva em "Validar comprovante" continua no atalho "Falta cobrar"? → A: Sim, até a
  confirmação do Financeiro; o filtro "Validar comprovante" separa as que esperam conferência
  (FR-015).
- Q: Ao desfazer o envio de uma reserva, o que acontece com a linha na planilha? → A: Vai para
  "Concluídas" com a situação "Pedido cancelado pelo Financeiro", para o Comercial ver que deve parar;
  sai da planilha depois dos 90 dias, como as outras concluídas (FR-009, FR-026).
- Q: O "Hotel da cobrança" é escolhido numa lista do catálogo ou escrito livremente? → A: Escrito
  livremente (só não pode ficar vazio): é o estabelecimento que aparece na maquininha, que nem sempre é
  o hotel da reserva nem está no catálogo, e é por ele que o Financeiro acha o pagamento na adquirente
  (FR-018).
- Q: O Financeiro confirma vários retornos de uma vez? → A: Sim, em lote, depois de uma lista de
  revisão com o código, o hotel da cobrança, o valor e a diferença de cada um; a recusa é sempre
  individual, porque exige motivo (FR-016a).
- Q: (pedido do usuário na mesma sessão) O alerta "Verificar" da spec 003 pode ser confirmado em
  lote? → A: Sim, acrescentado a esta feature: hoje só é individual, e há cerca de 100 000 reservas do
  sistema anterior para revisar (FR-029).
- Q: A confirmação em lote do "Verificar" vale para a seleção ou para todo o resultado do filtro? →
  A: Só para a seleção, até 2 000 reservas por vez, como as outras ações em lote (FR-029).
- Q: (pedido do usuário na mesma sessão) "Selecionar todas" pode pegar todo o resultado do filtro, e
  não só as reservas da página visível (50)? → A: Sim. A seleção continua limitada a 2 000 (spec
  003, FR-006a): se o resultado passar do que cabe, entram as primeiras na ordem da lista e o app
  avisa quantas ficaram de fora. Com o lote do "Verificar", a revisão vira um ciclo: selecionar todas
  do filtro, confirmar, e as confirmadas saem do filtro "A verificar" (FR-030).

### Session 2026-11-17 (análise)

Decisões do `/speckit-analyze`.

- Q: Uma reserva com retorno aguardando validação que o Hunit passa a mostrar como "já cobrada" (ou
  que deixa de exigir cobrança): onde fica a linha e o que acontece com o retorno? → A: Vai para "A
  verificar". A reserva fica com a situação do Hunit e o alerta "Verificar" (spec 003, FR-002a); a
  linha vai para "Concluídas"; o retorno é encerrado sem validação e continua visível no histórico,
  para o Financeiro conferir. Ele não pode mais ser confirmado nem recusado, e nenhuma recusa volta a
  uma linha protegida (FR-009, FR-016).
- Q: O filtro "Enviada ao Comercial" é necessário? → A: Não; foi retirado. A tratativa já conta como
  enviada ao Comercial, tanto por e-mail (spec 003) quanto pela planilha, e o filtro "Tratativa
  enviada" já a encontra (FR-023).
- Q: O comando que prepara a planilha está descrito numa spec, como a constitution exige para os
  comandos administrativos (princípio III)? → A: Passa a estar: FR-008a.

### Session 2026-11-17 (homologação)

Ajustes pedidos pelo usuário ao homologar a planilha de teste (T064).

- Q: A planilha precisa de aparência de tabela? → A: Sim (FR-010a): cabeçalho das colunas do sistema
  (A a J) preto com letra lima e o das colunas de retorno (K a N) lima com letra preta; linhas de
  dados com listras claras alternadas e bordas tracejadas; o cabeçalho sem bordas.
- Q: A coluna "Validação do Financeiro" vira uma lista suspensa (dropdown) colorida? → A: Não. O
  Google não deixa o sistema escolher a cor de cada opção de uma lista suspensa, e a lista exigiria
  valores fixos, tirando da célula o motivo da recusa e o que falta no retorno. A célula inteira
  ganha a cor do status, com o texto completo: lima para a reserva enviada aguardando o retorno do
  Comercial, laranja para o retorno aguardando validação e vermelho para recusa e retorno com
  problema (FR-010a).
- Q: O que a coluna "Validação do Financeiro" mostra numa linha enviada que ainda não tem retorno? →
  A: "Aguardando retorno do Comercial" (antes ficava vazia), para a linha nova também ter a sua cor
  (FR-010).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enviar reservas ao Comercial com verificação no Hunit (Priority: P1)

O operador do Financeiro seleciona as reservas que precisam de cobrança (uma ou várias, com a seleção
mantida entre pesquisas da spec 003) e escolhe **"Enviar ao Comercial"**. O app mostra quantas serão
enviadas, quantas ficam de fora e por quê, e o total dos valores; o operador confirma e informa
usuário e senha do Hunit, como numa execução. Quando o Hunit pede o token, o operador recebe o mesmo
aviso de uma execução e o informa. O sistema então verifica cada reserva no Hunit, uma por uma: as
que ainda precisam de cobrança vão para a planilha do Comercial e ficam "Tratativa enviada"; as que
já aparecem como cobradas (ou que deixaram de exigir cobrança) são retiradas, com o motivo, e ficam
com a situação atualizada; as que não puderam ser verificadas não são enviadas e aparecem no
resultado com o motivo.

**Why this priority**: resolve os três problemas que motivam a feature do lado do pedido: o
Comercial passa a ter uma lista única, e nenhuma reserva já cobrada chega até ele. Sozinha, já
substitui o e-mail de pedido.

**Independent Test**: com o Hunit simulado, selecionar 10 reservas pendentes, sendo 2 que o Hunit
passou a mostrar como "já cobrada" e 1 que o Hunit não encontra; enviar ao Comercial e conferir que
7 aparecem na aba "A cobrar" da planilha (sem o nome do hóspede), ficam "Tratativa enviada" com o
envio no histórico, que as 2 foram retiradas com o motivo e ficaram "Já cobrada", e que a 1 aparece
como não verificada; reenviar 3 das 7 e conferir que a planilha continua com 7 linhas, sem
duplicadas.

**Acceptance Scenarios**:

1. **Given** reservas selecionadas, **When** o operador escolhe "Enviar ao Comercial", **Then** o app
   mostra quantas aceitam o envio, quantas ficam de fora (com o motivo de cada uma, FR-003) e o total
   dos valores, e pede a confirmação e as credenciais do Hunit antes de começar.
2. **Given** um envio iniciado, **When** o Hunit pede o token, **Then** o envio fica "aguardando
   token" e o operador recebe o mesmo aviso de uma execução (spec 002); **When** o token não é
   informado a tempo, **Then** o envio termina com "tempo de espera do token esgotado", sem enviar
   nenhuma reserva.
3. **Given** uma reserva que o Hunit ainda mostra como pendente de cobrança, **When** é verificada,
   **Then** os dados dela são atualizados com a leitura, ela entra na aba "A cobrar" da planilha e
   passa a "Tratativa enviada", e o histórico registra quem enviou, quando e em qual envio, sem
   exigir documento.
4. **Given** uma reserva que o Hunit passou a mostrar como "já cobrada", **When** é verificada,
   **Then** não é enviada, o resultado a mostra como retirada com o motivo, e a situação da reserva
   passa a refletir a leitura nova ("Já cobrada").
5. **Given** uma reserva que o Hunit não encontra ou cuja leitura falha, **When** o envio a processa,
   **Then** ela não é enviada, o resultado a mostra como "não verificada" com o motivo, e nada muda
   nela.
6. **Given** uma reserva já enviada, **When** o operador a envia de novo, **Then** a mesma linha da
   planilha é atualizada (sem criar outra), o retorno já preenchido pelo Comercial é mantido e o
   histórico registra o novo envio.
7. **Given** um envio em andamento, **When** o operador o acompanha, **Then** vê quantas reservas já
   foram verificadas, quantas faltam, e o resultado de cada uma; **When** ele cancela, **Then** as já
   processadas ficam como estão e as restantes aparecem como "não verificadas: envio cancelado".
8. **Given** um envio que falhou ou foi cancelado no meio, **When** o operador o retoma, **Then** um
   novo login com token é feito e só as reservas não verificadas são processadas.
9. **Given** uma reserva com tratativa por e-mail anexado (spec 003), **When** ela é enviada ao
   Comercial, **Then** o documento continua registrado, e o envio fica ao lado dele no histórico.

---

### User Story 2 - Validar o retorno do Comercial (Priority: P2)

O Comercial cobra a reserva e preenche, na linha dela, o código de autorização, o hotel da cobrança,
o valor cobrado e o responsável pela cobrança. O servidor lê esse retorno sozinho, de tempos em
tempos (ou na hora, quando o operador pede). A reserva passa a **"Validar comprovante"**, com o
retorno visível no app. O Financeiro confere o código e o pagamento na adquirente e **confirma** — a
reserva passa a "Comprovante enviado" com o valor cobrado informado pelo Comercial, e a linha vai
para a aba de concluídas — ou **recusa** com um motivo — a reserva volta a "Tratativa enviada" e a
linha mostra a recusa e o motivo, para o Comercial corrigir.

**Why this priority**: fecha o ciclo sem e-mail e sem transcrição à mão, mas depende de existir o
envio (US1). Até ela ficar pronta, o comprovante pode continuar sendo anexado como na 003.

**Independent Test**: com reservas enviadas, preencher na planilha o retorno de 3 delas (uma
completa, uma sem o valor cobrado e uma com valor ilegível); pedir a leitura na hora e conferir que
só a completa ficou "Validar comprovante" e que as outras duas foram relatadas, sem mudar nada;
confirmar a completa e conferir que ficou "Comprovante enviado" com o valor do Comercial e foi para
"Concluídas"; recusar outra depois de corrigida e conferir a recusa e o motivo na linha.

**Acceptance Scenarios**:

1. **Given** uma reserva enviada, **When** o Comercial preenche as quatro colunas de retorno e o
   servidor as lê, **Then** o retorno é gravado na reserva, ela passa a "Validar comprovante", a
   linha mostra "Aguardando validação do Financeiro" e o histórico registra o retorno recebido.
2. **Given** um retorno com coluna faltando ou valor ilegível (FR-018), **When** o servidor o lê,
   **Then** nada muda na reserva, o problema aparece no app na lista de retornos com problema e na
   própria linha (ex.: "Retorno incompleto: falta o valor cobrado").
3. **Given** uma reserva "Validar comprovante", **When** o operador abre a validação, **Then** vê o
   código de autorização, o hotel da cobrança ao lado do hotel da reserva (destacado quando forem
   diferentes), o valor cobrado, o responsável, quando o retorno foi lido, o valor a cobrar e a
   diferença entre os dois valores, se houver.
4. **Given** a validação aberta, **When** o operador confirma, **Then** a reserva passa a
   "Comprovante enviado" com o valor cobrado identificado como "informado pelo Comercial", a linha vai
   para a aba "Concluídas" e o histórico registra quem confirmou e quando.
5. **Given** a validação aberta, **When** o operador recusa e informa o motivo (ex.: código errado,
   valor diferente, pagamento não encontrado), **Then** a reserva volta a "Tratativa enviada", a
   linha continua em "A cobrar" com "Recusado pelo Financeiro: <motivo>" e o histórico registra a
   recusa; recusar sem motivo não é aceito.
6. **Given** um retorno recusado, **When** o Comercial corrige alguma coluna de retorno e o servidor
   a lê, **Then** o retorno novo substitui o recusado, a reserva volta a "Validar comprovante" e a
   indicação de recusa sai da linha.
7. **Given** uma reserva "Validar comprovante", **When** o Comercial altera o retorno antes da
   validação, **Then** o retorno novo substitui o anterior e o histórico registra a alteração.
8. **Given** o operador quer ver um retorno recém-preenchido, **When** pede "Ler retornos agora",
   **Then** a leitura é feita na hora e o resultado aparece em até 1 minuto.
9. **Given** várias reservas "Validar comprovante" selecionadas, **When** o operador escolhe
   confirmar em lote, **Then** o app mostra a lista de revisão (código, hotel da cobrança e hotel da
   reserva, valor cobrado, valor a cobrar e diferença de cada uma) e, depois da confirmação, todas
   passam a "Comprovante enviado", com o histórico de cada uma; as selecionadas sem retorno aguardando
   validação ficam de fora, com o motivo.

---

### User Story 3 - Acompanhar envios, retornos e a planilha (Priority: P2)

Quem consulta (o Financeiro, com perfil operador, ou a Controladoria, com perfil consulta) vê a lista
de envios — quem enviou, quando, quantas reservas foram enviadas, retiradas e não verificadas — e o
resultado de cada um, filtra as reservas por "Validar comprovante", vê os
retornos com problema e sabe se há atualizações da planilha pendentes. O perfil consulta não envia,
não confirma, não recusa e não pede leitura.

**Why this priority**: dá visibilidade do que está com o Comercial e do que espera o Financeiro;
sem isso, a fila de validação e as pendências da planilha ficam invisíveis.

**Independent Test**: com envios e retornos em várias situações, conferir a lista de envios e o
resultado de cada um, o filtro "Validar comprovante" combinado com hotel e período, e a lista de retornos com problema; deixar a planilha indisponível, enviar uma reserva e
conferir que a pendência aparece no app e some sozinha quando a planilha volta; com uma chave de
perfil consulta, conferir que tudo isso é visível e nenhuma ação é aceita.

**Acceptance Scenarios**:

1. **Given** envios feitos, **When** se abre a lista de envios, **Then** cada um mostra quem enviou,
   quando, o estado, e as contagens de enviadas, retiradas e não verificadas; **When** se abre um
   envio, **Then** aparece o resultado de cada reserva, com o motivo das retiradas e das não
   verificadas.
2. **Given** reservas em várias situações, **When** se filtra a situação "Validar comprovante",
   **Then** aparecem só as que têm retorno aguardando validação; **When** se filtra "Tratativa
   enviada", **Then** aparecem as enviadas ao Comercial por qualquer caminho (e-mail anexado ou
   planilha) que ainda não têm retorno aguardando validação.
3. **Given** a planilha indisponível, **When** um envio, uma confirmação ou uma recusa acontece,
   **Then** o registro no sistema é feito normalmente, a atualização da planilha fica pendente e o app
   mostra quantas atualizações estão pendentes e desde quando; **When** a planilha volta, **Then** as
   pendências são aplicadas sozinhas, sem ação do operador.
4. **Given** uma chave de perfil consulta, **When** ela tenta enviar, confirmar, recusar ou pedir uma
   leitura, **Then** a API recusa e o app não oferece essas ações.
5. **Given** uma reserva enviada, **When** se abre o histórico dela, **Then** aparecem os envios, os
   retornos recebidos e alterados, as confirmações e as recusas, cada um com quem e quando (os 5 mais
   recentes e "Mostrar mais", spec 003 FR-017a).
6. **Given** reservas com o alerta "Verificar" selecionadas (até 2 000), **When** o operador escolhe
   confirmar o alerta em lote, **Then** o app mostra quantas têm o alerta, quantas ficam de fora e a
   contagem por status do Hunit e pede confirmação; **When** ele confirma, **Then** o alerta sai de
   todas, a tratativa continua registrada e cada uma ganha o registro no histórico (FR-029).
7. **Given** um filtro "A verificar" com 5 000 reservas em várias páginas, **When** o operador
   escolhe selecionar todas do filtro, **Then** as 2 000 primeiras da lista são selecionadas e o app
   avisa que 3 000 ficaram de fora; **When** ele confirma o alerta em lote e repete a seleção, **Then**
   entram as próximas 2 000, porque as confirmadas saíram do filtro (FR-030).

---

### User Story 4 - Ver o valor cobrado na lista de reservas (Priority: P3)

Na lista de reservas, além do valor total vindo do Hunit, o operador vê o **valor efetivamente
cobrado** quando ele existe: o que o Hunit informa, o informado à mão pelo Financeiro (spec 003) ou o
informado pelo Comercial e confirmado, identificado pela origem. Hoje esse valor só aparece no
detalhe.

**Why this priority**: corrige a conferência rápida pela lista (pendência da homologação da 004), mas
não bloqueia o fluxo de envio e retorno.

**Independent Test**: com reservas com valor cobrado de cada origem e sem nenhum, conferir na lista
o valor cobrado e a origem de cada uma, e que o total do Hunit continua visível.

**Acceptance Scenarios**:

1. **Given** uma reserva com valor cobrado informado pelo Comercial e confirmado, **When** se vê a
   lista, **Then** ela mostra o valor total e o valor cobrado, com a indicação "Comercial".
2. **Given** uma reserva com valor manual (spec 003, FR-005) e sem valor cobrado do Hunit, **When**
   se vê a lista, **Then** o valor cobrado é o manual, com a indicação "manual".
3. **Given** uma reserva sem nenhum valor cobrado, **When** se vê a lista, **Then** a coluna do valor
   cobrado fica vazia, e o valor total continua visível.

---

### User Story 5 - Copiar as reservas da pesquisa para o e-mail ao Comercial (Priority: P3)

Quando o pedido ao Comercial vai por e-mail (o caminho da spec 003, que continua aceito), o operador
pesquisa as reservas com os filtros de sempre e escolhe **"Copiar para e-mail"**. O app copia uma
tabela formatada como a planilha do Comercial — as mesmas colunas, sem o nome do hóspede, com o total
dos valores — e o operador cola no corpo do e-mail, que mantém a tabela formatada. Se houver reservas
selecionadas, ele escolhe copiar as selecionadas ou o resultado da pesquisa.

**Why this priority**: evita montar a tabela à mão no e-mail, mas o envio pela planilha (US1) já
resolve o pedido; a cópia serve aos pedidos que continuam por e-mail.

**Independent Test**: filtrar um hotel e um período com 30 reservas em 2 páginas, copiar e colar num
programa de e-mail; conferir que as 30 aparecem numa tabela com as colunas da planilha, na ordem da
lista, sem o nome do hóspede, com o total, e que nada mudou nas reservas; repetir com 5 reservas
selecionadas em pesquisas diferentes e escolher "selecionadas".

**Acceptance Scenarios**:

1. **Given** uma pesquisa com resultado, **When** o operador escolhe "Copiar para e-mail", **Then** o
   app copia todas as reservas do resultado (todas as páginas, não só a visível) numa tabela com as
   colunas Hotel, Reserva, Check-in, Canal, Valor a cobrar, Motivo, Ativa ou cancelada e Situação, uma
   linha com o total dos valores e, acima da tabela, os filtros usados e o momento dos dados, e avisa
   quantas reservas foram copiadas.
2. **Given** a tabela copiada, **When** o operador cola no corpo de um e-mail, **Then** ela aparece
   como tabela formatada; **When** cola num lugar que só aceita texto, **Then** aparece como texto em
   colunas separadas por tabulação.
3. **Given** reservas selecionadas (spec 003, FR-006a), **When** o operador escolhe "Copiar para
   e-mail", **Then** o app pergunta se copia as selecionadas ou o resultado da pesquisa.
4. **Given** um resultado com mais de 2 000 reservas, **When** o operador tenta copiar, **Then** o
   app não copia e pede para refinar os filtros.
5. **Given** a cópia feita, **When** se consulta as reservas copiadas, **Then** nada mudou nelas: a
   cópia não registra tratativa, não envia nada e não acessa o Hunit.

### Edge Cases

- **Reserva com retorno aguardando validação selecionada para envio**: fica de fora do envio, com o
  motivo "retorno do Comercial aguardando validação"; o Financeiro precisa confirmar ou recusar antes.
- **Reserva com comprovante (arquivo ou retorno confirmado) selecionada para envio**: fica de fora,
  com o motivo "já tem comprovante".
- **"A revisar (sistema anterior)" no envio** (spec 004, FR-007a): aceita o envio; a verificação no
  Hunit a reclassifica, e ela é enviada ou retirada conforme a classificação nova.
- **A verificação mostra outra classificação que ainda exige cobrança** (ex.: de "pendente de
  cobrança" para "erro na cobrança"): a reserva é enviada com a classificação nova na coluna de
  motivo, e a mudança fica no histórico (spec 001, FR-018b).
- **A verificação mostra "faturada" ou "cancelada sem cobrança"**: a reserva é retirada, como a "já
  cobrada", com a situação nova como motivo.
- **Reserva enviada que uma execução comum passa a mostrar como "já cobrada"** (ou que deixa de
  exigir cobrança): vale a regra da spec 003, FR-002a — a situação do Hunit prevalece, com o alerta
  "Verificar" —, e a linha vai para "Concluídas" com a situação do Hunit.
- **Retorno aguardando validação e o Hunit passa a mostrar "já cobrada"** (ou outra situação que não
  exige cobrança): a reserva vai para "A verificar" — situação do Hunit com o alerta "Verificar"
  (spec 003, FR-002a) —, a linha vai para "Concluídas" e o retorno é encerrado sem validação: continua
  visível no histórico para a conferência, mas não pode mais ser confirmado nem recusado. Confirmar o
  alerta segue a regra da spec 003.
- **Comprovante anexado como arquivo (spec 003) numa reserva enviada**: a reserva passa a
  "Comprovante enviado" e a linha vai para "Concluídas"; um retorno que estivesse aguardando
  validação fica registrado no histórico como não validado.
- **Desfazer a tratativa de envio** (spec 003, FR-004): a linha vai para "Concluídas" com a situação
  "Pedido cancelado pelo Financeiro", e a reserva volta a refletir o que restou; é recusado enquanto
  houver retorno aguardando validação. A reversão no prazo de 30 dias (spec 003, FR-013a) devolve a
  tratativa e a linha para "A cobrar". Um retorno preenchido numa linha cancelada não é lido (a linha
  está protegida, FR-011).
- **Desfazer a confirmação de um retorno** (desfazer o comprovante, spec 003, FR-004): o retorno
  volta a aguardar validação, a reserva volta a "Validar comprovante" e a linha volta para "A
  cobrar".
- **Retorno preenchido numa linha já concluída**: as linhas de "Concluídas" ficam inteiramente
  protegidas; um retorno que chegue no momento em que a linha é movida é lido antes da mudança e fica
  no histórico, sem mudar a situação da reserva.
- **Linha apagada, movida, ou com a chave alterada na planilha**: o sistema a reconstrói a partir dos
  seus dados na atualização seguinte e relata o ocorrido; o retorno já lido não se perde (está no
  sistema).
- **Linha acrescentada à mão na planilha, sem envio correspondente**: é ignorada e relatada; o
  sistema nunca cria nem altera uma reserva a partir da planilha.
- **Valor cobrado diferente do valor a cobrar**: é aceito como retorno; a validação mostra a
  diferença, e cabe ao Financeiro confirmar ou recusar.
- **Comercial preenchendo o retorno aos poucos**: enquanto faltar coluna, a linha mostra "Retorno
  incompleto" e nada muda; quando as quatro estiverem preenchidas, a leitura seguinte o aceita.
- **Envio com uma execução em andamento na mesma conta do Hunit**: é recusado com o motivo, como duas
  execuções na mesma conta (constitution, princípio IV; spec 002).
- **Hunit indisponível por alguns instantes durante a verificação**: a leitura é repetida como numa
  execução (spec 001, FR-011a); esgotadas as tentativas, a reserva fica "não verificada" e o envio
  segue para a próxima.
- **Sessão do Hunit expira no meio do envio**: o envio termina como falho; as reservas já
  processadas ficam como estão, e a retomada (US1, cenário 8) processa as restantes.
- **Planilha indisponível por muito tempo**: os registros no sistema continuam; as pendências se
  acumulam e são aplicadas na ordem em que aconteceram quando a planilha volta, sem perda.
- **Leitura de retornos com a planilha indisponível**: falha sem mudar nada, aparece no app como
  pendência ("última leitura em HH:MM") e é refeita na próxima leitura automática.
- **Motivo da recusa com dado pessoal**: o motivo vai para a planilha, vista pelo Comercial; o app
  avisa isso ao pedir o motivo.
- **Reserva anonimizada pelo prazo de retenção** (spec 001, FR-026): a linha sai da planilha, se ainda
  estiver lá.
- **Copiar para e-mail com dados antigos**: a cópia mostra o que o sistema tem, sem verificar no
  Hunit; por isso leva o momento dos dados acima da tabela. Para retirar as já cobradas antes do
  pedido, o caminho é o envio pela planilha (US1).
- **Copiar para e-mail com resultado vazio**: a ação fica indisponível.
- **Selecionar todas do filtro com a seleção quase cheia**: entram só as que cabem até 2 000, na
  ordem da lista, e o app avisa quantas ficaram de fora; as que já estavam selecionadas não contam
  duas vezes.
- **Resultado do filtro muda depois de selecionar** (ex.: uma execução reclassifica reservas): a
  seleção não muda sozinha; a elegibilidade de cada reserva é conferida na confirmação da ação em
  lote (spec 003, FR-006a), e as que mudaram aparecem entre as ignoradas, com o motivo.
- **Copiar reservas que não exigem cobrança** (ex.: um filtro que traz "já cobrada"): são copiadas
  como estão, com a situação na coluna; a cópia é um recorte da pesquisa, não um pedido conferido.

## Requirements *(mandatory)*

### Functional Requirements

**Envio**

- **FR-001**: O operador MUST poder enviar ao Comercial uma ou várias reservas (inclusive a seleção
  mantida entre pesquisas, spec 003 FR-006a). Antes de começar, o app MUST mostrar quantas aceitam o
  envio, quantas ficam de fora, com o motivo de cada uma, e o total dos valores, e pedir confirmação.
- **FR-002**: Todo envio MUST começar com login no Hunit com as credenciais e o token 2FA informados
  pelo operador, com os mesmos estados, aviso do pedido de token, tempo limite do token e regras de
  credenciais de uma execução (spec 001, US1; spec 002). O envio MUST respeitar a regra de uma
  automação por vez por conta do Hunit (constitution, princípio IV).
- **FR-003**: Aceitam o envio as reservas que aceitam tratativa (spec 003, FR-003, e "A revisar
  (sistema anterior)", spec 004 FR-007a) e que não têm comprovante nem retorno aguardando validação.
  Uma reserva já enviada MAY ser enviada de novo. A elegibilidade MUST ser conferida no momento da
  confirmação.
- **FR-004**: O sistema MUST verificar cada reserva do envio no Hunit, uma por uma, só com leituras
  (spec 001, FR-012; constitution, princípio II), e MUST atualizar os dados e a classificação da
  reserva com o que leu, como numa execução (spec 001, FR-016 a FR-018b).
- **FR-005**: Depois da verificação, cada reserva MUST ter um destes resultados, mostrado no
  acompanhamento e no resultado do envio:
  - **enviada**: a classificação nova ainda exige cobrança (spec 003, FR-003);
  - **retirada**: a classificação nova não exige mais cobrança (ex.: "já cobrada", "faturada",
    "cancelada sem cobrança"), com a classificação como motivo;
  - **não verificada**: a reserva não foi encontrada no Hunit, a leitura falhou ou o envio foi
    cancelado antes dela, com o motivo; nada muda na reserva.
- **FR-006**: Cada reserva enviada MUST passar a ter a tratativa de envio, sem documento anexado: a
  situação da reserva passa a "Tratativa enviada" (spec 003, FR-002), e o histórico (spec 003,
  FR-012) registra quem enviou, quando e o envio. A tratativa com documento da spec 003 continua
  aceita; uma reserva pode ter as duas.
- **FR-007**: O operador MUST poder acompanhar um envio em andamento (verificadas, restantes,
  resultado de cada uma), cancelá-lo e retomar um envio falho ou cancelado. A retomada MUST fazer novo
  login com token e processar só as reservas não verificadas. O registro de cada reserva enviada MUST
  ser feito assim que ela é verificada, para que uma falha no meio deixe claro o que foi e o que não
  foi enviado.

**Planilha do Comercial**

- **FR-008**: O sistema MUST manter uma planilha do Comercial, criada para isso e controlada pelo
  sistema, com uma linha por reserva enviada, identificada por hotel + número da reserva, sem
  duplicadas. Reenviar uma reserva MUST atualizar a linha dela, mantendo o retorno.
- **FR-008a**: A preparação da planilha (abas, cabeçalhos, formatos e proteções das FR-009 a FR-011)
  MUST ser feita por um **comando administrativo de implantação**, rodado por quem administra o
  servidor, no próprio computador do servidor (constitution, princípio III), depois de criar a
  planilha no Google e compartilhá-la com o acesso do servidor. O comando MUST também permitir só
  conferir o acesso e o formato, sem mudar nada. Ele MUST NOT ser usado pelos clientes (app, Sura),
  MUST NOT acessar o Hunit, MUST NOT mostrar as credenciais da planilha, e o estado da planilha que
  ele prepara MUST ficar visível pela API (FR-013). Se o formato for alterado na planilha (aba
  renomeada, cabeçalho apagado), o sistema MUST parar de escrever, mostrar isso no app e voltar a
  funcionar depois que o comando for rodado de novo.
- **FR-009**: A planilha MUST ter duas abas: **"A cobrar"**, com as reservas enviadas que ainda não
  têm comprovante e ainda exigem cobrança (inclusive as "Validar comprovante" e as recusadas), e
  **"Concluídas"**, com as que passaram a "Comprovante enviado", deixaram de exigir cobrança no
  Hunit ou tiveram o envio desfeito pelo Financeiro (situação **"Pedido cancelado pelo
  Financeiro"**). A linha MUST mudar de aba sozinha quando a situação da reserva mudar, por qualquer
  caminho (envio, execução, validação, ações da spec 003). Se a reserva deixar de exigir cobrança no
  Hunit com um retorno aguardando validação, a linha vai para "Concluídas" e o retorno é encerrado
  sem validação: a reserva fica "A verificar" (alerta "Verificar", spec 003 FR-002a) e o retorno
  continua visível no histórico.
- **FR-010**: A planilha MUST ter só estas colunas, nesta ordem, e MUST NOT conter o nome do hóspede
  nem outro dado pessoal do hóspede (nomes confirmados pelo usuário, sessão 2026-11-17):
  - preenchidas pelo sistema, protegidas contra edição: **Hotel**, **Reserva** (número), **Check-in**,
    **Canal**, **Valor a cobrar** (total da reserva no Hunit), **Motivo** (a classificação, ex.:
    "Pendente de cobrança"), **Ativa ou cancelada**, **Situação** (a situação da reserva no HUNIT
    Control), **Enviada em** (último envio) e **Validação do Financeiro** (aguardando o retorno do
    Comercial, aguardando validação, recusa e motivo, confirmação ou o problema do retorno);
  - preenchidas pelo Comercial, as colunas de retorno: **Código de autorização**, **Hotel da
    cobrança**, **Valor cobrado** e **Responsável pela cobrança**.
- **FR-010a**: A planilha MUST ter aparência de tabela, aplicada pelo comando de FR-008a nas duas
  abas: cabeçalho das colunas do sistema preto com letra lima (`#D4F25A`) e o das colunas de retorno
  lima com letra preta, sem bordas; linhas de dados com listras claras alternadas e bordas
  tracejadas, também nas linhas que entram depois da preparação. A célula "Validação do Financeiro"
  MUST ter a cor do status, com o texto completo: lima para "Aguardando retorno do Comercial",
  laranja para "Aguardando validação do Financeiro" e vermelho para a recusa e o retorno com problema
  (FR-017, FR-018). A aparência não é conferida pelo sistema: mudá-la na planilha não impede a
  sincronização, e o comando a refaz.
- **FR-011**: As colunas do sistema MUST ficar protegidas contra edição pelo Comercial, e as linhas
  de "Concluídas" MUST ficar inteiramente protegidas. Se uma célula do sistema estiver diferente do
  que o sistema tem (por edição, linha apagada ou movida), a atualização seguinte MUST restaurá-la e o
  caso MUST ser relatado no app.
- **FR-012**: A planilha MUST ser uma projeção do sistema: pode ser refeita inteira a partir dos dados
  do sistema, e nada do que estiver nela MUST mudar uma reserva, a não ser o retorno validado pelo
  Financeiro (FR-016). A leitura do retorno é entrada, nunca fonte da verdade (constitution,
  princípio VI).
- **FR-013**: Se a planilha estiver indisponível, os registros no sistema MUST acontecer normalmente,
  e as atualizações da planilha MUST ficar pendentes e ser refeitas sozinhas, na ordem, até darem
  certo, sem perda. O app MUST mostrar se há atualizações pendentes, quantas e desde quando, e quando
  foi a última leitura de retornos com sucesso.

**Retorno do Comercial**

- **FR-014**: O servidor MUST ler as colunas de retorno sozinho, a cada 10 minutos, e o operador MUST
  poder pedir uma leitura na hora.
- **FR-015**: Um retorno MUST ser aceito só se as quatro colunas estiverem preenchidas e legíveis
  (FR-018). Aceito, o retorno MUST ser gravado na reserva com o momento da leitura, e a reserva MUST
  passar a **"Validar comprovante"**, uma nova situação da reserva (spec 003, FR-002), que MUST
  continuar no atalho "Falta cobrar" até a confirmação (FR-016), porque a cobrança ainda não foi
  conferida. A linha MUST mostrar "Aguardando validação do Financeiro".
- **FR-016**: O operador MUST poder **confirmar** um retorno aguardando validação: a reserva passa a
  "Comprovante enviado" (o retorno confirmado vale como comprovante, sem arquivo) e o valor cobrado
  informado pelo Comercial passa a ser o valor cobrado da reserva, identificado pela origem (FR-024).
- **FR-016a**: O operador MUST poder confirmar vários retornos aguardando validação de uma vez
  (seleção da spec 003, FR-006a). Antes, o app MUST mostrar uma lista de revisão com, para cada
  reserva, o código de autorização, o hotel da cobrança ao lado do hotel da reserva, o valor cobrado,
  o valor a cobrar e a diferença, e pedir confirmação. Reservas selecionadas sem retorno aguardando
  validação ficam de fora, com o motivo. O resultado e o histórico seguem FR-016 e FR-020 para cada
  reserva; a recusa (FR-017) é sempre individual.
- **FR-017**: O operador MUST poder **recusar** um retorno aguardando validação, informando o motivo
  (obrigatório, até 500 caracteres; o app sugere "código de autorização errado", "valor diferente" e
  "pagamento não encontrado"): a reserva volta a "Tratativa enviada", e a linha continua em "A cobrar"
  com "Recusado pelo Financeiro: <motivo>". Uma alteração seguinte de qualquer coluna de retorno MUST
  ser lida como um retorno novo (FR-015), que tira a recusa da linha.
- **FR-018**: Um retorno com coluna faltando ou valor ilegível MUST NOT mudar nada na reserva e MUST
  ser relatado no app (lista de retornos com problema) e na coluna "Validação do Financeiro" da linha,
  dizendo o que falta ou o que não foi entendido. São ilegíveis: valor cobrado que não seja um valor
  em reais maior que zero, com até 2 casas decimais; código de autorização, hotel da cobrança ou
  responsável só com espaços ou com mais de 100 caracteres. O hotel da cobrança é texto livre: o
  estabelecimento que aparece na maquininha, sem validação contra o catálogo de hotéis.
- **FR-019**: Uma alteração do retorno feita pelo Comercial antes da validação MUST substituir o
  retorno anterior e ficar no histórico. Depois da confirmação, a linha fica em "Concluídas",
  protegida, e o retorno não muda mais pela planilha.

**Auditoria, acesso e segredos**

- **FR-020**: Todo envio (com o resultado de cada reserva), retorno recebido ou alterado, confirmação
  e recusa (com o motivo) MUST ficar no histórico da reserva (spec 003, FR-012) com o cliente da API
  que fez — ou "Comercial (planilha)" para os retornos — e o momento. Os envios MUST ficar consultáveis
  com quem enviou, quando, o estado e o resultado de cada reserva.
- **FR-021**: O perfil operador MUST poder enviar, acompanhar, cancelar e retomar envios, confirmar e
  recusar retornos, confirmar o alerta "Verificar" em lote e pedir a leitura na hora; o perfil consulta MUST poder ver os envios, os retornos,
  os retornos com problema, as pendências da planilha e a situação de cada reserva, e a API MUST
  recusar as ações dele.
- **FR-022**: O acesso à planilha (credenciais e chaves) MUST ficar só no servidor, configurado como
  segredo, e MUST NOT aparecer no app, na API, em logs, em mensagens de erro, em evidências ou no
  repositório. As mensagens de falha da planilha mostradas no app MUST ser genéricas (ex.: "planilha
  indisponível", "sem permissão na planilha").

**Consulta e app desktop**

- **FR-023**: A consulta de reservas (API e app) MUST oferecer "Validar comprovante" no filtro de
  situação da reserva (spec 003, FR-015), combinável com os filtros existentes. Não há filtro próprio
  de "enviada ao Comercial": a situação "Tratativa enviada" já reúne as enviadas por e-mail (spec
  003) e pela planilha. A consulta MUST mostrar, para cada reserva enviada, o último envio, a aba em que está e o
  retorno (atual e histórico).
- **FR-024**: A lista de reservas MUST mostrar, além do valor total, o **valor cobrado** quando
  existir, com a origem: o do Hunit, se houver (maior que zero: os R$ 0,00 que o Hunit registra na
  validação do cartão não são cobrança); senão, o manual (spec 003, FR-005); senão, o do Comercial
  confirmado (FR-016). Todos continuam visíveis no detalhe, identificados pela origem.
- **FR-025**: O app MUST oferecer a ação "Enviar ao Comercial" ao lado das ações de lote da spec 003,
  o acompanhamento do envio, a lista de envios com o resultado de cada um, a validação do retorno
  (confirmar, confirmar em lote e recusar), a confirmação do alerta "Verificar" em lote (FR-029),
  selecionar todas do filtro (FR-030), a lista de retornos com problema, "Ler retornos agora" e a indicação de
  pendências da planilha. As ações MUST ficar ocultas para o perfil consulta.

**Cópia para e-mail**

- **FR-027**: O app MUST oferecer, na consulta de reservas, a ação **"Copiar para e-mail"**, que
  copia as reservas do resultado da pesquisa (todas as páginas) ou, à escolha do operador, as
  selecionadas (spec 003, FR-006a), até 2 000 reservas, numa tabela com as colunas Hotel, Reserva,
  Check-in, Canal, Valor a cobrar, Motivo, Ativa ou cancelada e Situação (os mesmos nomes e valores
  da planilha, FR-010), na ordem da lista, com uma linha de total dos valores e, acima, os filtros
  usados e o momento dos dados. A tabela MUST ser copiada ao mesmo tempo formatada (para colar no
  corpo do e-mail) e como texto separado por tabulação (para colar onde só se aceita texto). A cópia
  MUST NOT conter o nome do hóspede nem outro dado pessoal do hóspede.
- **FR-028**: A cópia MUST NOT alterar reservas, registrar tratativa, acessar o Hunit nem gravar
  arquivo na máquina. Os perfis operador e consulta MAY copiar, porque a cópia só mostra o que eles já
  podem consultar.

**Alerta "Verificar" em lote**

- **FR-029**: O operador MUST poder confirmar o alerta "Verificar" (spec 003, FR-002a) de várias
  reservas de uma vez, a partir da seleção mantida entre pesquisas (spec 003, FR-006a), até 2 000
  reservas por vez. Antes, o app MUST mostrar quantas reservas têm o alerta, quantas ficam de fora
  (sem alerta), a contagem por status do Hunit e pedir confirmação. Cada reserva confirmada MUST
  seguir a regra da confirmação individual (só tira o alerta, mantém a tratativa e registra no
  histórico, com o status do Hunit confirmado, quem e quando), e o resultado MUST informar as que
  ficaram de fora, com o motivo. Só o perfil operador confirma.

**Selecionar todas do filtro**

- **FR-030**: Além de selecionar as reservas da página visível, o app MUST permitir **selecionar
  todas as reservas do resultado da pesquisa**, de todas as páginas, somando-as à seleção mantida
  entre pesquisas (spec 003, FR-006a). Se o total passar do limite da seleção (2 000), o app MUST
  selecionar as primeiras na ordem da lista até o limite e avisar quantas ficaram de fora. A seleção
  continua valendo para todas as ações em lote (spec 003: tratativa e comprovante; esta spec: envio
  ao Comercial, confirmação de retornos, alerta "Verificar" e cópia para e-mail). Selecionar MUST NOT
  alterar nenhuma reserva.

**Retenção**

- **FR-026**: As linhas de "Concluídas" MUST sair da planilha 90 dias depois de concluídas; o envio,
  o retorno e a validação continuam no sistema. Os retornos e os envios seguem o prazo de retenção da
  reserva (spec 001, FR-026), e a linha de uma reserva anonimizada MUST sair da planilha.

### Key Entities *(include if feature involves data)*

- **Envio ao Comercial**: um pedido de envio feito por um operador — quem, quando, estado (na fila,
  em andamento, aguardando token, concluído, falhou, cancelado), as reservas pedidas e o resultado de
  cada uma (enviada, retirada com a classificação, não verificada com o motivo). Pode ser retomado.
- **Cópia para e-mail**: não é guardada; é uma tabela montada na hora a partir da pesquisa ou da
  seleção, com as colunas da planilha (FR-027).
- **Linha da planilha**: a projeção de uma reserva enviada (hotel + número), com a aba em que está, os
  valores das colunas do sistema e a última vez em que foi atualizada; uma por reserva.
- **Retorno do Comercial**: os quatro valores preenchidos pelo Comercial para uma reserva, o momento
  da leitura e o estado: aguardando validação, confirmado, recusado (com motivo e quem recusou),
  substituído ou com problema (o que falta ou não foi entendido).
- **Pendência da planilha**: uma atualização da planilha ainda não aplicada (envio, mudança de
  situação, validação, retirada de linha), com o momento e a última falha; some quando aplicada.
- **Reserva** e **Tratativa da reserva** (specs 001 e 003): ganham a tratativa de envio (sem
  documento), o comprovante por retorno confirmado (sem arquivo), a situação "Validar comprovante" e o
  valor cobrado com a origem "Comercial".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Nenhuma reserva que o Hunit mostra como cobrada no momento da verificação chega à
  planilha (100% retiradas).
- **SC-002**: O operador envia 20 reservas selecionadas e elas aparecem na planilha em até 5 minutos,
  contados a partir do token informado.
- **SC-003**: Zero linhas duplicadas (mesmo hotel + número) na planilha, depois de qualquer número de
  reenvios.
- **SC-004**: Um retorno completo preenchido pelo Comercial aparece no app como "Validar comprovante"
  em até 15 minutos sem ação de ninguém, ou em até 1 minuto depois de "Ler retornos agora".
- **SC-005**: O operador confirma ou recusa um retorno em até 1 minuto, sem digitar os dados do
  retorno, e confirma 20 retornos já conferidos, em lote, em até 2 minutos.
- **SC-006**: Zero reservas passam a "Comprovante enviado" sem a confirmação de um operador, quando o
  caminho é o retorno do Comercial.
- **SC-007**: Zero ocorrências do nome do hóspede na planilha.
- **SC-008**: Zero requisições ao Hunit que não sejam de leitura, causadas pelos envios.
- **SC-009**: Zero ocorrências das credenciais da planilha no app, nas respostas da API, nos logs, nas
  mensagens de erro e no repositório.
- **SC-010**: Com a planilha indisponível por até 24 horas, 100% das atualizações pendentes estão
  aplicadas até 15 minutos depois de ela voltar, sem ação de ninguém.
- **SC-011**: Depois de cada atualização, 100% das colunas do sistema na planilha batem com os dados
  do sistema.
- **SC-012**: Com uma chave de perfil consulta, zero envios, confirmações, recusas ou leituras são
  aceitos.
- **SC-013**: O operador leva as reservas de uma pesquisa (até 200) para o corpo de um e-mail em até
  30 segundos, com 100% delas na tabela colada e zero nomes de hóspede.
- **SC-014**: O operador confirma o alerta "Verificar" de 2 000 reservas selecionadas em até 2
  minutos, incluindo a confirmação, com 100% delas registradas no histórico.
- **SC-015**: Selecionar todas as reservas de um filtro com até 2 000 resultados leva até 5
  segundos, com 100% delas na seleção, independentemente de quantas páginas a lista tenha.

## Assumptions

- O "Enviada" e o "Cobrada" da descrição são as situações "Tratativa enviada" e "Comprovante enviado"
  da spec 003, renomeadas na homologação. O retorno confirmado vale como comprovante (por isso a
  situação é "Comprovante enviado", mesmo sem arquivo).
- "A reserva volta para pendente", depois da recusa, quer dizer "Tratativa enviada": ela continua com
  o Comercial, na aba "A cobrar", para ser corrigida.
- Na ordem de prioridade da situação da reserva (spec 003, FR-002), "Validar comprovante" fica assim:
  comprovante → situação do Hunit que não exige mais cobrança (com o alerta "Verificar") → "Validar
  comprovante" → "Tratativa enviada" → situação do Hunit.
- O valor a cobrar é o total da reserva no Hunit; se o Hunit não o trouxer (ex.: reserva importada
  sem total, spec 004), a célula fica vazia e o Comercial consulta o Hunit.
- O hotel da cobrança é o estabelecimento que aparece na maquininha, que muitas vezes não é o hotel
  da reserva; é por ele que o Financeiro acha o pagamento na adquirente. Por isso é texto livre,
  copiado como o Comercial escreveu.
- O responsável pela cobrança é um funcionário do Comercial, não o hóspede; o nome dele pode ir para a
  planilha e para o sistema, como o "responsável pela cobrança" do Hunit (spec 001, FR-016).
- A planilha é criada uma vez, na implantação, por quem administra o servidor, e preparada pelo
  comando de FR-008a; o compartilhamento com o Comercial é feito no próprio Google, fora do sistema. O sistema não abre a planilha para o
  operador.
- O intervalo de 10 minutos da leitura automática e os 90 dias das concluídas são valores iniciais,
  que a homologação pode ajustar.
- A verificação de cada reserva é uma leitura por reserva no Hunit (hotel + número), diferente da
  consulta por hotel e período da spec 001; como lê só uma reserva, não a marca como "não encontrada
  na última verificação" (spec 001, FR-018a) quando não a acha.
- O volume é pequeno: dezenas de reservas por envio e alguns envios por dia; a seleção vai até 2 000
  reservas (spec 003, FR-006a).
- A planilha é lida como entrada do retorno, nunca como fonte da verdade: o retorno só muda a
  reserva depois da validação do Financeiro (constitution, princípio VI).
- Os envios, retornos e validações ficam no banco do servidor e entram nas cópias de segurança
  diárias cifradas (spec 001, FR-030); depois de uma restauração, a planilha é refeita a partir do
  sistema.
- A API cresce só com acréscimos, sem quebrar o app desktop atual nem os clientes das features
  anteriores.
