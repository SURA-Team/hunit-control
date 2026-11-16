# Quickstart: validação da feature 004 (importação do histórico)

**Feature**: [spec.md](./spec.md) | **Contratos**: [cli.md](./contracts/cli.md), [api-changes.md](./contracts/api-changes.md) | **Dados**: [data-model.md](./data-model.md)

Três etapas: testes automatizados (dados fictícios), homologação (pilha `hunit-homolog`, planilha
fictícia) e importação real na produção. A planilha real e a pasta de anexos **nunca** entram no
repositório nem na homologação: ficam numa pasta temporária do PC do servidor, apagada no fim.

## Pré-requisitos

- O que a 003 pede (Node, pnpm, Docker Desktop, Chromium do Playwright) e `pnpm install && pnpm build`.
- Para a etapa 3: a cópia .xlsx da planilha do sistema anterior e a cópia da pasta de anexos.

## 1. Testes automatizados

```powershell
pnpm typecheck
pnpm lint
pnpm test --project domain        # valores, conversão, precedência, "A revisar", nomes de hotel
pnpm test --project server-db     # simulação, importação, reimportação, marcadores, coletor, retenção, contrato 1.6.0
pnpm test --project desktop-ui    # selo, filtro "Origem", seção "Sistema anterior", "A revisar"
```

Esperado: tudo verde. Em especial (research R-14): a simulação não grava nada (SC-002); importar
duas vezes não duplica (SC-003); documentos baixados idênticos (SC-004); zero chamadas ao Hunit
(SC-005); nenhum marcador da planilha fictícia na saída, no log nem em `legacy_imports` (SC-006); a
mesma contagem e primeira verificação com o coletor antes ou depois (SC-007).

Medição de SC-008 (lenta, fora da rodada normal): `$env:HUNIT_LEGACY_PERF = "1"; pnpm test --project
server-db legacy-import-perf` — simulação de 20 000 linhas e 2 000 anexos em até 5 min, importação
em até 15 min.

## 2. Homologação (pilha `hunit-homolog`, dados fictícios)

1. Suba a homologação como na 003 ([quickstart §2.1](../003-tratativas-manuais/quickstart.md),
   passos 1 a 7). **Todo comando leva `--env-file .env.homolog`.**
2. Gere a planilha e os anexos fictícios para os hotéis `HML1` a `HML4` (com hotel sem associação,
   linhas ilegíveis, duplicadas, anexo antigo, arquivo ausente, executável renomeado, 26 MB, valor
   manual sem comprovante, reservas que já existem na homologação e check-in antigo):
   ```powershell
   $env:HUNIT_HOMOLOG_DATABASE_URL = "postgres://hunit:$pw@127.0.0.1:55432/hunit"   # como no §2.1
   $env:HUNIT_LEGACY_HOMOLOG_DIR = "C:\hunit-homolog\importacao"
   pnpm test --project server-db legacy-homolog-prepare   # "1 passed"; gera planilha.xlsx e anexos\
   ```
3. Simule e confira o relatório (contagens, motivos, nenhum dado pessoal, hotel sem associação com
   proposta):
   ```powershell
   docker compose --env-file .env.homolog run --rm -v "C:\hunit-homolog\importacao:/import:ro" server node dist/cli.js legacy-import simulate --xlsx /import/planilha.xlsx --files /import/anexos
   ```
4. Confirme os hotéis e simule de novo (os hotéis confirmados deixam de aparecer como recusados):
   ```powershell
   docker compose --env-file .env.homolog run --rm server node dist/cli.js legacy-import hotels
   docker compose --env-file .env.homolog run --rm server node dist/cli.js legacy-import hotels --accept-proposals
   # repita o passo 3 e anote o id da simulação
   ```
5. Importe e confira as diferenças (devem ser zero):
   ```powershell
   docker compose --env-file .env.homolog run --rm -v "C:\hunit-homolog\importacao:/import:ro" server node dist/cli.js legacy-import run --simulation <id> --xlsx /import/planilha.xlsx --files /import/anexos
   ```
6. Rode o passo 5 de novo com uma simulação nova: tudo "ignorado", nada criado (SC-003).
7. No app (janelas "operador" e "consulta" da 003):
   - filtro **Origem → Sistema anterior**: as importadas, com o selo, também combinado com hotel e
     "Situação da reserva" (US4);
   - detalhe de uma importada: seção "Sistema anterior" (classificação original, verificações, data
     da importação) e "Ainda não verificada pelo HUNIT Control";
   - uma reserva já existente antes da importação: classificação do HUNIT Control mantida, primeira
     verificação e contagem ajustadas (US2, cenário 3);
   - **Situação da reserva → A revisar (sistema anterior)**: aparecem as "Sem cartão virtual", que
     **não** aparecem em "Falta cobrar"; uma delas com tratativa continua "A revisar", sem
     "Verificar" (FR-007a);
   - "Falta cobrar": as pendentes antigas aparecem junto com as da homologação (SC-009);
   - documentos importados: abrem, baixam idênticos e o histórico mostra "Sistema anterior" com a
     data original (US3);
   - perfil consulta: vê tudo isso e não tem nenhuma ação nova.
8. Reclassificação de "A revisar" (US2, cenário 7): na homologação o Hunit é simulado só nos testes;
   aqui, confira pelo teste `server-db` correspondente. Na produção, a etapa 3 confere de verdade.
9. Desmonte como na 003 e apague `C:\hunit-homolog\importacao`.

## 3. Importação real (produção, pilha `hunit-control`)

Comandos na pasta de produção (`C:\Dev\producao\hunit-control`), **sem** `--env-file .env.homolog`.

1. Atualize a produção para a versão com a 004 (`git pull`, `docker compose up -d --build`); a
   migration roda ao subir. Confira que a cópia de segurança do dia foi feita (`docker compose logs
   backup`).
2. Copie a cópia .xlsx e a pasta de anexos para `C:\importacao` (fora de qualquer repositório):
   `C:\importacao\planilha.xlsx` e `C:\importacao\anexos\`.
3. Simule, confira os hotéis e simule de novo (como na homologação, passos 3 e 4). Revise com o
   Financeiro as recusas e os hotéis sem associação **antes** de importar.
4. Importe (`run --simulation <id>`) e guarde o id da importação (`legacy-import report --id <id>`
   mostra o relatório de novo quando precisar).
5. No app, confira por amostragem: algumas reservas pendentes antigas, uma "A revisar", uma com
   comprovante (abrir e baixar).
6. Rode uma execução no Hunit cobrindo o período do sistema anterior (por hotel e mês, como de
   costume): as "A revisar" recebem a classificação do Hunit e as pendentes antigas são atualizadas
   (FR-007a). Confira que nenhuma reserva ficou em "A revisar" entre as que a execução encontrou.
7. **Apague `C:\importacao`** e esvazie a lixeira (FR-018). Os dados ficam só no banco e nas cópias
   de segurança cifradas.
8. Mudou algo visível no app: rode a skill `figma-screens-sync` para a página
   `004-importacao-historico` (AGENTS.md).
