# Feature Specification: Validação dos retornos do Comercial

**Feature Branch**: `009-validacao-retornos-comercial`

**Created**: 2026-11-27

**Status**: Draft — rascunho para a PM (as decisões marcadas como "sugestão" esperam a PM; ver "Pontos para a PM")

**Input**: User description: "Ajustes na planilha do Comercial (itens 15 e 16 do doc da PM): (1) nova aba 'Aguardando validação do Financeiro', com as mesmas colunas e formatação de 'A cobrar'; toda reserva cujo retorno vai para validação do Financeiro sai de 'A cobrar' e passa para a aba nova, para diminuir a fila do Comercial; (2) situação da cobrança livre: o Comercial escreve a situação real; com situação e responsável preenchidos o retorno vai para a validação do Financeiro, que age de acordo com o que foi escrito; só 'Cobrada na maquininha' exige também código de autorização, hotel da cobrança, valor cobrado e data ('Retorno incompleto: faltam ...'); outra situação sem responsável → 'Retorno incompleto: falta o responsável pela cobrança'. Rascunho para a PM, com as sugestões do agente nos pontos abertos."

## Contexto

Desde a feature 008, a planilha do Comercial tem a coluna "Situação da cobrança", com três situações
sugeridas: "Cobrada na maquininha", "Cobrada no Hunit" e "Cancelada". A coluna aceita outro texto, mas
qualquer texto que não seja "Cobrada no Hunit" nem "Cancelada" segue a regra da maquininha e exige
código de autorização, hotel da cobrança, valor cobrado, responsável e data. Na prática, o Comercial só
consegue usar as três sugestões. Uma situação real diferente fica em "Retornos com problema", pedindo
dados que não existem para ela. Exemplos: a OTA cobrou o hóspede, o hóspede pagou no hotel ou a cobrança
foi feita por link de pagamento.

Além disso, a planilha tem só duas abas, "A cobrar" e "Concluídas". A linha fica em "A cobrar" do envio
até a conclusão, inclusive depois que o Comercial responde e enquanto o Financeiro não valida. A fila do
Comercial mistura o que ele ainda precisa fazer com o que já fez.

Esta feature resolve os dois pontos (itens 15 e 16 do doc "ajustes e bugs para a PM"):

1. **Situação real, validada pelo Financeiro.** O Comercial escreve o que de fato aconteceu com a
   cobrança. Com a situação e o responsável preenchidos, o retorno vai para o Financeiro validar, e o
   Financeiro decide o que fazer com a reserva. Só "Cobrada na maquininha" continua exigindo também os
   dados da maquininha.
2. **Fila do Comercial menor.** Uma aba nova, "Aguardando validação do Financeiro", recebe as linhas que
   o Comercial já respondeu. "A cobrar" fica só com o que depende dele.

Ficam **fora do escopo**: cobrar ou alterar qualquer coisa no Hunit (o app continua só lendo o Hunit);
mudar o envio ao Comercial, a fila "Cobradas no Hunit" (além do que o FR-004 diz), a marcação "Cancelada
sem cobrança" em si e as colunas A a P da planilha.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar a situação real e o Financeiro validar (Priority: P1)

O Comercial cobra (ou não) cada reserva do jeito que o caso pede e escreve na planilha o que aconteceu,
com as próprias palavras, e quem cuidou. O Financeiro recebe esse retorno em "Retornos a validar", lê a
situação e decide: considera a reserva cobrada, marca como cancelada sem cobrança ou recusa, com o motivo,
para o Comercial corrigir.

**Why this priority**: é o pedido principal. Hoje situações reais ficam presas em "Retornos com problema"
e o Financeiro não tem como resolvê-las pelo fluxo do Comercial.

**Independent Test**: na planilha, preencher retornos com "Cobrada na maquininha" completo e incompleto,
com uma situação livre com e sem responsável e com "Cancelada"; ler os retornos e conferir em que lista
cada um aparece e o texto da coluna "Validação do Financeiro". Depois, validar cada situação livre com
cada uma das três decisões e conferir o resultado na reserva e na planilha.

**Acceptance Scenarios**:

1. **Given** um retorno com uma situação livre (ex.: "Cobrada pela OTA") e o responsável, **When** o app lê os retornos, **Then** a reserva aparece em "Retornos a validar", com a situação como o Comercial escreveu, e a planilha mostra "Aguardando validação do Financeiro".
2. **Given** um retorno com uma situação livre sem o responsável, **When** o app lê os retornos, **Then** ele vai para "Retornos com problema" com "Retorno incompleto: falta o responsável pela cobrança", e não pede nenhum outro campo.
3. **Given** um retorno "Cobrada na maquininha" só com o responsável, **When** o app lê os retornos, **Then** ele vai para "Retornos com problema" com "Retorno incompleto: faltam o código de autorização, o hotel da cobrança, o valor cobrado e a data da cobrança".
4. **Given** um retorno "Cobrada na maquininha" completo, **When** o app lê os retornos, **Then** ele vai para "Retornos a validar" como hoje, e "Confirmar" continua valendo como comprovante, com o valor do Comercial como valor cobrado.
5. **Given** uma situação livre em "Retornos a validar", **When** o Financeiro escolhe "Confirmar como cobrada", **Then** a reserva fica cobrada (vale como comprovante), com o valor que o Comercial informou ou, se ele não informou, o valor que o Financeiro digita na confirmação; a planilha mostra "Confirmado pelo Financeiro" e a linha vai para "Concluídas".
6. **Given** uma situação livre em "Retornos a validar", **When** o Financeiro escolhe "Confirmar como cancelada sem cobrança", **Then** a reserva é marcada como "Cancelada sem cobrança" (como a "Cancelada" da 008: R$ 0,00, "Concluídas", com "Desfazer").
7. **Given** uma situação livre em "Retornos a validar", **When** o Financeiro escolhe "Recusar" e escreve o motivo, **Then** a planilha mostra "Recusado pelo Financeiro: <motivo>" e a reserva sai de "Retornos a validar" até o Comercial mudar a linha.
8. **Given** um retorno "Cancelada" sem o responsável, **When** o app lê os retornos, **Then** ele vai para "Retornos com problema" com "Retorno incompleto: falta o responsável pela cobrança" (sugestão S3).
9. **Given** um retorno sem situação, **When** o app lê os retornos, **Then** ele vai para "Retornos com problema" dizendo que falta a situação (e o responsável, se também faltar).
10. **Given** o perfil consulta, **When** abre "Retornos a validar", **Then** vê as situações livres, mas não tem as ações de validação.

---

### User Story 2 - Fila do Comercial só com o que depende dele (Priority: P2)

O Comercial abre a planilha e quer ver, em "A cobrar", só as reservas que ele ainda precisa cobrar ou
corrigir. As que ele já respondeu e esperam o Financeiro ficam numa aba própria, com as mesmas colunas,
onde ele acompanha o andamento sem que elas atrapalhem a fila.

**Why this priority**: melhora o dia a dia do Comercial, mas o fluxo funciona sem ela; independe da
história 1 (vale também com as regras de hoje).

**Independent Test**: com linhas em cada estado (sem retorno, com retorno incompleto, aguardando
validação, "Cobrada no Hunit" aguardando a conferência e recusada), fazer uma leitura e conferir em que
aba cada linha fica; recusar uma e confirmar outra no app e conferir para onde vão.

**Acceptance Scenarios**:

1. **Given** a planilha preparada para esta feature, **When** o Comercial a abre, **Then** há três abas: "A cobrar", "Aguardando validação do Financeiro" e "Concluídas", e a aba nova tem as mesmas colunas, cabeçalhos, larguras, cores e formatos de "A cobrar".
2. **Given** um retorno que foi para a validação do Financeiro, **When** o retorno fica alguns minutos sem mudança (FR-010), **Then** a linha sai de "A cobrar" e aparece na aba nova, com os mesmos valores.
3. **Given** um retorno "Cobrada no Hunit" com o responsável, **When** ele espera a conferência no Hunit, **Then** a linha também fica na aba nova, com "Aguardando verificação no Hunit" (sugestão S4).
4. **Given** uma linha na aba nova, **When** o Financeiro recusa o retorno (ou a conferência no Hunit não encontra a cobrança), **Then** a linha volta para o fim de "A cobrar", com o motivo na coluna "Validação do Financeiro", para o Comercial corrigir (sugestão S5).
5. **Given** uma linha na aba nova, **When** o Financeiro confirma (ou a conferência no Hunit confirma a cobrança), **Then** a linha vai para "Concluídas", como hoje.
6. **Given** uma linha com retorno incompleto ou não entendido, ou ainda sem retorno, **When** o app lê os retornos, **Then** ela continua em "A cobrar".
7. **Given** a aba nova, **When** o Comercial tenta editar uma célula, **Then** a planilha não deixa: a aba fica só para consulta, como "Concluídas" (sugestão S6). Para mudar um retorno, o Comercial pede ao Financeiro que o recuse.

---

### Edge Cases

- **Comercial ainda digitando quando a linha mudaria de aba**: a linha só muda de aba depois que o retorno fica alguns minutos sem mudança (FR-010), para não sumir enquanto ele preenche. Se o Financeiro decidir antes disso, a linha vai direto para o destino da decisão.
- **Situação livre que contém "maquininha"** (ex.: "Cobrada na maquininha do hotel"): segue a regra da maquininha (FR-002).
- **Situação livre que começa com "Cancelada"**: vale como "Cancelada", como desde a 008.
- **Situação livre com valor ou data preenchidos**: o app lê os dois; valor ou data que não forem entendidos levam o retorno para "Retornos com problema" ("Retorno não entendido: …"), como hoje. Preenchidos e entendidos, aparecem na validação, e o valor vira a sugestão de valor cobrado.
- **"Confirmar como cobrada" sem valor do Comercial**: a confirmação pede o valor cobrado; sem ele, não confirma.
- **Situação livre numa reserva que já não exige cobrança** (cobrada no Hunit, faturada, com comprovante): segue a regra de hoje dos retornos de reservas que deixaram de exigir cobrança; as ações de validação que não fizerem sentido são recusadas com explicação.
- **Retorno recusado e o Comercial não muda a linha**: continua recusado, em "A cobrar", com o motivo. Se ele mudar a situação, o responsável ou outro campo, a leitura nova segue a regra da situação nova.
- **Comercial edita a linha direto na aba nova** (por alguém com permissão de dono do arquivo, por exemplo): o app restaura o que estava, como faz hoje com as células do sistema.
- **Linhas já abertas na atualização**: na primeira leitura depois da atualização, valem as regras novas: uma situação livre que estava em "Retornos com problema" por falta dos dados da maquininha passa a "Retornos a validar"; uma "Cancelada" sem responsável que aguardava validação passa a "Retornos com problema", pedindo o responsável. As linhas que aguardam validação mudam para a aba nova. A implantação avisa o Comercial antes.
- **Confirmação em lote**: as situações livres não entram no lote, porque cada uma exige uma decisão (FR-007). O lote continua aceitando os retornos da maquininha e as "Cancelada", como hoje.

## Requirements *(mandatory)*

### Functional Requirements

**Situação da cobrança e o que cada uma exige (história 1)**

- **FR-001**: O Comercial MUST poder escrever na "Situação da cobrança" a situação real, com as próprias palavras, até 100 caracteres. As três situações sugeridas continuam na lista da coluna.
- **FR-002**: O que cada situação exige para ir à validação:
  - **"Cobrada na maquininha"** (o texto contém "maquininha"): responsável, código de autorização, hotel da cobrança, valor cobrado e data da cobrança, como hoje.
  - **"Cobrada no Hunit"**: responsável (sugestão S2: a data deixa de ser obrigatória).
  - **"Cancelada"** (o texto começa com "Cancelada"): responsável (sugestão S3: hoje basta a situação).
  - **Qualquer outra situação**: responsável. Código, hotel, valor e data são opcionais.
- **FR-003**: Retorno que não tem o que a situação exige MUST ir para "Retornos com problema" e mostrar na coluna "Validação do Financeiro" só o que falta, na ordem das colunas: por exemplo, "Retorno incompleto: falta o responsável pela cobrança" numa situação livre e "Retorno incompleto: faltam o código de autorização, o hotel da cobrança, o valor cobrado e a data da cobrança" na maquininha. Sem situação, a mensagem MUST pedir a situação (e o responsável, se também faltar).
- **FR-004**: Com o que a situação exige, o retorno MUST ir para:
  - "Retornos a validar": maquininha, "Cancelada" e situação livre;
  - a fila "Cobradas no Hunit": "Cobrada no Hunit", como hoje (sugestão S4).
- **FR-005**: Valor e data preenchidos numa situação livre MUST seguir as regras de leitura de hoje (valor em reais maior que zero e data válida). O que não for entendido leva o retorno a "Retornos com problema" ("Retorno não entendido: …").

**Validação da situação livre pelo Financeiro (história 1)**

- **FR-006**: A situação livre MUST aparecer em "Retornos a validar" (lista, gaveta da reserva) com um selo próprio (sugestão S1: "Outra situação", na cor de atenção) e com a situação como o Comercial escreveu, o responsável e, se preenchidos, o código, o hotel, o valor e a data.
- **FR-007**: Para uma situação livre, o Financeiro MUST escolher uma de três decisões (sugestão S1), uma reserva por vez:
  - **Confirmar como cobrada**: vale como comprovante, como a confirmação de um retorno da maquininha. O valor cobrado é o do Comercial ou, se ele não informou, o que o Financeiro digita (obrigatório). A origem do valor fica registrada.
  - **Confirmar como cancelada sem cobrança**: marca a reserva como "Cancelada sem cobrança", com as mesmas regras e recusas da "Cancelada" da 008.
  - **Recusar**: pede o motivo, que o Comercial vê na coluna "Validação do Financeiro" ("Recusado pelo Financeiro: <motivo>").
- **FR-008**: Cada decisão MUST ficar no histórico da reserva, com a situação que o Comercial escreveu, quem decidiu e quando. "Confirmar como cobrada" e "Confirmar como cancelada sem cobrança" MUST poder ser desfeitas como as confirmações de hoje, e desfazer devolve a situação livre para "Retornos a validar" enquanto o Comercial mantiver a linha.
- **FR-009**: Só o perfil operador MUST ver as decisões; o perfil consulta só vê.

**Aba "Aguardando validação do Financeiro" (história 2)**

- **FR-010**: A planilha MUST ter a aba "Aguardando validação do Financeiro", entre "A cobrar" e "Concluídas", com as mesmas colunas, cabeçalhos, larguras, cores, formatos e regras de cor da coluna "Validação do Financeiro" de "A cobrar". Uma linha MUST passar de "A cobrar" para a aba nova quando o retorno dela foi para "Retornos a validar" ou para a fila "Cobradas no Hunit" e está sem mudança há pelo menos 10 minutos.
- **FR-011**: Uma linha da aba nova MUST:
  - ir para "Concluídas" quando o Financeiro confirma (ou a conferência no Hunit confirma a cobrança), como hoje;
  - voltar para o fim de "A cobrar" quando o retorno é recusado (pelo Financeiro ou porque a conferência no Hunit não encontrou a cobrança), com o motivo (sugestão S5);
  - quando uma confirmação é desfeita, a linha sai de "Concluídas" e volta para a aba nova, porque o
    retorno volta a esperar validação (FR-008).
- **FR-012**: A aba nova MUST ficar protegida inteira, como "Concluídas": o Comercial só consulta (sugestão S6). Célula alterada nela MUST ser restaurada pelo app, como as células do sistema hoje.
- **FR-013**: Linhas sem retorno, com retorno incompleto, com retorno não entendido ou recusadas MUST ficar em "A cobrar".
- **FR-014**: A planilha em uso MUST ganhar a aba nova quando o comando de preparação da planilha rodar de novo, sem perder nem duplicar linhas; na primeira leitura depois disso, as linhas que já aguardavam validação MUST passar para a aba nova. Enquanto a aba nova não existir, a planilha MUST ser apontada como fora do formato esperado, como hoje acontece com colunas faltando.

**Consistência**

- **FR-015**: As telas afetadas ("Retornos a validar", gaveta da reserva com o retorno do Comercial, "Retornos com problema" e a área Comercial, que mostra em que aba está a linha da reserva) MUST seguir o visual, os componentes e a responsividade da 006 e o design da UX para esta feature.
- **FR-016**: A planilha MUST continuar sem o nome do hóspede ou outro dado pessoal dele, em qualquer aba.

### Key Entities *(include if feature involves data)*

- **Situação da cobrança**: texto do Comercial, até 100 caracteres. Uma das três situações reconhecidas ("Cobrada na maquininha", "Cobrada no Hunit", "Cancelada") ou uma situação livre, guardada e mostrada como veio.
- **Retorno do Comercial**: situação, responsável e, conforme a situação, código, hotel, valor e data. Estados: vazio, com problema (incompleto ou não entendido), aguardando validação (ou conferência no Hunit), confirmado ou recusado.
- **Decisão do Financeiro sobre uma situação livre**: confirmada como cobrada (com o valor e a origem dele), confirmada como cancelada sem cobrança ou recusada (com o motivo); quem decidiu e quando; desfeita ou não.
- **Aba da linha na planilha**: "A cobrar", "Aguardando validação do Financeiro" ou "Concluídas", decidida pelo estado da reserva e do retorno.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos retornos com situação e responsável, e com os dados da maquininha quando a situação é "Cobrada na maquininha", chegam a "Retornos a validar" (ou à fila "Cobradas no Hunit") na primeira leitura depois de preenchidos.
- **SC-002**: Nenhum retorno com situação livre fica em "Retornos com problema" pedindo código, hotel, valor ou data.
- **SC-003**: Em 100% dos retornos com problema testados, a mensagem cita só os campos que faltam para a situação escrita.
- **SC-004**: O Financeiro valida uma situação livre (lê, decide e, se for o caso, digita o valor ou o motivo) em menos de 1 minuto.
- **SC-005**: Em "A cobrar" ficam só linhas sem retorno, com problema ou recusadas: nenhuma linha que aguarda o Financeiro ou a conferência no Hunit há mais de 10 minutos continua lá.
- **SC-006**: Nenhuma linha é perdida ou duplicada nas mudanças de aba, em 100% dos casos testados (inclusive na primeira leitura depois da atualização).
- **SC-007**: Com o Comercial, a PM confirma que ele acha o que precisa fazer em "A cobrar" sem precisar filtrar ou pular linhas já respondidas.

## Assumptions

- A 008 está em produção e é a base: colunas O e P, "Cancelada" validada pelo Financeiro, fila "Cobradas no Hunit" e marcação "Cancelada sem cobrança". Esta feature muda a regra de leitura da situação e acrescenta a aba; não muda as colunas.
- A leitura dos retornos continua sendo a de hoje: automática, a cada 10 minutos, e pelo "Ler agora" do app. Por isso uma linha pode levar até cerca de 20 minutos para mudar de aba depois de preenchida (até 10 minutos sem mudança mais a leitura seguinte).
- As telas do app que mudam ("Retornos a validar", com o selo da situação livre e as três decisões, e o diálogo de "Confirmar como cobrada" com o valor) precisam do desenho da UX no Figma antes da implementação, pela regra do projeto. Sem o desenho, o plano usa os componentes que já existem (selos, diálogos e campos da 006).
- Uma situação livre não é interpretada pelo app além do reconhecimento das três situações sugeridas: quem decide o que ela significa é o Financeiro.
- A confirmação em lote não ganha as situações livres; continua com os retornos da maquininha e as "Cancelada".
- O app continua só lendo o Hunit; nenhuma rota de cobrança ou alteração é liberada (constitution, princípio II).
- Os retornos e as decisões seguem as regras de guarda e retenção já existentes; "Concluídas" continua apagando as linhas depois de 90 dias. A aba nova não apaga linhas por tempo: uma linha sai dela só pela decisão do Financeiro ou pela conferência no Hunit.

## Pontos para a PM

O usuário pediu este rascunho com as sugestões do desenvolvimento nos pontos que ele não definiu. Cada
sugestão está aplicada no texto acima e pode ser trocada sem mudar o resto da spec.

| # | Ponto | Sugestão | Onde |
|---|---|---|---|
| S1 | O que o Financeiro faz com uma situação livre | Três decisões, uma reserva por vez: "Confirmar como cobrada" (com o valor do Comercial ou digitado), "Confirmar como cancelada sem cobrança" e "Recusar" com motivo; selo "Outra situação" | FR-006, FR-007 |
| S2 | "Cobrada no Hunit" exige a data? | Não: basta o responsável, como as outras situações; quem confirma a cobrança é a leitura do Hunit | FR-002 |
| S3 | "Cancelada" passa a exigir o responsável? | Sim, como todas as situações (hoje basta a situação) | FR-002, história 1 cenário 8 |
| S4 | "Cobrada no Hunit" passa pelo Financeiro? E vai para a aba nova? | Continua indo direto para a conferência no Hunit (sem validação do Financeiro) e fica na aba nova enquanto espera, porque não depende mais do Comercial | FR-004, FR-010, história 2 cenário 3 |
| S5 | Recusa volta para "A cobrar"? | Sim, no fim da aba, com o motivo, para o Comercial corrigir | FR-011, história 2 cenário 4 |
| S6 | O Comercial edita na aba nova? | Não: a aba fica só para consulta; para mudar, ele pede a recusa ao Financeiro | FR-012, história 2 cenário 7 |
| S7 | Quando a linha muda de aba | Depois de 10 minutos sem mudança no retorno, para não sumir enquanto o Comercial preenche | FR-010 |
