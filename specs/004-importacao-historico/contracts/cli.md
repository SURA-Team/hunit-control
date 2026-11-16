# Contrato do comando `legacy-import`

**Feature**: [spec.md](../spec.md) | **Research**: [R-01](../research.md#r-01--onde-e-como-o-comando-roda-fr-002-fr-019-fr-020), [R-08](../research.md#r-08--simulação-confirmação-e-relatório-fr-005-fr-005a-fr-006-fr-018), [R-10](../research.md#r-10--associação-de-hotéis-fr-006a)

Subcomando de `apps/server/src/cli.ts`. Nunca acessa o Hunit nem pede token (FR-001). Precisa só de
`DATABASE_URL` (como o `create-client`); aplica as migrations pendentes antes, como os outros
comandos.

## Como rodar

Produção (pasta montada só para leitura num container de uso único):

```text
docker compose run --rm -v "C:\importacao:/import:ro" server node dist/cli.js legacy-import <subcomando> [opções]
```

Desenvolvimento e homologação (depois do `pnpm build`, com as variáveis do ambiente):

```text
pnpm --filter @hunit/server legacy-import <subcomando> [opções]
```

## Subcomandos

| Subcomando | Opções | O que faz |
|---|---|---|
| `simulate` | `--xlsx <arquivo>` `--files <pasta>` | Lê e confere tudo, sem gravar reservas nem documentos; atualiza as propostas de hotéis; grava o registro da simulação e mostra o relatório e o id |
| `hotels` | — | Lista os hotéis do sistema anterior: código, nome, linhas, situação (`proposta`, `confirmado`, `sem associação`) e hotel do catálogo |
| `hotels` | `--set <código> --hotel <código do catálogo>` | Confirma ou troca a associação |
| `hotels` | `--set <código> --none` | Deixa o hotel sem associação (as linhas dele são recusadas) |
| `hotels` | `--accept-proposals` | Confirma todas as propostas |
| `run` | `--simulation <id>` `--xlsx <arquivo>` `--files <pasta>` | Confere a impressão digital contra a simulação e importa; mostra o relatório e as diferenças |
| `report` | `--id <id>` | Mostra de novo o relatório de uma simulação ou importação |
| `--help` | — | Uso |

## Saída

Só no terminal e em `legacy_imports`, nunca em arquivo. Formato (texto, em português):

```text
Simulação 7f1c… — planilha conferida (Reservas: 35 colunas, Tratativas: 14 colunas)

                 criadas  atualizadas  ignoradas  recusadas
Reservas            1234           10          3         12
Tratativas           210            0          1          4
Comprovantes         180            0          0          2
Valores manuais       15            0          0          1
Arquivos da pasta sem referência: 7

Hotéis sem associação (linhas recusadas):
  hotel_exemplo_centro   "Hotel Exemplo Centro"   proposta: 1234 (Hotel Exemplo Centro)

Ignorados e recusados:
  Reservas linha 18   hotel_exemplo_centro   123456   reserva     recusada   Data ilegível: Entrada
  Tratativas linha 4  hotel_exemplo_praia    654321   comprovante recusado   Arquivo não encontrado na pasta
  …

Avisos:
  3 reservas com check-in há mais de 5 anos serão gravadas já anonimizadas.

Para importar: legacy-import run --simulation 7f1c… --xlsx … --files …
```

Nunca aparecem: nome de hóspede, valores, datas, nomes de arquivo, conteúdo de célula (FR-018). O
andamento durante a importação mostra só "N de M reservas".

## Códigos de saída

| Código | Quando |
|---|---|
| 0 | Terminou (com ou sem recusas) |
| 1 | Erro de uso, arquivo ou pasta inexistente, aba ou coluna obrigatória faltando, outra importação em andamento, impressão digital diferente da simulação, falha geral |
