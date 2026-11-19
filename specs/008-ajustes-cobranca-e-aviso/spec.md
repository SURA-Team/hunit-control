# Feature Specification: Ajustes de cobrança e do aviso de token

**Feature Branch**: `008-ajustes-cobranca-e-aviso`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "Nova página 008-ajustes-cobranca-e-aviso no design oficial (Figma), com cópias das telas da 006 que mudam e a numeração da 006 mantida. (1) Som do aviso: volume, mudo e som único (telas 1.1, 1.2, 1.3): a chave 'Tocar som do aviso', o controle de volume e a nota de que só o app toca som; sai a chave de som duplicada do card Preferências. (2) Situação e data da cobrança (telas 7.5, 7.7, 7.8, 7.12): o retorno do Comercial mostra 'Situação da cobrança' e 'Data da cobrança'; nova aba 'Cobradas no Hunit'; o retorno só pode ser confirmado quando a cobrança é de ontem ou mais antiga; a confirmação em lote deixa de fora as cobranças de hoje e explica. (3) Fila e bloqueio (telas novas 7.15 e 7.16): fila das reservas que o Comercial marcou como 'Cobrada no Hunit', com situação (Aguardando verificação, Confirmada no Hunit, Não encontrada no Hunit) e 'Verificar agora'; detalhe com a data de hoje em destaque, alerta âmbar e 'Confirmar' desabilitado. (4) Cancelada sem cobrança (telas novas 7.17 e 7.18): card com o botão 'Marcar como cancelada sem cobrança', diálogo de confirmação (valor de R$ 655,00 para R$ 0,00, reserva vai para Concluídas, observação opcional), selo, quem marcou e quando, 'Desfazer', histórico e contagens atualizadas. Biblioteca de componentes: Switch ganha a variante 'Desligado'; novo componente 'Controle de volume' (ativo e desabilitado)."

## Contexto

A feature 006 levou o design oficial para o app desktop, incluindo as telas do envio ao Comercial e da
área Comercial (história 8 da 006, implementada junto da feature 005). Com o uso, o design oficial
recebeu quatro ajustes, reunidos numa página nova do Figma, a **008-ajustes-cobranca-e-aviso**. Essa
página tem cópias das telas da 006 que mudam, já com os ajustes aplicados, e **mantém a numeração da
006** (1.1, 7.5…) para facilitar achar a original. A 006 não foi alterada: esta feature é um
acréscimo e, onde houver diferença, **a 008 prevalece sobre a 006**.

Os quatro ajustes:

1. **Som do aviso único e controlável.** Hoje tocam dois sons ao mesmo tempo quando o pedido de token
   aparece (o do app e o da notificação do Windows), e o som é configurado em dois lugares.
2. **Situação e data da cobrança no retorno do Comercial.** O retorno do Comercial só pode ser
   confirmado quando a cobrança foi feita ontem ou antes; é preciso mostrar a data e o motivo do
   bloqueio.
3. **Fila das reservas "Cobrada no Hunit" e tela de bloqueio.** O operador precisa acompanhar o que o
   app está conferindo no Hunit e entender por que não consegue confirmar uma reserva.
4. **Cancelada sem cobrança.** Uma ação nova, com confirmação e desfazer, para reservas canceladas que
   não serão cobradas.

Esta feature leva essas telas e esses comportamentos para o app. As telas novas (7.15 a 7.18) e os
ajustes das telas 7.x seguem o visual e a responsividade da 006. Ficam **fora do escopo**: mudar
permissões, tema escuro, cobrar ou alterar qualquer coisa no Hunit (o app continua só lendo o Hunit), e
qualquer mudança nas telas da 006 que a 008 não copiou.

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

### User Story 2 - Ver a situação e a data da cobrança antes de confirmar o retorno (Priority: P1)

Quando o Comercial devolve uma reserva com cobrança feita, a pessoa do Financeiro valida o retorno. Ela
precisa ver a **situação** e a **data** da cobrança e só conseguir confirmar quando a cobrança é de
ontem ou mais antiga; se for de hoje, o app mostra a data em âmbar e explica o bloqueio.

**Why this priority**: evita confirmar uma cobrança que o Hunit ainda pode não ter registrado, que é o
erro que esta regra quer impedir.

**Independent Test**: com um retorno cobrado ontem e outro cobrado hoje, abrir os dois: o primeiro
confirma, o segundo mostra a data em âmbar e o "Confirmar" desabilitado com o motivo; a confirmação em
lote com os dois leva só o primeiro e informa o que ficou de fora.

**Acceptance Scenarios**:

1. **Given** um retorno do Comercial (tela 7.5), **When** a gaveta abre, **Then** o card "Comercial" mostra a "Situação da cobrança" e a "Data da cobrança"; com cobrança de ontem ou mais antiga, o "Confirmar" está habilitado.
2. **Given** a área Comercial (telas 7.7 e 7.8), **When** aberta, **Then** tem a aba nova "Cobradas no Hunit", ao lado das já existentes.
3. **Given** a lista de retornos (tela 7.8), **When** exibida, **Then** cada linha mostra a data da cobrança; quando a cobrança é de hoje, a data aparece em âmbar e o "Confirmar" da linha fica desabilitado.
4. **Given** reservas marcadas em lote com um retorno cobrado hoje (tela 7.12), **When** a pessoa pede "Confirmar", **Then** o diálogo mostra só os retornos confirmáveis e explica quantos ficaram de fora e por quê (cobrança de hoje).
5. **Given** que nenhum retorno marcado é confirmável, **When** a pessoa pede a confirmação em lote, **Then** o diálogo explica que nenhum pode ser confirmado hoje e não oferece a confirmação.
6. **Given** um retorno cobrado hoje, **When** vira o dia, **Then** ele passa a poder ser confirmado, sem nenhuma ação da pessoa além de reabrir ou atualizar a tela.

---

### User Story 3 - Acompanhar a fila "Cobrada no Hunit" e entender o bloqueio (Priority: P2)

Quando o Comercial marca uma reserva como "Cobrada no Hunit", o app confere no Hunit se a cobrança
aparece. O operador acompanha essas reservas numa fila, com a situação de cada uma, pode pedir a
conferência na hora e, ao abrir uma reserva que ainda não pode ser confirmada, entende o motivo.

**Why this priority**: dá visibilidade ao que o app está conferindo e explica o bloqueio da história 2;
depende dela.

**Independent Test**: com reservas marcadas pelo Comercial como "Cobrada no Hunit" em cada uma das três
situações, abrir a fila e conferir situações e contagem; usar "Verificar agora"; abrir a reserva
cobrada hoje e conferir o alerta e o "Confirmar" desabilitado.

**Acceptance Scenarios**:

1. **Given** a aba "Cobradas no Hunit" (tela 7.15), **When** aberta, **Then** lista as reservas que o Comercial marcou como "Cobrada no Hunit", cada uma com uma situação: "Aguardando verificação", "Confirmada no Hunit" ou "Não encontrada no Hunit".
2. **Given** a fila, **When** a pessoa aciona "Verificar agora", **Then** o app confere no Hunit as reservas aguardando verificação, mostra que está conferindo e atualiza as situações ao terminar.
3. **Given** uma reserva "Não encontrada no Hunit", **When** exibida, **Then** a linha deixa claro que a cobrança não foi encontrada e que a reserva continua pendente.
4. **Given** o detalhe de uma reserva cobrada hoje (tela 7.16), **When** aberto, **Then** a data da cobrança aparece destacada, um alerta âmbar diz a partir de que dia dá para confirmar (o dia seguinte à cobrança) e o "Confirmar" está desabilitado.
5. **Given** o perfil consulta, **When** abre a fila, **Then** vê as situações, mas não tem "Verificar agora".
6. **Given** a fila vazia, **When** exibida, **Then** mostra o estado vazio padrão da 006, com explicação.

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
5. **Given** a lista de reservas (tela 7.18), **When** exibida depois da ação, **Then** a linha aparece como cancelada e as contagens de "Falta cobrar" e "Concluídas" refletem a mudança.
6. **Given** uma reserva marcada, **When** a pessoa aciona "Desfazer" e confirma, **Then** o valor, a situação e as contagens voltam ao que eram, e o histórico registra o desfazer.
7. **Given** o perfil consulta, **When** abre o detalhe, **Then** vê o selo e o histórico, mas não vê o botão de marcar nem o "Desfazer".
8. **Given** uma reserva que não aceita a ação (já concluída, por exemplo), **When** o detalhe abre, **Then** o card não aparece.

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

- **Virada do dia**: uma cobrança de "hoje" vira "ontem" à meia-noite (no fuso de Brasília); o app deve usar o dia local, não um prazo de 24 horas.
- **Reserva sem data de cobrança**: se o retorno não traz a data, o app não deve liberar o "Confirmar" e deve dizer que a data não foi informada.
- **Data de cobrança no futuro**: tratada como "de hoje ou depois": bloqueada, com o mesmo alerta.
- **Verificação no Hunit indisponível**: "Verificar agora" mostra que não foi possível conferir, mantém as situações como estavam e não as troca por "Não encontrada".
- **Pedido de token durante a verificação**: a verificação segue o mesmo aviso de token das execuções, sem aviso duplicado.
- **Som sem dispositivo de áudio**: a falha ao tocar não impede o aviso visual nem a notificação.
- **Volume zero**: equivale a som sem volume; a chave continua ligada e o controle habilitado.
- **Cancelada sem cobrança numa reserva com comprovante ou retorno em andamento**: [ver FR-024] a ação é recusada com explicação, para não deixar registros contraditórios.
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

- **FR-007**: O card "Comercial" na gaveta de uma reserva com retorno MUST mostrar a "Situação da cobrança" e a "Data da cobrança".
- **FR-008**: O retorno do Comercial só MUST poder ser confirmado quando a data da cobrança é **anterior ao dia de hoje** (ontem ou antes), no dia civil local; cobrança de hoje, futura ou sem data MUST manter o "Confirmar" desabilitado, com o motivo visível.
- **FR-009**: A área Comercial MUST ter a aba "Cobradas no Hunit", além das abas já existentes.
- **FR-010**: Na lista de retornos, cada linha MUST mostrar a data da cobrança; cobrança de hoje MUST aparecer em âmbar e com o "Confirmar" da linha desabilitado.
- **FR-011**: A confirmação em lote MUST considerar só os retornos confirmáveis, informar no diálogo quantos ficaram de fora e por quê, e MUST NOT oferecer a confirmação quando nenhum é confirmável.
- **FR-012**: A regra do FR-008 MUST valer em todos os caminhos de confirmação (gaveta, linha da lista, lote) e também no servidor, para que nenhum cliente da API consiga confirmar uma cobrança de hoje.

**Fila "Cobrada no Hunit" e bloqueio (história 3)**

- **FR-013**: A aba "Cobradas no Hunit" MUST listar as reservas que o Comercial marcou como "Cobrada no Hunit", cada uma com uma situação entre "Aguardando verificação", "Confirmada no Hunit" e "Não encontrada no Hunit".
- **FR-014**: A fila MUST ter o botão "Verificar agora", que confere no Hunit as reservas aguardando verificação, mostra o andamento e atualiza as situações; só o perfil operador MUST vê-lo.
- **FR-015**: A conferência MUST ser somente de leitura no Hunit (a regra da constitution continua valendo) e MUST NOT alterar a classificação calculada nem registrar cobrança por conta própria; ela só atualiza a situação da fila.
- **FR-016**: Quando a conferência não puder ser feita (Hunit indisponível, token pendente), as situações MUST ficar como estavam, com uma mensagem clara.
- **FR-017**: O detalhe de uma reserva cobrada hoje MUST destacar a data da cobrança, mostrar um alerta âmbar com o primeiro dia em que dá para confirmar e manter o "Confirmar" desabilitado (tela 7.16).

**Cancelada sem cobrança (história 4)**

- **FR-018**: O detalhe de uma reserva que aceita a ação MUST mostrar um card com o botão "Marcar como cancelada sem cobrança", visível só ao perfil operador.
- **FR-019**: O diálogo de confirmação MUST mostrar o valor atual e R$ 0,00, informar que a reserva vai para "Concluídas", ter observação opcional, "Voltar" em texto e o confirmar em vermelho cheio; fechar ou voltar MUST NOT gravar nada.
- **FR-020**: Confirmada a ação, a reserva MUST passar a valor R$ 0,00 e a "Concluídas", sair de "Falta cobrar", mostrar o selo "Cancelada sem cobrança", quem marcou, quando e a observação, e aparecer cancelada na lista; as contagens dos filtros rápidos MUST refletir a mudança.
- **FR-021**: A reserva marcada MUST ter o botão "Desfazer" (vermelho suave, com confirmação), que restaura valor, situação e contagens ao que eram antes.
- **FR-022**: Marcar e desfazer MUST ficar registrados no histórico da reserva, com quem fez e quando.
- **FR-023**: A marcação MUST ser uma camada de registro da pessoa, como as tratativas: nunca altera nada no Hunit, e uma nova verificação da reserva não a apaga; se o Hunit passar a mostrar a reserva como cobrada, isso MUST ficar visível.
- **FR-024**: A ação MUST ser recusada, com explicação, em reservas que não a aceitam (já concluídas, ou com comprovante ou retorno do Comercial em andamento).

**Componentes e consistência (história 5)**

- **FR-025**: O Switch MUST ter as variantes "Ligado" e "Desligado", e o "Controle de volume" as versões "Ativo" e "Desabilitado"; as telas MUST usar esses componentes únicos, e o espelho do app no Figma MUST ser atualizado.
- **FR-026**: As telas novas e alteradas (1.1 a 1.3, 7.5, 7.7, 7.8, 7.12 e 7.15 a 7.18) MUST seguir o visual, a hierarquia de botões e a responsividade da 006, e MUST ser coerentes com as páginas do design oficial.
- **FR-027**: Perfis MUST ser respeitados: o operador executa as ações; o perfil consulta só vê (situação, datas, selo e histórico).

### Key Entities *(include if feature involves data)*

- **Preferência do aviso de token**: som ligado ou desligado e volume, por instalação do app.
- **Cobrança do retorno do Comercial**: situação da cobrança e data da cobrança, ligadas ao retorno de uma reserva; define se o retorno já pode ser confirmado.
- **Item da fila "Cobrada no Hunit"**: reserva marcada pelo Comercial como cobrada no Hunit, com situação (aguardando verificação, confirmada, não encontrada) e momento da última conferência.
- **Marcação "Cancelada sem cobrança"**: registro por reserva (hotel + número), com valor anterior, observação, quem marcou, quando e, se desfeita, quem desfez e quando.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em 100% dos pedidos de token, toca no máximo um som; com o som desligado, nenhum.
- **SC-002**: A pessoa liga, desliga e ajusta o som do aviso em menos de 30 segundos, sem sair do card "Aviso do pedido de token".
- **SC-003**: Nenhum retorno com cobrança de hoje é confirmado, por nenhum caminho (gaveta, linha, lote ou API).
- **SC-004**: Em teste com 5 pessoas, 100% explicam por que um retorno cobrado hoje não pode ser confirmado, só olhando a tela.
- **SC-005**: A pessoa vê a situação de todas as reservas "Cobrada no Hunit" numa única tela, e a conferência de até 50 reservas termina com resultado visível para cada uma.
- **SC-006**: Marcar uma reserva como cancelada sem cobrança leva menos de 1 minuto, e desfazer devolve a reserva exatamente ao estado anterior em 100% dos casos testados.
- **SC-007**: Nenhuma marcação ou desfazer acontece sem confirmação explícita, e o efeito (valor e destino) é mostrado antes de aplicar.
- **SC-008**: Cada tela afetada confere com a página 008 do design oficial, e o espelho no Figma mostra as mesmas telas ao fim da feature.

## Assumptions

- A página 008 do Figma é a fonte visual das telas afetadas; onde ela diverge da 006, vale a 008.
- A feature 005 (envio ao Comercial) já fornece, ou fornecerá antes desta, as áreas e abas do Comercial e a marcação "Cobrada no Hunit" feita pelo Comercial; esta feature ajusta e acrescenta sobre elas.
- "Hoje" e "ontem" seguem o dia civil no fuso de Brasília; o servidor é quem decide o bloqueio, e o app só o apresenta.
- A conferência "Cobrada no Hunit" usa as mesmas leituras já permitidas ao servidor; nenhuma rota de cobrança ou alteração é liberada (constitution, princípio II).
- A situação "Não encontrada no Hunit" mantém a reserva como pendente; não há retentativa automática além de "Verificar agora" e das execuções normais.
- O volume inicial é o som atual do app (fixo hoje); a escala do controle vai de mudo a máximo.
- Mexer no som afeta só a máquina em que o app roda; não é preferência compartilhada entre usuários.
- A marcação "Cancelada sem cobrança" é aceita para reservas que exigem ação (pendente de cobrança, erro na cobrança, cobrar na maquininha, erro de análise), as mesmas das tratativas; reservas concluídas ou com retorno em andamento não a aceitam.
- Os dados (valor, histórico, comprovantes) seguem as regras de guarda e retenção já existentes; esta feature não cria arquivos novos.
- A mudança toca o contrato da API e o servidor (regra de confirmação, fila, marcação), diferentemente da 006; isso é detalhado no plano.
