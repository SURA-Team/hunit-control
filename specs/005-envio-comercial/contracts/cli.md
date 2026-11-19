# Comando administrativo `commercial-sheet`

Comando de implantação no servidor (constitution 1.2.0, princípio III, exceção): rodado por quem
administra, no PC do servidor; não é usado pelos clientes; não acessa o Hunit; o que o sistema grava
por causa dele fica visível pela API (`GET /commercial-sheet`). Research R-05.

```text
docker compose exec server node dist/cli.js commercial-sheet setup
docker compose exec server node dist/cli.js commercial-sheet check
# fora do Docker (depois do pnpm build):
pnpm --filter @hunit/server commercial-sheet <setup|check>
```

Usa `COMMERCIAL_SHEET_ID` e `COMMERCIAL_SHEET_KEY_FILE` do ambiente do servidor; não recebe nenhum
dos dois por argumento (não ficam no histórico do terminal).

## `setup`

Prepara a planilha de forma repetível ([sheet-layout.md](./sheet-layout.md)): abas, cabeçalhos,
localidade, fuso, formatos, linha congelada, aparência (cores, listras, bordas e larguras) e
proteções. Não apaga linhas existentes. Se a planilha já
tiver abas com outros nomes, elas ficam como estão (o sincronizador só usa as duas abas do formato).

Saída (sem a chave, o e-mail da conta de serviço completo nem o ID):

```text
Planilha do Comercial: acesso OK (conta de serviço co…@….iam.gserviceaccount.com)
Aba "A cobrar": criada | já existia
Aba "Concluídas": criada | já existia
Cabeçalhos: gravados
Aparência: cabeçalho preto e lima, listras, bordas tracejadas e cores da Validação do Financeiro
Proteções: colunas A:J de "A cobrar" e "Concluídas" inteira (só a conta de serviço edita)
Pronto. Compartilhe a planilha com o Comercial como editor, no Google.
```

Códigos de saída: 0 = pronto; 1 = configuração ausente; 2 = sem acesso (planilha não compartilhada
com a conta de serviço, ou ID errado); 3 = falha da API do Google (mensagem genérica).

## `check`

Só confere acesso e formato, sem mudar nada. Mostra o estado de cada item ("OK" ou o problema) e as
contagens de linhas por aba. Mesmos códigos de saída, mais 4 = formato diferente do esperado (rode o
`setup`).
