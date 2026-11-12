# Feature Specification: App desktop para operar o HUNIT Control

**Feature Branch**: `002-app-desktop`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "App desktop (Electron) do HUNIT Control para os operadores do Financeiro. Hoje o servidor (feature 001) já faz login no Hunit com token 2FA, consulta e classifica as reservas por hotel, acompanha o andamento com estimativa de tempo, cancela e retoma execuções, e expõe tudo por uma API HTTP — mas só dá para usar chamando a API à mão; o sistema legado parou de funcionar, então a operação está sem interface. O app deve permitir: configurar a conexão com o servidor (endereço e chave de acesso do cliente, por máquina); iniciar uma execução informando usuário e senha do Hunit, hotéis e período de check-in; avisar o operador de forma chamativa quando o Hunit pedir o token 2FA (a janela do token é de 1 a 2 minutos) e enviar o token; acompanhar o andamento (hotel atual, progresso, tempo estimado), cancelar e retomar execuções; consultar as reservas gravadas com filtros (hotel, período, classificação, situação) e baixar as evidências de falha. Usuário e senha do Hunit ficam preenchidos nos campos apenas em memória até o app ser fechado (não são limpos após iniciar a execução, diferente do legado) e nunca são gravados em disco. Dois perfis de acesso já existem na API: operador (tudo) e consulta (somente leitura). Contexto de uso: 2 pessoas, cada uma na sua máquina Windows, na mesma rede local do servidor, que aceita conexões da rede somente por HTTPS com certificado da autoridade certificadora interna do servidor. Fora do escopo: tratativas manuais (enviada/cobrada com anexos), importação do histórico do Sheets, sincronização com a planilha do comercial, relatórios e exportação."

## Contexto

A feature 001 entregou o servidor do HUNIT Control: ele acessa o Hunit com o token 2FA informado por
uma pessoa, consulta e classifica as reservas de cartão virtual por hotel, grava o resultado e
permite acompanhar, cancelar e retomar cada execução. Tudo isso, porém, só é acessível chamando a
API diretamente, o que não é viável para o Financeiro e a Controladoria no dia a dia. O sistema anterior, que tinha
interface própria, deixou de funcionar quando o Hunit mudou suas telas.

Esta feature entrega o aplicativo de desktop que os operadores usam para fazer, sem conhecimento
técnico, tudo o que o servidor já oferece: iniciar uma consulta, responder ao pedido de token a
tempo, acompanhar o andamento e consultar as reservas classificadas. O aplicativo é apenas uma
interface: as regras de negócio (classificação, retomada, retenção) continuam no servidor.

Ficam **fora do escopo** e serão tratadas em specs próprias: tratativas manuais (enviada/cobrada
com anexos), importação do histórico da planilha do legado, sincronização com a planilha do
comercial, relatórios e painéis, e exportação de planilhas.

## Clarifications

### Session 2026-11-12

- Q: Em quais máquinas aparece o pedido de token? → A: Cada pessoa tem a própria conta do Hunit e
  o próprio autenticador; o aviso aparece só na máquina de quem iniciou (ou retomou) a execução. As
  outras máquinas veem apenas o estado na lista. Como as contas são diferentes, as duas pessoas
  podem rodar execuções ao mesmo tempo, uma por conta. *(Nota posterior: "cada pessoa tem a
  própria conta" vale para o Financeiro; a Controladoria usa a conta gerencial dela — ver a revisão
  abaixo e as premissas. A regra do aviso não muda.)*
- Q: Por quanto tempo usuário e senha do Hunit ficam na memória do aplicativo? → A: Até o
  aplicativo ser encerrado ou até 8 horas sem nenhuma ação no aplicativo (prazo ajustável), o que
  vier primeiro. O aplicativo não roda em segundo plano na área de notificação: fechar a janela
  encerra o aplicativo, porque a execução continua no servidor.
- Q: Por quais dados, além dos filtros básicos, o Financeiro precisa encontrar uma reserva? → A:
  Busca livre por número da reserva (sem precisar do hotel), nome do hóspede, transação, código de
  autorização e referência da operadora; filtro por canal; e busca por valor (valor total da
  reserva ou valor cobrado), como no legado, para conciliar com o extrato da operadora do cartão.
- Q: Com o servidor desligado, o aplicativo continua mostrando as últimas reservas consultadas? →
  A: Sim, mas só o que já estava aberto na tela, em memória, até o aplicativo ser fechado, com o
  aviso "dados de HH:MM — servidor indisponível"; nada de reservas é gravado em disco.
- Correção do usuário (2026-11-12): serão 4 usuários iniciais, do Financeiro e da Controladoria; o
  Comercial, com mais pessoas, poderá usar depois, somente se o sistema for validado.
- Q: A Controladoria vai iniciar execuções ou só consultar? → A (revisada pelo usuário em
  2026-11-12, depois do plano): a Controladoria também pode iniciar execuções, com perfil operador,
  usando a conta de perfil gerencial dela no Hunit. O perfil consulta continua disponível para quem
  só precisa consultar. Permissões mais finas (por ação e por escopo) ficam para a integração com o
  Sura.
- Acréscimo do usuário (2026-11-12, depois da homologação da 001): na homologação, o Hunit
  respondeu com erros passageiros, e o servidor passou a repetir a leitura até 5 vezes, com esperas
  de até 30 segundos, avisando a cada tentativa. O acompanhamento mostra esses avisos do servidor,
  para o hotel não parecer travado (FR-016a).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Executar a consulta e responder ao token (Priority: P1)

Na primeira vez, o operador configura o aplicativo na sua máquina com o endereço do servidor e a
chave de acesso que recebeu. A partir daí, para consultar as reservas, ele informa usuário e senha
do Hunit, escolhe os hotéis (ou todos) e o período de check-in e inicia a execução. Quando o Hunit
pede o token, o aplicativo chama a atenção do operador de forma impossível de ignorar, mesmo que
ele esteja em outra janela, mostra quanto tempo resta e recebe o token. Ao final, o operador vê o
resultado: quantas reservas foram encontradas em cada situação de cobrança e quais hotéis falharam.

**Why this priority**: sem isso, ninguém consegue usar o sistema; é o que substitui o legado
parado. O pedido de token tem janela de 1 a 2 minutos: se o operador não perceber a tempo, a
execução falha e precisa recomeçar.

**Independent Test**: numa máquina nova, configurar a conexão, iniciar uma execução de um hotel
por uma semana, responder ao token com o aplicativo minimizado e ver o resumo final com as
contagens por situação.

**Acceptance Scenarios**:

1. **Given** o aplicativo instalado e nunca configurado, **When** o operador o abre, **Then** ele
   é levado à configuração da conexão e só consegue usar as demais telas depois que a conexão com
   o servidor é confirmada.
2. **Given** a conexão configurada, **When** o operador informa usuário, senha, período e hotéis e
   inicia a execução, **Then** o aplicativo mostra que a execução foi iniciada e o estado dela.
3. **Given** uma execução aguardando o token e o aplicativo minimizado ou atrás de outras janelas,
   **When** o Hunit pede o token, **Then** o operador recebe um aviso visual e sonoro do sistema
   operacional, o aplicativo vem para a frente com o campo do token em foco e mostra o tempo
   restante em contagem regressiva.
4. **Given** o pedido de token aberto, **When** o operador digita o token e confirma, **Then** o
   aplicativo informa se o token foi aceito ou recusado pelo Hunit.
5. **Given** o prazo do token esgotado, **When** a execução falha por tempo, **Then** o aplicativo
   explica o motivo e oferece iniciar de novo com os mesmos dados já preenchidos.
6. **Given** uma execução iniciada, **When** o operador volta à tela inicial, **Then** usuário e
   senha do Hunit continuam preenchidos até o aplicativo ser encerrado ou ficar 8 horas sem uso.
7. **Given** uma execução concluída, **When** o operador abre o resultado, **Then** vê a contagem
   de reservas por situação de cobrança, os hotéis concluídos e os que falharam, com o motivo.
8. **Given** usuário ou senha incorretos, **When** o servidor informa a falha de acesso, **Then** o
   aplicativo mostra uma mensagem clara, sem repetir a senha, e mantém os campos para correção.

---

### User Story 2 - Acompanhar, cancelar e retomar (Priority: P2)

Durante uma execução, que pode levar de minutos a mais de meia hora, o operador acompanha em que
hotel ela está, quantos hotéis faltam, o tempo estimado para terminar e quantas reservas já foram
classificadas em cada situação. Se precisar, cancela. Se uma execução foi interrompida (cancelada,
falhou no meio, servidor reiniciado), ele a retoma a partir dos hotéis que faltaram, informando de
novo o acesso ao Hunit e o token. Ele também vê a lista das execuções anteriores, inclusive as
iniciadas pela outra máquina.

**Why this priority**: torna o uso confiável em execuções longas e evita recomeçar do zero após
uma interrupção, mas a consulta já é possível só com a US1.

**Independent Test**: iniciar uma execução de vários hotéis, observar o progresso e a estimativa,
cancelar no meio, retomar e confirmar que só os hotéis pendentes foram processados.

**Acceptance Scenarios**:

1. **Given** uma execução em andamento, **When** o operador abre o acompanhamento, **Then** vê o
   hotel atual, o progresso por hotel (concluído, em andamento, pendente, falhou, cancelado), o
   tempo estimado restante e as contagens por situação, atualizados enquanto a execução avança.
2. **Given** uma execução em andamento, **When** o operador pede o cancelamento e confirma,
   **Then** o aplicativo mostra a execução como cancelada assim que o servidor a interromper.
3. **Given** uma execução interrompida com hotéis pendentes, **When** o operador escolhe retomar,
   **Then** o aplicativo pede o acesso ao Hunit (já preenchido, se ainda estiver na memória) e o
   token, e a nova execução processa somente os hotéis que faltaram.
4. **Given** uma execução iniciada em outra máquina, **When** o operador abre a lista de execuções,
   **Then** ela aparece com quem a iniciou, o período, o estado e, se estiver em andamento, o
   acompanhamento em tempo real.
5. **Given** o aplicativo fechado e reaberto durante uma execução, **When** ele se reconecta,
   **Then** mostra a execução ativa no estado atual, inclusive se estiver aguardando token.
6. **Given** já existe uma execução ativa para a mesma conta do Hunit, **When** o operador tenta
   iniciar outra, **Then** o aplicativo explica que só pode haver uma por vez por conta e leva o
   operador à execução ativa.
7. **Given** uma execução em andamento em que o Hunit responde com erro passageiro, **When** o
   servidor espera para tentar de novo a leitura de um hotel, **Then** o acompanhamento mostra o
   aviso do servidor junto do hotel (motivo, número da tentativa e espera) e na lista de avisos da
   execução, e o operador entende que a execução não travou.

---

### User Story 3 - Consultar reservas e evidências (Priority: P3)

O operador, ou alguém com perfil de consulta, procura reservas já gravadas filtrando por hotel,
período de check-in, situação de cobrança, situação da reserva (ativa ou cancelada), canal e
reservas não encontradas na última verificação; ou encontra uma reserva digitando o número, o nome
do hóspede, a transação, o código de autorização ou o valor que aparece no extrato da operadora. Abre o detalhe
para ver os dados da cobrança e o histórico de verificações. Quando um hotel falha, baixa a
evidência (captura de tela ou resposta recebida do Hunit) para entender o que aconteceu.

**Why this priority**: é o uso diário do Financeiro depois que as execuções rodam, mas depende de
haver reservas gravadas, o que exige a US1.

**Independent Test**: com reservas já gravadas, filtrar as pendentes de cobrança de um hotel numa
semana, abrir uma delas, conferir os dados da cobrança e baixar a evidência de um hotel que falhou.

**Acceptance Scenarios**:

1. **Given** reservas gravadas, **When** o operador combina filtros, **Then** a lista mostra só as
   reservas que atendem a todos eles, com hotel, número, hóspede, check-in, valor, situação de
   cobrança e situação da reserva.
2. **Given** um código de autorização e um valor tirados do extrato da operadora, **When** o
   operador os digita na busca, **Then** a lista mostra a reserva correspondente, sem precisar
   saber o hotel.
3. **Given** uma lista com muitas reservas, **When** o operador chega ao fim do que foi exibido,
   **Then** consegue carregar as próximas sem perder os filtros.
4. **Given** uma reserva na lista, **When** o operador a abre, **Then** vê os dados da cobrança,
   o motivo da classificação, a classificação anterior (se mudou) e as datas da primeira e da
   última verificação.
5. **Given** uma reserva anonimizada pelo prazo de retenção, **When** ela aparece, **Then** o
   aplicativo indica que o nome do hóspede foi anonimizado, em vez de mostrar campo vazio.
6. **Given** um hotel que falhou numa execução, **When** o operador pede a evidência, **Then** o
   arquivo é salvo onde ele escolher; se a evidência já expirou, o aplicativo explica que ela não
   está mais disponível.
7. **Given** uma chave de acesso com perfil de consulta, **When** o operador usa o aplicativo,
   **Then** consulta execuções, reservas e evidências, e as ações de iniciar, enviar token,
   cancelar e retomar não aparecem.

---

### Edge Cases

- **Servidor desligado ou inacessível** (o servidor roda num PC ligado manualmente): o aplicativo
  mostra claramente que o servidor está indisponível, mantém visível (marcado com o horário) o que
  já estava na tela, tenta reconectar sozinho e volta a funcionar sem precisar ser reiniciado. Se o
  aplicativo for aberto com o servidor fora do ar, não há dados a mostrar até a conexão voltar.
- **Identidade do servidor não confirmada** (certificado desconhecido ou trocado): o aplicativo
  recusa a conexão, explica o problema e não oferece opção de "continuar mesmo assim".
- **Chave de acesso inválida ou revogada**: o aplicativo informa e leva o operador à configuração.
- **Conexão cai durante o pedido de token**: ao reconectar, se ainda houver prazo, o pedido volta a
  aparecer com o tempo restante correto; se não, o aplicativo mostra a falha por tempo.
- **Token enviado depois do prazo** ou execução que já saiu da espera: o aplicativo informa que o
  token não é mais aceito, sem travar.
- **Duas execuções ao mesmo tempo, uma de cada pessoa**: cada máquina recebe só o pedido de token da
  execução que iniciou; a lista mostra as duas.
- **Mesma pessoa com o aplicativo aberto em duas máquinas** (por exemplo, trocou de computador): o
  aviso vai só para a máquina que iniciou; se o token for enviado por outro caminho, o pedido se
  encerra na máquina que iniciou.
- **Aplicativo fechado com execução em andamento**: a execução continua no servidor; o operador é
  avisado antes de fechar que não receberá o pedido de token enquanto o aplicativo estiver
  fechado. Ao reabrir, se a execução estiver aguardando token e ainda houver prazo, o pedido
  aparece (FR-019).
- **8 horas sem uso**: usuário e senha são apagados da memória; ao iniciar ou retomar uma execução,
  o aplicativo explica que as credenciais foram apagadas por inatividade e pede de novo.
- **Período inválido** (data final antes da inicial) ou nenhum hotel no catálogo ainda (primeira
  execução): o aplicativo impede o envio no primeiro caso e, no segundo, permite apenas "todos os
  hotéis", explicando que o catálogo será obtido nessa execução.
- **Hotel pedido que a conta não acessa**: aparece como pendente com o motivo, como o servidor
  informa.
- **Hunit instável (erros passageiros)**: o servidor repete a leitura até 5 vezes, com esperas de
  até 30 segundos, e avisa a cada tentativa; com vários hotéis ao mesmo tempo, o mesmo episódio
  pode gerar avisos em todos eles. O aplicativo mostra cada aviso junto do hotel e na lista de
  avisos da execução. Se as tentativas se esgotarem, o hotel aparece como falhou, com o motivo.
- **Notificações do sistema operacional desativadas**: o aviso de token continua acontecendo dentro
  do aplicativo (janela à frente, som e destaque). Como o aplicativo não consegue saber se o
  Windows bloqueou as notificações dele, a configuração oferece "Testar aviso", que dispara o aviso
  completo para o operador conferir se a notificação aparece.
- **Segunda instância do aplicativo na mesma máquina**: em vez de abrir outra, a janela já aberta
  vem para a frente.

## Requirements *(mandatory)*

### Functional Requirements

**Conexão e acesso**

- **FR-001**: O aplicativo MUST permitir configurar, por usuário da máquina, o endereço do servidor
  e a chave de acesso do cliente, e MUST testar a conexão antes de salvar.
- **FR-002**: O aplicativo MUST conectar-se ao servidor somente por conexão cifrada e somente
  depois de confirmar a identidade do servidor; a configuração MUST incluir o que for necessário
  para essa confirmação, e MUST NOT existir opção para ignorar uma identidade não confirmada.
- **FR-003**: A chave de acesso MUST ficar guardada protegida para o usuário da máquina, nunca em
  texto legível por outros usuários, e MUST poder ser trocada ou removida pela configuração.
- **FR-004**: O aplicativo MUST identificar o perfil da chave (operador ou consulta) e exibir
  somente as ações permitidas a esse perfil.
- **FR-005**: Quando o servidor estiver inacessível, o aplicativo MUST indicar isso de forma
  visível em todas as telas e MUST tentar reconectar automaticamente. O que já estava carregado na
  tela (listas, detalhes, acompanhamento) MUST continuar visível, marcado com o horário em que foi
  obtido e o aviso de servidor indisponível; ações que dependem do servidor ficam desabilitadas até
  a reconexão, e nada novo é exibido como se fosse atual.

**Credenciais do Hunit**

- **FR-006**: Usuário e senha do Hunit MUST ser informados no aplicativo e MUST permanecer
  preenchidos apenas na memória, inclusive depois de iniciar uma execução, para reaproveitar em
  novas execuções e retomadas, até o primeiro destes: o aplicativo ser encerrado ou passarem 8
  horas sem nenhuma ação do operador no aplicativo (prazo ajustável na configuração). Ao apagar
  por inatividade, o aplicativo MUST informar o operador na próxima vez que ele precisar das
  credenciais.
- **FR-007**: Usuário, senha e token do Hunit MUST NOT ser gravados em disco (configuração,
  registros, cache, relatórios de erro ou qualquer outro arquivo) e MUST NOT aparecer em mensagens
  de erro.
- **FR-008**: O operador MUST poder limpar usuário e senha da memória a qualquer momento, sem
  encerrar o aplicativo.
- **FR-008a**: Dados de reservas e execuções (nomes de hóspedes, valores, dados de cobrança) MUST
  ficar só na memória enquanto exibidos e MUST NOT ser gravados em disco pelo aplicativo; a única
  exceção são os arquivos de evidência que o operador escolhe salvar (FR-024).

**Execução**

- **FR-009**: O operador MUST poder iniciar uma execução informando usuário, senha, período de
  check-in (datas em DD/MM/AAAA, qualquer intervalo, inclusive retroativo) e os hotéis: todos ou
  uma seleção a partir do catálogo conhecido, com busca pelo nome ou código do hotel.
- **FR-010**: O aplicativo MUST validar o período antes de enviar (data final não anterior à
  inicial) e MUST mostrar as recusas do servidor em linguagem clara.
- **FR-011**: Quando uma execução passar a aguardar o token, o aplicativo MUST, em até 5 segundos:
  emitir uma notificação do sistema operacional com som, trazer a janela para a frente com o campo
  do token em foco e exibir o tempo restante em contagem regressiva até o prazo informado pelo
  servidor. O aviso MUST acontecer mesmo com o aplicativo minimizado ou atrás de outras janelas;
  com o aplicativo encerrado não há aviso (ver FR-026).
- **FR-012**: O aviso de token (FR-011) MUST ser entregue somente na máquina que iniciou ou retomou
  a execução, porque quem iniciou é quem está esperando o pedido e tem acesso ao autenticador da
  conta do Hunit usada. Nas
  demais máquinas, a execução MUST aparecer na lista como "aguardando token", sem aviso.
- **FR-013**: O aplicativo MUST enviar o token informado e mostrar se ele foi aceito; se recusado
  ou fora do prazo, MUST explicar o motivo.
- **FR-014**: Ao terminar, falhar ou ser cancelada uma execução iniciada nesta máquina, o
  aplicativo MUST notificar o operador, com o resultado resumido.

**Acompanhamento, cancelamento e retomada**

- **FR-015**: O aplicativo MUST listar as execuções, das mais recentes para as mais antigas, com
  quem iniciou, período, estado, motivo de término e datas, incluindo as iniciadas em outras
  máquinas.
- **FR-016**: Para uma execução em andamento, o aplicativo MUST mostrar, atualizado enquanto ela
  avança (no máximo 5 segundos de atraso em relação ao servidor): estado, hotel atual, progresso de
  cada hotel, tempo estimado restante e contagens por situação de cobrança.
- **FR-016a**: O acompanhamento de uma execução MUST mostrar os avisos do servidor sobre ela (por
  exemplo, nova tentativa depois de um erro passageiro do Hunit, ou hotel que a conta não acessa)
  com horário, hotel e a mensagem como o servidor a escreveu, os mais recentes primeiro. Enquanto
  um hotel estiver em andamento, o aviso mais recente dele, com o horário, aparece junto do hotel.
- **FR-017**: O operador MUST poder cancelar uma execução ativa, com confirmação.
- **FR-018**: O operador MUST poder retomar uma execução interrompida com hotéis pendentes,
  informando o acesso ao Hunit (preenchido se ainda estiver na memória) e o token, e o aplicativo
  MUST mostrar a ligação entre a execução original e a retomada.
- **FR-019**: Ao abrir ou reconectar, o aplicativo MUST mostrar a execução ativa, se houver, no
  estado atual, inclusive retomando o pedido de token com o tempo restante correto.

**Consulta de reservas e evidências**

- **FR-020**: O aplicativo MUST permitir consultar as reservas gravadas combinando os filtros:
  hotel, período de check-in, situação de cobrança, situação da reserva (ativa/cancelada), canal,
  "não encontrada na última verificação" e execução; e localizar uma reserva pelo hotel e número.
- **FR-020a**: O aplicativo MUST oferecer um campo de busca livre que encontra reservas pelo número
  da reserva (sem precisar informar o hotel), nome do hóspede (sem diferenciar maiúsculas e
  acentos, por parte do nome), número da transação, código de autorização ou referência da
  operadora, combinável com os filtros da FR-020.
- **FR-020b**: O aplicativo MUST permitir buscar reservas por valor em reais, encontrando as
  reservas cujo valor total ou valor cobrado seja exatamente o informado, combinável com os demais
  filtros (por exemplo, para conciliar uma linha do extrato da operadora do cartão).
- **FR-021**: A lista de reservas MUST mostrar hotel, número, hóspede, canal, check-in, check-out,
  valor total, situação de cobrança e situação da reserva, e MUST permitir carregar mais resultados
  mantendo os filtros.
- **FR-022**: O detalhe da reserva MUST mostrar os dados da cobrança (data, responsável, valor,
  transação, autorização, parcelamento, estado do pré-pagamento), o motivo da classificação, o que
  mudou desde a verificação anterior e o histórico de verificação (primeira, última, quantidade).
- **FR-023**: As situações de cobrança e da reserva MUST ser exibidas com nomes em português e
  cores consistentes em todo o aplicativo (sucesso, atenção, erro); valores em reais e datas em
  DD/MM/AAAA.
- **FR-024**: O operador MUST poder baixar as evidências de falha de uma execução ou hotel,
  escolhendo onde salvar; evidência expirada MUST ser informada como indisponível.

**Instalação e uso**

- **FR-025**: O aplicativo MUST ser instalável no Windows por um instalador, sem pedir credenciais
  do Hunit na instalação, e MUST mostrar sua versão.
- **FR-026**: Fechar a janela MUST encerrar o aplicativo e descartar usuário e senha da memória; o
  aplicativo MUST NOT continuar rodando em segundo plano na área de notificação. Se houver execução
  ativa iniciada nesta máquina, o aplicativo MUST avisar antes de fechar que a execução continua no
  servidor, mas o pedido de token não será recebido enquanto ele estiver fechado.
- **FR-027**: O aplicativo MUST permitir uma única instância por usuário da máquina.
- **FR-028**: O aplicativo MUST NOT conter regras de negócio: classificação, retomada e demais
  regras ficam no servidor, e o aplicativo apenas exibe o que o servidor informa.

### Key Entities *(include if feature involves data)*

- **Configuração da conexão**: endereço do servidor, chave de acesso e o necessário para confirmar a
  identidade do servidor; guardada por usuário da máquina; a chave fica protegida.
- **Sessão de acesso ao Hunit**: usuário e senha do Hunit mantidos só na memória enquanto o
  aplicativo está aberto e em uso (apagados após 8 horas sem ação); nunca persistidos.
- **Execução** (vinda do servidor): quem iniciou, período, hotéis e seus estados, estado geral,
  prazo do token, andamento, estimativa, contagens por situação e ligação com a execução retomada.
- **Reserva** (vinda do servidor): dados da reserva, situação de cobrança e da reserva, dados da
  cobrança, mudanças desde a verificação anterior e histórico de verificação.
- **Evidência** (vinda do servidor): arquivo de falha vinculado a execução, hotel e, quando houver,
  reserva; disponível por tempo limitado.
- **Preferências locais**: ajustes de uso da máquina (por exemplo, som do aviso ativado), sem
  nenhum dado do Hunit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Com o aplicativo já configurado, o operador inicia uma execução de rotina (todos os
  hotéis, uma semana de check-in) em até 1 minuto a partir da abertura do aplicativo.
- **SC-002**: Em 100% dos pedidos de token, o aviso chega ao operador em até 5 segundos, inclusive
  com o aplicativo minimizado ou atrás de outras janelas.
- **SC-003**: Em homologação, nenhuma execução falha por prazo do token esgotado quando o operador
  está diante da máquina no momento do pedido.
- **SC-004**: Zero ocorrências de usuário, senha ou token do Hunit em qualquer arquivo gravado pelo
  aplicativo na máquina, verificadas por busca depois de um ciclo completo de uso (execução,
  retomada, erro de senha e erro de token); e zero nomes de hóspedes ou dados de cobrança em
  arquivos do aplicativo, exceto as evidências salvas pelo operador.
- **SC-005**: O operador encontra uma reserva específica (pelo número, hóspede, código de
  autorização ou valor de uma linha do extrato da operadora), ou a lista das pendentes de cobrança
  de um hotel numa semana, em até 30 segundos.
- **SC-006**: Depois que o servidor volta a ficar acessível, o aplicativo volta a funcionar sozinho
  em até 30 segundos, sem ser reiniciado.
- **SC-007**: Zero conexões estabelecidas com um servidor cuja identidade não foi confirmada.
- **SC-008**: Uma máquina nova fica pronta para uso (instalação e configuração da conexão) em até
  15 minutos seguindo o guia, sem ajuda técnica.
- **SC-009**: Com uma chave de perfil consulta, nenhuma ação de operador (iniciar, enviar token,
  cancelar, retomar) fica disponível.

## Assumptions

- Os usuários iniciais são 4 pessoas do Financeiro e da Controladoria, cada uma na sua máquina
  Windows (10 ou 11), na mesma rede local do servidor; acesso de fora da rede está fora do escopo,
  como na feature 001. O Comercial, com mais pessoas, poderá usar depois, se o sistema for
  validado; isso não muda esta spec, só a quantidade de chaves e de instalações.
- Quem opera usa uma conta do Hunit com o autenticador correspondente (clarificação de
  2026-11-12): cada pessoa do Financeiro tem a própria conta; a Controladoria usa a conta de perfil
  gerencial dela. Se duas pessoas usarem a mesma conta, vale a regra da 001 de uma execução ativa
  por conta, e o token vem do autenticador dessa conta.
- Cada máquina recebe sua própria chave de acesso, criada no servidor pelo responsável, e é por ela
  que o aplicativo sabe quais execuções foram iniciadas naquela máquina. As 4 máquinas iniciais
  usam o perfil operador; o perfil consulta fica para quem só precisar consultar.
- Os dois perfis da API (operador e consulta) bastam para esta feature. Um modelo de permissões
  mais fino, por ação e por escopo (por exemplo, quais operações e quais dados cada cliente pode
  usar), será necessário na integração com o Sura e fica para a spec dessa integração; ele deve
  entrar como acréscimo, sem quebrar este aplicativo.
- O servidor da feature 001 está implantado com conexão cifrada e certificado emitido pela
  autoridade certificadora interna do servidor; confiar nesse certificado faz parte da
  configuração de cada máquina.
- O que o servidor ainda não oferece e o aplicativo precisar (por exemplo, informar o perfil da
  chave) será acrescentado à API nesta feature, sem quebrar a compatibilidade com a 001.
- A distribuição é feita por instalador, entregue manualmente às máquinas; atualização automática
  fica fora do escopo enquanto forem poucas máquinas (4); deve ser reavaliada se o Comercial
  passar a usar.
- A interface é em português do Brasil.
- A permissão de notificações do Windows pode estar desativada sem que o aplicativo consiga
  detectar; nesse caso vale o aviso dentro do aplicativo (FR-011), e "Testar aviso" na
  configuração permite ao operador conferir (ajuste feito no plano, research R-07).
- Os nomes em português das situações de cobrança seguem os usados na spec 001 (FR-013).
- Relatórios, painéis com gráficos, exportação para planilha, tratativas manuais, importação do
  histórico e sincronização com a planilha do comercial ficam para specs próprias; o resumo por
  situação de cada execução (US1) não é um relatório, é o resultado da execução.
