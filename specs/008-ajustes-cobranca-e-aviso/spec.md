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

Esta feature leva essas telas e esses comportamentos para o app, com o visual e a responsividade da
006. Ficam **fora do escopo**: mudar permissões, tema escuro, cobrar ou alterar qualquer coisa no Hunit
(o app continua só lendo o Hunit), **qualquer bloqueio da confirmação do retorno por causa da data da
cobrança** (uma reserva cobrada hoje pode ser confirmada normalmente; a data só é mostrada) e qualquer
mudança nas telas da 006 que a 008 não copiou.

## Clarifications

### Session 2026-11-19

- Q: A marcação "Cobrada no Hunit" feita pelo Comercial já existe (feature 005) ou a 008 precisa criá-la? → A: A 005 já entrega a marcação, o retorno e a área Comercial; a 008 só acrescenta sobre eles (inclusive o campo "Situação da cobrança" e a entrada na fila, que já constavam como acréscimos desta feature) e é implementada depois da 005.
- Q: "Marcar como cancelada sem cobrança" vale só para reservas canceladas no Hunit ou para qualquer reserva que exige ação? → A: Para qualquer reserva que exige ação, cancelada ou não no Hunit; a decisão é da pessoa, que confirma vendo o efeito.
- Q: A fila "Cobrada no Hunit" é conferida sozinha ou só pelo "Verificar agora"? → A: Só manual: a conferência acontece apenas quando o operador aciona "Verificar agora"; o app não confere sozinho.

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

1. **Given** a planilha do Comercial, **When** o Comercial preenche um retorno, **Then** há o campo "Situação da cobrança", com as situações previstas (entre elas "Cobrada no Hunit"), e ele não precisa escrever a situação nos campos do retorno.
2. **Given** um retorno do Comercial (tela 7.5), **When** a gaveta abre, **Then** o bloco "Retorno do Comercial" mostra a "Situação da cobrança" e a "Data da cobrança".
3. **Given** a aba "Retornos a validar" (tela 7.8), **When** a lista é exibida, **Then** cada linha mostra a situação e a data da cobrança.
4. **Given** reservas marcadas em lote (tela 7.12), **When** a pessoa pede "Confirmar", **Then** o diálogo mostra os retornos que serão confirmados, com a situação e a data da cobrança de cada um.
5. **Given** um retorno com cobrança de hoje, **When** a pessoa confirma, **Then** a confirmação é aceita normalmente: a data da cobrança é só informativa e **não bloqueia** a confirmação, em nenhuma tela.
6. **Given** um retorno sem situação ou sem data de cobrança, **When** exibido, **Then** mostra "não informada" no campo vazio, sem impedir a confirmação.

---

### User Story 3 - Acompanhar a fila "Cobrada no Hunit" (Priority: P2)

Quando o Comercial informa a situação "Cobrada no Hunit", a reserva entra sozinha numa fila e o app
confere no Hunit se a cobrança aparece. O operador acompanha essas reservas, com a situação de cada uma,
e pode pedir a conferência na hora.

**Why this priority**: dá visibilidade ao que o app está conferindo; é independente das demais
histórias (depende só da situação "Cobrada no Hunit" da história 2).

**Independent Test**: com reservas marcadas pelo Comercial como "Cobrada no Hunit" em cada uma das três
situações, abrir a fila, conferir situações e contagem e usar "Verificar agora".

**Acceptance Scenarios**:

1. **Given** um retorno com a situação "Cobrada no Hunit" na planilha, **When** o app lê os retornos, **Then** a reserva entra automaticamente na fila, como "Aguardando verificação".
2. **Given** a área Comercial (telas 7.7 e 7.8), **When** aberta, **Then** tem a aba "Cobradas no Hunit", com contagem, ao lado das já existentes.
3. **Given** a aba "Cobradas no Hunit" (tela 7.15), **When** aberta, **Then** lista as reservas que o Comercial marcou como "Cobrada no Hunit", cada uma com uma situação: "Aguardando verificação", "Confirmada no Hunit" ou "Não encontrada no Hunit".
4. **Given** a fila, **When** a pessoa aciona "Verificar agora", **Then** o app confere no Hunit as reservas aguardando verificação, mostra que está conferindo e atualiza as situações ao terminar.
5. **Given** uma reserva "Confirmada no Hunit", **When** exibida, **Then** a linha informa que ela foi para "Concluídas".
6. **Given** uma reserva "Não encontrada no Hunit", **When** exibida, **Then** a linha deixa claro que a cobrança não foi encontrada e que a reserva continua pendente.
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
5. **Given** uma reserva que já tinha sido enviada ao Comercial, **When** marcada (tela 7.18), **Then** o card "Comercial" mostra o selo "Fora da planilha" e a reserva não é mais enviada ao Comercial. [NEEDS CLARIFICATION: o que acontece com a linha da reserva na planilha]
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

### Edge Cases

- **Verificação no Hunit indisponível**: "Verificar agora" mostra que não foi possível conferir, mantém as situações como estavam e não as troca por "Não encontrada".
- **Pedido de token durante a verificação**: a verificação segue o mesmo aviso de token das execuções, sem aviso duplicado.
- **Som sem dispositivo de áudio**: a falha ao tocar não impede o aviso visual nem a notificação.
- **Volume zero**: equivale a som sem volume; a chave continua ligada e o controle habilitado.
- **Situação escrita em texto livre não reconhecida** (se o formato do campo for texto livre): [NEEDS CLARIFICATION: mostrar o texto como veio, mandar para "Retornos com problema" ou outro tratamento].
- **Comercial troca a situação de "Cobrada no Hunit" para outra**: a reserva sai da fila na próxima leitura dos retornos.
- **Cancelada sem cobrança numa reserva com comprovante ou retorno em andamento**: a ação é recusada com explicação (FR-022), para não deixar registros contraditórios.
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

- **FR-007**: A planilha do Comercial MUST ter o campo "Situação da cobrança", com uma lista de situações que inclui "Cobrada no Hunit", para o Comercial registrar o que encontrou sem usar os campos do retorno. [NEEDS CLARIFICATION: lista completa de situações]
- **FR-008**: O formato do campo na planilha MUST seguir esta ordem de preferência: (1) campo digitável com opções sugeridas, em que o Comercial escolhe uma opção ou escreve; (2) se não for possível, lista suspensa com as opções; (3) se também não for possível, texto livre, que o app MUST interpretar na leitura do retorno (por exemplo, reconhecer "hunit" como "Cobrada no Hunit").
- **FR-009**: O bloco "Retorno do Comercial", na gaveta de uma reserva com retorno, MUST mostrar a "Situação da cobrança" e a "Data da cobrança".
- **FR-010**: A lista "Retornos a validar" da área Comercial MUST mostrar a situação e a data da cobrança em cada linha, e o diálogo da confirmação em lote MUST mostrar a situação e a data da cobrança de cada retorno incluído.
- **FR-011**: A data da cobrança é informativa: o retorno do Comercial MUST poder ser confirmado em qualquer data de cobrança, inclusive a de hoje, por todos os caminhos (gaveta, linha, lote); o app e o servidor MUST NOT bloquear a confirmação por causa dela. Sem situação ou sem data, o app MUST mostrar "não informada" no campo vazio.

**Fila "Cobrada no Hunit" (história 3)**

- **FR-012**: Um retorno com a situação "Cobrada no Hunit" MUST colocar a reserva automaticamente na fila, como "Aguardando verificação", na leitura dos retornos; se o Comercial trocar a situação, a reserva MUST sair da fila na próxima leitura.
- **FR-013**: A área Comercial MUST ter a aba "Cobradas no Hunit", com contagem, além das abas já existentes, listando as reservas da fila, cada uma com uma situação entre "Aguardando verificação", "Confirmada no Hunit" e "Não encontrada no Hunit".
- **FR-014**: A fila MUST ter o botão "Verificar agora", **a única forma de conferir (o app não confere sozinho)**, que confere no Hunit as reservas aguardando verificação, mostra o andamento e atualiza as situações; só o perfil operador MUST vê-lo.
- **FR-015**: A conferência MUST ser somente de leitura no Hunit (a regra da constitution continua valendo) e MUST NOT alterar a classificação calculada nem registrar cobrança por conta própria; ela só atualiza a situação da fila.
- **FR-016**: Quando a conferência não puder ser feita (Hunit indisponível, token pendente), as situações MUST ficar como estavam, com uma mensagem clara.
- **FR-017**: Uma reserva "Confirmada no Hunit" MUST ir para "Concluídas", e a linha MUST informar isso; uma reserva "Não encontrada no Hunit" MUST continuar pendente, e a linha MUST dizer que a cobrança não foi encontrada.

**Cancelada sem cobrança (história 4)**

- **FR-018**: O detalhe de uma reserva que aceita a ação MUST mostrar um card com o botão "Marcar como cancelada sem cobrança", visível só ao perfil operador.
- **FR-019**: O diálogo de confirmação MUST mostrar o valor atual e R$ 0,00, informar que a reserva vai para "Concluídas", ter observação opcional, "Voltar" em texto e o confirmar em vermelho cheio; fechar ou voltar MUST NOT gravar nada.
- **FR-020**: Confirmada a ação, a reserva MUST passar a valor R$ 0,00 e a "Concluídas", sair de "Falta cobrar", mostrar o selo "Cancelada sem cobrança", quem marcou, quando e a observação, e aparecer cancelada na lista; as contagens dos filtros rápidos MUST refletir a mudança. Se a reserva já tinha sido enviada ao Comercial, o card "Comercial" MUST mostrar o selo "Fora da planilha" e a reserva MUST NOT ser enviada de novo. [NEEDS CLARIFICATION: o que acontece com a linha da reserva na planilha]
- **FR-021**: A reserva marcada MUST ter o botão "Desfazer" (vermelho suave), com um diálogo de confirmação no padrão de diálogo pequeno da 006 (não desenhado na 008), que restaura valor, situação e contagens ao que eram antes; marcar e desfazer MUST ficar registrados no histórico da reserva, com quem fez e quando.
- **FR-022**: A ação MUST ser recusada, com explicação, em reservas que não a aceitam: já concluídas, com comprovante aguardando validação ou com retorno do Comercial aguardando validação. Reserva enviada ao Comercial e ainda sem retorno aceita a ação (como na tela 7.17). [NEEDS CLARIFICATION: confirmar esta regra]
- **FR-023**: A marcação MUST ser uma camada de registro da pessoa, como as tratativas: nunca altera nada no Hunit, e uma nova verificação da reserva não a apaga; se o Hunit passar a mostrar a reserva como cobrada, isso MUST ficar visível.

**Componentes e consistência (história 5)**

- **FR-024**: O Switch MUST ter as variantes "Ligado" e "Desligado", e o "Controle de volume" as versões "Ativo" e "Desabilitado"; as telas MUST usar esses componentes únicos, e o espelho do app no Figma MUST ser atualizado.
- **FR-025**: As telas novas e alteradas (1.1 a 1.3, 7.5, 7.7, 7.8, 7.12, 7.15, 7.17 e 7.18) MUST seguir o visual, a hierarquia de botões e a responsividade da 006, e MUST ser coerentes com as páginas do design oficial.
- **FR-026**: Perfis MUST ser respeitados: o operador executa as ações; o perfil consulta só vê (situação, selo e histórico).

### Key Entities *(include if feature involves data)*

- **Preferência do aviso de token**: som ligado ou desligado e volume, por instalação do app.
- **Situação da cobrança**: campo novo do retorno do Comercial na planilha, com uma das situações previstas (entre elas "Cobrada no Hunit"), lido pelo app junto com a data da cobrança.
- **Item da fila "Cobrada no Hunit"**: reserva cujo retorno tem a situação "Cobrada no Hunit", com situação da verificação (aguardando verificação, confirmada, não encontrada) e momento da última conferência.
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
- **SC-008**: Cada tela afetada confere com a página 008 do design oficial, e o espelho no Figma mostra as mesmas telas ao fim da feature.

## Assumptions

- A página 008 do Figma é a fonte visual das telas afetadas; onde ela diverge da 006, vale a 008. A regra de bloqueio da confirmação por data foi descartada: o retorno do Comercial pode ser confirmado mesmo que a cobrança seja de hoje (sem âmbar nem botão desabilitado por data), e a 008 não tem tela de confirmação bloqueada.
- O campo "Situação da cobrança" é novo nesta feature e fica na planilha do Comercial; o formato dele (FR-008) é configuração da planilha, não de tela. A "Data da cobrança" também vem do retorno do Comercial; o app só lê e exibe as duas.
- Nas telas da 008, "Cobrada na maquininha" é só um exemplo de situação, até a lista real ser definida.
- A feature 005 (envio ao Comercial) entrega as áreas e abas do Comercial, o retorno e a marcação "Cobrada no Hunit" feita pelo Comercial, e a 008 MUST ser implementada depois dela (dependência); o campo "Situação da cobrança" e a entrada automática na fila "Cobrada no Hunit" são acréscimos desta feature.
- A conferência "Cobrada no Hunit" usa as mesmas leituras já permitidas ao servidor; nenhuma rota de cobrança ou alteração é liberada (constitution, princípio II).
- A situação "Não encontrada no Hunit" mantém a reserva como pendente; não há retentativa automática: só o "Verificar agora" confere de novo.
- O volume inicial é o som atual do app (fixo hoje); a escala do controle vai de mudo a máximo.
- Mexer no som afeta só a máquina em que o app roda; não é preferência compartilhada entre usuários.
- A marcação "Cancelada sem cobrança" é aceita para reservas que exigem ação (pendente de cobrança, erro na cobrança, cobrar na maquininha, erro de análise), as mesmas das tratativas, **estando ou não cancelada no Hunit** (a pessoa decide, com a confirmação); reservas concluídas ou com comprovante ou retorno aguardando validação não a aceitam.
- Os dados (valor, histórico, comprovantes) seguem as regras de guarda e retenção já existentes; esta feature não cria arquivos novos.
- A mudança toca o contrato da API, o servidor (fila, marcação) e a leitura da planilha (campo novo), diferentemente da 006; isso é detalhado no plano.

## Open Questions

1. Lista completa de situações do campo "Situação da cobrança" (FR-007).
2. Qual dos três formatos do campo será possível na planilha (FR-008) e, se for texto livre, o que fazer com um texto não reconhecido.
3. O que acontece com a linha da reserva na planilha quando ela é marcada como cancelada sem cobrança depois de enviada ao Comercial (FR-020).
4. Confirmar que uma reserva enviada ao Comercial e ainda sem retorno aceita "Cancelada sem cobrança" (FR-022).
