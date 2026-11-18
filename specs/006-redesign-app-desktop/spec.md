# Feature Specification: Redesign visual do app desktop

**Feature Branch**: `006-redesign-app-desktop`

**Created**: 2026-11-16

**Status**: Draft

**Updated**: 2026-11-18 (telas do sistema anterior — página 004 —, do envio ao Comercial — página 005 —, padronização final dos diálogos e telas responsivas; depois, revisão para o plano: a 006 assume as telas da 004 e da 005, grupos dos filtros rápidos e contagens pela API)

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

Desde a primeira versão desta spec, o design oficial recebeu três blocos de mudança, que esta feature
também leva para o app: (a) as telas da **importação do histórico do sistema anterior** (página 004 do
Figma: reservas com origem "Sistema anterior", filtro "Origem", selos e gaveta próprios); (b) as telas
do **envio ao Comercial e da área Comercial** (página 005: envio, validação e recusa de retorno, abas
da área, ações em lote, "Copiar para e-mail" e valor cobrado nas listas); e (c) uma **padronização
final** dos diálogos e cards. Além disso, **todas as telas precisam ser responsivas**: a mesma
informação e as mesmas ações devem funcionar em qualquer largura de janela suportada, e não só no
tamanho em que o design foi desenhado. O comportamento de negócio da importação e do envio ao Comercial
pertence às features 004 e 005, que já foram entregues com o visual anterior; esta feature leva as
telas delas ao design oficial, cuidando da apresentação e da organização da informação.

O app passa a ser comparado tela a tela com o design oficial: a feature termina quando os dois
mostram as mesmas telas. Ao concluir, as telas da 006 ficam marcadas no Figma como as em uso.

Ficam **fora do escopo**: novas funções de negócio (as regras da importação do sistema anterior e do
envio ao Comercial são das features 004 e 005), mudança de permissões, tema escuro, versão para outros
sistemas operacionais além do Windows, versão para celular ou tablet, e qualquer mudança no servidor
ou no contrato da API além dos acréscimos compatíveis para as contagens dos filtros rápidos (FR-017)
e para a ordem da lista por hotel e check-in (FR-014).

## Clarifications

### Session 2026-11-18

- Q: As telas do sistema anterior (4.10 a 4.12) e do Comercial (seção 7) são implementadas na 006 ou junto das features 004 e 005? → A: ~~A 006 entrega identidade, listas, componentes e responsividade; as telas 4.10 a 4.12 e a seção 7 são implementadas junto das features 004 e 005, já com o visual e a responsividade da 006.~~ Substituída na revisão para o plano (abaixo): a 004 e a 005 foram entregues com o visual anterior.
- Q: Com a 004 e a 005 entregues com o visual anterior, quem leva as telas delas ao design oficial? → A: A 006. As histórias 7 e 8 e os FR-033 a FR-041 fazem parte desta feature (só apresentação; as regras continuam as da 004 e da 005). As telas já estão no Figma.
- Q: As contagens dos filtros rápidos podem exigir mudança na API, que hoje não informa o total da lista? → A: Sim, como acréscimo compatível no contrato (nada do que existe muda).
- Q: Quais reservas entram em cada filtro rápido? → A: Falta cobrar = o filtro "Falta cobrar" de hoje; A verificar = alerta "Verificar", "A revisar (sistema anterior)" e "Validar comprovante"; Com erro = "Erro na cobrança" e "Erro de análise"; Concluídas = "Comprovante enviado", "Faturada", "Já cobrada", "Cancelada sem cobrança" e "Ignorada (Hotelbeds 258)". Uma reserva pode estar em mais de um filtro.
- Q: O que são as "áreas de hotéis e de documentos" do FR-020? → A: Não há áreas com esses nomes no menu; são a lista de hotéis dentro da execução e a lista de documentos dentro dos detalhes da reserva.
- Q: O critério de sucesso do teste com 4 pessoas (antigo SC-004) fica? → A: Não; os critérios seguintes foram renumerados. A validação é a homologação com os perfis de acesso; a adoção pelas usuárias é acompanhada em produção, sem meta.

### Session 2026-11-18 (plano)

- Q: O rodapé do design diz "ordenadas por hotel e check-in", mas a lista hoje é ordenada por hotel e número da reserva. Qual vale? → A: Hotel e check-in, que é melhor para ler; entra como acréscimo compatível na API (o app atual continua com a ordem de hoje).
- Q: Algumas cores do design ficam abaixo de 4,5:1 (texto secundário, placeholder, selo "Verificar"). Ajustar agora? → A: Não. A 006 usa as cores do design; o ajuste de contraste vai para a UX e para uma próxima spec.
- Q: O envio ao Comercial em andamento não tem desenho na aba "Envios". Como mostrar? → A: Num card escuro com lima e barra de progresso, como a execução em andamento; uma tela de exemplo vai ao Figma para a UX aprovar antes da implementação, e ajustes ficam para uma feature seguinte.
- Q: As quebras para janelas menores não estão desenhadas. → A: A 006 implementa as telas responsivas como o plano define; ajustes finos ficam para uma feature seguinte.
- Q: A marca nova vale também para o ícone do app? → A: Sim: o ícone do app no Windows (janela, barra de tarefas, atalho e instalador) e o da página do app passam a ser a marca nova.
- Q: Como fica o Figma ao concluir a 006? → A: Nenhuma tela é redesenhada pelo agente: as telas em uso ficam marcadas com ✅ e as substituídas com ❌ e ocultas, em todas as páginas de feature (skill `figma-screens-sync`).

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
6. **Given** o app instalado, **When** a pessoa olha a barra de tarefas, o Menu Iniciar, a janela e o
   instalador, **Then** vê a marca nova (H lima no quadrado preto), nítida também no tamanho pequeno.

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

### User Story 6 - Acompanhar execuções e ler as listas de hotéis e de documentos (Priority: P3)

A execução em andamento ganha um card escuro no topo, com o progresso; as demais ficam num
"Histórico". A lista de hotéis dentro da execução e a lista de documentos dentro dos detalhes da
reserva aparecem como linhas simples, com nome, uma linha de resumo e a situação.

**Why this priority**: melhora a leitura de telas de uso menos frequente que a lista de reservas; pode
vir por último sem prejudicar o resto.

**Independent Test**: com uma execução em andamento e várias concluídas, abrir a área de execuções e
os hotéis de uma execução; abrir os detalhes de uma reserva com documentos e conferir com o design
oficial.

**Acceptance Scenarios**:

1. **Given** uma execução em andamento, **When** a área de execuções é exibida, **Then** ela aparece
   num card escuro no topo, com o hotel atual, o progresso e o tempo estimado, e a ação principal em
   lima.
2. **Given** execuções já encerradas, **When** a área é exibida, **Then** ficam na seção "Histórico".
3. **Given** nenhuma execução em andamento, **When** a área é exibida, **Then** não aparece o card
   escuro e o histórico ocupa a tela.
4. **Given** a lista de hotéis dentro da execução e a lista de documentos dentro dos detalhes da
   reserva, **When** exibidas, **Then** cada item é uma linha simples com o nome, uma linha de resumo e
   a situação, sem colunas vazias.

---

### User Story 7 - Reconhecer as reservas do sistema anterior nas listas e nos detalhes (Priority: P2)

**Escopo nesta feature**: a feature 004 já entregou o comportamento (importação, origem "Sistema
anterior", filtro, "A revisar (sistema anterior)") com o visual anterior. A 006 leva estas telas
(4.10 a 4.12 do design) ao design oficial, com a responsividade da história 9, sem mudar as regras da
004.

A pessoa filtra por origem "Sistema anterior" na própria barra de busca, reconhece de relance as
reservas importadas e abre uma delas numa gaveta que mostra o que foi importado e o que ainda não foi
verificado.

**Why this priority**: sem sinais visuais claros, o histórico importado se confunde com as reservas
novas; depende das listas (história 2) e dos detalhes (história 5).

**Independent Test**: com reservas importadas e novas gravadas, filtrar por "Sistema anterior", conferir
a lista e abrir uma reserva "A revisar (sistema anterior)" comparando com as telas 4.10 a 4.12 do design.

**Acceptance Scenarios**:

1. **Given** a barra de busca de qualquer lista de reservas (e da lista usada nos relatórios), **When**
   exibida, **Then** mostra o filtro "Origem" visível; ao escolher "Sistema anterior" a lista mostra só
   as reservas importadas, e a linha "Filtros aplicados" e o painel de filtros avançados não repetem
   esse filtro.
2. **Given** uma reserva importada, **When** aparece numa lista, **Then** exibe o selo "Sistema
   anterior" ao lado do nome do hóspede, e os selos de situação ficam um embaixo do outro, sem texto
   cortado.
3. **Given** a lista, **When** há reservas "A revisar (sistema anterior)", **Then** elas entram na
   contagem e no filtro rápido "A verificar".
4. **Given** uma reserva importada aberta na gaveta, **When** exibida, **Then** o topo mostra os selos
   "Sistema anterior", "A revisar (sistema anterior)" e "Não identificada" (os que se aplicam), e a
   gaveta traz o quadro "Status do Hunit", a tratativa importada (com Baixar e Desfazer), o card
   Cobrança, o card Verificações (com o aviso "Ainda não verificada…") e o card "Sistema anterior".
5. **Given** a opção de selo extra da linha de reserva, **When** usada, **Then** o rótulo é "Selo
   extra" (antes "Verificar"), pois serve também para "Não identificada".
6. **Given** o painel de filtros avançados, **When** aberto, **Then** mostra os mesmos filtros de antes,
   sem o campo Origem, que passou para a barra de busca.

---

### User Story 8 - Enviar ao Comercial e trabalhar na área Comercial (Priority: P2)

**Escopo nesta feature**: a feature 005 já entregou o comportamento (envio, pedido de token,
"Validar comprovante", área Comercial, lote, "Copiar para e-mail", valor cobrado) com o visual
anterior. A 006 leva estas telas (seção 7 do design) ao design oficial, com a responsividade da
história 9, sem mudar as regras da 005.

A pessoa seleciona reservas e, na barra de seleção, envia ao Comercial: confere, acompanha o envio,
responde ao pedido de token quando aparece e vê o resultado. Quando o Comercial devolve, valida o retorno
na gaveta da reserva e acompanha tudo na área "Comercial".

**Why this priority**: leva o fluxo da feature 005 para o app com a mesma identidade; depende da barra
de lote (história 4) e da gaveta de detalhes (história 5).

**Independent Test**: percorrer as telas 7.1 a 7.14 do design com dados de teste (conferência, envio em
andamento, pedido de token, concluído, validação e recusa, as quatro abas, lote e e-mail) e comparar
cada uma com o Figma.

**Acceptance Scenarios**:

1. **Given** o menu, **When** exibido em qualquer tela, **Then** tem o item "Comercial", com ícone, nos
   dois perfis.
2. **Given** reservas marcadas, **When** a barra de seleção aparece, **Then** agrupa as ações em "Ver
   seleção", "Anexar ▾", "Confirmar ▾", "Enviar ao Comercial" (em lima) e "Desmarcar todas".
3. **Given** "Enviar ao Comercial", **When** acionado, **Then** a pessoa passa pelas telas de
   conferência, envio em andamento (progresso e lista de resultados), pedido de token (no mesmo diálogo
   escuro do token das execuções) e concluído.
4. **Given** uma reserva em "Validar comprovante", **When** a gaveta abre, **Then** o card "Comercial"
   mostra o retorno (hotel diferente e diferença de valor em destaque) com "Confirmar" e "Recusar"; ao
   recusar, o diálogo oferece motivos rápidos e um campo de texto.
5. **Given** a área "Comercial", **When** aberta, **Then** tem as abas "Envios", "Retornos a validar",
   "Retornos com problema" e "Planilha".
6. **Given** uma lista de reservas, **When** exibida, **Then** tem o botão "Copiar para e-mail" ao lado
   do título e "Selecionar todas do filtro" no fim da linha dos filtros rápidos, e permite confirmar
   retornos e "Verificar" em lote.
7. **Given** a coluna Valor da lista, **When** a reserva tem valor cobrado, **Then** uma segunda linha
   embaixo do valor total mostra "cobrado R$ X · Hunit" ou "· manual"; nas gavetas, o campo "Valor
   cobrado" aparece nos dados da reserva e, no card Cobrança, o rótulo é "Valor cobrado no Hunit".

---

### User Story 9 - Usar o app em janelas de tamanhos diferentes e com diálogos padronizados (Priority: P1)

A pessoa usa o app em notebook, em monitor grande ou com a janela redimensionada, e todas as telas se
reorganizam sozinhas: nada some, nada é cortado e as ações continuam ao alcance. Os diálogos têm a
mesma aparência e o mesmo comportamento em todo o app.

**Why this priority**: as listas de 5 colunas, a barra de lote e as abas só cumprem o redesenho se
funcionarem fora do tamanho em que foram desenhadas; é requisito de todas as outras histórias.

**Independent Test**: abrir cada tela, gaveta e diálogo na largura mínima suportada, numa intermediária e
numa grande, e redimensionar com o app aberto, conferindo conteúdo e ações.

**Acceptance Scenarios**:

1. **Given** qualquer tela, gaveta ou diálogo, **When** a janela tem qualquer largura entre a mínima
   suportada e a de um monitor grande, **Then** não há rolagem horizontal da página e nenhuma informação
   ou ação do design de referência deixa de existir.
2. **Given** as listas, **When** a largura diminui, **Then** as colunas menos importantes se reduzem ou se
   empilham, e valor total, valor cobrado e selos de situação nunca são cortados.
3. **Given** a barra de busca, os filtros rápidos e a barra de seleção, **When** não cabem numa linha,
   **Then** quebram em mais linhas sem se sobrepor, e as ações agrupadas em menus continuam acessíveis.
4. **Given** as abas da área Comercial e o menu lateral, **When** a largura diminui, **Then** todas as
   opções continuam alcançáveis, com a ativa visível (o menu pode se recolher só com ícones).
5. **Given** gavetas e diálogos, **When** exibidos em qualquer largura, **Then** nunca ultrapassam a área
   visível, rolam internamente, mantêm o botão de fechar alcançável e (os diálogos) ficam centralizados
   na área visível.
6. **Given** os diálogos do app (token, cancelar execução, recusar retorno, confirmações), **When**
   exibidos, **Then** têm o mesmo espaçamento interno (24 px), só duas larguras (520 px e 780 px) e o
   mesmo estilo de título.
7. **Given** o card "Comercial" da gaveta, **When** exibido, **Then** tem o mesmo espaçamento interno
   (16 px) dos demais cards.
8. **Given** a janela redimensionada com a tela aberta, **When** a pessoa a redimensiona, **Then** a tela
   se ajusta na hora, sem perder filtros, seleção, texto digitado, aba ativa nem gaveta aberta.

---

### Edge Cases

- Mais de uma execução em andamento ao mesmo tempo (contas diferentes): todas aparecem em destaque no
  topo, cada uma no seu card escuro, sem quebrar o layout.
- Janela estreita: a lista de reservas, a barra de seleção, as abas e o menu continuam utilizáveis, sem
  rolagem horizontal da página; o menu pode se recolher mostrando só os ícones (história 9).
- Janela redimensionada com gaveta, diálogo ou seleção em andamento: tudo se ajusta sem fechar nem
  perder o que a pessoa digitou ou escolheu.
- Selos longos (por exemplo, "A revisar (sistema anterior)"): ficam empilhados e legíveis em qualquer
  largura.
- Reserva sem valor cobrado: a segunda linha da coluna Valor não aparece (nunca "R$ 0,00").
- Perfil de consulta: vê as listas, abas e retornos, mas sem ações de registro, envio, confirmação,
  recusa ou desfazer (regra da 003).
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
  e o cliente conectado num selo branco. A mesma marca MUST ser o ícone do app no Windows (janela,
  barra de tarefas, atalho do Menu Iniciar e instalador), nítida nos tamanhos pequenos, e o ícone da
  página do app.
- **FR-004**: O app MUST usar a fonte definida no design oficial (Manrope), com títulos maiores que o
  texto corrido e indicadores numéricos em tamanho grande, e MUST exibi-la sem depender de acesso à
  internet.
- **FR-005**: A paleta MUST ser monocromática (preto, cinzas e branco) com lima como único acento;
  verde, âmbar e vermelho MUST ser usados só para concluído/aceito, atenção e erro/destrutivo,
  respectivamente.
- **FR-006**: Toda informação transmitida por cor MUST também ser transmitida por texto, ícone ou
  forma, e o contraste entre texto e fundo MUST ser suficiente para leitura confortável, com as
  exceções do design já conhecidas (SC-005), que ficam para uma próxima spec.

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
  acessível nos detalhes da reserva. Quando houver valor cobrado, a coluna Valor MUST mostrar, numa
  segunda linha, "cobrado R$ X · Hunit" ou "· manual", e a coluna MUST ser dimensionada para que o texto
  caiba (Hotel e Período um pouco mais estreitos). A lista MUST ser ordenada por hotel e, dentro do
  hotel, por data de check-in (a mais antiga primeiro), como diz o rodapé "ordenadas por hotel e
  check-in"; a lista da seleção e a cópia para e-mail seguem a mesma ordem.
- **FR-015**: A coluna "Situação da reserva" MUST ser única e MUST mostrar, ao lado, o selo "Verificar"
  em âmbar cheio quando a reserva pede verificação.
- **FR-016**: A área de reservas MUST oferecer uma busca, o filtro "Origem" visível na própria barra, um
  botão "Filtros" que abre um painel com os demais filtros detalhados que o app já oferece, e os filtros
  rápidos Todas, Falta cobrar, A verificar, Com erro e Concluídas, cada um com a contagem de reservas;
  "Selecionar todas do filtro" MUST ficar no fim da linha dos filtros rápidos e "Copiar para e-mail" ao
  lado do título. Os filtros rápidos MUST agrupar as reservas assim:
  - **Todas**: todas as que atendem à busca e aos filtros em vigor;
  - **Falta cobrar**: as do filtro "Falta cobrar" que o app já oferece;
  - **A verificar**: as com o alerta "Verificar", as "A revisar (sistema anterior)" e as em "Validar
    comprovante";
  - **Com erro**: as em "Erro na cobrança" e "Erro de análise";
  - **Concluídas**: as em "Comprovante enviado", "Faturada", "Já cobrada", "Cancelada sem cobrança" e
    "Ignorada (Hotelbeds 258)".

  Uma reserva pode estar em mais de um grupo (por exemplo, "Validar comprovante" está em Falta cobrar e
  em A verificar); a soma das contagens pode passar do total de Todas, e a reserva que não está em
  nenhum grupo aparece só em Todas.
- **FR-017**: As contagens dos filtros rápidos MUST refletir a busca e os filtros em vigor e MUST ser
  atualizadas quando eles mudam ou quando os dados são recarregados. Se a API não as informar, MAY
  ganhar um acréscimo compatível no contrato para isso (nada do que existe muda).
- **FR-018**: A linha inteira da reserva MUST abrir os detalhes ao ser clicada, MUST exibir uma seta no
  fim e MUST destacar em lima suave a linha aberta ou marcada; a caixa de seleção MUST funcionar sem
  abrir os detalhes.
- **FR-019**: A área de execuções MUST mostrar a execução em andamento num card escuro no topo, com
  hotel atual, progresso e tempo estimado, e as demais num "Histórico".
- **FR-020**: A lista de hotéis dentro da execução e a lista de documentos dentro dos detalhes da
  reserva MUST ser linhas simples, com nome, uma linha de resumo e situação.
- **FR-021**: Toda lista sem resultado MUST mostrar o estado vazio com ícone, explicação e, quando
  houver busca ou filtro em vigor, o botão "Limpar busca e filtros".

**Seleção em lote**

- **FR-022**: A caixa de seleção MUST ser preta com o check em lima, e a do cabeçalho da lista MUST
  indicar estado parcial quando só parte das reservas está marcada.
- **FR-023**: Com reservas marcadas, MUST aparecer uma barra escura com o total e as ações do lote
  agrupadas em "Ver seleção", "Anexar ▾", "Confirmar ▾", "Enviar ao Comercial" (em lima) e "Desmarcar
  todas" (em vez de várias ações soltas); sem reservas marcadas, a barra MUST ficar oculta.
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
- **FR-031**: O redesenho MUST NOT alterar regras de negócio, permissões por perfil nem o
  comportamento das funções já entregues (consulta, execução, tratativas, evidências, importação do
  sistema anterior, envio ao Comercial); só a apresentação e a organização da informação. O contrato
  da API só MAY receber os acréscimos compatíveis de FR-017 (contagens) e FR-014 (ordem).
- **FR-032**: Ao final, o app MUST mostrar as mesmas telas do design oficial, e as telas da 006 MUST
  ficar marcadas no Figma como as em uso (✅), com as versões anteriores marcadas como substituídas
  (❌) e ocultas; o guia de paleta, leis de UX e hierarquia de ações continua disponível para o time
  manter o padrão.

**Sistema anterior (página 004)**

- **FR-033**: Reservas importadas MUST exibir o selo "Sistema anterior" ao lado do nome do hóspede nas
  listas e nos detalhes; a opção de selo extra da linha MUST se chamar "Selo extra" (serve a "Verificar" e
  a "Não identificada") e os selos de situação MUST ficar empilhados, nunca cortados.
- **FR-034**: Nas listas filtradas por "Sistema anterior" e na gaveta de uma reserva importada, o filtro
  "Origem" MUST mostrar "Sistema anterior"; a linha "Filtros aplicados" e o campo Origem do painel MUST NOT
  repeti-lo. Reservas "A revisar (sistema anterior)" MUST contar em "A verificar".
- **FR-035**: A gaveta de uma reserva importada MUST mostrar os selos aplicáveis ("Sistema anterior",
  "A revisar (sistema anterior)", "Não identificada"), o quadro "Status do Hunit", a tratativa importada
  com Baixar e Desfazer, os cards Cobrança e Verificações (com o aviso "Ainda não verificada…") e o card
  "Sistema anterior".

**Comercial (página 005)**

- **FR-036**: O menu MUST ter o item "Comercial" em todas as telas, nos dois perfis.
- **FR-037**: O envio ao Comercial MUST ter as telas de conferência, em andamento (progresso e lista de
  resultados), pedido de token (no mesmo diálogo escuro do token das execuções) e concluído.
- **FR-038**: A gaveta de uma reserva em "Validar comprovante" MUST mostrar o card "Comercial" com o
  retorno (hotel diferente e diferença de valor em destaque), "Confirmar" e "Recusar"; o diálogo de
  recusa MUST ter motivos rápidos e um campo de texto.
- **FR-039**: A área "Comercial" MUST ter as abas "Envios", "Retornos a validar", "Retornos com problema"
  e "Planilha". Na aba "Envios", o envio em andamento MUST aparecer num card escuro no topo, com lima e
  barra de progresso, como a execução em andamento (FR-019); a tela de exemplo MUST ser aprovada pela
  UX no Figma antes da implementação.
- **FR-040**: As gavetas MUST mostrar o campo "Valor cobrado" nos dados da reserva e, no card Cobrança, o
  rótulo "Valor cobrado no Hunit"; os componentes "Botão com menu" e "Aba" e o ícone Comercial MUST ser
  definições únicas (FR-030).
- **FR-041**: A conferência de ações em lote ("Confirmar ▾", retornos e "Verificar") e a cópia para
  e-mail MUST ter as telas descritas no design oficial (7.11 a 7.14).

**Padronização e telas responsivas**

- **FR-042**: Todos os diálogos do app MUST ter o mesmo espaçamento interno (24 px), só duas larguras
  (520 px e 780 px), o mesmo estilo de título e ficar centralizados na área visível; o card "Comercial"
  da gaveta MUST ter o mesmo espaçamento interno (16 px) dos demais cards.
- **FR-043**: Todas as telas, gavetas e diálogos do app (inclusive os das features 004 e 005)
  MUST ser responsivos: funcionar em qualquer largura entre a mínima suportada pelo app (hoje 960 px,
  da feature 002) e a de monitores grandes, sem rolagem horizontal da página e sem perder informação ou
  ação em relação ao design de referência.
- **FR-044**: Em larguras menores, os blocos MUST se reorganizar (colunas menos importantes reduzidas ou
  empilhadas, barras de busca, de filtros rápidos e de seleção quebrando em mais linhas, abas e menu
  alcançáveis), preservando a prioridade da informação.
- **FR-045**: Valores em reais, selos de situação e rótulos de ação MUST nunca ser cortados em nenhuma
  largura; só nomes longos (hóspede, hotel) podem ser cortados, com o texto inteiro nos detalhes.
- **FR-046**: Em larguras grandes, o conteúdo MUST ter largura máxima de leitura.
- **FR-047**: Gavetas e diálogos MUST respeitar a área visível, rolar internamente e manter o botão de
  fechar alcançável.
- **FR-048**: Redimensionar a janela MUST reorganizar a tela na hora, sem recarregar dados e sem perder
  filtros, seleção, texto digitado, aba ativa nem gaveta aberta.

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
- **SC-004**: A lista de reservas exibe todos os dados de uma reserva comum com 5 colunas sem rolagem
  horizontal na janela padrão do app, e nenhum nome longo quebra o layout.
- **SC-005**: O texto de todas as telas atende a contraste suficiente para leitura (relação mínima de
  4,5:1 no texto comum), exceto os pares de cor do design já conhecidos — texto secundário
  ("texto/apagado"), placeholder dos campos e selo "Verificar" —, que ficam para uma próxima spec; e
  nenhuma informação depende só de cor.
- **SC-006**: Nenhum pedido de ajuda registrado pelas usuárias, na semana seguinte à entrega, sobre
  "onde foi parar" uma informação que saiu das colunas da lista.
- **SC-007**: Em cada tela, gaveta e diálogo do app, verificados na largura mínima suportada, numa
  intermediária e numa de monitor grande, 100% das informações e ações do design de referência estão
  acessíveis, sem rolagem horizontal e sem valores, selos ou rótulos cortados.
- **SC-008**: Redimensionar a janela nunca perde filtros, seleção, aba ativa, texto digitado nem gaveta
  aberta, em 100% dos casos verificados.
- **SC-009**: 100% dos diálogos do app usam o mesmo espaçamento e uma das duas larguras definidas.
- **SC-010**: Uma pessoa distingue as reservas do sistema anterior das novas numa lista em até 5
  segundos, e abre o envio ao Comercial a partir de uma seleção em no máximo 2 cliques.

## Assumptions

- **Fonte da verdade do visual**: o design oficial do arquivo "Hunit Control" do Figma; a numeração
  das telas (4.2, 4.4–4.7, 4.9, 4.10 etc.) refere-se a ele. Em caso de dúvida de detalhe, vale o
  Figma, e esta spec é atualizada se ele mudar.
- **Features 004 e 005**: as telas do sistema anterior (4.10 a 4.12) e do Comercial (seção 7) usam o
  comportamento das features 004 (importação do histórico) e 005 (envio ao Comercial, "Validar
  comprovante", valor cobrado), que definem as regras. As duas já estão na `master`, com o visual
  anterior; esta feature leva essas telas ao design oficial (histórias 7 e 8, FR-033 a FR-041). A
  numeração das telas no Figma (4.x, 6.x, 7.x) refere-se ao design oficial.
- **Responsividade**: o design oficial é desenhado numa largura de referência; o comportamento nas demais
  larguras (quebras, empilhamento, largura máxima) é decidido na implementação conforme FR-043 a FR-048,
  com revisão da UX. Não há versão para celular ou tablet.
- **Ponto de partida**: esta feature parte do app com as features 003, 004 e 005 incorporadas, todas já
  na `master`; vários elementos do design (tratativas, comprovantes, "Status do Hunit", "Verificações",
  "Verificar", valor manual, lote) vêm da 003.
- **Dados já disponíveis**: tudo que o design mostra (situações, classificação anterior, verificações,
  histórico, progresso) vem de informação que o servidor e a API já fornecem. A exceção possível são as
  contagens dos filtros rápidos: a lista de reservas da API é paginada e não informa o total, então o
  plano decide o acréscimo compatível no contrato (FR-017).
- **Validação**: a homologação percorre o app com os dois perfis de acesso (operador e consulta). A
  adoção pelas usuárias é acompanhada em produção, sem meta numérica.
- **Contagem dos filtros rápidos**: refere-se a todas as reservas que atendem à busca e aos filtros em
  vigor, não só às mostradas na página atual.
- **Uso**: 4 pessoas do Financeiro e da Controladoria, em computadores Windows, em tela de
  computador (não celular); janela redimensionável, com tamanho mínimo já definido na feature 002.
- **Tema**: só o tema claro; tema escuro fica para outra spec.
- **Rótulos**: continuam em português do Brasil, com os nomes exatamente como no design oficial.
- **Manutenção do Figma**: o agente não redesenha telas; ao concluir a feature, a skill
  `figma-screens-sync` marca as telas em uso (✅) e as substituídas (❌, ocultas) em todas as páginas
  de feature (AGENTS.md, "Telas no Figma"); o guia de paleta, leis de UX e hierarquia de ações já
  existe ao lado das telas do design oficial.
