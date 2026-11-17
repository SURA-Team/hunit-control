# Formato da planilha do Comercial

Contrato entre o sistema e a planilha compartilhada com o Comercial (spec FR-008 a FR-011; research
R-05 a R-08). Preparado pelo comando `commercial-sheet setup` ([cli.md](./cli.md)) e conferido a cada
rodada do sincronizador. Nenhum dado real neste arquivo.

## Abas

| Aba | Conteúdo | Edição pelo Comercial |
|---|---|---|
| **A cobrar** | linhas `open` (enviadas, sem comprovante e ainda exigindo cobrança, inclusive "Validar comprovante" e recusadas) | só as colunas de retorno (K a N) |
| **Concluídas** | linhas `concluded` e `cancelled`, por 90 dias | nenhuma (aba protegida inteira) |

Linha 1: cabeçalhos, congelada. Dados a partir da linha 2. Novas linhas entram no fim de "A cobrar";
ao concluir, a linha é acrescentada no fim de "Concluídas" e apagada de "A cobrar".

## Colunas (nomes confirmados na clarificação de 2026-11-17)

| Col. | Nome | Preenchida por | Conteúdo | Formato |
|---|---|---|---|---|
| A | Hotel | sistema | nome do hotel no catálogo ("Nome (código)" se houver nome repetido) | texto |
| B | Reserva | sistema | número da reserva | texto (`@`) |
| C | Check-in | sistema | data de entrada | `dd/mm/aaaa` |
| D | Canal | sistema | canal da reserva | texto |
| E | Valor a cobrar | sistema | total da reserva no Hunit (vazio se não houver) | `R$ #.##0,00` |
| F | Motivo | sistema | classificação em português (ex.: "Pendente de cobrança") | texto |
| G | Ativa ou cancelada | sistema | "Ativa", "Cancelada" ou "Não identificada" | texto |
| H | Situação | sistema | situação detalhada (ex.: "Tratativa enviada", "Validar comprovante", "Comprovante enviado", "Já cobrada", "Pedido cancelado pelo Financeiro") | texto |
| I | Enviada em | sistema | último envio | `dd/mm/aaaa hh:mm` |
| J | Validação do Financeiro | sistema | vazio, "Aguardando validação do Financeiro", "Recusado pelo Financeiro: <motivo>", "Confirmado pelo Financeiro" ou o problema do retorno ("Retorno incompleto: falta o valor cobrado") | texto |
| K | Código de autorização | Comercial | texto livre, até 100 | texto |
| L | Hotel da cobrança | Comercial | estabelecimento que aparece na maquininha, texto livre, até 100 | texto |
| M | Valor cobrado | Comercial | valor em reais > 0, até 2 casas | `R$ #.##0,00` |
| N | Responsável pela cobrança | Comercial | funcionário do Comercial, até 100 | texto |

Proibido em qualquer coluna: nome do hóspede ou outro dado pessoal do hóspede (spec FR-010, SC-007).
Os rótulos em português vêm de `packages/domain/src/commercial-sheet.ts`, conferidos contra os do app
por teste.

## Proteções

- "A cobrar": intervalo protegido nas colunas A:J inteiras (vale para linhas novas) e na linha 1;
  editores = só a conta de serviço.
- "Concluídas": aba inteira protegida; editores = só a conta de serviço.
- O dono do arquivo (quem administra) sempre pode editar; o Comercial entra como editor do arquivo,
  mas não das áreas protegidas.

## Configuração da planilha

Localidade `pt_BR` (vírgula decimal), fuso `America/Sao_Paulo`.

## O que o sincronizador faz com a planilha

| Situação encontrada | Ação |
|---|---|
| Linha do sistema faltando em "A cobrar" | acrescenta no fim e relata `restored_line` (exceto a primeira escrita) |
| Célula do sistema diferente do banco | reescreve a célula e relata `restored_line` |
| Linha duplicada (mesmo Hotel + Reserva) | mantém a primeira, apaga as outras e relata `duplicate_line` |
| Linha sem correspondência, com retorno preenchido | deixa como está e relata `orphan_line` |
| Linha sem correspondência e vazia | ignora |
| Cabeçalho ou aba diferente do esperado | não escreve nada, estado `layout_invalid`, até rodar o `setup` |
