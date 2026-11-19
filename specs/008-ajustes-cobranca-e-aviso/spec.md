# Feature Specification: Ajustes de cobrança e do aviso de token

**Feature Branch**: `008-ajustes-cobranca-e-aviso`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "Nova página 008-ajustes-cobranca-e-aviso no design oficial (Figma), com cópias das telas da 006 que mudam e a numeração da 006 mantida. (1) Som do aviso: volume, mudo e som único (telas 1.1, 1.2, 1.3): a chave 'Tocar som do aviso', o controle de volume e a nota de que só o app toca som; sai a chave de som duplicada do card Preferências. (2) Situação e data da cobrança (telas 7.5, 7.7, 7.8, 7.12): a planilha do Comercial ganha o campo 'Situação da cobrança', para o Comercial registrar o que encontrou sem usar os campos do retorno; o retorno do Comercial mostra 'Situação da cobrança' e 'Data da cobrança', na gaveta, na lista e na confirmação em lote; a data é só informativa e não bloqueia a confirmação (inclusive cobrança de hoje). (3) Fila das reservas 'Cobrada no Hunit' (tela nova 7.15): quando o Comercial informa 'Cobrada no Hunit', a reserva entra sozinha na aba 'Cobradas no Hunit', cada uma com situação (Aguardando verificação, Confirmada no Hunit, Não encontrada no Hunit) e o botão 'Verificar agora'. (4) Cancelada sem cobrança (telas novas 7.17 e 7.18): card com o botão 'Marcar como cancelada sem cobrança', diálogo de confirmação (valor de R$ 655,00 para R$ 0,00, reserva vai para Concluídas, observação opcional), selo, quem marcou e quando, 'Desfazer', histórico e contagens atualizadas. Biblioteca de componentes: Switch ganha a variante 'Desligado'; novo componente 'Controle de volume' (ativo e desabilitado)."

## Contexto

A feature 006 levou o design oficial para o app desktop, incluindo as telas do envio ao Comercial e da
área Comercial (história 8 da 006, implementada junto da feature 005). Com o uso, o design oficial
recebeu ajustes, reunidos numa página nova do Figma, a **008-ajustes-cobranca-e-aviso**. Essa página
tem cópias das telas da 006 que mudam, já com os ajustes aplicados, e **mantém a numeração da 006**
(1.1, 7.15…) para facilitar achar a original. A 006 não foi alterada: esta feature é um acréscimo e,
onde houver diferença, **a 008 prevalece sobre a 006**.

Os ajustes:

1. **Som do aviso único e controlável.** Hoje tocam dois sons ao mesmo tempo quando o pedido de token
   aparece (o do app e o da notificação do Windows), e o som é configurado em dois lugares.
2. **Situação e data da cobrança.** O Comercial às vezes encontra um problema na reserva fora do Hunit
   (por exemplo, reserva normal no Hunit mas cancelada na Expedia). Hoje a planilha não tem onde
   registrar isso, e o Comercial acaba escrevendo "cancelada" nos campos do retorno. A planilha ganha o
   campo "Situação da cobrança", e o retorno do Comercial passa a mostrar a situação e a data da
   cobrança no app, para a pessoa conferir antes de confirmar.
3. **Fila das reservas "Cobrada no Hunit".** Quando o Comercial informa a situação "Cobrada no Hunit",
   a reserva entra numa fila em que o app confere no Hunit se a cobrança aparece, e o operador
   acompanha o resultado.
4. **Cancelada sem cobrança.** Uma ação nova, com confirmação e desfazer, para reservas canceladas que
   não serão cobradas.
5. **Ajustes do app vistos no uso** (pedidos pelo desenvolvimento em 2026-11-19, fora da página 008 do
   Figma): o ícone do app na barra de tarefas do Windows aparece como o do Electron, e não com a marca
   do HUNIT Control; os filtros de seleção da lista não aceitam buscar a opção digitando; e o destaque
   da linha selecionada ou sob o mouse sai quadrado para fora dos cantos arredondados da lista.
6. **Busca pelo código de autorização do Comercial** (item 1 do doc de ajustes da PM, incluído em
   2026-11-19): a busca da lista de reservas não acha a reserva pelo código de autorização que o
   Comercial informou no retorno, só pelo código que vem do Hunit.

Esta feature leva essas telas e esses comportamentos para o app, com o visual e a responsividade da
006. Ficam **fora do escopo**: mudar permissões, tema escuro, cobrar ou alterar qualquer coisa no Hunit
(o app continua só lendo o Hunit), **qualquer bloqueio da confirmação do retorno por causa da data da
cobrança** (uma reserva cobrada hoje pode ser confirmada normalmente; a data só é mostrada) e qualquer
mudança nas telas da 006 que a 008 não copiou, **exceto** as que as histórias 6 e 7 pedem (seletores,
destaque da linha, busca) e as partes sem desenho de que as histórias 2 a 4 precisam (o relato "Não
cobrada" em "Retornos com problema", o diálogo "Desfazer" e a linha da lista de uma reserva marcada).

## Clarifications

### Session 2026-11-19

- Q: A marcação "Cobrada no Hunit" feita pelo Comercial já existe (feature 005) ou a 008 precisa criá-la? → A: A 005 já entrega o retorno e a área Comercial; a 008 só acrescenta sobre eles e é implementada depois da 005. **Corrigido no plano (abaixo)**: a 005 não tem a marcação "Cobrada no Hunit" nem a data da cobrança; as duas chegam nesta feature, como colunas novas da planilha.
- Q: "Marcar como cancelada sem cobrança" vale só para reservas canceladas no Hunit ou para qualquer reserva que exige ação? → A: Para qualquer reserva que exige ação, cancelada ou não no Hunit; a decisão é da pessoa, que confirma vendo o efeito.
- Q: A fila "Cobrada no Hunit" é conferida sozinha ou só pelo "Verificar agora"? → A: O app nunca confere sozinho, em segundo plano. **Ajustado no plano (abaixo)**: a conferência é o "Verificar agora" e também a leitura da reserva por uma execução que o operador já roda.

### Session 2026-11-19 (plano)

Decididas com o usuário ao planejar, a partir do código entregue pela 005 e da página 008 do Figma.

- Q: A 005 já tem a marcação "Cobrada no Hunit" e a data da cobrança? → A: Não. O retorno da 005 tem só quatro campos (código de autorização, hotel da cobrança, valor cobrado e responsável). "Situação da cobrança" e "Data da cobrança" são colunas novas da planilha, preenchidas pelo Comercial, e "Cobrada no Hunit" é uma das situações.
- Q: Quais são as situações da cobrança e o que cada uma faz? → A: Três situações sugeridas, e o Comercial também pode escrever outra: **"Cobrada na maquininha"** (o retorno completo de hoje: vai para "Retornos a validar"), **"Cobrada no Hunit"** (basta o responsável: vai para a fila "Cobradas no Hunit") e **"Não cobrada"** (o Comercial encontrou um problema, por exemplo reserva cancelada no canal: vai para "Retornos com problema", com o que ele escreveu, para o Financeiro decidir, por exemplo marcando como cancelada sem cobrança). Situação vazia ou não reconhecida aparece como veio e segue as regras de hoje (retorno completo vai para "Retornos a validar"; incompleto, para "Retornos com problema").
- Q: O que acontece com a linha da reserva na planilha quando ela é marcada como cancelada sem cobrança depois de enviada ao Comercial? → A: Vai para a aba "Concluídas", com a situação "Cancelada sem cobrança", para o Comercial saber que não precisa mais cobrar; sai da planilha depois de 90 dias, como as outras concluídas. No app, o card "Comercial" mostra a linha em "Concluídas" (o selo "Fora da planilha" da tela 7.18 fica só para linhas que já saíram da planilha; diferença levada à UX).
- Q: Uma reserva enviada ao Comercial e ainda sem retorno aceita "Cancelada sem cobrança"? → A: Sim, como na tela 7.17.
- Q: Quando a fila "Cobradas no Hunit" é conferida? → A: Pelo "Verificar agora" e por qualquer leitura da reserva no Hunit feita depois da marcação do Comercial (as execuções que o operador já roda também contam). O app nunca confere sozinho, em segundo plano. Os textos da tela 7.15 ("confere na próxima execução") ficam como estão.
- Q: O que entra além da página 008? → A: Dois ajustes vistos no uso do app (história 6): o ícone na barra de tarefas do Windows e a busca pelo teclado em todos os seletores de filtro.
- Q: O bug da busca pelo código de autorização do Comercial (item 1 do doc de ajustes da PM) entra na 008? → A: Sim (história 7, autorizado pela PM). Entra na busca o código do retorno do Comercial **confirmado pelo Financeiro** (o código passa a ser o real da cobrança); retorno ainda aguardando validação, recusado, substituído ou com a confirmação desfeita não entra.
- Q: Quando a reserva do relato "Cobrada no Hunit" conta como confirmada, e o que acontece quando não conta (inclusive se ela aparecer depois como cancelada sem cobrança)? → A: Quem decide é o Hunit. Só é "Confirmada no Hunit" quando a leitura da reserva no Hunit (execução ou "Verificar agora") mostra a cobrança. Se a leitura não mostra a cobrança — reserva ainda pendente, cancelada sem cobrança, faturada ou outra situação sem cobrança —, a reserva não foi cobrada: fica "Não encontrada no Hunit" e a planilha do Comercial mostra, na validação do Financeiro, "Recusado pelo Financeiro: cobrança não encontrada no Hunit". A marcação "Cancelada sem cobrança" feita pelo Financeiro não muda essa conferência (vale o que o Hunit mostra).
- Q: O que mais entra nesta branch? → A: O bug visual da lista: a linha selecionada (lima) e a linha sob o mouse ficam quadradas e saem dos cantos arredondados do card quando encostam na borda (por exemplo, com uma reserva só). Entra na história 6.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Controlar o som do aviso de token em um só lugar (Priority: P1)

Quando uma execução pede o token, o app avisa a pessoa (notificação, janela à frente e som). A pessoa
quer ouvir **um único** som, no volume que escolher, ou desligá-lo, sem procurar a configuração em dois
cards.

**Why this priority**: é um incômodo diário (dois sons ao mesmo tempo) e o ajuste é pequeno e
independente das demais histórias.

**Independent Test**: abrir Configurações, ajustar o volume e o som do aviso, disparar um pedido de
token de teste e conferir que toca um único som no volume escolhido, ou nenhum se estiver desligado.

**Acceptance Scenarios**:

1. **Given** o card "Aviso do pedido de token" (tela 1.1), **When** exibido, **Then** tem a chave "Tocar som do aviso", o controle de volume e uma nota dizendo que só o app toca som e que a notificação do Windows vem sem som.
2. **Given** a chave "Tocar som do aviso" desligada (tela 1.2), **When** exibida, **Then** o controle de volume aparece desabilitado e nenhum som toca num pedido de token.
3. **Given** a chave ligada e um volume escolhido, **When** o pedido de token aparece, **Then** toca um único som, no volume escolhido, e a notificação do Windows não toca som próprio.
4. **Given** o card "Preferências" (tela 1.3), **When** exibido, **Then** não tem mais chave de som, só a configuração do card "Aviso do pedido de token".
5. **Given** o usuário já tinha o som desligado antes desta mudança, **When** o app é atualizado, **Then** o som continua desligado.
6. **Given** a pessoa mexe no volume, **When** solta o controle, **Then** o app toca uma amostra do som no volume escolhido (se o som estiver ligado).

---

### User Story 2 - Registrar e ver a situação e a data da cobrança (Priority: P1)

O Comercial registra na planilha o que encontrou na cobrança, num campo próprio, sem usar os campos do
retorno. Quando o retorno volta, a pessoa do Financeiro precisa ver a **situação** e a **data** da
cobrança para conferir o que o Comercial informou, tanto na gaveta da reserva quanto na lista e na
confirmação em lote.

**Why this priority**: sem a situação e a data, a pessoa confirma sem saber quando e como a cobrança
foi feita, e o Comercial continua sem lugar para registrar problemas encontrados fora do Hunit.

**Independent Test**: preencher a "Situação da cobrança" e a data na planilha, ler os retornos e
conferir a situação e a data na gaveta, na lista "Retornos a validar" e no diálogo da confirmação em
lote.

**Acceptance Scenarios**:

1. **Given** a planilha do Comercial, **When** o Comercial preenche um retorno, **Then** há os campos "Situação da cobrança" (com as situações sugeridas "Cobrada na maquininha", "Cobrada no Hunit" e "Não cobrada", aceitando também outro texto) e "Data da cobrança", e ele não precisa escrever a situação nos campos do retorno.
1a. **Given** o Comercial escolhe "Não cobrada", **When** o app lê os retornos, **Then** a reserva aparece em "Retornos com problema" com a situação e o responsável, sem exigir código, hotel e valor, e continua pendente até o Financeiro decidir.
2. **Given** um retorno do Comercial (tela 7.5), **When** a gaveta abre, **Then** o bloco "Retorno do Comercial" mostra a "Situação da cobrança" e a "Data da cobrança".
3. **Given** a aba "Retornos a validar" (tela 7.8), **When** a lista é exibida, **Then** cada linha mostra a situação e a data da cobrança.
4. **Given** reservas marcadas em lote (tela 7.12), **When** a pessoa pede "Confirmar", **Then** o diálogo mostra os retornos que serão confirmados, com a situação e a data da cobrança de cada um.
5. **Given** um retorno com cobrança de hoje, **When** a pessoa confirma, **Then** a confirmação é aceita normalmente: a data da cobrança é só informativa e **não bloqueia** a confirmação, em nenhuma tela.
6. **Given** um retorno sem situação ou sem data de cobrança, **When** exibido, **Then** mostra "não informada" no campo vazio, sem impedir a confirmação.

---

### User Story 3 - Acompanhar a fila "Cobradas no Hunit" (Priority: P2)

Quando o Comercial informa a situação "Cobrada no Hunit", a reserva entra sozinha numa fila e o app
confere no Hunit se a cobrança aparece. O operador acompanha essas reservas, com a situação de cada uma,
e pode pedir a conferência na hora.

**Why this priority**: dá visibilidade ao que o app está conferindo; é independente das demais
histórias (depende só da situação "Cobrada no Hunit" da história 2).

**Independent Test**: com reservas marcadas pelo Comercial como "Cobrada no Hunit" em cada uma das três
situações, abrir a fila, conferir situações e contagem e usar "Verificar agora".

**Acceptance Scenarios**:

1. **Given** um retorno com a situação "Cobrada no Hunit" e o responsável na planilha, **When** o app lê os retornos, **Then** a reserva entra automaticamente na fila, como "Aguardando verificação".
2. **Given** a área Comercial (telas 7.7 e 7.8), **When** aberta, **Then** tem a aba "Cobradas no Hunit", com contagem, ao lado das já existentes.
3. **Given** a aba "Cobradas no Hunit" (tela 7.15), **When** aberta, **Then** lista as reservas que o Comercial marcou como "Cobrada no Hunit", cada uma com uma situação: "Aguardando verificação", "Confirmada no Hunit" ou "Não encontrada no Hunit".
4. **Given** a fila, **When** a pessoa aciona "Verificar agora", **Then** o app confere no Hunit as reservas aguardando verificação e as não encontradas que ainda exigem cobrança, com o mesmo pedido de token das execuções, mostra que está conferindo e atualiza as situações ao terminar.
4a. **Given** uma reserva da fila, **When** uma execução lê essa reserva no Hunit depois da marcação do Comercial, **Then** a situação na fila também é atualizada por essa leitura.
5. **Given** a leitura no Hunit mostra a cobrança, **When** a fila é exibida, **Then** a reserva está "Confirmada no Hunit" e a linha informa que ela foi para "Concluídas".
6. **Given** a leitura no Hunit não mostra a cobrança e a reserva ainda exige cobrança, **When** a fila é exibida, **Then** a reserva está "Não encontrada no Hunit", a linha diz que a cobrança não foi encontrada e que a reserva continua pendente, e a planilha mostra "Recusado pelo Financeiro: cobrança não encontrada no Hunit".
6a. **Given** a leitura no Hunit não mostra a cobrança e a reserva não exige mais cobrança (por exemplo, cancelada sem cobrança ou faturada no Hunit), **When** a fila é exibida, **Then** a reserva também está "Não encontrada no Hunit", a linha mostra a situação que o Hunit informou, e a planilha mostra a mesma recusa com o motivo.
7. **Given** o perfil consulta, **When** abre a fila, **Then** vê as situações, mas não tem "Verificar agora".
8. **Given** a fila vazia, **When** exibida, **Then** mostra o estado vazio padrão da 006, com explicação.

---

### User Story 4 - Marcar uma reserva como cancelada sem cobrança (Priority: P2)

Algumas reservas são canceladas e nunca serão cobradas. A pessoa do Financeiro marca a reserva como
**cancelada sem cobrança**: o valor passa a R$ 0,00 e a reserva sai das pendências e vai para
"Concluídas". Como a ação muda o valor e tira a reserva da lista de pendências, o app pede confirmação,
mostra o efeito antes de aplicar e permite desfazer.

**Why this priority**: resolve um caso real que hoje deixa reservas eternamente pendentes; é
independente das demais histórias.

**Independent Test**: abrir uma reserva pendente, marcar como cancelada sem cobrança (com e sem
observação) e conferir detalhe, lista e contagens; desfazer e conferir que tudo volta ao que era.

**Acceptance Scenarios**:

1. **Given** o detalhe de uma reserva que aceita a ação (tela 7.17), **When** aberto, **Then** mostra um card com o botão "Marcar como cancelada sem cobrança".
2. **Given** o botão acionado, **When** o diálogo abre, **Then** mostra o valor indo do atual (ex.: R$ 655,00) para R$ 0,00, informa que a reserva vai para "Concluídas", tem um campo de observação opcional, "Voltar" em texto e o botão de confirmar em vermelho cheio.
3. **Given** o diálogo aberto, **When** a pessoa aciona "Voltar", **Then** nada é gravado.
4. **Given** a confirmação, **When** concluída (tela 7.18), **Then** o detalhe mostra o selo "Cancelada sem cobrança", o valor em R$ 0,00, quem marcou e quando, a observação (se houver), o botão "Desfazer" e o registro no histórico.
5. **Given** uma reserva que já tinha sido enviada ao Comercial, **When** marcada (tela 7.18), **Then** a linha dela vai para a aba "Concluídas" da planilha com a situação "Cancelada sem cobrança", o card "Comercial" mostra a linha em "Concluídas" e a reserva não é mais enviada ao Comercial; ao desfazer, a linha volta para "A cobrar" se a reserva ainda exigir cobrança.
6. **Given** a lista de reservas (tela 7.18), **When** exibida depois da ação, **Then** a linha aparece como cancelada e as contagens de "Falta cobrar" e "Concluídas" refletem a mudança.
7. **Given** uma reserva marcada, **When** a pessoa aciona "Desfazer" e confirma, **Then** o valor, a situação e as contagens voltam ao que eram, e o histórico registra o desfazer.
8. **Given** o perfil consulta, **When** abre o detalhe, **Then** vê o selo e o histórico, mas não vê o botão de marcar nem o "Desfazer".
9. **Given** uma reserva que não aceita a ação (já concluída, por exemplo), **When** o detalhe abre, **Then** o card não aparece.

---

### User Story 5 - Componentes novos na biblioteca (Priority: P3)

A biblioteca "Componentes — nova identidade" ganha a variante "Desligado" do Switch e o componente
"Controle de volume" (ativo e desabilitado), usados pelas histórias acima e disponíveis para telas
futuras, sem repetir marcação ou estilo.

**Why this priority**: sustenta a história 1 e mantém a regra da 006 de que o que se repete é um
componente único.

**Independent Test**: conferir, na biblioteca do app e no Figma, que o Switch tem os estados ligado e
desligado e que o controle de volume existe nos estados ativo e desabilitado, e que as telas usam esses
componentes.

**Acceptance Scenarios**:

1. **Given** a biblioteca de componentes, **When** consultada, **Then** o Switch tem as variantes "Ligado" e "Desligado" e o "Controle de volume" tem as versões "Ativo" e "Desabilitado".
2. **Given** qualquer tela que usa chave ou volume, **When** exibida, **Then** usa esses componentes únicos.
3. **Given** o controle de volume, **When** operado só pelo teclado, **Then** pode ser ajustado e tem foco visível.

---

### User Story 6 - Ícone na barra de tarefas, busca pelo teclado nos filtros e destaque da linha (Priority: P2)

Três incômodos vistos no uso do app, fora da página 008 do Figma: na barra de tarefas do Windows o app
aparece com o ícone do Electron, e não com a marca do HUNIT Control (inclusive quando pisca pedindo o
token); nos filtros de seleção a pessoa não consegue achar uma opção digitando, só clicando; e o
destaque da linha selecionada ou sob o mouse sai quadrado dos cantos arredondados da lista.

**Why this priority**: o ícone errado confunde quem procura o app na barra de tarefas justamente na
hora do token; a busca pelo teclado agiliza o uso diário dos filtros; o destaque fora da lista deixa
a tela com aparência de erro. Os três são pequenos e independentes das demais histórias.

**Independent Test**: instalar o app numa máquina que já teve versões anteriores, abrir, disparar
"Testar aviso" e conferir a marca na barra de tarefas (aberta, piscando e fixada); abrir os filtros
da lista e escolher opções de cada seletor só pelo teclado; selecionar uma reserva só e passar o
mouse sobre ela: o destaque fica dentro da lista.

**Acceptance Scenarios**:

1. **Given** o app instalado aberto, **When** a pessoa olha a barra de tarefas, **Then** vê a marca do HUNIT Control, e não o ícone do Electron.
2. **Given** um pedido de token, **When** o botão do app pisca na barra de tarefas, **Then** pisca com a marca do HUNIT Control.
3. **Given** o app fixado na barra de tarefas, **When** fechado e aberto de novo pelo atalho fixado, **Then** o ícone continua a marca e a janela aberta se agrupa no mesmo botão.
4. **Given** uma máquina em que o app já rodou em desenvolvimento ou nos testes, **When** o app instalado abre, **Then** a barra de tarefas mostra a marca (o desenvolvimento não interfere no app instalado).
5. **Given** um seletor de filtro (por exemplo "Situação da reserva"), **When** a pessoa digita parte do nome de uma opção, **Then** a lista mostra só as opções que combinam, e ela escolhe com as setas e Enter, sem o mouse.
6. **Given** um texto que não combina com nenhuma opção, **When** digitado, **Then** a lista diz que nada foi encontrado, e o filtro não muda.
7. **Given** uma lista com uma reserva só (ou a última linha da lista), **When** a pessoa a seleciona ou passa o mouse sobre ela, **Then** o destaque (lima da seleção ou cinza do mouse) acompanha os cantos arredondados da lista, sem sair dela.

---

### User Story 7 - Achar a reserva pelo código de autorização do Comercial (Priority: P2)

Quando o Comercial cobra na maquininha, o código de autorização da cobrança vem no retorno da
planilha, e não do Hunit. Depois que o Financeiro confirma o retorno, esse é o código real da
cobrança, e a pessoa precisa achar a reserva buscando por ele, como já acha pelo código do Hunit.

**Why this priority**: é um bug que faz a pessoa achar que a reserva não existe, justamente nas
cobranças feitas pelo Comercial; a correção é pequena e independente das demais histórias.

**Independent Test**: confirmar um retorno do Comercial com um código de autorização, buscar esse
código na lista de reservas e conferir que a reserva aparece; buscar o código de um retorno ainda
aguardando validação e conferir que não aparece.

**Acceptance Scenarios**:

1. **Given** uma reserva com retorno do Comercial confirmado pelo Financeiro, **When** a pessoa busca o código de autorização desse retorno (com maiúsculas ou minúsculas diferentes), **Then** a reserva aparece na lista.
2. **Given** a busca pelo código, **When** combinada com filtros, filtros rápidos e "selecionar todas do filtro", **Then** a lista, as contagens e a seleção dizem o mesmo, como em qualquer busca.
3. **Given** um retorno aguardando validação, recusado ou substituído, **When** a pessoa busca o código dele, **Then** a reserva não aparece por esse código.
4. **Given** um retorno confirmado cuja confirmação foi desfeita, **When** a pessoa busca o código, **Then** a reserva deixa de aparecer por esse código.
5. **Given** a busca pelo código do Hunit, pelo número da reserva, pela transação, pelo hóspede ou pelo valor, **When** feita, **Then** continua funcionando como hoje.

---

### Edge Cases

- **Verificação no Hunit indisponível**: "Verificar agora" mostra que não foi possível conferir, mantém as situações como estavam e não as troca por "Não encontrada".
- **Pedido de token durante a verificação**: a verificação segue o mesmo aviso de token das execuções, sem aviso duplicado.
- **Som sem dispositivo de áudio**: a falha ao tocar não impede o aviso visual nem a notificação.
- **Volume zero**: equivale a som sem volume; a chave continua ligada e o controle habilitado.
- **Situação escrita em texto livre não reconhecida**: aparece no app como o Comercial escreveu; o retorno segue as regras de hoje (completo vai para "Retornos a validar", incompleto para "Retornos com problema").
- **Data da cobrança que não é uma data**: o retorno vai para "Retornos com problema" ("data da cobrança não entendida"), como qualquer valor não entendido; uma data válida, qualquer que seja, nunca impede a confirmação.
- **Hunit mostra cobrada uma reserva marcada como cancelada sem cobrança**: a marcação continua, e o detalhe avisa que o Hunit mostra a reserva como cobrada (FR-023).
- **Comercial troca a situação de "Cobrada no Hunit" para outra**: a reserva sai da fila na próxima leitura dos retornos.
- **Cancelada sem cobrança numa reserva com comprovante ou retorno aguardando validação**: a ação é recusada com explicação (FR-022), para não deixar registros contraditórios.
- **Duas pessoas ao mesmo tempo**: se outra pessoa já marcou ou alterou a reserva, o diálogo informa que a situação mudou e não aplica a ação em cima de dados velhos.
- **Largura de janela pequena**: as telas novas e alteradas seguem a responsividade da 006: mesma informação e mesmas ações em qualquer largura suportada.

## Requirements *(mandatory)*

### Functional Requirements

**Som do aviso (história 1)**

- **FR-001**: O card "Aviso do pedido de token" MUST ter a chave "Tocar som do aviso", o controle de volume e uma nota dizendo que só o app toca som e que a notificação do Windows vem sem som.
- **FR-002**: Com a chave desligada, o controle de volume MUST ficar desabilitado e nenhum som MUST tocar no pedido de token.
- **FR-003**: O pedido de token MUST tocar um único som, no volume escolhido; a notificação do Windows MUST ser emitida sem som próprio.
- **FR-004**: O card "Preferências" MUST deixar de ter a chave de som; o som do aviso é configurado só no card "Aviso do pedido de token".
- **FR-005**: A escolha de som ligado/desligado e de volume MUST ser lembrada entre as aberturas do app; quem já tinha o som desligado MUST continuar com ele desligado, e o volume inicial MUST ser o que o app usa hoje.
- **FR-006**: Ao ajustar o volume com o som ligado, o app MUST tocar uma amostra no volume escolhido.

**Situação e data da cobrança (história 2)**

- **FR-007**: A planilha do Comercial MUST ter os campos "Situação da cobrança" e "Data da cobrança", preenchidos pelo Comercial. As situações sugeridas são "Cobrada na maquininha", "Cobrada no Hunit" e "Não cobrada"; o Comercial registra nelas o que encontrou, sem usar os campos do retorno.
- **FR-007a**: O que cada situação faz: "Cobrada na maquininha" exige o retorno completo de hoje (código, hotel da cobrança, valor e responsável) e vai para "Retornos a validar"; "Cobrada no Hunit" exige só o responsável e vai para a fila "Cobradas no Hunit" (FR-012); "Não cobrada" exige só o responsável e vai para "Retornos com problema", com a situação, sem mudar a reserva; ela fica lá só enquanto a linha está em "A cobrar" e a reserva não está marcada como cancelada sem cobrança (concluída por outro motivo, sai da lista e fica no histórico). Situação vazia ou não reconhecida MUST ser mostrada como veio e seguir as regras de hoje do retorno.
- **FR-008**: O formato do campo na planilha MUST seguir esta ordem de preferência: (1) campo digitável com opções sugeridas, em que o Comercial escolhe uma opção ou escreve; (2) se não for possível, lista suspensa com as opções; (3) se também não for possível, texto livre, que o app MUST interpretar na leitura do retorno (por exemplo, reconhecer "hunit" como "Cobrada no Hunit").
- **FR-009**: O bloco "Retorno do Comercial", na gaveta de uma reserva com retorno, MUST mostrar a "Situação da cobrança" e a "Data da cobrança".
- **FR-010**: A lista "Retornos a validar" da área Comercial MUST mostrar a situação e a data da cobrança em cada linha, e o diálogo da confirmação em lote MUST mostrar a situação e a data da cobrança de cada retorno incluído.
- **FR-011**: A data da cobrança é informativa: o retorno do Comercial MUST poder ser confirmado em qualquer data de cobrança, inclusive a de hoje, por todos os caminhos (gaveta, linha, lote); o app e o servidor MUST NOT bloquear a confirmação por causa dela. Sem situação ou sem data, o app MUST mostrar "não informada" no campo vazio.

**Fila "Cobrada no Hunit" (história 3)**

- **FR-012**: Um retorno com a situação "Cobrada no Hunit" MUST colocar a reserva automaticamente na fila "Cobradas no Hunit", como "Aguardando verificação", na leitura dos retornos; se o Comercial trocar a situação, a reserva MUST sair da fila na próxima leitura.
- **FR-013**: A área Comercial MUST ter a aba "Cobradas no Hunit", com contagem, além das abas já existentes, listando as reservas da fila, cada uma com uma situação entre "Aguardando verificação", "Confirmada no Hunit" e "Não encontrada no Hunit". As confirmadas continuam na lista por 7 dias depois da leitura que confirmou (depois disso, só em "Concluídas"); as não encontradas que não exigem mais cobrança (por exemplo, canceladas ou faturadas no Hunit) também saem 7 dias depois da leitura, mostrando a situação do Hunit; as não encontradas que ainda exigem cobrança ficam até mudarem. A contagem é o número de reservas listadas.
- **FR-014**: A fila MUST ter o botão "Verificar agora", que confere no Hunit as reservas aguardando verificação e as não encontradas que ainda exigem cobrança, com o mesmo pedido de token das execuções, mostra o andamento e atualiza as situações; só o perfil operador MUST vê-lo. Uma leitura da reserva no Hunit feita por uma execução depois da marcação do Comercial MUST também valer como conferência; o app MUST NOT conferir sozinho, em segundo plano.
- **FR-015**: A conferência MUST ser somente de leitura no Hunit (a regra da constitution continua valendo). Ela lê a reserva como uma execução lê (os dados e a classificação passam a ser os do Hunit naquele momento), e MUST NOT registrar cobrança por conta própria: não cria comprovante nem valor cobrado; a situação da fila só mostra o que o Hunit informou.
- **FR-016**: Quando a conferência não puder ser feita (Hunit indisponível, token pendente), as situações MUST ficar como estavam, com uma mensagem clara.
- **FR-017**: A reserva MUST ser "Confirmada no Hunit" só quando a leitura no Hunit mostra a cobrança; aí ela vai para "Concluídas", e a linha MUST informar isso. Se a leitura não mostra a cobrança, por qualquer motivo (ainda pendente, cancelada sem cobrança, faturada…), a reserva MUST ficar "Não encontrada no Hunit": a linha MUST dizer que a cobrança não foi encontrada e mostrar a situação da reserva ("continua pendente", se ainda exigir cobrança), e a planilha do Comercial MUST mostrar, na validação do Financeiro, "Recusado pelo Financeiro: cobrança não encontrada no Hunit". A conferência considera o que o Hunit mostra, não a marcação "Cancelada sem cobrança" do Financeiro.

**Cancelada sem cobrança (história 4)**

- **FR-018**: O detalhe de uma reserva que aceita a ação MUST mostrar um card com o botão "Marcar como cancelada sem cobrança", visível só ao perfil operador.
- **FR-019**: O diálogo de confirmação MUST mostrar o valor atual e R$ 0,00, informar que a reserva vai para "Concluídas", ter observação opcional, "Voltar" em texto e o confirmar em vermelho cheio; fechar ou voltar MUST NOT gravar nada.
- **FR-020**: Confirmada a ação, a reserva MUST passar a valor R$ 0,00 e a "Concluídas", sair de "Falta cobrar", mostrar o selo "Cancelada sem cobrança", quem marcou, quando e a observação, e aparecer cancelada na lista; as contagens dos filtros rápidos MUST refletir a mudança. Se a reserva já tinha sido enviada ao Comercial, a linha dela MUST ir para a aba "Concluídas" da planilha, com a situação "Cancelada sem cobrança" e o valor a cobrar R$ 0,00, o card "Comercial" MUST mostrar a linha em "Concluídas", e a reserva MUST NOT ser enviada de novo enquanto estiver marcada. Um relato "Não cobrada" da reserva MUST sair de "Retornos com problema" quando ela é marcada (continua no histórico) e voltar se a marcação for desfeita.
- **FR-021**: A reserva marcada MUST ter o botão "Desfazer" (vermelho suave), com um diálogo de confirmação no padrão de diálogo pequeno da 006 (não desenhado na 008), que restaura valor, situação e contagens ao que eram antes; marcar e desfazer MUST ficar registrados no histórico da reserva, com quem fez e quando.
- **FR-022**: A ação MUST ser recusada, com explicação, em reservas que não a aceitam: já concluídas, com comprovante (documento ou retorno do Comercial confirmado) ou com retorno do Comercial aguardando validação. Reserva enviada ao Comercial e ainda sem retorno aceita a ação (como na tela 7.17); a com retorno "Não cobrada" também aceita (é o caso que motivou a ação).
- **FR-023**: A marcação MUST ser uma camada de registro da pessoa, como as tratativas: nunca altera nada no Hunit, e uma nova verificação da reserva não a apaga; se o Hunit passar a mostrar a reserva como cobrada, isso MUST ficar visível.

**Componentes e consistência (história 5)**

- **FR-024**: O Switch MUST ter as variantes "Ligado" e "Desligado", e o "Controle de volume" as versões "Ativo" e "Desabilitado"; as telas MUST usar esses componentes únicos; ao fim da feature, as telas em uso MUST ser marcadas no Figma (skill `figma-screens-sync`).
- **FR-025**: As telas novas e alteradas (1.1 a 1.3, 7.5, 7.7, 7.8, 7.12, 7.15, 7.17 e 7.18) MUST seguir o visual, a hierarquia de botões e a responsividade da 006, e MUST ser coerentes com as páginas do design oficial.
- **FR-026**: Perfis MUST ser respeitados: o operador executa as ações; o perfil consulta só vê (situação, selo e histórico).

**Ajustes do app (história 6)**

- **FR-027**: O app instalado MUST mostrar a marca do HUNIT Control na barra de tarefas do Windows: com a janela aberta, piscando no aviso do token e fixado na barra, inclusive em máquinas que já tiveram versões anteriores instaladas ou que rodaram o app em desenvolvimento e nos testes.
- **FR-028**: Todo seletor de opções dos filtros (lista suspensa de uma ou de várias opções) MUST aceitar buscar a opção digitando, além de escolher com o mouse; com o teclado, a pessoa digita, anda pelas opções com as setas, escolhe com Enter e fecha com Esc. Sem opção para o texto digitado, a lista MUST dizer que nada foi encontrado.
- **FR-030**: O destaque de uma linha de lista (seleção, linha aberta na gaveta ou mouse sobre ela) MUST ficar dentro do card da lista, acompanhando os cantos arredondados, em qualquer posição da linha e em todas as listas em card do app.

**Busca pelo código do Comercial (história 7)**

- **FR-029**: A busca da lista de reservas MUST achar a reserva pelo código de autorização de um retorno do Comercial confirmado pelo Financeiro, com a mesma regra de comparação do código do Hunit (texto inteiro, sem diferenciar maiúsculas e minúsculas), em todos os lugares em que a busca vale (lista, contagens dos filtros rápidos e "selecionar todas do filtro"). Códigos de retornos não confirmados (aguardando validação, recusados, substituídos ou com a confirmação desfeita) MUST NOT entrar na busca.

### Key Entities *(include if feature involves data)*

- **Preferência do aviso de token**: som ligado ou desligado e volume, por instalação do app.
- **Situação da cobrança**: campo novo do retorno do Comercial na planilha, com uma das situações sugeridas ("Cobrada na maquininha", "Cobrada no Hunit", "Não cobrada") ou outro texto, lido pelo app junto com a data da cobrança.
- **Data da cobrança**: campo novo do retorno do Comercial na planilha (uma data), só informativo.
- **Relato do Comercial**: o que o Comercial informa na planilha sem um retorno a validar — as situações "Cobrada no Hunit" e "Não cobrada", com o responsável e a data, se houver.
- **Item da fila "Cobradas no Hunit"**: reserva cujo relato tem a situação "Cobrada no Hunit", com o responsável, o momento em que o app leu a marcação, a situação da verificação (aguardando verificação, confirmada, não encontrada) e o momento da última conferência.
- **Marcação "Cancelada sem cobrança"**: registro por reserva (hotel + número), com valor anterior, observação, quem marcou, quando e, se desfeita, quem desfez e quando.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em 100% dos pedidos de token, toca no máximo um som; com o som desligado, nenhum.
- **SC-002**: A pessoa liga, desliga e ajusta o som do aviso em menos de 30 segundos, sem sair do card "Aviso do pedido de token".
- **SC-003**: Em 100% dos retornos do Comercial, a pessoa vê a situação e a data da cobrança antes de confirmar, e nenhum retorno deixa de poder ser confirmado por causa da data (inclusive cobrança de hoje).
- **SC-004**: O Comercial deixa de usar os campos do retorno para registrar a situação: 100% das situações ficam no campo "Situação da cobrança".
- **SC-005**: A pessoa vê a situação de todas as reservas "Cobrada no Hunit" numa única tela, e a conferência de até 50 reservas termina com resultado visível para cada uma.
- **SC-006**: Marcar uma reserva como cancelada sem cobrança leva menos de 1 minuto, e desfazer devolve a reserva exatamente ao estado anterior em 100% dos casos testados.
- **SC-007**: Nenhuma marcação ou desfazer acontece sem confirmação explícita, e o efeito (valor e destino) é mostrado antes de aplicar.
- **SC-008**: Cada tela afetada confere com a página 008 do design oficial, e ao fim da feature as telas da página 008 estão marcadas no Figma como as em uso.
- **SC-009**: Em 100% das máquinas atualizadas, inclusive as que já tinham versões anteriores, a barra de tarefas mostra a marca do HUNIT Control (aberto, piscando e fixado).
- **SC-010**: Em todos os seletores de filtro, a pessoa escolhe qualquer opção só pelo teclado, digitando parte do nome, em menos de 5 segundos.
- **SC-011**: Em 100% dos retornos confirmados testados, buscar o código de autorização do Comercial traz a reserva na primeira página da lista; nenhum código de retorno não confirmado traz a reserva.

## Assumptions

- A página 008 do Figma é a fonte visual das telas afetadas; onde ela diverge da 006, vale a 008. A regra de bloqueio da confirmação por data foi descartada: o retorno do Comercial pode ser confirmado mesmo que a cobrança seja de hoje (sem âmbar nem botão desabilitado por data), e a 008 não tem tela de confirmação bloqueada.
- Os campos "Situação da cobrança" e "Data da cobrança" são novos nesta feature e ficam na planilha do Comercial; o formato deles (FR-008) é configuração da planilha, não de tela. O app só lê e exibe os dois. A planilha em uso ganha as colunas quando o comando de preparação da planilha é rodado de novo, na atualização.
- "Cobrada na maquininha", "Cobrada no Hunit" e "Não cobrada" são as situações sugeridas (sessão "plano"); mudar a lista depois é mudar uma configuração, sem tela nova.
- A feature 005 (envio ao Comercial) entrega as áreas e abas do Comercial e o retorno de quatro campos, e a 008 MUST ser implementada depois dela (dependência); os campos "Situação da cobrança" e "Data da cobrança", a marcação "Cobrada no Hunit" e a fila são acréscimos desta feature.
- A 008 é priorizada antes da 007 (relatórios); se a 007 também mudar o contrato da API, ela parte da versão que a 008 entregar.
- A conferência "Cobrada no Hunit" usa as mesmas leituras já permitidas ao servidor; nenhuma rota de cobrança ou alteração é liberada (constitution, princípio II).
- A situação "Não encontrada no Hunit" mantém a reserva como pendente; não há retentativa automática: só o "Verificar agora" confere de novo.
- O volume inicial é o som atual do app (fixo hoje); a escala do controle vai de mudo a máximo.
- Mexer no som afeta só a máquina em que o app roda; não é preferência compartilhada entre usuários.
- A marcação "Cancelada sem cobrança" é aceita para reservas que exigem ação (pendente de cobrança, erro na cobrança, cobrar na maquininha, erro de análise), as mesmas das tratativas, **estando ou não cancelada no Hunit** (a pessoa decide, com a confirmação); reservas concluídas ou com comprovante ou retorno aguardando validação não a aceitam.
- Os dados (valor, histórico, comprovantes) seguem as regras de guarda e retenção já existentes; esta feature não cria arquivos novos.
- A mudança toca o contrato da API, o servidor (fila, marcação) e a leitura da planilha (campo novo), diferentemente da 006; isso é detalhado no plano.

## Open Questions

Todas respondidas em 2026-11-19 (clarificações, sessão "plano"):

1. Lista de situações do campo "Situação da cobrança" (FR-007): "Cobrada na maquininha", "Cobrada no Hunit" e "Não cobrada", aceitando outro texto (FR-007a).
2. Formato do campo (FR-008): a primeira opção é possível (campo com as opções sugeridas que também aceita outro texto; plano, research); texto não reconhecido aparece como veio e segue as regras de hoje.
3. Linha da reserva na planilha ao marcar cancelada sem cobrança (FR-020): vai para "Concluídas".
4. Reserva enviada ao Comercial e ainda sem retorno aceita "Cancelada sem cobrança" (FR-022): sim.
