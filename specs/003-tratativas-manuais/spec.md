# Feature Specification: Tratativas manuais das reservas

**Feature Branch**: `003-tratativas-manuais`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "Tratativas manuais das reservas de cartão virtual no HUNIT Control. Hoje o servidor (feature 001) consulta e classifica as reservas e o app desktop (feature 002) as mostra, mas o Financeiro não tem como registrar o que fez com uma reserva que o sistema não consegue resolver sozinho; no legado isso existia e a operação depende disso. O operador precisa registrar, por reserva (hotel + número da reserva), dois documentos independentes: a tratativa (por exemplo o e-mail enviado ao hotel cobrando, em arquivo .eml, .msg, PDF ou imagem), que muda a situação exibida para "Enviada" sem tirar a reserva da exposição de pendências, e o comprovante de cobrança, que muda a situação exibida para "Cobrada" em todas as consultas. Só reservas que exigem ação (pendente de cobrança, erro na cobrança, sem cartão virtual/erro de análise) aceitam tratativa. Cada documento pode ser substituído e aberto/baixado depois; o registro guarda quem fez e quando (auditoria), e a tratativa pode ser desfeita. O operador pode informar manualmente o valor cobrado quando o Hunit não traz o valor, e voltar ao valor do Hunit. Deve ser possível aplicar o mesmo documento a várias reservas selecionadas de uma vez, com confirmação, ignorando e informando as que não aceitam. A tratativa é uma camada sobre a classificação: nunca altera nada no Hunit, e uma nova verificação da reserva não apaga a tratativa (mas se o Hunit passar a mostrar a reserva como cobrada, isso deve ficar visível). Na consulta de reservas (API e app), filtrar por situação com tratativa (enviada, cobrada manualmente, sem tratativa) e ver os documentos. Perfil operador registra; perfil consulta só vê e baixa. Os documentos contêm dados pessoais e financeiros: definir guarda, tamanho máximo, tipos aceitos e retenção junto com a retenção que já existe. Fora do escopo: envio de e-mail pelo sistema, inclusão das enviadas na planilha do comercial (spec futura de sincronização com o Sheets), importação do histórico de tratativas do legado (spec futura de importação), relatórios/painéis e exportação de planilhas."

## Contexto

O servidor (feature 001) consulta o Hunit, classifica cada reserva de cartão virtual quanto à
cobrança e grava o resultado; o app desktop (feature 002) permite operar e consultar tudo isso. Mas
uma parte das reservas não se resolve sozinha: ficam pendentes de cobrança, dão erro na cobrança ou
não têm como ser analisadas. Para essas, o Financeiro age fora do sistema — cobra o hotel por
e-mail, recebe um comprovante, cobra por outro meio — e precisa registrar o que fez, para saber o
que ainda falta e provar o que já foi feito. O sistema anterior tinha esse registro (as
"tratativas"); sem ele, a operação volta a depender de controles paralelos.

Esta feature acrescenta as **tratativas manuais**: uma camada de registro feita por pessoas, ligada à
reserva, que nunca altera nada no Hunit nem a classificação calculada pelo servidor. Uma reserva
pode receber dois documentos independentes:

- a **tratativa** (prova de que o Financeiro agiu — por exemplo, o e-mail enviado ao hotel), que faz
  a reserva aparecer como **Enviada**, mas continua contando como pendência;
- o **comprovante de cobrança** (prova de que o valor foi recebido), que faz a reserva aparecer como
  **Cobrada** em todas as consultas.

Ficam **fora do escopo** e serão tratados em specs próprias: envio de e-mail pelo sistema, inclusão
das reservas enviadas na planilha do comercial (sincronização com o Sheets), importação das
tratativas registradas no sistema anterior, relatórios e painéis, e exportação de planilhas.

## Clarifications

### Session 2026-11-13

- Q: O que fazer com documentos substituídos ou desfeitos? → A: Guardar por 30 dias e depois apagar
  (FR-013); enquanto guardados, o operador pode revertê-los, voltando-os a documento atual (FR-013a).
- Q: Quais classificações aceitam tratativa? → A: Pendente de cobrança, erro na cobrança, cartão
  validado (não cobrado) e erro de análise aceitam tratativa e comprovante; "cobrar na maquininha"
  aceita o comprovante, mesmo depois que existir a planilha do comercial (FR-003).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar o comprovante de cobrança de uma reserva (Priority: P1)

O operador encontra, na consulta de reservas, uma reserva pendente de cobrança (ou com erro na
cobrança) que já foi cobrada por fora do Hunit. Ele anexa o comprovante e, se o Hunit não traz o
valor cobrado, informa o valor. A partir daí a reserva aparece como **Cobrada** para todos, com o
comprovante disponível para abrir ou baixar, e com o registro de quem anexou e quando.

**Why this priority**: é o registro que tira a reserva da lista do que falta cobrar. Sem ele, o
Financeiro não consegue distinguir o que está de fato pendente do que já foi resolvido, que é o
motivo de o sistema existir.

**Independent Test**: com reservas pendentes gravadas, anexar um comprovante a uma delas e conferir
que ela passa a aparecer como "Cobrada" na consulta (pela API e pelo app), que o arquivo pode ser
baixado idêntico ao enviado e que o registro mostra o cliente e o momento.

**Acceptance Scenarios**:

1. **Given** uma reserva "pendente de cobrança", **When** o operador anexa um comprovante válido,
   **Then** a reserva passa a ser exibida como "Cobrada" (cobrada manualmente) em todas as consultas,
   e o comprovante fica disponível para abrir e baixar.
2. **Given** uma reserva com comprovante, **When** qualquer cliente autorizado consulta a reserva,
   **Then** vê o nome do arquivo, o tamanho, quem o anexou e quando.
3. **Given** uma reserva com comprovante e sem valor cobrado vindo do Hunit, **When** o operador
   informa o valor cobrado, **Then** esse valor passa a ser exibido como valor cobrado, identificado
   como informado manualmente; **When** ele volta ao valor do Hunit, **Then** o valor manual é
   removido.
4. **Given** uma reserva "cobrar na maquininha" cobrada na maquininha, **When** o operador anexa o
   comprovante, **Then** ela passa a "Cobrada"; **When** ele tenta anexar uma tratativa, **Then** o
   sistema recusa e explica por quê (FR-003).
5. **Given** uma reserva "já cobrada", "faturada" ou outra que não exige ação do Financeiro (FR-003),
   **When** o operador tenta anexar um comprovante, **Then** o sistema recusa e explica por quê.
6. **Given** um arquivo de tipo não aceito ou maior que o limite (FR-008), **When** o operador tenta
   anexá-lo, **Then** o sistema recusa com uma mensagem que diz o motivo e os limites, e nada é
   gravado.
7. **Given** uma reserva com comprovante, **When** o operador anexa outro comprovante, **Then** o
   novo substitui o anterior como comprovante atual e a substituição fica no histórico da reserva.
8. **Given** um comprovante substituído há menos de 30 dias, **When** o operador escolhe reverter,
   **Then** o comprovante anterior volta a ser o atual, o que foi revertido passa a ser o substituído
   e o histórico registra a reversão; **Given** um substituído há mais de 30 dias, **Then** a opção de
   reverter não aparece e o arquivo não está mais disponível.

---

### User Story 2 - Registrar a tratativa (reserva "Enviada") (Priority: P2)

O operador cobrou o hotel por e-mail (ou outro meio) e ainda não recebeu o pagamento. Ele anexa o
documento da tratativa à reserva, que passa a aparecer como **Enviada**: todos sabem que alguém já
agiu, mas a reserva continua contando como pendente até chegar o comprovante.

**Why this priority**: evita cobrar o mesmo hotel duas vezes e mostra o que está em andamento; mas a
reserva ainda está pendente, então vem depois do comprovante.

**Independent Test**: anexar uma tratativa a uma reserva pendente e conferir que ela aparece como
"Enviada", que continua sendo contada entre as pendências nos filtros e que, ao anexar depois o
comprovante, passa a "Cobrada" mantendo os dois documentos.

**Acceptance Scenarios**:

1. **Given** uma reserva que exige ação, **When** o operador anexa a tratativa, **Then** a reserva é
   exibida como "Enviada" e continua sendo encontrada quando se filtra pela classificação original
   (ex.: "pendente de cobrança").
2. **Given** uma reserva "Enviada", **When** o operador anexa o comprovante, **Then** ela passa a
   "Cobrada" e os dois documentos continuam disponíveis, cada um com seu autor e momento.
3. **Given** uma reserva só com comprovante, **When** o operador anexa a tratativa depois, **Then**
   ela continua "Cobrada" e a tratativa fica disponível ao lado do comprovante.
4. **Given** uma tratativa ou um comprovante registrado por engano, **When** o operador desfaz esse
   documento, **Then** a situação exibida volta a refletir só o que restou (ex.: desfazer o
   comprovante de uma reserva que tem tratativa a deixa "Enviada"), e o histórico registra quem
   desfez e quando. Por 30 dias, o documento desfeito pode ser revertido (FR-013a).

---

### User Story 3 - Aplicar o mesmo documento a várias reservas (Priority: P3)

Um mesmo e-mail ou comprovante costuma cobrir várias reservas do mesmo hotel. O operador seleciona
as reservas na consulta, escolhe "Anexar tratativa" ou "Anexar comprovante", confirma e o documento
é registrado em todas as que aceitam; as demais são listadas com o motivo de terem ficado de fora.

**Why this priority**: economiza tempo quando há muitas reservas, mas o registro de uma em uma
(US1/US2) já resolve a operação.

**Independent Test**: selecionar 10 reservas, sendo 2 delas "já cobradas", aplicar um comprovante e
conferir que 8 ficaram "Cobradas", que as 2 foram informadas com o motivo e que o arquivo baixado de
cada uma é o mesmo.

**Acceptance Scenarios**:

1. **Given** várias reservas selecionadas, **When** o operador escolhe aplicar um documento, **Then**
   o sistema mostra quantas reservas aceitam, quantas serão ignoradas e o total dos valores, e pede
   confirmação antes de gravar.
2. **Given** a confirmação, **When** o documento é aplicado, **Then** todas as reservas que aceitam
   ficam com o documento e o resultado lista as ignoradas com o motivo de cada uma.
3. **Given** uma falha no meio da aplicação em lote, **When** o operador vê o resultado, **Then** sabe
   exatamente quais reservas ficaram com o documento e quais não, e pode repetir só as que faltaram.

---

### User Story 4 - Consultar e filtrar pelas tratativas (Priority: P2)

Quem consulta as reservas (operador ou perfil consulta) filtra pela situação da tratativa — sem
tratativa, enviada, cobrada manualmente — combinando com os filtros que já existem, vê os documentos
de cada reserva e os baixa. O perfil consulta não pode registrar, substituir nem desfazer nada.

**Why this priority**: sem o filtro, o operador não consegue montar a lista do que ainda falta tratar,
que é o uso diário da feature.

**Independent Test**: com reservas em cada situação de tratativa, filtrar por cada uma (e combinadas
com hotel e período) e conferir os resultados; com uma chave de perfil consulta, conferir que os
documentos podem ser baixados e que nenhuma ação de registro está disponível nem é aceita pela API.

**Acceptance Scenarios**:

1. **Given** reservas pendentes com e sem tratativa, **When** o operador filtra "pendente de cobrança"
   + "sem tratativa", **Then** vê só as pendentes em que ninguém agiu ainda.
2. **Given** reservas cobradas manualmente, **When** se filtra "cobrada manualmente", **Then** elas
   aparecem, cada uma com o comprovante disponível.
3. **Given** uma chave de perfil consulta, **When** ela tenta registrar, substituir ou desfazer um
   documento, ou alterar o valor, **Then** a API recusa e o app não oferece essas ações.
4. **Given** uma reserva com tratativa, **When** se abre o seu histórico, **Then** aparecem todos os
   registros, substituições e desfazimentos, com quem e quando.

### Edge Cases

- **Nova verificação depois da tratativa**: a reserva é verificada de novo pelo servidor; a tratativa
  e os documentos permanecem (spec 001, FR-018b). Se a classificação do Hunit mudar para "já
  cobrada", a reserva aparece como já cobrada pelo Hunit e o comprovante manual continua visível,
  sem conflito.
- **Classificação muda para uma que não aceita tratativa** (ex.: de "pendente de cobrança" para
  "faturada"): os documentos já registrados permanecem visíveis e baixáveis; novos registros são
  recusados enquanto a classificação não exigir ação.
- **Reserva cancelada**: a classificação de cobrança é a mesma de uma ativa (spec 001, FR-014a);
  uma cancelada pendente de cobrança aceita tratativa.
- **Reserva "não encontrada na última verificação"**: mantém a tratativa e continua aceitando
  registros.
- **Dois operadores na mesma reserva ao mesmo tempo**: os dois registros são aceitos, o último
  vale como documento atual e o histórico guarda ambos; quem estava com a tela aberta vê a situação
  atualizada ao recarregar.
- **Arquivo com extensão aceita mas conteúdo de outro tipo** (ex.: um executável renomeado para
  .pdf): é recusado.
- **Arquivo vazio**: é recusado.
- **Servidor indisponível durante o envio**: nada é gravado pela metade; o operador vê o erro e pode
  tentar de novo.
- **Valor manual informado com a reserva sem comprovante**: o sistema recusa; o valor manual só faz
  sentido com o comprovante.
- **Valor manual quando o Hunit passa a trazer o valor cobrado**: os dois ficam visíveis,
  identificados pela origem; o valor do Hunit prevalece como valor cobrado.
- **Reverter quando a reserva já não aceita registros** (ex.: a classificação passou a "faturada"):
  a reversão é recusada com o motivo, como um registro novo (FR-003).
- **Reverter um documento aplicado em lote**: vale só para a reserva em que se reverte; as outras
  reservas do lote não mudam.
- **Reserva anonimizada pelo prazo de retenção**: segue a regra de retenção dos documentos (FR-016).

## Requirements *(mandatory)*

### Functional Requirements

**Registro**

- **FR-001**: O sistema MUST permitir registrar, para cada reserva (identificada por hotel + número,
  spec 001 FR-017), dois documentos independentes: a **tratativa** e o **comprovante de cobrança**.
  Cada um é opcional e pode ser registrado sem o outro, em qualquer ordem.
- **FR-002**: A situação exibida da reserva MUST ser derivada assim, sem alterar a classificação
  calculada pelo servidor:
  - com comprovante → **Cobrada** (cobrada manualmente);
  - só com tratativa → **Enviada**;
  - sem nenhum dos dois → a classificação do servidor, sem marcação.
  "Enviada" MUST continuar sendo tratada como pendência em filtros e totais; "Cobrada" MUST deixar de
  ser.
- **FR-003**: Só aceitam novos registros as reservas cuja classificação exige uma cobrança ainda não
  registrada no Hunit:
  - pendente de cobrança, erro na cobrança, cartão validado (não cobrado) e erro de análise aceitam
    tratativa e comprovante;
  - cobrar na maquininha aceita só o comprovante (a cobrança é feita na maquininha, sem tratativa
    com o hotel), e com ele passa a "Cobrada" (FR-002).
  As demais (ignorada, faturada, cancelada sem cobrança, já cobrada) MUST ser recusadas com o motivo.
- **FR-004**: Cada documento MUST poder ser substituído por outro do mesmo tipo e desfeito
  (removido). A situação exibida MUST refletir o que restou (FR-002).
- **FR-005**: O operador MUST poder informar manualmente o valor cobrado de uma reserva que tenha
  comprovante, e removê-lo para voltar ao valor do Hunit. O valor manual MUST ser exibido
  identificado como tal; quando o Hunit também trouxer o valor cobrado, o do Hunit prevalece e os dois
  ficam visíveis.
- **FR-006**: O sistema MUST permitir aplicar o mesmo documento (tratativa ou comprovante) a várias
  reservas de uma vez, depois de uma confirmação que mostre quantas aceitam, quantas serão ignoradas
  e o total dos valores. O resultado MUST informar, por reserva, se o documento foi registrado ou o
  motivo de ter ficado de fora.
- **FR-007**: Os registros MUST NOT gerar nenhuma requisição ao Hunit nem alterar dado lido dele; uma
  nova verificação da reserva MUST NOT apagar ou alterar tratativas, documentos ou valor manual.

**Documentos**

- **FR-008**: Os documentos aceitos são e-mails (.eml e .msg), PDF e imagens (.png, .jpg, .jpeg), de
  até 25 MB cada. O sistema MUST conferir que o conteúdo corresponde ao tipo declarado e MUST recusar
  arquivos vazios, de outros tipos ou acima do limite, sem gravar nada.
- **FR-009**: O documento baixado MUST ser idêntico ao enviado, com o nome original do arquivo.
- **FR-010**: Os documentos MUST ser guardados pelo servidor (nunca só na máquina de quem anexou),
  acessíveis apenas por clientes autorizados, e MUST entrar nas cópias de segurança diárias cifradas
  (spec 001, FR-030), com a mesma restauração (FR-031).
- **FR-011**: Um registro (individual ou de cada reserva num lote) MUST ser completo ou não acontecer:
  nunca uma reserva marcada sem o documento guardado, nem documento guardado sem registro.

**Auditoria e acesso**

- **FR-012**: Todo registro, substituição, desfazimento e alteração de valor manual MUST ficar no
  histórico da reserva com o cliente da API que fez e o momento. O histórico MUST NOT ser apagado
  pelas ações dos operadores.
- **FR-013**: Documentos substituídos ou desfeitos MUST ser guardados por 30 dias a partir da
  substituição ou do desfazimento, visíveis e baixáveis no histórico da reserva, e depois apagados
  automaticamente; o registro no histórico permanece (FR-012).
- **FR-013a**: Enquanto um documento substituído ou desfeito estiver guardado (FR-013), o operador
  MUST poder **revertê-lo**: ele volta a ser o documento atual do seu tipo, e o que estava atual, se
  houver, passa a ser o substituído (com novo prazo de 30 dias). A situação exibida MUST refletir o
  resultado (FR-002), a reversão MUST ficar no histórico (FR-012) e MUST respeitar a regra de
  FR-003. Depois do prazo, a opção de reverter deixa de aparecer.
- **FR-014**: O perfil operador MUST poder registrar, substituir, desfazer, reverter e informar valor; o perfil
  consulta MUST poder apenas ver e baixar. A API MUST recusar ações de registro vindas de clientes do
  perfil consulta.

**Consulta**

- **FR-015**: A consulta de reservas (API e app) MUST permitir filtrar pela situação da tratativa —
  sem tratativa, enviada, cobrada manualmente — combinando com os filtros existentes (hotel, período,
  classificação, situação da reserva etc.), e MUST mostrar, para cada reserva, a situação exibida, os
  documentos atuais (nome, tamanho, autor, momento), o valor manual e o histórico.

**Retenção**

- **FR-016**: Os documentos atuais MUST ser mantidos pelo mesmo prazo dos dados da reserva (5 anos
  após o check-in, spec 001 FR-026). Como o conteúdo de um documento não pode ser anonimizado, ao fim
  do prazo os arquivos MUST ser apagados automaticamente junto com a anonimização da reserva,
  mantendo o registro de que houve tratativa/comprovante, as datas e o valor manual. Nomes de arquivo
  podem conter dados pessoais e MUST ser tratados da mesma forma.

**App desktop**

- **FR-017**: O app MUST oferecer, na consulta de reservas, as ações de anexar tratativa, anexar
  comprovante, substituir, desfazer (com confirmação), reverter um documento substituído ou desfeito
  (dentro do prazo de FR-013), informar e remover valor manual, abrir e
  baixar documentos, seleção de várias reservas para aplicação em lote e o filtro de FR-015. As ações
  de registro MUST ficar ocultas para o perfil consulta.

### Key Entities *(include if feature involves data)*

- **Tratativa da reserva**: o estado manual atual de uma reserva (hotel + número): documento de
  tratativa atual, comprovante atual, valor cobrado manual, situação exibida derivada (FR-002).
- **Documento**: arquivo anexado a uma reserva; tipo (tratativa ou comprovante), nome original,
  tamanho, tipo de conteúdo, quem anexou (cliente da API) e quando; estado (atual, substituído ou
  desfeito) e, se não for atual, até quando pode ser revertido. Um mesmo arquivo aplicado em
  lote (FR-006) vale para cada reserva como documento dela.
- **Evento de tratativa**: entrada do histórico — registrar, substituir, desfazer, reverter,
  informar valor, remover valor — com o documento ou valor envolvido, o cliente da API e o momento.
- **Reserva** (da spec 001): ganha a situação exibida e a ligação com a tratativa; sua
  classificação calculada não muda.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O operador registra o comprovante de uma reserva encontrada na consulta em até 1 minuto.
- **SC-002**: O operador aplica um mesmo documento a 20 reservas selecionadas em até 2 minutos,
  incluindo a confirmação.
- **SC-003**: Zero requisições ao Hunit causadas por tratativas, e zero alterações na classificação
  calculada das reservas.
- **SC-004**: 100% das tratativas e documentos permanecem iguais depois de novas verificações das
  reservas.
- **SC-005**: 100% dos documentos baixados são idênticos aos enviados.
- **SC-006**: Com uma chave de perfil consulta, zero ações de registro são aceitas.
- **SC-007**: Depois de restaurar uma cópia de segurança, 100% dos documentos atuais voltam
  disponíveis.
- **SC-008**: O filtro "pendente de cobrança" + "sem tratativa" devolve exatamente as reservas
  pendentes em que ninguém agiu, em até 5 segundos.
- **SC-009**: Um documento substituído ou desfeito por engano volta a ser o atual em até 30
  segundos, durante os 30 dias seguintes, sem precisar anexar o arquivo de novo.

## Assumptions

- "Quem fez" é o cliente da API que fez a ação. Como cada máquina tem a sua chave (spec 002) e cada
  pessoa usa a sua máquina, isso identifica a pessoa na prática; identificar a pessoa
  independentemente da máquina exigiria login por usuário, fora do escopo.
- Os tipos aceitos (FR-008) são os usados no sistema anterior; o limite de 25 MB cobre e-mails com
  anexos comuns. Os dois podem ser ajustados no plano se a homologação mostrar necessidade.
- "Cobrar na maquininha" é cobrada fora do Hunit, na maquininha; o comprovante dessa cobrança é
  registrado no sistema por quem tiver acesso de operador (hoje o Financeiro e a Controladoria). A
  futura planilha do comercial não substitui esse registro: o sistema continua sendo a fonte da
  verdade (constitution, princípio VI), e a planilha será uma projeção dele.
- O volume é pequeno: dezenas de documentos por semana, de 4 operadores.
- As tratativas registradas no sistema anterior não entram nesta feature: virão com a importação do
  histórico (spec futura). Até lá, quem precisar consulta o sistema anterior.
- "Enviada" registra que houve uma tratativa com documento; a inclusão das reservas enviadas na
  planilha do comercial fica para a spec de sincronização com o Sheets, que poderá mudar o que
  significa "enviar".
- A API cresce só com acréscimos, sem quebrar o app desktop atual nem os clientes da 001.
- Os nomes em português das classificações seguem a spec 001 (FR-013).
