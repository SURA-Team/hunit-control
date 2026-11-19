# Formato da planilha do Comercial: acréscimos da 008

**Feature**: [spec.md](../spec.md) | **Research**: [R-05](../research.md#r-05--planilha-colunas-situação-da-cobrança-e-data-da-cobrança), [R-06](../research.md#r-06--leitura-do-retorno-com-situação-e-data)

Só o que muda em relação ao contrato da 005
([specs/005-envio-comercial/contracts/sheet-layout.md](../../005-envio-comercial/contracts/sheet-layout.md)),
que continua valendo no resto. Nenhum dado real neste arquivo.

## Colunas novas (no fim, depois de N)

| Col. | Nome | Preenchida por | Conteúdo | Formato e validação |
|---|---|---|---|---|
| O | Situação da cobrança | Comercial | "Cobrada na maquininha", "Cobrada no Hunit", "Não cobrada" ou outro texto, até 100 | lista suspensa com as três opções, **não estrita** (aceita outro texto, com o aviso da planilha) |
| P | Data da cobrança | Comercial | dia em que a cobrança foi feita | `dd/mm/aaaa`; validação "data válida", **estrita** (recusa o que não é data) |

O que cada situação exige e faz está na spec (FR-007a) e no research (R-06): "Cobrada na maquininha",
vazia ou outro texto exigem K a N; "Cobrada no Hunit" e "Não cobrada" exigem só N (responsável).

## Coluna J (Validação do Financeiro): textos novos

| Texto | Quando | Cor |
|---|---|---|
| Aguardando verificação no Hunit | relato "Cobrada no Hunit", ainda não lido no Hunit depois do relato | laranja (`#FFA94D`), como "Aguardando validação do Financeiro" |
| Cobrança não encontrada no Hunit | relato "Cobrada no Hunit", lido e o Hunit ainda exige cobrança | vermelho (`#FF6B6B`) |
| Não cobrada: aguardando o Financeiro | relato "Não cobrada" | vermelho (`#FF6B6B`) |
| Cancelada sem cobrança pelo Financeiro | reserva marcada (a linha está em "Concluídas") | sem cor |

## Outras mudanças

- **Coluna E (Valor a cobrar)**: R$ 0,00 na reserva marcada como cancelada sem cobrança (o valor a
  cobrar, não o total do Hunit).
- **Coluna H (Situação)**: "Cancelada sem cobrança" na reserva marcada (o nome que já existe).
- **Proteções**: em "A cobrar", K a P editáveis pelo Comercial; A:J continuam protegidas.
  "Concluídas" continua protegida inteira.
- **Aparência**: cabeçalho de O e P em lima, como K a N; larguras fixas novas para O e P; bordas e
  listras de dados de A a P.
- **Formato esperado**: o cabeçalho conferido a cada rodada passa a ter 16 colunas. Uma planilha da 005
  fica com `layout_invalid` até o `commercial-sheet setup` rodar de novo, que acrescenta O e P (com
  validação, proteção e aparência) sem mexer nas linhas que já existem. O `check` aponta as colunas
  faltando.

## Cópia para e-mail

Sem mudança: as 8 primeiras colunas (A a H).
