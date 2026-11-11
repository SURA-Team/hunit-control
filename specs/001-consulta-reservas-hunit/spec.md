# Feature Specification: Consulta de Reservas de Cartão Virtual no Hunit

**Feature Branch**: `001-consulta-reservas-hunit`

**Created**: 2026-11-11

**Status**: Draft

**Input**: User description: "Consulta de reservas de cartão virtual no Hunit via API (login com 2FA,
coleta e classificação). O legado parou de funcionar porque o Hunit atualizou suas telas; a navegação
precisa ser mapeada novamente a partir da UI atual. O legado vale apenas como referência das regras de
negócio e do resultado esperado."

## Contexto

O Financeiro da rede precisa saber quais reservas com pré-pagamento por cartão virtual no Hunit já
foram cobradas e quais continuam pendentes, para apoiar a cobrança manual e a conferência
operacional. O Hunit não oferece integração oficial; as informações são obtidas navegando a extranet
do Hunit como um usuário faria.

O sistema anterior (`legacy/`) realizava essa coleta, mas **deixou de funcionar porque o Hunit
atualizou suas telas**. Por isso:

- o **caminho de navegação** no Hunit (telas, campos, botões, textos) MUST ser levantado novamente a
  partir da interface atual do Hunit; nada do caminho de navegação do legado pode ser presumido válido;
- o legado continua válido como referência de **regras de negócio** (classificação, dados coletados,
  histórico de verificações) e do **resultado esperado**.

Esta feature entrega o núcleo da operação acessível a clientes autorizados (o futuro app desktop e,
mais adiante, o Sura). Ficam **fora do escopo** e serão tratados em specs próprias: app desktop,
tratativas manuais (enviada/cobrada com anexos), sincronização com a planilha compartilhada do
comercial, relatórios e painéis, e exportação de planilhas.

## Clarifications

### Session 2026-11-11

- Q: Cada execução exige login novo com token 2FA ou reaproveita a sessão do Hunit? → A: Login novo
  com token a cada execução e retomada; nenhuma sessão do Hunit é guardada após a execução. O servidor
  nunca guarda usuário e senha; o cliente (ex.: app desktop) pode mantê-los preenchidos apenas em
  memória enquanto estiver aberto. O token vem de um aplicativo autenticador e o Hunit aceita o token
  por cerca de 1 a 2 minutos.
- Q: Como tratar reservas canceladas? → A: A consulta usa "Status da reserva = Todas", porque
  reservas canceladas ainda podem ser cobradas. A situação da reserva (ativa/cancelada) é registrada
  separadamente da classificação de cobrança, permitindo distinguir, por exemplo, cancelada e cobrada
  de cancelada e pendente.
- Q: O que fazer quando uma reserva gravada não aparece numa consulta que cobriu seu hotel e período?
  → A: Marcar como "não encontrada na última verificação", mantendo o status anterior e o histórico.
- Q: Todos os clientes autorizados têm as mesmas permissões? → A: Não; dois níveis por cliente:
  operador (tudo) e consulta (somente leitura de execuções e resultados).
- Q: Qual a duração aceitável de uma execução de rotina (todos os hotéis, uma semana de check-in)?
  → A: Até 30 minutos, se o Hunit permitir processar hotéis simultaneamente; se não permitir, até
  1 hora processando um hotel por vez. Além da rotina, o operador precisa rodar períodos
  retroativos de qualquer tamanho para encontrar reservas antigas que passaram sem cobrança.
- Q: Por quanto tempo guardar os dados das reservas? → A: 5 anos após o check-in; depois, dados
  pessoais do hóspede são anonimizados e os dados financeiros são mantidos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Acesso ao Hunit com token 2FA (Priority: P1)

Um operador, por meio de um cliente autorizado, inicia uma execução informando usuário/e-mail e senha
do Hunit. A execução acessa o Hunit e, quando o Hunit pede o token de verificação em duas etapas,
pausa e sinaliza que está **aguardando token**. O operador informa o token (pelo mesmo cliente ou por
outro cliente autorizado) e a execução confirma que o acesso foi concluído, ou encerra com um motivo
claro de falha.

**Why this priority**: sem acesso ao Hunit nenhuma outra parte funciona, e é exatamente a etapa
afetada pela mudança de telas do Hunit. Entregá-la sozinha já comprova que o sistema consegue operar
a interface atual do Hunit com intervenção humana.

**Independent Test**: iniciar uma execução com credenciais válidas, informar o token quando
solicitado e verificar que a execução indica acesso concluído; repetir com senha errada, token errado
e sem informar o token para verificar cada motivo de falha.

**Acceptance Scenarios**:

1. **Given** credenciais válidas, **When** o operador inicia a execução, **Then** a execução passa a
   "aguardando token" assim que o Hunit solicitar a verificação em duas etapas.
2. **Given** uma execução aguardando token, **When** o operador informa o token correto, **Then** a
   execução indica acesso concluído.
3. **Given** credenciais inválidas, **When** o operador inicia a execução, **Then** a execução
   encerra com o motivo "credenciais inválidas", sem pedir token.
4. **Given** uma execução aguardando token, **When** o operador informa um token incorreto, **Then**
   a execução encerra com o motivo "token inválido".
5. **Given** uma execução aguardando token, **When** nenhum token é informado dentro do tempo limite,
   **Then** a execução encerra com o motivo "tempo de espera do token esgotado".
6. **Given** que o Hunit apresenta uma tela que o sistema não reconhece, **When** a execução tenta
   prosseguir, **Then** ela encerra com o motivo "tela do Hunit não reconhecida" e registra evidência
   da tela encontrada.
7. **Given** qualquer execução, **When** seus registros e evidências são inspecionados, **Then**
   senha e token não aparecem em nenhum deles.

---

### User Story 2 - Consulta e classificação das reservas (Priority: P2)

Com o acesso concluído, a execução percorre os hotéis escolhidos para o período de check-in
informado, passa por todas as páginas de resultados de cada hotel, abre cada reserva **somente para
leitura**, classifica a situação do pré-pagamento e grava o resultado. O Financeiro consulta as
reservas resultantes por execução, por hotel e por classificação.

**Why this priority**: é o valor de negócio principal — saber o que está cobrado e o que está
pendente — e depende do acesso entregue na P1.

**Independent Test**: com acesso concluído, executar a consulta para um hotel e um período
conhecidos e comparar a classificação de uma amostra de reservas com o que se vê manualmente no
Hunit.

**Acceptance Scenarios**:

1. **Given** acesso concluído, um hotel e um período, **When** a consulta roda, **Then** todas as
   páginas de resultado do hotel são percorridas, sem limite fixo de páginas.
2. **Given** uma reserva cujo número começa com "258-", **When** ela aparece na listagem, **Then**
   é classificada como "ignorada (Hotelbeds 258)" sem ser aberta.
3. **Given** uma reserva sem indicação de pré-pagamento, **When** é analisada, **Then** é
   classificada como "não é cartão virtual".
4. **Given** uma reserva com pré-pagamento e registro de cobrança ("Cobrado em"), **When** é
   analisada, **Then** é classificada como "já cobrada", com data/hora da cobrança registrada.
5. **Given** uma reserva com pré-pagamento, sem registro de cobrança e com a ação de cobrar
   disponível, **When** é analisada, **Then** é classificada como "pendente de cobrança" e a ação de
   cobrar **não** é acionada.
6. **Given** uma reserva com pré-pagamento cujo estado atual indica falha de cobrança, **When** é
   analisada, **Then** é classificada como "erro na cobrança".
7. **Given** uma reserva com estrutura não reconhecida, estado contraditório ou indeterminado,
   **When** é analisada, **Then** é classificada como "erro de análise", com motivo e evidência,
   para revisão humana.
8. **Given** uma reserva já conhecida de execuções anteriores, **When** é verificada novamente,
   **Then** seu registro é atualizado, mantendo a primeira verificação, atualizando a última,
   incrementando a quantidade de verificações e indicando campos alterados e mudança de status
   (status anterior e momento da mudança).
9. **Given** um hotel concluído, **When** o Financeiro consulta os resultados, **Then** encontra
   todas as reservas daquele hotel com seus dados e classificação.
10. **Given** uma reserva cancelada no Hunit com pré-pagamento e registro "Cobrado em", **When** é
    analisada, **Then** é registrada como cancelada e já cobrada, distinguível de uma reserva
    cancelada e pendente de cobrança e de uma reserva ativa e já cobrada.

---

### User Story 3 - Acompanhamento, cancelamento e retomada (Priority: P3)

O operador acompanha a execução em andamento, pode cancelá-la a qualquer momento e pode retomar
uma execução interrompida a partir do último hotel concluído.

**Why this priority**: execuções percorrem muitos hotéis e podem levar bastante tempo; sem
acompanhamento e retomada, uma falha no meio obriga a recomeçar tudo. Agrega robustez, mas a
consulta (P2) já entrega valor sem isso.

**Independent Test**: iniciar uma execução com vários hotéis, acompanhar o progresso, cancelar
durante o segundo hotel e retomar, verificando que o primeiro hotel não é reprocessado.

**Acceptance Scenarios**:

1. **Given** uma execução em andamento, **When** o operador consulta seu andamento, **Then** vê o
   estado, o hotel, a página e a reserva atuais, as contagens por classificação e os eventos
   recentes.
2. **Given** uma execução em andamento, **When** o operador a cancela, **Then** ela é interrompida
   sem aguardar o fim do hotel atual, e os hotéis já concluídos permanecem gravados.
3. **Given** uma execução interrompida (cancelada ou com falha), **When** o operador solicita a
   retomada, **Then** uma nova sessão de acesso é feita (com novo token) e o processamento continua
   a partir do primeiro hotel não concluído.
4. **Given** uma execução em andamento para uma conta do Hunit, **When** alguém tenta iniciar outra
   execução para a mesma conta, **Then** a nova tentativa é recusada com motivo claro.
5. **Given** um cliente com nível "consulta", **When** ele tenta iniciar, cancelar ou retomar uma
   execução ou enviar token, **Then** a ação é recusada com motivo claro, e ele continua podendo
   acompanhar a execução e consultar os resultados.

---

### Edge Cases

- O Hunit exibe avisos ou janelas informativas (ex.: "Bloqueios de Processamento") antes da
  listagem: a execução os dispensa apenas quando forem informativos e conhecidos; avisos
  desconhecidos encerram o hotel como "tela do Hunit não reconhecida".
- Um hotel não oferece algum filtro esperado na tela de reservas: se o filtro estiver configurado
  como "Todos/Todas" (sem restrição), o hotel é processado normalmente; se o filtro restringir a
  consulta (ex.: Tipo coleta pagamento = Canal), o hotel é marcado como falha com motivo.
- O período informado não retorna reservas para um hotel: o hotel é concluído com zero reservas,
  sem erro.
- A sessão do Hunit expira no meio da execução: a execução encerra como interrompida, permitindo a
  retomada.
- Falha ao abrir uma reserva específica: a reserva é classificada como "erro de análise" com
  evidência, e a execução segue para a próxima.
- Falha repetida em um hotel inteiro: o hotel é marcado como falho e a execução segue para o
  próximo hotel; o resultado final aponta os hotéis falhos.
- Um token chega depois que a execução já expirou ou foi cancelada: é recusado com motivo claro.
- O token do autenticador muda a cada poucos segundos: um token que expirou entre a leitura e o
  envio é rejeitado pelo Hunit e a execução encerra com "token inválido"; o operador inicia nova
  execução.
- A listagem muda durante a paginação (reservas novas no Hunit): reservas repetidas na mesma
  execução são gravadas uma única vez.
- Uma reserva gravada tem o check-in alterado para fora do período ou deixa de ser "Canal" no
  Hunit: na próxima consulta completa do hotel e período originais, ela é marcada como "não
  encontrada na última verificação" (FR-018a), sem perder a classificação anterior.

## Requirements *(mandatory)*

### Functional Requirements

**Acesso e execução**

- **FR-001**: O sistema MUST permitir que um cliente autorizado inicie uma execução informando
  credenciais do Hunit, hotéis e período de check-in.
- **FR-002**: O sistema MUST pausar a execução no estado "aguardando token" quando o Hunit solicitar
  verificação em duas etapas, e aceitar o token de qualquer cliente autorizado.
- **FR-003**: O sistema MUST encerrar a execução com motivo distinto para: credenciais inválidas,
  token inválido, tempo de espera do token esgotado, Hunit indisponível e tela do Hunit não
  reconhecida.
- **FR-004**: O tempo de espera do token MUST acompanhar o limite da tela de verificação do Hunit
  (cerca de 1 a 2 minutos; valor exato a confirmar no mapeamento da tela). Se o Hunit expirar a tela
  de verificação, ou se esse limite for atingido sem token, a execução MUST encerrar com o motivo
  "tempo de espera do token esgotado".
- **FR-005**: Credenciais e token MUST ser usados apenas durante a execução e MUST NOT ser
  armazenados pelo sistema nem aparecer em registros, evidências ou mensagens de erro. Nenhuma
  sessão autenticada do Hunit MUST permanecer guardada após o fim da execução. Manter usuário e
  senha preenchidos no cliente, somente em memória enquanto ele estiver aberto, é responsabilidade
  do cliente e não do sistema.
- **FR-006**: O sistema MUST permitir no máximo uma execução ativa por conta do Hunit.
- **FR-007**: Somente clientes autorizados, identificados individualmente, MUST poder acessar o
  sistema, cada um com um de dois níveis de acesso:
  - **operador**: iniciar execuções, enviar token, cancelar, retomar, acompanhar e consultar
    resultados;
  - **consulta**: somente acompanhar execuções e consultar resultados e catálogo de hotéis.
  Ações não permitidas ao nível do cliente MUST ser recusadas com motivo claro, e toda ação de
  operador MUST registrar qual cliente a executou.

**Hotéis e consulta**

- **FR-008**: O sistema MUST obter o catálogo de hotéis disponíveis na conta do Hunit a cada
  execução e disponibilizar aos clientes o último catálogo conhecido.
- **FR-009**: Quando nenhum hotel for informado, a execução MUST processar todos os hotéis do
  catálogo.
- **FR-010**: Para cada hotel, o sistema MUST consultar as reservas do período informado aplicando
  um conjunto fixo de filtros do Hunit, equivalente ao usado pelo legado (nomes conforme a tela de
  reservas atual do Hunit, em 2026-11-11):

  | Filtro no Hunit | Valor aplicado |
  |---|---|
  | Filtrar período por | Check-in |
  | De / Até | período informado na execução |
  | Status da reserva | Todas (ativas e canceladas) |
  | Tipo coleta pagamento | Canal |
  | Status da cobrança | Todos |
  | Status da integração (PMS) | Todas |
  | Demais campos (nº da reserva, canais, hóspede, tipo de quarto, nº integração PMS) | sem filtro |

  Se algum desses filtros ou valores deixar de existir na tela do Hunit, o hotel MUST ser marcado
  como falha com o motivo "tela do Hunit não reconhecida", em vez de consultar sem o filtro.
- **FR-010a**: O período de check-in MUST aceitar qualquer intervalo de datas, inclusive totalmente
  no passado e maior que uma semana, para permitir consultas retroativas de reservas que passaram
  sem cobrança. A data inicial MUST ser menor ou igual à final. Se o Hunit limitar o tamanho do
  intervalo, o sistema MUST dividir a consulta em intervalos aceitos pelo Hunit, de forma
  transparente para o operador.
- **FR-011**: O sistema MUST percorrer todas as páginas de resultados de cada hotel, descobrindo o
  total de páginas a partir do próprio resultado.
- **FR-012**: O sistema MUST abrir as reservas somente para leitura e MUST NOT acionar cobranças,
  nem alterar reservas, observações ou dados financeiros no Hunit.

**Classificação**

- **FR-013**: O sistema MUST classificar cada reserva em exatamente uma das situações: ignorada
  (Hotelbeds 258), não é cartão virtual, já cobrada, pendente de cobrança, erro na cobrança ou erro
  de análise, aplicando as regras na seguinte ordem:
  1. número iniciando com "258-" → ignorada, sem abrir a reserva;
  2. sem indicação de pré-pagamento → não é cartão virtual;
  3. pré-pagamento cujo estado atual indica falha de cobrança → erro na cobrança;
  4. pré-pagamento com registro de cobrança ("Cobrado em") → já cobrada;
  5. pré-pagamento sem registro de cobrança e com a ação de cobrar disponível → pendente de
     cobrança;
  6. qualquer outro caso (estrutura não reconhecida, contraditória ou indeterminada) → erro de
     análise.
- **FR-014**: Cada classificação MUST registrar o motivo que a determinou.
- **FR-014a**: O sistema MUST registrar a situação da reserva no Hunit (ativa ou cancelada) de forma
  independente da classificação de cobrança: uma reserva cancelada recebe a mesma classificação de
  cobrança que receberia se estivesse ativa (ex.: cancelada + já cobrada, cancelada + pendente de
  cobrança). Se a situação não puder ser identificada, MUST ser registrada como "não identificada",
  com evidência, sem impedir a classificação de cobrança.
- **FR-015**: Diante de estado ambíguo, o sistema MUST classificar como "erro de análise" e MUST NOT
  presumir cobrança.

**Dados e histórico**

- **FR-016**: Para cada reserva, o sistema MUST registrar: hotel, número da reserva, hóspede, canal,
  entrada, saída, período da hospedagem, total da reserva, situação da reserva (ativa, cancelada ou
  não identificada), classificação e motivo; e, quando
  disponíveis no Hunit: data/hora da cobrança, responsável pela cobrança, valor cobrado, ID da
  transação, código de autorização, referência do processador, parcelamento (sim/não, número de
  parcelas, valor da parcela), estado e mensagem do pré-pagamento e se a ação de cobrar estava
  disponível.
- **FR-017**: Uma reserva MUST ser identificada pela combinação hotel + número da reserva; reservas
  novas são incluídas e reservas conhecidas são atualizadas.
- **FR-018**: Para cada reserva, o sistema MUST manter: primeira verificação, última verificação,
  quantidade de verificações, campos alterados na última verificação, indicação de mudança de
  status, status anterior e momento da última mudança de status. A passagem de ativa para cancelada
  MUST ser registrada como mudança, com o momento em que foi detectada.
- **FR-018a**: Quando um hotel for concluído com sucesso e uma reserva já gravada desse hotel, com
  check-in dentro do período consultado, não aparecer no resultado, o sistema MUST marcá-la como
  "não encontrada na última verificação", com o momento da marcação, mantendo inalterados sua
  classificação, situação e histórico. Se a reserva voltar a aparecer em uma verificação futura, a
  marcação MUST ser removida. Hotéis que falharam ou foram interrompidos MUST NOT gerar essa
  marcação.
- **FR-019**: Os resultados de um hotel MUST ser gravados ao final do processamento daquele hotel;
  um hotel interrompido não deixa resultados parciais.
- **FR-020**: Os clientes autorizados MUST poder consultar reservas filtrando por execução, hotel,
  classificação, situação da reserva (ativa, cancelada, não identificada) e marcação "não
  encontrada na última verificação", inclusive combinando-os (ex.: canceladas pendentes de
  cobrança).

**Acompanhamento, cancelamento e retomada**

- **FR-021**: O sistema MUST expor o andamento de cada execução: estado, hotel atual, página atual,
  reserva atual, contagens por classificação, hotéis concluídos, falhos e pendentes, e eventos
  recentes.
- **FR-022**: O sistema MUST permitir cancelar uma execução a qualquer momento, interrompendo-a sem
  aguardar o fim do hotel atual.
- **FR-023**: O sistema MUST permitir retomar uma execução interrompida a partir do primeiro hotel
  não concluído, exigindo novo acesso com token.

**Evidências**

- **FR-024**: Toda falha de navegação ou de classificação MUST gerar evidência (captura da tela e
  conteúdo da página) vinculada à execução, ao hotel e, quando houver, à reserva.
- **FR-025**: Evidências MUST NOT conter credenciais nem token e MUST ser mantidas por 30 dias.

**Retenção de dados**

- **FR-026**: Os dados de cada reserva MUST ser mantidos por 5 anos após a data de check-in. Ao fim
  desse prazo, os dados pessoais do hóspede (nome) MUST ser anonimizados de forma irreversível,
  mantendo hotel, número da reserva, datas, valores, classificação, situação e histórico de
  verificação.
- **FR-027**: A anonimização MUST ocorrer automaticamente, sem ação do operador, e reservas
  anonimizadas MUST continuar consultáveis pelos demais campos.

### Key Entities

- **Execução**: uma solicitação de consulta. Tem conta do Hunit (identificada sem credenciais),
  hotéis solicitados, período de check-in, estado (na fila, em andamento, aguardando token,
  concluída, falhou, cancelada), motivo de encerramento, cliente solicitante, datas de início e fim,
  e o andamento por hotel. Pode originar uma retomada.
- **Hotel**: um hotel do catálogo da conta do Hunit, com código e nome; o catálogo é atualizado a
  cada execução.
- **Processamento de hotel**: a situação de um hotel dentro de uma execução (pendente, em
  andamento, concluído, falhou), com páginas e reservas processadas e contagens por classificação.
- **Reserva**: identificada por hotel + número; contém os dados da reserva, a situação da reserva
  (ativa/cancelada/não identificada), os dados do pré-pagamento e da cobrança, a classificação de
  cobrança atual, a marcação "não encontrada na última verificação" e o histórico de verificação (primeira/última verificação,
  contagem, mudanças).
- **Evidência**: captura de tela e conteúdo de página vinculados a uma falha, com execução, hotel e
  reserva de origem e data de expiração.
- **Cliente autorizado**: um sistema ou aplicativo identificado individualmente (ex.: app desktop,
  Sura), com nível de acesso "operador" ou "consulta".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em uma execução concluída, 100% das reservas listadas pelo Hunit para os hotéis e o
  período solicitados aparecem nos resultados com uma classificação.
- **SC-002**: Em uma amostra de 50 reservas conferidas manualmente no Hunit, ao menos 98% têm a
  mesma situação (cobrada, pendente, erro na cobrança, não é cartão virtual) que o sistema
  registrou, e nenhuma reserva pendente aparece como cobrada.
- **SC-003**: Zero cobranças disparadas e zero alterações feitas no Hunit pelo sistema em qualquer
  execução.
- **SC-004**: Zero ocorrências de senha ou token em registros e evidências, verificadas por busca
  em todos os artefatos gerados nas execuções de homologação.
- **SC-005**: O operador vê que a execução está aguardando token em até 5 segundos após o Hunit
  solicitá-lo, garantindo que quase toda a janela de 1 a 2 minutos fique disponível para digitar o
  token.
- **SC-006**: Quando o Hunit mudar uma tela usada pelo sistema, 100% das execuções afetadas
  encerram ou marcam o hotel com o motivo "tela do Hunit não reconhecida" e evidência, em vez de
  produzir classificações incorretas.
- **SC-007**: Uma execução retomada não reprocessa nenhum hotel já concluído.
- **SC-008**: Após um cancelamento, a execução para em até 15 segundos.
- **SC-009**: Uma execução de rotina (todos os hotéis do catálogo, uma semana de check-in) termina
  em até 30 minutos, se o Hunit permitir processar hotéis simultaneamente; caso contrário, em até
  1 hora. Consultas retroativas maiores têm duração proporcional ao número de reservas.

## Assumptions

- As regras de classificação do legado continuam válidas para o negócio; apenas a forma de
  identificá-las nas telas pode ter mudado com a atualização do Hunit.
- Toda execução exige um novo acesso com token 2FA, gerado por um aplicativo autenticador e
  informado por um humano; reaproveitar a sessão do Hunit entre execuções está fora do escopo desta
  feature.
- Uma única conta do Hunit dá acesso a todos os hotéis do catálogo da rede.
- O período de check-in é obrigatório e informado como data inicial e final (DD/MM/AAAA).
- Se o Hunit permite processar vários hotéis simultaneamente com a mesma conta ainda é
  desconhecido; precisa ser verificado na fase de planejamento e define qual meta da SC-009 vale.
- Os filtros da FR-010 são fixos nesta feature; permitir que o operador escolha filtros por
  execução fica para uma spec futura, se houver necessidade.
- Os nomes de filtros, telas e textos do Hunit citados nesta spec refletem a interface atual
  (2026-11-11) e servem para identificar o significado de negócio; podem mudar sem que a regra mude.
- A retenção de 30 dias para evidências é um padrão inicial, ajustável pela operação.
- O prazo de 5 anos para dados de reservas acompanha a guarda usual de registros financeiros e deve
  ser confirmado com o jurídico/financeiro da empresa; mudar o prazo não altera o restante da spec.
- Os dados históricos do legado (planilhas existentes) não são migrados nesta feature; isso, se
  necessário, será tratado em spec própria.
- Os usuários do resultado (Financeiro) consultarão os dados por meio de clientes futuros (app
  desktop, Sura); nesta feature, a validação é feita diretamente pelos clientes autorizados.
- Para mapear a interface atual do Hunit, o time terá acesso a uma conta do Hunit e a um operador
  capaz de fornecer o token 2FA durante o desenvolvimento e a homologação.
