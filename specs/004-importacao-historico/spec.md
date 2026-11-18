# Feature Specification: Importação do histórico do sistema anterior

**Feature Branch**: `004-importacao-historico`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Importação do histórico do sistema anterior (legado) para o HUNIT Control. O legado rodou por alguns meses antes de parar (o Hunit mudou a interface) e guardava a sua base numa planilha do Google Sheets, com uma aba de reservas (uma linha por hotel + número da reserva, com classificação, situação, valores, datas de primeira e última verificação, quantidade de verificações e situação anterior) e uma aba de tratativas (tratativa "Enviada" e comprovante "Cobrada", com os arquivos anexados guardados numa pasta à parte). Hoje o HUNIT Control só conhece as reservas que ele mesmo verificou desde a feature 001, e as tratativas registradas desde a 003. Sem o histórico, o Financeiro perde a continuidade: não vê reservas antigas ainda pendentes, nem o que já foi enviado ao Comercial ou cobrado, e a futura sincronização com a planilha do Comercial começaria sem a história. O sistema deve permitir importar esse histórico uma vez, com a possibilidade de repetir a importação sem duplicar nada (a chave é hotel + número da reserva). Antes de gravar, deve haver uma simulação que mostra quantas reservas e tratativas seriam criadas, atualizadas, ignoradas ou recusadas, e por quê. Linhas inválidas (hotel desconhecido no catálogo, data ou valor ilegível, classificação sem correspondência) são relatadas e não interrompem as demais. Os hotéis do legado precisam ser associados aos hotéis do catálogo atual. As classificações e situações do legado precisam ser convertidas para as atuais; o que não tiver correspondência vai para uma situação de revisão, sem ser descartado. Quando a reserva já foi verificada pelo HUNIT Control, o dado mais recente do sistema novo prevalece, mas as datas de primeira verificação e a contagem do legado entram no histórico. As tratativas e os comprovantes importados viram tratativas iguais às da feature 003, com os seus documentos, respeitando os tipos e o tamanho máximo já definidos. A auditoria deve indicar que vieram do sistema anterior, com a data original e, se houver, quem registrou. Documentos fora das regras são relatados e não importados. Toda reserva importada fica identificada como vinda do sistema anterior na API e no app desktop. A importação nunca acessa o Hunit e não exige token. Os dados importados seguem a retenção que já existe: 5 anos após o check-in, depois disso anonimizados; os documentos seguem a retenção das tratativas. A planilha e os arquivos de origem contêm dados pessoais e financeiros: nunca são versionados, nem aparecem em logs, mensagens de erro ou relatórios da importação, que mostram só contagens, hotel, número da reserva e o motivo. Os nomes das colunas serão informados pelo usuário durante a especificação, nunca os dados. Quem executa a importação e por onde (no servidor ou pelo app) é uma decisão a tomar na especificação. Fora do escopo: envio das tratativas ao Comercial e sincronização contínua com a planilha do Comercial (spec futura), conciliação com o adquirente, relatórios e painéis, exportação de planilhas e os ajustes pós-homologação do app desktop (som do aviso, notificação, concorrência de hotéis, desligamento dos containers)."

## Contexto

O sistema anterior verificou reservas no Hunit durante alguns meses, até parar de funcionar quando o
Hunit mudou a interface. Toda a sua base ficou numa planilha com duas abas:

- **Reservas**: uma linha por reserva (hotel + número), com os dados lidos do Hunit, a classificação
  de cobrança que o sistema anterior calculou e o acompanhamento das verificações (primeira e última
  verificação, quantidade, status anterior e momento da última mudança de status).
- **Tratativas**: uma linha por reserva com tratativa, com o documento da tratativa (o pedido de
  cobrança, que no sistema anterior deixava a reserva "Enviada"), o comprovante (que a deixava
  "Cobrada"), o valor cobrado informado à mão e as datas de cada registro. Os arquivos ficaram numa
  pasta à parte, referenciados pela planilha.

O HUNIT Control (features 001 a 003) começou do zero: só conhece as reservas que ele mesmo verificou
e as tratativas registradas nele. Sem o histórico, o Financeiro não vê as reservas antigas que ainda
estão pendentes, pode pedir de novo ao Comercial uma cobrança que já foi pedida, e a Controladoria
perde os comprovantes do período anterior. A futura sincronização com a planilha do Comercial também
começaria sem essa história.

Esta feature traz esse histórico para dentro do HUNIT Control, uma vez, de forma conferível antes de
gravar e repetível sem duplicar nada. A importação nunca acessa o Hunit: só lê a planilha e os
arquivos do sistema anterior.

Ficam **fora do escopo** e serão tratados em specs próprias: envio das tratativas ao Comercial e
sincronização contínua com a planilha do Comercial, conciliação com o adquirente, relatórios e
painéis, exportação de planilhas e os ajustes pós-homologação do app desktop (som do aviso,
notificação, concorrência de hotéis, desligamento dos containers).

## Clarifications

### Session 2026-11-16

- Q: Quem faz a importação do histórico, e por onde? → A: Por um comando no servidor, rodado por
  quem administra a implantação; o app desktop só mostra a marcação "Sistema anterior" e os filtros
  (FR-002, FR-019, FR-024).
- Q: Como a planilha do sistema anterior chega ao comando de importação? → A: Uma cópia baixada da
  planilha (.xlsx, com as duas abas) e a pasta de anexos copiada do Dropbox, as duas no computador
  do servidor; sem acesso ao Google (FR-004).
- Q: Como deve aparecer uma reserva cuja classificação do legado não tem equivalente hoje (ex.: "Sem
  cartão virtual")? → A: Numa situação própria, **"A revisar (sistema anterior)"**, fora do "Falta
  cobrar" e com filtro próprio. Uma execução no Hunit que cubra o hotel e o período da reserva a
  reclassifica normalmente, tirando-a dessa situação (FR-007a).
- Q: (Homologação, T043) O relatório da reimportação listava cada linha "já importada" e as
  recusas se perdiam no meio. O que mostrar? → A: Os "já importados sem mudança" viram uma contagem
  por tipo; as recusas e os demais ignorados continuam listados; `report --id <id> --all` mostra a
  lista completa (FR-005).
- Q: (Importação real, T045) 631 reservas da planilha real não têm "Total da reserva", e 123
  tratativas delas seriam recusadas junto. Recusar ou aceitar? → A: Aceitar, com o total vazio até a
  primeira verificação pelo HUNIT Control (FR-008); nunca inventar um valor.
- Q: (Importação real, T045) A importação parou com falha depois de ~24 mil reservas, e o erro
  original se perdeu. O que fazer? → A: A falha de uma reserva deixa só ela de fora e fica no
  relatório e no registro da importação, sem valores; a importação para só com 10 falhas seguidas
  (FR-021). O que o banco recusaria (valor manual zerado, números grandes demais) passa a ser
  recusado já na simulação (FR-015).
- Q: Os nomes de coluna listados na spec batem com o cabeçalho das duas abas da planilha real? → A:
  Sim, os 35 da aba "Reservas" e os 14 da aba "Tratativas", na mesma ordem. O "Codigo hotel" do
  sistema anterior não é o código numérico do Hunit: é um nome em minúsculas separado por "_",
  definido no cadastro de hotéis do sistema anterior (FR-006a).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Simular a importação e conferir o resultado antes de gravar (Priority: P1)

Quem administra a implantação roda o comando de importação no servidor e entrega a ele a planilha do sistema anterior e a pasta com os arquivos
anexados, e associa cada hotel do sistema anterior a um hotel do catálogo atual. O sistema faz uma
**simulação**: lê tudo, confere cada linha e cada arquivo e mostra quantas reservas e tratativas
seriam criadas, atualizadas, ignoradas ou recusadas, e o motivo de cada recusa — sem gravar nada.
Com o relatório em mãos, a pessoa corrige o que for possível (por exemplo, a associação de um hotel)
e simula de novo, até o resultado estar como esperado.

**Why this priority**: a importação é feita uma vez sobre dados pessoais e financeiros que não podem
ser perdidos nem misturados; sem a simulação, um erro de associação de hotel ou de conversão só
apareceria depois de gravado. É também a parte que permite combinar com o Financeiro o que será
importado.

**Independent Test**: com uma planilha fictícia (todos os casos: reservas válidas, hotel não
associado, data e valor ilegíveis, classificação sem correspondência, reserva já verificada pelo
HUNIT Control, tratativa com arquivo ausente, arquivo de tipo não aceito), rodar a simulação e
conferir as contagens e os motivos, e que nenhuma reserva, tratativa ou documento foi gravado.

**Acceptance Scenarios**:

1. **Given** a planilha e a pasta de arquivos do sistema anterior, **When** a simulação é feita,
   **Then** o relatório mostra, separadamente para reservas, tratativas e documentos, quantos seriam
   criados, atualizados, ignorados e recusados, e nada é gravado.
2. **Given** uma linha com hotel sem associação no catálogo, data ilegível ou valor ilegível,
   **When** a simulação é feita, **Then** essa linha aparece como recusada, com hotel, número da
   reserva e o motivo, e as demais linhas são avaliadas normalmente.
3. **Given** hotéis do sistema anterior ainda não associados, **When** a simulação começa, **Then** o
   sistema lista cada hotel do sistema anterior com a quantidade de linhas e a associação proposta
   (quando o nome coincidir com o de um hotel do catálogo, FR-006a), e a pessoa confirma, troca ou
   deixa sem associação cada um.
4. **Given** o relatório da simulação, **When** ele é exibido ou guardado, **Then** contém apenas
   contagens, hotel, número da reserva e motivo — nunca nome de hóspede, valores, dados de cobrança,
   conteúdo ou nome de arquivo.
5. **Given** uma planilha sem alguma coluna obrigatória (FR-003), **When** a simulação é feita,
   **Then** o sistema para antes de avaliar as linhas e diz qual coluna falta.

---

### User Story 2 - Importar as reservas do sistema anterior (Priority: P1)

Depois de conferir a simulação, a pessoa confirma a importação. As reservas do sistema anterior
passam a existir no HUNIT Control com a classificação convertida, os dados que o sistema anterior
leu do Hunit e o acompanhamento das verificações. O Financeiro e a Controladoria as encontram na
consulta de reservas (API e app), identificadas como vindas do sistema anterior, junto com as
verificadas pelo HUNIT Control.

**Why this priority**: é o que devolve ao Financeiro a lista do que ficou pendente no período do
sistema anterior; as tratativas (US3) dependem das reservas.

**Independent Test**: importar uma planilha fictícia, consultar pela API e pelo app e conferir que
as reservas válidas existem com a classificação convertida, a marcação de origem e os dados de
verificação; importar a mesma planilha de novo e conferir que nada foi duplicado e que o resultado
mostra tudo como ignorado (sem mudança).

**Acceptance Scenarios**:

1. **Given** a simulação conferida, **When** a importação é confirmada, **Then** o resultado é o
   mesmo que a simulação mostrou (salvo mudanças feitas no sistema entre as duas, que são relatadas)
   e as reservas válidas passam a ser consultáveis com a marcação "Sistema anterior".
2. **Given** uma reserva que só existe no sistema anterior, **When** ela é importada, **Then** fica
   com a classificação convertida (FR-007), a primeira e a última verificação, a quantidade de
   verificações, o status anterior e o momento da última mudança de status do sistema anterior.
3. **Given** uma reserva que o HUNIT Control já verificou, **When** ela é importada, **Then** os
   dados e a classificação do HUNIT Control prevalecem, a primeira verificação passa a ser a mais
   antiga das duas, a quantidade de verificações soma as duas e o histórico registra a situação que
   o sistema anterior tinha (FR-010).
4. **Given** a importação já feita, **When** a mesma planilha é importada de novo, **Then** nenhuma
   reserva é duplicada e as já importadas sem mudança aparecem como ignoradas.
5. **Given** uma reserva importada, **When** o HUNIT Control a verifica no Hunit depois, **Then** ela
   é atualizada como qualquer reserva (spec 001, FR-017 e FR-018b), mantendo a marcação de origem e
   o histórico do sistema anterior.
6. **Given** uma reserva cuja classificação do sistema anterior não tem correspondência (FR-007),
   **When** ela é importada, **Then** fica "A revisar (sistema anterior)", com a classificação
   original guardada, é encontrada pelo filtro dessa situação e não aparece no "Falta cobrar".
7. **Given** uma reserva "A revisar (sistema anterior)", **When** uma execução no Hunit cobre o hotel
   e o check-in dela, **Then** ela recebe a classificação calculada pelo HUNIT Control, sai de "A
   revisar (sistema anterior)" e o histórico registra a mudança.

---

### User Story 3 - Importar as tratativas e os comprovantes com os documentos (Priority: P2)

Junto com as reservas, as tratativas e os comprovantes do sistema anterior viram tratativas iguais
às registradas no HUNIT Control (spec 003): a reserva aparece como "Tratativa enviada" ou
"Comprovante enviado", os documentos podem ser abertos e baixados, e o histórico mostra que vieram do
sistema anterior, com a data original.

**Why this priority**: evita pedir de novo ao Comercial cobranças já pedidas e devolve à
Controladoria os comprovantes do período anterior; depende das reservas (US2).

**Independent Test**: importar uma planilha fictícia com tratativas, comprovantes, valor manual,
anexo do formato antigo, arquivo ausente e arquivo fora das regras; conferir a situação de cada
reserva, que os documentos baixados são idênticos aos originais, que o histórico mostra "Sistema
anterior" com a data original e que os casos fora das regras foram relatados e não importados.

**Acceptance Scenarios**:

1. **Given** uma reserva com tratativa no sistema anterior, **When** ela é importada, **Then** fica
   com a tratativa como documento atual e a situação da reserva segue a regra da spec 003 (FR-002 e
   FR-002a).
2. **Given** uma reserva com comprovante no sistema anterior, **When** ela é importada, **Then** fica
   "Comprovante enviado", com o comprovante disponível para abrir e baixar, idêntico ao original.
3. **Given** um documento importado, **When** se consulta o histórico da reserva, **Then** o registro
   mostra o autor "Sistema anterior", a data original do registro e o momento da importação.
4. **Given** um arquivo referenciado pela planilha que não está na pasta, que está vazio, de tipo não
   aceito, com conteúdo diferente do tipo declarado ou maior que o limite (spec 003, FR-008),
   **When** a importação é feita, **Then** esse documento não é importado, é relatado com hotel,
   número da reserva, tipo de documento e motivo, e a reserva e o outro documento dela são
   importados normalmente.
5. **Given** um valor cobrado informado à mão no sistema anterior, numa reserva com comprovante,
   **When** ela é importada, **Then** o valor fica como valor manual (spec 003, FR-005), com a data
   original; **Given** um valor manual numa reserva sem comprovante importado, **Then** o valor é
   relatado e não importado.
6. **Given** uma reserva que já tem tratativa ou comprovante registrado no HUNIT Control, **When** o
   documento do mesmo tipo vem do sistema anterior, **Then** o registro do HUNIT Control prevalece e o
   documento do sistema anterior é relatado como ignorado.
7. **Given** a importação repetida, **When** os documentos já importados são encontrados de novo,
   **Then** nada é duplicado e eles aparecem como ignorados.

---

### User Story 4 - Identificar e filtrar o que veio do sistema anterior (Priority: P3)

Quem consulta as reservas (perfil operador ou consulta) vê quais reservas vieram do sistema anterior
e pode filtrar por isso, combinando com os filtros que já existem; no detalhe, vê o que o sistema
anterior registrou (classificação original, verificações) e o resultado da importação daquela
reserva.

**Why this priority**: ajuda a conferir a importação e a distinguir o que o HUNIT Control ainda não
verificou, mas as reservas importadas já são úteis sem o filtro.

**Independent Test**: com reservas importadas, verificadas pelo HUNIT Control e das duas origens,
filtrar por origem (sozinha e combinada com hotel e situação) e conferir os resultados e o detalhe,
pela API e pelo app, com chave de perfil operador e de perfil consulta.

**Acceptance Scenarios**:

1. **Given** reservas de várias origens, **When** se filtra "Sistema anterior", **Then** aparecem só
   as importadas, inclusive as que o HUNIT Control verificou depois.
2. **Given** uma reserva importada, **When** se abre o detalhe, **Then** aparecem a marcação de
   origem, a classificação original do sistema anterior e a data da importação.
3. **Given** uma reserva importada que o HUNIT Control ainda não verificou, **When** se consulta a
   lista, **Then** é possível distinguir que os dados são os do sistema anterior (última verificação
   feita pelo sistema anterior).

### Edge Cases

- **Mesma reserva em duas linhas da aba de reservas** (duplicada na planilha): a linha com a última
  verificação mais recente vale; a outra é relatada como ignorada ("duplicada na planilha").
- **Tratativa de uma reserva que não está na aba de reservas**: o documento é recusado ("reserva sem
  linha na aba de reservas"), a não ser que a reserva já exista no HUNIT Control, caso em que a
  tratativa é importada para ela.
- **Tratativa de uma reserva recusada** (ex.: hotel sem associação): a tratativa também é recusada,
  com o mesmo motivo.
- **Anexo no formato antigo** (o sistema anterior começou com um único anexo por reserva, antes de
  separar tratativa e comprovante): vira comprovante se a classificação original era "pendente de
  cobrança" e tratativa nos demais casos, como o sistema anterior o exibia.
- **Mesmo arquivo usado em várias reservas** (lote no sistema anterior): é importado para cada
  reserva como documento dela, como no lote da spec 003, sem guardar o conteúdo repetido.
- **Classificação original que hoje não aceita tratativa** (ex.: "já cobrada" com tratativa): o
  documento é importado mesmo assim, por ser registro histórico, não um registro novo (a regra da
  spec 003, FR-003, vale só para novos registros); a situação da reserva e o alerta "Verificar"
  seguem a spec 003 (FR-002 e FR-002a).
- **Reserva com check-in há mais de 5 anos**: é importada já anonimizada e sem os documentos, como
  se tivesse passado pela rotina de retenção (spec 001, FR-026; spec 003, FR-016); o relatório conta
  quantas foram nessa condição.
- **Data de primeira verificação posterior à última, ou contagem negativa/ilegível**: a linha é
  recusada com o motivo.
- **Situação ativa/cancelada**: o sistema anterior não a registrava; as reservas importadas ficam com
  a situação "não identificada" (spec 001, FR-014a) até o HUNIT Control verificá-las.
- **Reserva importada que o HUNIT Control não encontra numa verificação posterior**: recebe a
  marcação "não encontrada na última verificação" como qualquer outra (spec 001, FR-018a).
- **Importação interrompida** (servidor desligado, falha no meio): o que foi gravado fica íntegro por
  reserva (nunca uma reserva com tratativa sem documento, nem documento sem registro); repetir a
  importação completa o resto, sem duplicar.
- **Uma execução no Hunit em andamento durante a importação**: as duas podem acontecer; se ambas
  tocarem a mesma reserva, vale a regra de precedência (FR-010) e o resultado final é o mesmo,
  qualquer que seja a ordem.
- **Planilha de outra versão do sistema anterior** (sem as colunas mais novas, como o valor manual):
  as colunas opcionais ausentes são tratadas como vazias; só a falta de colunas obrigatórias
  impede a importação (FR-003).
- **Arquivo da pasta que nenhuma linha referencia**: não é importado; o relatório conta quantos
  sobraram, sem nomes.

## Requirements *(mandatory)*

### Functional Requirements

**Origem e execução**

- **FR-001**: O sistema MUST permitir importar o histórico do sistema anterior a partir da planilha
  (aba de reservas e aba de tratativas) e da pasta com os arquivos anexados. A importação MUST NOT
  acessar o Hunit nem exigir credenciais ou token do Hunit.
- **FR-002**: A simulação e a importação MUST ser executadas por um **comando no servidor**, rodado
  por quem administra a implantação, no próprio computador do servidor. Os arquivos de origem MUST
  NOT trafegar pela rede nem passar pela API ou pelo app desktop. A API e o app MUST NOT oferecer
  simular nem importar; eles só mostram o resultado (FR-011 e FR-024).
- **FR-003**: O sistema MUST reconhecer as colunas das duas abas pelos nomes do cabeçalho (seção
  "Colunas da planilha de origem"), em qualquer ordem. A falta de uma coluna obrigatória MUST
  impedir a simulação e a importação, informando qual falta; colunas opcionais ausentes são tratadas
  como vazias e colunas desconhecidas são ignoradas.
- **FR-004**: A planilha MUST ser fornecida como uma **cópia baixada** em .xlsx, com a aba de
  reservas e a aba de tratativas, e os anexos como uma **pasta copiada** do armazenamento do sistema
  anterior, com os caminhos que a planilha referencia; as duas no computador do servidor. A
  importação MUST NOT acessar o Google nem exigir credencial do Google. A simulação e a importação
  confirmada MUST ler a mesma cópia (FR-005a).

**Simulação e relatório**

- **FR-005**: Antes de gravar, MUST existir uma **simulação** que avalia todas as linhas e arquivos
  exatamente como a importação faria e MUST NOT gravar nada. O relatório MUST mostrar, para reservas,
  tratativas, comprovantes e valores manuais, quantos seriam **criados**, **atualizados**,
  **ignorados** (já importados sem mudança, duplicados ou com registro do HUNIT Control que
  prevalece) e **recusados**, e a lista dos ignorados e recusados com hotel, número da reserva e
  motivo. Os ignorados por já estarem importados sem mudança MUST aparecer resumidos numa contagem
  por tipo, para as recusas não se perderem numa reimportação; a lista completa MUST continuar
  guardada e ser mostrada a pedido.
- **FR-005a**: A importação MUST só ser confirmada sobre uma simulação feita com a mesma planilha, a
  mesma pasta e a mesma associação de hotéis. O resultado da importação MUST usar o mesmo formato do
  relatório da simulação e apontar as diferenças em relação a ela.
- **FR-006**: Uma linha ou um documento inválido MUST ser recusado com o motivo sem interromper os
  demais. Motivos mínimos: hotel sem associação, data ilegível, valor ilegível, dado obrigatório
  ausente, datas incoerentes, duplicada na planilha, reserva sem linha na aba de reservas, arquivo
  ausente, arquivo vazio, tipo não aceito, conteúdo diferente do tipo, arquivo acima do limite e valor
  manual sem comprovante.

**Hotéis e conversão**

- **FR-006a**: Cada hotel do sistema anterior (identificado pelo código e pelo nome da planilha) MUST
  ser associado a um hotel do catálogo atual (spec 001, FR-008) antes da importação. O código do
  sistema anterior é um nome em minúsculas separado por "_" (não o código do Hunit), por isso a
  comparação é pelo nome: o sistema MUST propor a associação quando o nome do hotel (coluna "Hotel")
  ou o código do sistema anterior coincidir com o nome de um hotel do catálogo, desconsiderando
  maiúsculas, acentos, espaços e "_"; e quem conduz a
  importação MUST poder confirmar, trocar ou deixar sem associação cada um. As linhas de um hotel sem
  associação são recusadas. A associação confirmada MUST ser guardada para as importações repetidas.
- **FR-007**: A classificação do sistema anterior (coluna "Codigo status"; o rótulo da coluna
  "Status" é só informativo) MUST ser convertida para a atual (spec 001, FR-013) assim:

  | Sistema anterior (código — rótulo) | HUNIT Control |
  |---|---|
  | `ignored_hotelbeds_258` — Ignorada - prefixo 258 | ignorada |
  | `virtual_card_already_charged` — Pre-pagamento cobrado | já cobrada |
  | `virtual_card_pending_charge` — Pre-pagamento pendente | pendente de cobrança |
  | `virtual_card_charge_error` — Erro na cobranca | erro na cobrança |
  | `analysis_error` — Erro de analise | erro de análise |
  | `not_virtual_card` — Sem cartao virtual | A revisar (sistema anterior) — sem correspondência: o sistema anterior não registrava a forma de pagamento, que hoje separa faturada, cobrar na maquininha, cancelada sem cobrança e erro de análise |
  | Qualquer outra | A revisar (sistema anterior) |

  A coluna "Status anterior" é convertida pela mesma tabela, aceitando o código ou o rótulo.
- **FR-007a**: A situação de revisão MUST ser uma situação própria, **"A revisar (sistema
  anterior)"**, exibida como status do Hunit da reserva (spec 003, FR-002). Ela MUST NOT entrar no
  atalho "Falta cobrar" (spec 003, FR-002) e MUST ter um filtro próprio na situação da reserva (spec
  003, FR-015). A reserva MUST guardar a classificação original e MUST aceitar tratativa e
  comprovante (exceção à spec 003, FR-003). Com só a tratativa, a situação da reserva MUST continuar
  "A revisar (sistema anterior)", sem o alerta "Verificar" (não se sabe ainda se exige cobrança);
  com comprovante, "Comprovante enviado" (spec 003, FR-002). Uma execução no Hunit (spec 001) que cubra o hotel e o
  check-in da reserva MUST reclassificá-la normalmente: a classificação nova substitui "A revisar
  (sistema anterior)" e a mudança fica no histórico (spec 001, FR-018b). Se a execução não a
  encontrar, ela recebe a marcação "não encontrada na última verificação" (spec 001, FR-018a) e
  continua "A revisar (sistema anterior)".
- **FR-008**: As reservas importadas MUST ficar com a situação ativa/cancelada "não identificada"
  (spec 001, FR-014a) até serem verificadas pelo HUNIT Control, e MUST guardar os dados que o sistema
  anterior leu do Hunit e que o HUNIT Control também guarda (spec 001, FR-016). Sem "Total da
  reserva" na planilha, a reserva MUST ser importada com o total vazio (mostrado como "—"), nunca com
  um valor inventado; a primeira verificação pelo HUNIT Control o preenche.

**Reservas**

- **FR-009**: A reserva MUST ser identificada por hotel (do catálogo atual, depois da associação) +
  número da reserva (spec 001, FR-017). Importar de novo MUST NOT duplicar reservas, tratativas,
  documentos nem registros do histórico.
- **FR-010**: Quando a reserva já tiver sido verificada pelo HUNIT Control, os dados e a
  classificação do HUNIT Control MUST prevalecer, e: a primeira verificação MUST passar a ser a mais
  antiga entre as duas; a quantidade de verificações MUST somar as do sistema anterior; a última
  verificação, os campos alterados e o status anterior continuam os do HUNIT Control; e o histórico
  da reserva MUST registrar a classificação, a primeira e a última verificação e a contagem do
  sistema anterior, identificadas como tal.
- **FR-010a**: Reimportar uma reserva já importada e ainda não verificada pelo HUNIT Control MUST
  atualizá-la com os dados da planilha (se mudaram) ou ignorá-la (se não mudaram). Uma reserva
  importada que o HUNIT Control já verificou segue FR-010.
- **FR-011**: Toda reserva importada MUST ficar com a marcação de origem **"Sistema anterior"** e a
  data da importação, mantidas mesmo depois de verificações pelo HUNIT Control. A API e o app MUST
  mostrar essa marcação e a classificação original do sistema anterior, e a consulta MUST permitir
  filtrar por origem, combinando com os filtros existentes.

**Tratativas e documentos**

- **FR-012**: A tratativa e o comprovante do sistema anterior MUST virar tratativa e comprovante da
  reserva como na spec 003 (FR-001), com os documentos guardados pelo servidor como os demais (spec
  003, FR-010 e FR-011), e a situação da reserva derivada pela regra da spec 003 (FR-002 e FR-002a).
  O anexo no formato antigo MUST virar comprovante quando a classificação original era "pendente de
  cobrança" e tratativa nos demais casos.
- **FR-013**: Os documentos importados MUST respeitar os tipos e o tamanho máximo da spec 003
  (FR-008); os que não respeitarem MUST ser relatados e não importados, sem impedir a reserva nem o
  outro documento dela. O documento baixado MUST ser idêntico ao arquivo de origem, com o nome
  original informado pela planilha (spec 003, FR-009); se a planilha não trouxer o nome original,
  ou trouxer um nome inválido, vale o nome do arquivo na pasta.
- **FR-014**: Quando a reserva já tiver tratativa (ou comprovante) registrada no HUNIT Control, o
  registro do HUNIT Control MUST prevalecer e o documento do mesmo tipo vindo do sistema anterior MUST
  ser relatado como ignorado. Um documento que já foi importado (mesmo conteúdo, mesma reserva, mesmo
  tipo) MUST ser ignorado na reimportação; se o conteúdo mudou e o documento atual veio de uma
  importação anterior, o novo MUST substituí-lo (spec 003, FR-004), com o registro no histórico.
- **FR-015**: O valor cobrado informado à mão no sistema anterior MUST virar valor manual (spec 003,
  FR-005), com a data original, quando a reserva tiver comprovante depois da importação; caso
  contrário MUST ser relatado e não importado. Valor manual igual a zero MUST ser recusado com o
  motivo, já na simulação (o HUNIT Control só aceita valor maior que zero).
- **FR-016**: Cada registro importado MUST entrar no histórico da reserva (spec 003, FR-012) como
  vindo do **sistema anterior**, com a data original do registro na planilha e o momento da
  importação, com o autor **"Sistema anterior"** (não um cliente da API: a planilha não informa
  quem registrou cada documento). Os registros importados MUST seguir as mesmas regras dos demais: podem ser
  substituídos, desfeitos e revertidos (spec 003, FR-004 e FR-013a).
- **FR-017**: A regra de elegibilidade para novos registros (spec 003, FR-003) MUST NOT impedir a
  importação de um documento: a importação registra o histórico, não uma ação nova.

**Segurança e dados**

- **FR-018**: A planilha, os arquivos de origem e qualquer cópia temporária deles MUST NOT ser
  versionados nem ficar guardados depois da importação fora do que foi importado. Logs, mensagens de
  erro, relatórios da simulação e da importação MUST mostrar só contagens, a aba e o número da linha
  da planilha, hotel, número da reserva, tipo de documento e o motivo — nunca nome de hóspede, valores, dados de cobrança, nome ou conteúdo
  de arquivo, nem o conteúdo de uma célula.
- **FR-019**: Só quem tem acesso ao comando no computador do servidor MUST poder simular e importar
  (FR-002); nenhum cliente da API, de perfil operador ou consulta, MUST poder fazê-lo. Os dois perfis
  MUST ver a marcação de origem e o histórico importado como os demais dados.
- **FR-020**: A importação MUST NOT acontecer ao mesmo tempo que outra importação; uma segunda
  tentativa MUST ser recusada com o motivo enquanto a primeira não terminar.
- **FR-021**: Uma reserva (com suas tratativas, documentos e valor manual) MUST ser importada por
  inteiro ou não ser importada; uma importação interrompida MUST poder ser repetida até o fim, sem
  duplicar nada (FR-009). Uma falha inesperada ao gravar uma reserva MUST deixar só ela de fora e
  aparecer no relatório e no registro da importação com a aba, a linha, a chave e a causa técnica
  (código do erro e regra do banco, nunca valores); a importação MUST parar só depois de 10 falhas
  seguidas.

**Retenção**

- **FR-022**: Os dados importados MUST seguir a retenção que já existe: os da reserva por 5 anos após
  o check-in e depois anonimizados (spec 001, FR-026 e FR-027); os documentos pela retenção das
  tratativas (spec 003, FR-013 e FR-016). Uma reserva com check-in há mais de 5 anos na data da
  importação MUST ser importada já anonimizada e sem os arquivos dos documentos, mantendo o registro
  de que houve tratativa ou comprovante.
- **FR-023**: Os dados importados MUST entrar nas cópias de segurança diárias cifradas e na
  restauração (spec 001, FR-030 e FR-031), como os demais.

**App desktop**

- **FR-024**: O app MUST mostrar, na lista e no detalhe das reservas, a marcação "Sistema anterior";
  no detalhe, a classificação original e a data da importação; no histórico, os registros importados
  identificados como do sistema anterior com a data original; e MUST oferecer o filtro por origem e a
  situação "A revisar (sistema anterior)" no filtro "Situação da reserva".

### Colunas da planilha de origem

Os nomes abaixo são os do cabeçalho da planilha real, conferidos pelo usuário em 2026-11-16, na
ordem em que aparecem. Obrigatórias marcadas com (*). O "Codigo hotel" é o identificador do hotel
no sistema anterior (nome em minúsculas separado por "_"), não o código do Hunit (FR-006a).

**Aba de reservas**: Codigo hotel (*), Hotel (*), Reserva (*), Hospede, Canal, Entrada (*), Saida
(*), Periodo da hospedagem, Total da reserva, Codigo status (*), Status, Motivo, Pre-pagamento encontrado,
Cobranca registrada, Cobrado em, Cobrado por, Valor cobrado, ID da transacao, Codigo de autorizacao,
Referencia do processador, Parcelado, Numero de parcelas, Valor da parcela, Estado do pre-pagamento,
Mensagem do pre-pagamento, Acao de cobranca visivel, Requer tratamento manual, Primeira verificacao
(*), Ultima verificacao (*), Quantidade de verificacoes (*), Dados alterados na ultima verificacao,
Campos alterados, Status alterado na ultima verificacao, Status anterior, Ultima alteracao de status.

**Aba de tratativas**: Codigo hotel (*), Reserva (*), Tratativa - arquivo no Dropbox, Tratativa -
nome original, Tratativa anexada em, Comprovante - arquivo no Dropbox, Comprovante - nome original,
Comprovante anexado em, Anexo antigo - arquivo no Dropbox, Anexo antigo - nome original, Anexo antigo
em, Atualizado em, Valor manual, Valor manual alterado em.

A aba de tratativas não tem coluna de quem registrou: nesse caso, o histórico mostra só "Sistema
anterior" como origem (FR-016).

### Key Entities *(include if feature involves data)*

- **Importação**: cada simulação ou importação feita pelo comando no servidor; quando, se foi
  simulação ou importação confirmada, a associação de hotéis usada, as contagens por resultado e a
  lista de ignorados e recusados (hotel, número, tipo, motivo). Não guarda dados da planilha nem dos
  arquivos.
- **Associação de hotel**: liga um hotel do sistema anterior (código e nome) a um hotel do catálogo
  atual, ou o deixa sem associação; reaproveitada nas importações repetidas.
- **Reserva** (da spec 001): ganha a marcação de origem "Sistema anterior", a data da importação, a
  classificação original e, quando for o caso, a situação "A revisar (sistema anterior)".
- **Registro do sistema anterior no histórico**: entrada do histórico da reserva com o que o sistema
  anterior tinha (classificação, primeira e última verificação, contagem), quando o HUNIT Control
  já conhecia a reserva.
- **Tratativa, Documento e Evento de tratativa** (da spec 003): ganham a origem "sistema anterior",
  a data original do registro e o autor "Sistema anterior".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das linhas da planilha aparecem no relatório da simulação em exatamente um
  resultado (criada, atualizada, ignorada ou recusada); zero linhas perdidas sem explicação.
- **SC-002**: A simulação grava zero reservas, tratativas e documentos.
- **SC-003**: Importar a mesma planilha duas vezes resulta em zero reservas, tratativas, documentos
  ou registros de histórico duplicados; na segunda vez, tudo aparece como ignorado.
- **SC-004**: 100% dos documentos importados baixam idênticos aos arquivos de origem.
- **SC-005**: Zero acessos ao Hunit durante a simulação e a importação.
- **SC-006**: Zero ocorrências de nome de hóspede, valor, dado de cobrança, nome ou conteúdo de
  arquivo nos logs, mensagens de erro e relatórios da importação (conferido com uma planilha fictícia
  de valores marcados).
- **SC-007**: Para as reservas que o HUNIT Control já verificou, 100% mantêm a classificação e os
  dados do HUNIT Control depois da importação, com a primeira verificação e a contagem corrigidas.
- **SC-008**: A simulação de uma planilha de 20 000 reservas com 2 000 documentos termina em até 5
  minutos, e a importação confirmada em até 15 minutos.
- **SC-009**: Depois da importação, o Financeiro encontra as reservas antigas pendentes pelo atalho
  "Falta cobrar" (spec 003), junto com as verificadas pelo HUNIT Control, sem consultar o sistema
  anterior.

## Assumptions

- O sistema anterior parou de funcionar e a planilha não muda mais; a importação repetida serve para
  corrigir recusas (por exemplo, uma associação de hotel) e completar uma importação interrompida,
  não para sincronizar.
- Quem administra a implantação baixa a cópia .xlsx da planilha e copia a pasta de anexos para o
  computador do servidor, fora do repositório; depois da importação, apaga as duas cópias (FR-018).
- O volume é o de alguns meses do sistema anterior: alguns milhares de reservas e algumas centenas
  de documentos (as metas de SC-008 cobrem com folga).
- Os dados da planilha foram lidos do Hunit pelo sistema anterior; não há como conferi-los de novo
  sem acessar o Hunit. Uma nova verificação pelo HUNIT Control corrige o que estiver desatualizado.
- O sistema anterior não registrava a situação ativa/cancelada nem a forma de pagamento; por isso as
  reservas importadas ficam com a situação "não identificada" e "Sem cartão virtual" não tem
  correspondência direta (FR-007).
- O sistema anterior não registrava quem anexou cada documento; quando a planilha não informa, a
  auditoria mostra "Sistema anterior" como origem e o momento da importação.
- A importação é feita uma vez, por quem administra a implantação (hoje, a mesma pessoa que
  desenvolve), no computador do servidor; o Financeiro não precisa operá-la.
- A aba de tratativas é a fonte das tratativas; a aba de controle oculta do sistema anterior não é
  importada.
- A API cresce só com acréscimos, sem quebrar o app desktop atual nem os clientes das features
  anteriores.
- Os nomes em português das classificações seguem a spec 001 (FR-013); as situações e os nomes das
  tratativas seguem a spec 003.
