# Formato da planilha do Comercial: acréscimos da 009

**Feature**: [spec.md](../spec.md) | **Research**: [R-02, R-06, R-07](../research.md)

Só o que muda em relação à 005 e à 008
([005](../../005-envio-comercial/contracts/sheet-layout.md), [008](../../008-ajustes-cobranca-e-aviso/contracts/sheet-layout.md)).
Nenhum dado real neste arquivo.

## Abas

| Aba | Conteúdo | Edição pelo Comercial |
|---|---|---|
| **A cobrar** | linhas abertas sem retorno, com retorno com problema, recusadas, ou aguardando há menos de 10 minutos | só as colunas de retorno (K a P) |
| **Aguardando validação do Financeiro** (nova, entre as duas) | linhas abertas com retorno aguardando validação (inclusive situação livre e "Cancelada") ou "Cobrada no Hunit" aguardando a verificação, sem mudança há 10 minutos ou mais | nenhuma (aba protegida inteira) |
| **Concluídas** | sem mudança | nenhuma |

Mesmas colunas (A a P), cabeçalho, larguras, bordas, listras e cores da coluna J de "A cobrar". O que leva
uma linha a cada aba está no [data-model §4](../data-model.md#4-aba-da-linha-na-planilha).

## O que cada situação exige (coluna O)

| Situação | Exige além da situação | Vai para |
|---|---|---|
| "Cobrada na maquininha" (contém "maquininha") | responsável (N), código (K), hotel (L), valor (M), data (P) | Retornos a validar |
| "Cobrada no Hunit" (contém "hunit") | responsável | fila "Cobradas no Hunit" (data opcional desde a 009) |
| "Cancelada" (começa com "Cancelada") | responsável (desde a 009) | Retornos a validar |
| outro texto | responsável | Retornos a validar, como situação livre |

A lista suspensa da coluna O continua com as três opções, não estrita. A validação da data (P) continua
estrita, mas a coluna deixa de ser obrigatória fora da maquininha.

## Coluna J: textos

Nenhum texto novo. Exemplos da regra nova de "Retorno incompleto":

- situação livre sem responsável: "Retorno incompleto: falta o responsável pela cobrança";
- maquininha só com responsável: "Retorno incompleto: faltam o código de autorização, o hotel da
  cobrança, o valor cobrado e a data da cobrança";
- sem situação e sem responsável: "Retorno incompleto: faltam o responsável pela cobrança e a situação da
  cobrança".

## Sincronizador

| Situação encontrada | Ação |
|---|---|
| Linha que deve mudar de aba | acrescenta no fim da aba de destino, copiando K a P, e apaga onde estava (como hoje entre "A cobrar" e "Concluídas") |
| K a P diferentes do último lido, na aba nova | reescreve e relata `restored_line` |
| Aba nova faltando | `layout_invalid` até o `setup` ("a aba 'Aguardando validação do Financeiro' não existe") |

## Comando de preparação (`commercial-sheet setup` / `check`)

O `setup` cria a aba nova (entre as outras duas), escreve o cabeçalho, protege a aba inteira e aplica a
aparência, sem mexer nas linhas que já existem. Pode rodar de novo. O `check` mostra a aba nova e a proteção
dela.
