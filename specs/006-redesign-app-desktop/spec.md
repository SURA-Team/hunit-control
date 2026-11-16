# Feature Specification: Redesign visual do app desktop

**Feature Branch**: `006-redesign-app-desktop`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Levar para o app desktop o design oficial da UX (arquivo Hunit Control no Figma): (1) nova identidade visual em todas as telas — fundo cinza claro, conteúdo em cards brancos de cantos bem arredondados e sombra suave, sem bordas; menu lateral flutuante com ícones, com o item ativo numa pílula preta com o ícone em lima; cabeçalho transparente com a marca nova (H lima no quadrado preto) e o cliente num selo branco; fonte Manrope, títulos maiores e números grandes nos indicadores; paleta monocromática com um único acento, o lima. (2) Hierarquia de botões e cores: preto é a ação principal (uma por bloco), lima é a principal só em fundo escuro, contorno é secundária, só texto é cancelar ou sair, âmbar é atenção e vermelho é destrutiva; ações destrutivas ('Limpar acesso', 'Desfazer', 'Remover valor' em vermelho suave; 'Sim, cancelar' em vermelho cheio) nunca parecem seguras; Baixar, Reverter e Desfazer com cores e ícones diferentes; 'Cancelar' só em texto nos diálogos; 'Substituir tratativa' e 'Substituir comprovante' com o mesmo peso; sai o botão 'Leve'. (3) Listas: reservas com 5 colunas (hóspede, hotel, período, valor, situação), duas linhas de texto em cada, coluna única 'Situação da reserva' com o selo 'Verificar' em âmbar cheio quando precisa; filtros viram uma busca, um botão 'Filtros' (painel) e filtros rápidos com contagem (Todas · Falta cobrar · A verificar · Com erro · Concluídas); linha inteira clicável com seta e a linha aberta ou marcada em lima suave; execuções com a que está em andamento num card escuro no topo, com progresso, e o resto no 'Histórico'; hotéis e documentos como linhas simples; estado vazio com ícone, explicação e 'Limpar busca e filtros'. (4) Seleção em lote: caixa de seleção preta com check em lima e cabeçalho com estado parcial; barra escura de seleção com o total e as ações, e 'Anexar comprovante' em lima; no diálogo de anexar, ícone verde para as reservas aceitas e âmbar para as ignoradas. (5) Detalhes da reserva: quadro 'Status do Hunit' com selo e 'Classificação anterior'; valor salvo (com Remover) separado do campo 'Corrigir o valor' com 'Informar valor' em preto; histórico com 5 itens e 'Mostrar mais'; card 'Verificações'; tela nova com o alerta 'Verificar', 'Confirmar' em preto e anexos desabilitados com a explicação do motivo. (6) Organização e consistência: o que se repete é componente único, para que uma mudança valha para todas as telas."

## Contexto

O app desktop (feature 002) e as tratativas manuais (feature 003) entregaram tudo o que o Financeiro e
a Controladoria precisam fazer, mas a interface cresceu por camadas: tabelas com 9 ou 10 colunas, um
card grande de filtros, botões que se parecem mesmo quando fazem coisas diferentes (ou o contrário) e
nenhuma identidade própria. A UX trabalhou uma versão nova de todas as telas — o **design oficial**,
mantido no arquivo "Hunit Control" do Figma — justificada por princípios de usabilidade (menos carga
de leitura, uma ação principal por bloco, ações destrutivas inconfundíveis, o que importa em destaque).

Esta feature leva esse design para o app. É uma mudança de **apresentação e de organização da
informação**: o que cada tela faz, as regras de negócio, os perfis de acesso e a API não mudam.
Onde o design pede algo que o app ainda não oferece (os filtros rápidos com contagem, o painel de
filtros, o histórico de execuções, a tela de alerta "Verificar"), a feature entrega o comportamento
descrito aqui, sempre sobre dados que o servidor já informa.

O espelho do app no Figma (feature de manutenção das telas) passa a ser comparado com o design
oficial: a feature termina quando os dois mostram as mesmas telas.

Ficam **fora do escopo**: novas funções de negócio, mudança de permissões, tema escuro, versão para
outros sistemas operacionais além do Windows, e qualquer mudança no servidor ou no contrato da API.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reconhecer o app e navegar com a nova identidade (Priority: P1)

Quem abre o app vê a identidade nova em todas as telas: fundo claro, conteúdo agrupado em cards
brancos, menu lateral com ícones em que a área atual é inconfundível, cabeçalho com a marca do
HUNIT Control e o nome do cliente conectado. A cor é usada com economia: só o que importa a recebe.

**Why this priority**: é a base de todo o resto. Cores, tipografia, cards e menu são compartilhados por
todas as telas; sem ela, as demais mudanças não têm onde se apoiar, e entregá-la sozinha já deixa o app
coeso.

**Independent Test**: abrir o app e percorrer todas as áreas do menu; conferir, lado a lado com o
design oficial, o fundo, os cards, o menu, o cabeçalho, a tipografia e a paleta de cada tela.

**Acceptance Scenarios**:

1. **Given** o app aberto em qualquer área, **When** a pessoa olha o menu lateral, **Then** vê um item
   por área, cada um com ícone e nome, e o item da área atual destacado como pílula preta com o ícone
   em lima.
2. **Given** qualquer tela, **When** ela é exibida, **Then** o conteúdo está em cards brancos sobre
   fundo cinza claro, sem bordas entre os grupos, e o cabeçalho mostra a marca nova e o cliente
   conectado num selo branco.
3. **Given** qualquer tela com indicadores numéricos (por exemplo, o resumo de uma execução), **When**
   ela é exibida, **Then** os números aparecem em tamanho grande, maior que o texto corrido.
4. **Given** todas as telas do app, **When** se procura cor além de preto, tons de cinza e lima,
   **Then** ela só aparece com significado fixo: verde (concluído/aceito), âmbar (atenção) e vermelho
   (erro ou ação destrutiva).
5. **Given** o computador sem acesso à internet, **When** o app abre, **Then** a fonte e os ícones da
   identidade aparecem normalmente.

---

### User Story 2 - Achar e abrir reservas numa lista mais enxuta (Priority: P1)

O operador consulta as reservas muitas vezes por dia. A lista mostra só o que decide a leitura —
hóspede, hotel, período, valor e situação —, com duas linhas de texto em cada coluna. Uma busca, um
botão "Filtros" e filtros rápidos com contagem trazem o que ele quer em um toque. Clicar em qualquer
ponto da linha abre os detalhes.

**Why this priority**: é a tela de uso diário. A leitura rápida da lista e a busca direta do que falta
cobrar são o ganho de produtividade que motivou o redesenho.

**Independent Test**: com reservas gravadas em várias situações, abrir a lista, usar a busca, cada
filtro rápido e o painel de filtros, e abrir uma reserva clicando na linha; conferir colunas, contagens
e destaque de cada passo com o design oficial.

**Acceptance Scenarios**:

1. **Given** a lista de reservas, **When** é exibida, **Then** tem exatamente cinco colunas — hóspede,
   hotel, período, valor e situação —, cada uma com até duas linhas de texto, e nenhum dado que estava
   nas colunas antigas se perde: o que saiu da lista continua disponível nos detalhes da reserva.
2. **Given** uma reserva que pede verificação, **When** aparece na lista, **Then** a coluna única
   "Situação da reserva" mostra a situação e, ao lado, o selo "Verificar" em âmbar cheio, mais forte
   que os demais selos.
3. **Given** a lista, **When** a pessoa escolhe um dos filtros rápidos (Todas, Falta cobrar, A
   verificar, Com erro, Concluídas), **Then** a lista mostra só as reservas daquele grupo e cada filtro
   exibe quantas reservas tem, considerando a busca e os filtros em vigor.
4. **Given** a lista, **When** a pessoa aciona "Filtros", **Then** abre um painel com os filtros
   detalhados (hotel, período, classificação, canal, valor e demais que o app já oferece) e, ao
   aplicar, a lista e as contagens acompanham.
5. **Given** a lista, **When** a pessoa clica em qualquer ponto da linha (fora da caixa de seleção),
   **Then** os detalhes da reserva abrem, a linha aberta fica em lima suave e a seta no fim da linha
   deixa claro que ela abre algo.
6. **Given** uma busca ou combinação de filtros sem resultado, **When** a lista é exibida, **Then**
   aparece o estado vazio com ícone, a explicação de que nada foi encontrado e o botão "Limpar busca e
   filtros", que restaura a lista completa.
7. **Given** nomes longos de hóspede ou de hotel, **When** a lista é exibida, **Then** o texto é
   cortado dentro das duas linhas, sem quebrar o layout, e o nome completo é visto nos detalhes.

---

### User Story 3 - Ver a hierarquia das ações de relance (Priority: P2)

Em cada bloco de tela há uma ação principal evidente, e cada cor de botão significa uma única coisa.
Ações que desfazem, removem ou cancelam não se parecem com ações seguras, e botões que fazem coisas
diferentes não se parecem entre si.

**Why this priority**: reduz erros e hesitação, mas depende da identidade da história 1 e se aplica
sobre telas já existentes.

**Independent Test**: percorrer todas as telas e diálogos e classificar cada botão pelo design oficial
(principal, secundária, cancelar/sair, atenção, destrutiva); conferir que cada bloco tem no máximo uma
ação principal e que cada botão da lista de ajustes tem a aparência pedida.

**Acceptance Scenarios**:

1. **Given** qualquer bloco de tela ou diálogo, **When** exibido, **Then** tem no máximo uma ação
   principal: preta em fundo claro, lima em fundo escuro.
2. **Given** ações secundárias, **When** exibidas, **Then** usam contorno; "Cancelar" e "Sair" usam só
   texto; avisos e ações de atenção usam âmbar.
3. **Given** "Limpar acesso", "Desfazer" e "Remover valor", **When** exibidos, **Then** aparecem em
   vermelho suave; **Given** a confirmação de cancelar uma execução, **Then** "Sim, cancelar" aparece
   em vermelho cheio.
4. **Given** uma reserva com documentos, **When** os botões "Baixar", "Reverter" e "Desfazer" aparecem,
   **Then** cada um tem cor e ícone próprios, de modo que não se confundem.
5. **Given** um diálogo com "Cancelar" e "Escolher outro arquivo", **When** exibido, **Then** o primeiro
   é só texto e o segundo tem contorno, pois fazem coisas diferentes.
6. **Given** uma reserva com tratativa e comprovante, **When** "Substituir tratativa" e "Substituir
   comprovante" aparecem, **Then** têm o mesmo peso visual.
7. **Given** o app inteiro, **When** se procura o botão "Leve" (lima suave), **Then** ele não existe
   mais; o lima fica reservado a destaque e seleção.

---

### User Story 4 - Operar um lote de reservas pela barra de seleção (Priority: P2)

O operador marca várias reservas e uma barra escura mostra quantas estão marcadas e as ações do lote,
com "Anexar comprovante" em destaque. No diálogo de anexar, ele vê de relance quais reservas serão
aceitas e quais serão ignoradas, antes de confirmar.

**Why this priority**: o lote é o fluxo de maior ganho de tempo da feature 003; o novo visual deixa o
estado da seleção e o resultado esperado inequívocos.

**Independent Test**: marcar reservas de situações variadas, conferir a caixa de seleção, o estado
parcial do cabeçalho, a barra e o diálogo de anexar com aceitas e ignoradas.

**Acceptance Scenarios**:

1. **Given** a lista, **When** a pessoa marca uma reserva, **Then** a caixa fica preta com o check em
   lima e a linha fica em lima suave; **When** marca só parte das visíveis, **Then** a caixa do
   cabeçalho mostra o estado parcial.
2. **Given** nenhuma reserva marcada, **When** a lista é exibida, **Then** a barra de seleção não
   aparece; **When** há reservas marcadas, **Then** aparece uma barra escura com o total marcado e as
   ações do lote, com "Anexar comprovante" em lima.
3. **Given** reservas marcadas, **When** a pessoa abre o diálogo de anexar, **Then** o resumo mostra
   um ícone verde para as reservas aceitas e um âmbar para as ignoradas, com a quantidade de cada
   grupo, antes da confirmação.
4. **Given** a seleção em andamento, **When** a pessoa muda de busca, filtro ou página, **Then** a
   seleção continua como já funciona hoje (feature 003) e a barra mantém o total correto.

---

### User Story 5 - Entender e corrigir uma reserva nos detalhes (Priority: P2)

Ao abrir uma reserva, a pessoa vê o que o Hunit informa separado do que o Financeiro registrou: o
quadro "Status do Hunit" com a classificação atual e a anterior, o valor salvo separado do campo para
corrigi-lo, o histórico resumido e as verificações. Quando a reserva pede verificação, uma tela própria
explica o que fazer e por que os anexos estão desabilitados.

**Why this priority**: a gaveta de detalhes é onde o erro custa mais (valor errado, anexo na reserva
errada); separar o que é do Hunit do que é da pessoa e explicar o que está bloqueado previne isso.

**Independent Test**: abrir reservas de cada situação (comum, com valor salvo, com muito histórico,
"Verificar") e conferir cada bloco com o design oficial, incluindo o comportamento de "Mostrar mais" e
da confirmação de verificação.

**Acceptance Scenarios**:

1. **Given** os detalhes de uma reserva, **When** abertos, **Then** o quadro "Status do Hunit" mostra
   a situação atual com selo e, quando mudou, a "Classificação anterior".
2. **Given** uma reserva com valor salvo manualmente, **When** os detalhes abrem, **Then** o valor
   salvo aparece de um lado, com a ação "Remover", e o campo "Corrigir o valor" aparece à parte, com
   "Informar valor" como ação principal em preto; digitar no campo não altera o valor salvo até
   confirmar.
3. **Given** uma reserva com mais de 5 itens no histórico, **When** os detalhes abrem, **Then** são
   mostrados os 5 mais recentes e o botão "Mostrar mais" revela os demais.
4. **Given** os detalhes de uma reserva, **When** abertos, **Then** o card "Verificações" mostra as
   verificações da reserva.
5. **Given** uma reserva que pede verificação, **When** os detalhes abrem, **Then** aparece um alerta
   "Verificar" com "Confirmar" como ação principal em preto, e os botões de anexar tratativa e
   comprovante aparecem desabilitados com a explicação do motivo ao lado; **When** a pessoa confirma,
   **Then** o alerta some e os anexos voltam a ficar disponíveis.

---

### User Story 6 - Acompanhar execuções e consultar hotéis e documentos (Priority: P3)

A execução em andamento ganha um card escuro no topo, com o progresso; as demais ficam num
"Histórico". Hotéis e documentos aparecem como linhas simples, com nome, uma linha de resumo e a
situação.

**Why this priority**: melhora a leitura de telas de uso menos frequente que a lista de reservas; pode
vir por último sem prejudicar o resto.

**Independent Test**: com uma execução em andamento e várias concluídas, abrir a área de execuções;
abrir as áreas de hotéis e de documentos e conferir com o design oficial.

**Acceptance Scenarios**:

1. **Given** uma execução em andamento, **When** a área de execuções é exibida, **Then** ela aparece
   num card escuro no topo, com o hotel atual, o progresso e o tempo estimado, e a ação principal em
   lima.
2. **Given** execuções já encerradas, **When** a área é exibida, **Then** ficam na seção "Histórico".
3. **Given** nenhuma execução em andamento, **When** a área é exibida, **Then** não aparece o card
   escuro e o histórico ocupa a tela.
4. **Given** as áreas de hotéis e de documentos, **When** exibidas, **Then** cada item é uma linha
   simples com o nome, uma linha de resumo e a situação, sem colunas vazias.

---

### Edge Cases

- Mais de uma execução em andamento ao mesmo tempo (contas diferentes): todas aparecem em destaque no
  topo, cada uma no seu card escuro, sem quebrar o layout.
- Janela estreita: a lista de reservas e o menu continuam utilizáveis, sem rolagem horizontal da
  página; o menu pode se recolher mostrando só os ícones.
- Reserva com valor ausente, período incompleto ou hotel sem nome legível: a célula mostra um
  marcador neutro, nunca fica em branco nem desalinha a linha.
- Contagem dos filtros rápidos com muitas reservas: o número é mostrado de forma abreviada se não
  couber, sem esconder o rótulo.
- O servidor fica indisponível com a lista aberta: o aviso "dados de HH:MM — servidor indisponível"
  da feature 002 continua visível e legível no novo cabeçalho/lista.
- Reserva em "Verificar" já com anexos antigos: os anexos existentes continuam visíveis e podem ser
  baixados; só o registro de novos anexos fica desabilitado até a confirmação.
- Cor como único indicador: pessoas com daltonismo precisam distinguir situação, atenção e erro; todo
  selo e ícone colorido traz também texto ou forma própria.
- Texto da interface aumentado nas configurações do Windows: nada some nem se sobrepõe.

## Requirements *(mandatory)*

### Functional Requirements

**Identidade visual**

- **FR-001**: Todas as telas e diálogos do app MUST seguir a identidade do design oficial: fundo cinza
  claro; conteúdo em cards brancos de cantos bem arredondados e sombra suave; separação entre grupos
  sem bordas.
- **FR-002**: O menu lateral MUST ser flutuante, com ícone e nome por área, e MUST destacar a área
  atual como pílula preta com o ícone em lima.
- **FR-003**: O cabeçalho MUST ser transparente e mostrar a marca nova (H em lima num quadrado preto)
  e o cliente conectado num selo branco.
- **FR-004**: O app MUST usar a fonte definida no design oficial (Manrope), com títulos maiores que o
  texto corrido e indicadores numéricos em tamanho grande, e MUST exibi-la sem depender de acesso à
  internet.
- **FR-005**: A paleta MUST ser monocromática (preto, cinzas e branco) com lima como único acento;
  verde, âmbar e vermelho MUST ser usados só para concluído/aceito, atenção e erro/destrutivo,
  respectivamente.
- **FR-006**: Toda informação transmitida por cor MUST também ser transmitida por texto, ícone ou
  forma, e o contraste entre texto e fundo MUST ser suficiente para leitura confortável.

**Hierarquia de ações**

- **FR-007**: Cada bloco de tela e cada diálogo MUST ter no máximo uma ação principal: preta em fundo
  claro; lima em fundo escuro.
- **FR-008**: As demais ações MUST seguir o padrão: contorno para secundárias; só texto para
  "Cancelar" e "Sair"; âmbar para atenção; vermelho para destrutivas.
- **FR-009**: "Limpar acesso", "Desfazer" e "Remover valor" MUST aparecer em vermelho suave, e "Sim,
  cancelar" MUST aparecer em vermelho cheio; nenhuma ação destrutiva MUST ter a aparência de uma ação
  segura.
- **FR-010**: "Baixar", "Reverter" e "Desfazer" MUST ter cores e ícones distintos entre si.
- **FR-011**: Nos diálogos, "Cancelar" MUST ser só texto e MUST ser visualmente diferente de "Escolher
  outro arquivo", que tem contorno.
- **FR-012**: "Substituir tratativa" e "Substituir comprovante" MUST ter o mesmo peso visual.
- **FR-013**: O botão "Leve" (lima suave) MUST deixar de existir; o lima MUST ficar reservado a
  destaque e seleção.

**Listas**

- **FR-014**: A lista de reservas MUST ter cinco colunas — hóspede, hotel, período, valor e situação
  —, com até duas linhas de texto em cada; todo dado que saiu das colunas antigas MUST continuar
  acessível nos detalhes da reserva.
- **FR-015**: A coluna "Situação da reserva" MUST ser única e MUST mostrar, ao lado, o selo "Verificar"
  em âmbar cheio quando a reserva pede verificação.
- **FR-016**: A área de reservas MUST oferecer uma busca, um botão "Filtros" que abre um painel com
  todos os filtros detalhados que o app já oferece, e os filtros rápidos Todas, Falta cobrar, A
  verificar, Com erro e Concluídas, cada um com a contagem de reservas.
- **FR-017**: As contagens dos filtros rápidos MUST refletir a busca e os filtros em vigor e MUST ser
  atualizadas quando eles mudam ou quando os dados são recarregados.
- **FR-018**: A linha inteira da reserva MUST abrir os detalhes ao ser clicada, MUST exibir uma seta no
  fim e MUST destacar em lima suave a linha aberta ou marcada; a caixa de seleção MUST funcionar sem
  abrir os detalhes.
- **FR-019**: A área de execuções MUST mostrar a execução em andamento num card escuro no topo, com
  hotel atual, progresso e tempo estimado, e as demais num "Histórico".
- **FR-020**: As áreas de hotéis e de documentos MUST ser linhas simples com nome, uma linha de resumo e
  situação.
- **FR-021**: Toda lista sem resultado MUST mostrar o estado vazio com ícone, explicação e, quando
  houver busca ou filtro em vigor, o botão "Limpar busca e filtros".

**Seleção em lote**

- **FR-022**: A caixa de seleção MUST ser preta com o check em lima, e a do cabeçalho da lista MUST
  indicar estado parcial quando só parte das reservas está marcada.
- **FR-023**: Com reservas marcadas, MUST aparecer uma barra escura com o total e as ações do lote, com
  "Anexar comprovante" em lima; sem reservas marcadas, a barra MUST ficar oculta.
- **FR-024**: O diálogo de anexar a várias reservas MUST resumir, antes da confirmação, as reservas
  aceitas (ícone verde) e as ignoradas (ícone âmbar), com a quantidade de cada grupo.

**Detalhes da reserva**

- **FR-025**: Os detalhes MUST mostrar o quadro "Status do Hunit", com selo da situação e, quando
  existir, a "Classificação anterior".
- **FR-026**: O valor salvo (com a ação "Remover") MUST aparecer separado do campo "Corrigir o valor",
  cuja ação principal é "Informar valor" em preto; o valor digitado MUST NOT substituir o salvo antes
  da confirmação.
- **FR-027**: O histórico MUST mostrar os 5 itens mais recentes e oferecer "Mostrar mais" para os
  demais.
- **FR-028**: Os detalhes MUST incluir o card "Verificações".
- **FR-029**: Para a reserva que pede verificação, os detalhes MUST mostrar o alerta "Verificar" com
  "Confirmar" como ação principal; enquanto não confirmada, os botões de anexar tratativa e comprovante
  MUST ficar desabilitados e MUST explicar o motivo ao lado.

**Consistência**

- **FR-030**: Elementos que se repetem (linhas, barra de lote, ações de documento, calendário, selos,
  estado vazio, cards) MUST ter uma única definição reutilizada em todas as telas, de modo que uma
  mudança vale para todas.
- **FR-031**: O redesenho MUST NOT alterar regras de negócio, permissões por perfil, o contrato da API
  nem o comportamento das funções já entregues (consulta, execução, tratativas, evidências); só a
  apresentação e a organização da informação.
- **FR-032**: Ao final, o espelho do app no Figma MUST mostrar as mesmas telas do design oficial, com
  o guia de paleta, leis de UX e hierarquia de ações disponível para o time manter o padrão.

### Key Entities

Não há entidades novas: a feature só reapresenta dados que o servidor já informa (reservas,
execuções, hotéis, documentos e o histórico de cada reserva).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das telas e diálogos do app coincidem com o design oficial na revisão lado a lado
  feita por quem mantém o Figma, sem divergência de estrutura, cor ou rótulo.
- **SC-002**: Todas as jornadas que funcionavam antes do redesenho (iniciar, acompanhar, cancelar e
  retomar execução; consultar, filtrar e abrir reservas; registrar, substituir, reverter e desfazer
  documentos; lote; informar e remover valor) continuam concluindo com o mesmo resultado, verificado
  pela mesma bateria de testes do app.
- **SC-003**: Uma pessoa do Financeiro chega a "reservas que faltam cobrar" em um único toque a partir
  da lista, e abre os detalhes de qualquer reserva em um único clique na linha.
- **SC-004**: Em teste com 4 pessoas (as usuárias iniciais), pelo menos 3 de 4 identificam, sem ajuda,
  qual é a ação principal de cada uma de 5 telas sorteadas e quais botões são destrutivos.
- **SC-005**: A lista de reservas exibe todos os dados de uma reserva comum com 5 colunas sem rolagem
  horizontal na janela padrão do app, e nenhum nome longo quebra o layout.
- **SC-006**: O texto de todas as telas atende a contraste suficiente para leitura (relação mínima de
  4,5:1 no texto comum) e nenhuma informação depende só de cor.
- **SC-007**: Nenhum pedido de ajuda registrado pelas usuárias, na semana seguinte à entrega, sobre
  "onde foi parar" uma informação que saiu das colunas da lista.

## Assumptions

- **Fonte da verdade do visual**: o design oficial do arquivo "Hunit Control" do Figma; a numeração
  das telas (4.2, 4.4–4.7, 4.9, 4.10 etc.) refere-se a ele. Em caso de dúvida de detalhe, vale o
  Figma, e esta spec é atualizada se ele mudar.
- **Dependência da 003**: vários elementos do design (tratativas, comprovantes, "Status do Hunit",
  "Verificações", "Verificar", valor manual, lote) existem a partir da feature 003. Esta feature parte
  do app com a 003 incorporada; a branch só começa a ser implementada depois que a 003 estiver na
  `master`.
- **Dados já disponíveis**: tudo que o design mostra (situações, classificação anterior, verificações,
  histórico, progresso, contagens) vem de informação que o servidor e a API já fornecem. Se alguma
  contagem dos filtros rápidos exigir dado novo da API, isso é decidido no plano, como acréscimo
  compatível, e não altera o escopo desta spec.
- **Contagem dos filtros rápidos**: refere-se a todas as reservas que atendem à busca e aos filtros em
  vigor, não só às mostradas na página atual.
- **Uso**: 4 pessoas do Financeiro e da Controladoria, em computadores Windows, em tela de
  computador (não celular); janela redimensionável, com tamanho mínimo já definido na feature 002.
- **Tema**: só o tema claro; tema escuro fica para outra spec.
- **Rótulos**: continuam em português do Brasil, com os nomes exatamente como no design oficial.
- **Manutenção do Figma**: o espelho do app é atualizado com a skill `figma-screens-sync` ao concluir
  a feature (AGENTS.md); o guia de paleta, leis de UX e hierarquia de ações já existe ao lado das
  telas do design oficial.
