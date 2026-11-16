# Quickstart: validação da feature 003 (tratativas manuais)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contratos**: [api-changes.md](./contracts/api-changes.md), [ipc.md](./contracts/ipc.md) | **Dados**: [data-model.md](./data-model.md)

Roteiro para provar que as tratativas funcionam de ponta a ponta. A seção 1 roda sem o Hunit real.
As seções 3 a 6 são a homologação. Ela roda num **ambiente de homologação** (§2.1), uma pilha
separada da de produção no PC do servidor, com reservas fictícias. **Nunca no banco de produção**:
anexar comprovantes de teste a reservas reais as marcaria como "Cobradas" para o Financeiro e a
Controladoria, e os documentos entrariam nas cópias de segurança. A homologação **não acessa o
Hunit**: o servidor de homologação aponta para um endereço inválido.

## Pré-requisitos

- No PC do servidor: o clone do repositório na branch da 003, Node 24, pnpm e o Docker em execução.
- Para os testes automatizados: Node 24, pnpm, Docker em execução e o Chromium do Playwright (como
  na 001 e na 002).

## 1. Testes automatizados

```powershell
pnpm test --project domain        # tipo do arquivo, elegibilidade, situação, prazo de reversão
pnpm test --project server-db     # contrato 1.5.0, perfis, lote, concorrência, retenção, cópia e restauração
pnpm test --project desktop       # leitura em memória, pré-visualização de e-mail, partes de 200
pnpm test --project desktop-ui    # seleção entre pesquisas, ações escondidas no perfil consulta
pnpm test --project desktop-e2e   # app real contra o servidor de teste; exige o Docker
```

| Grupo | Deve comprovar |
|---|---|
| `domain` | as cinco assinaturas aceitas; extensão trocada, vazio e 1 byte acima de 25 MiB recusados; a tabela de elegibilidade ([data-model §4](./data-model.md)); a situação derivada; o prazo de 30 dias |
| `server-db` | cada operação nova validada contra o `openapi.yaml` 1.5.0; perfil consulta recusado em todas as ações de registro (SC-006); nenhuma chamada ao Hunit (SC-003); tratativas iguais depois de uma nova coleta (SC-004); download idêntico (SC-005); restauração da cópia traz o documento (SC-007); filtro "pendente + sem tratativa" exato (SC-008); purga após 30 dias, na anonimização e dos órfãos |
| `desktop` | arquivo de 26 MB recusado sem ser lido; .eml e .msg viram remetente, assunto, data, texto e anexos; .msg corrompido vira "não foi possível pré-visualizar"; seleção de 450 reservas vai em 3 partes |
| `desktop-ui` | US3 cenários 4 a 6: marcas mantidas entre pesquisas, filtros e páginas; lista da seleção; limpar; só as falhas ficam marcadas depois de aplicar |
| `desktop-e2e` | US1 a US4 de ponta a ponta; pré-visualização sem acesso à rede e sem arquivo novo na pasta de dados do app nem na pasta temporária (SC-011) |

## 2. Gerar o instalador

```powershell
pnpm install
pnpm build
pnpm --filter @hunit/desktop dist
```

### 2.1 Ambiente de homologação (T056)

Tudo no PC do servidor, sem tocar na pilha de produção (`hunit-control`). Comandos no PowerShell, na
raiz do repositório.

1. Compile o projeto (o app compilado é usado no passo 7):
   ```powershell
   pnpm install
   pnpm build
   ```
2. Crie a pasta e o `.env.homolog` (o Git ignora). O trecho abaixo copia o modelo
   `deploy\homolog\homolog.env.example` e preenche `POSTGRES_PASSWORD`, `ACCOUNT_KEY_SECRET` e
   `BACKUP_PASSPHRASE` com valores aleatórios novos, sem mostrá-los. O modelo já define o projeto
   `hunit-homolog`, as portas 3100 e 8443, o banco em `127.0.0.1:55432`, as cópias em
   `C:/hunit-homolog/backups` (uma por hora) e o Hunit num endereço inválido.
   ```powershell
   New-Item -ItemType Directory -Force C:\hunit-homolog | Out-Null
   $s = { node -e "console.log(require('crypto').randomBytes(24).toString('hex'))" }
   $linhas = (Get-Content deploy\homolog\homolog.env.example) -replace '^POSTGRES_PASSWORD=$', "POSTGRES_PASSWORD=$(& $s)" -replace '^ACCOUNT_KEY_SECRET=$', "ACCOUNT_KEY_SECRET=$(& $s)" -replace '^BACKUP_PASSPHRASE=$', "BACKUP_PASSPHRASE=$(& $s)"
   [IO.File]::WriteAllLines("$PWD\.env.homolog", $linhas)
   ```
3. Suba a pilha **sem** o `backup`, para a primeira cópia já sair com os dados fictícios. **Todo
   comando da homologação leva `--env-file .env.homolog`**. Sem ele, o comando vai para a produção.
   ```powershell
   docker compose --env-file .env.homolog up -d --build db server proxy
   docker compose --env-file .env.homolog ps   # 3 containers hunit-homolog-…, todos "Up"
   ```
4. Grave os dados fictícios e gere os arquivos de teste. São 4 hotéis `HML1` a `HML4`, 2 000
   reservas de todas as classificações e, em `C:\hunit-homolog\arquivos`, os PDFs, o PNG, o .eml,
   o .msg, o arquivo de 26 MB, o executável renomeado e `reservas.txt`, com os números para as
   pesquisas. O script recusa um banco que já tenha reservas.
   ```powershell
   $pw = (Select-String -Path .env.homolog -Pattern '^POSTGRES_PASSWORD=(.+)$').Matches[0].Groups[1].Value
   $env:HUNIT_HOMOLOG_DATABASE_URL = "postgres://hunit:$pw@127.0.0.1:55432/hunit"
   $env:HUNIT_HOMOLOG_FILES_DIR = "C:\hunit-homolog\arquivos"
   pnpm test --project desktop homolog-prepare   # deve dar "1 passed", não "skipped"
   ```
   Falta o .jpg: abra o Paint, desenhe qualquer coisa sem dados reais e salve como JPEG em
   `C:\hunit-homolog\arquivos\imagem-teste.jpg`.
5. Ligue o `backup` e anote o tamanho da cópia **antes** (a primeira sai em alguns segundos):
   ```powershell
   docker compose --env-file .env.homolog up -d backup
   Get-ChildItem C:\hunit-homolog\backups | Select-Object Name, Length, LastWriteTime
   ```
6. Crie as duas chaves (cada comando mostra a chave **uma única vez**: copie para um bloco de notas
   temporário) e exporte o certificado raiz da homologação:
   ```powershell
   docker compose --env-file .env.homolog exec server node dist/cli.js create-client --name homolog-operador --role operator
   docker compose --env-file .env.homolog exec server node dist/cli.js create-client --name homolog-consulta --role reader
   docker compose --env-file .env.homolog cp proxy:/data/caddy/pki/authorities/local/root.crt C:\hunit-homolog\raiz-homolog.crt
   certutil -dump C:\hunit-homolog\raiz-homolog.crt | Select-String "sha256"
   ```
7. Abra o app compilado duas vezes, cada uma com sua pasta de dados. Assim o app instalado, que está
   ligado à produção, não muda. Em dois terminais PowerShell, na raiz do repositório:
   ```powershell
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   $env:HUNIT_DESKTOP_USER_DATA_DIR = "C:\hunit-homolog\app-operador"   # no 2º terminal: app-consulta
   pnpm --filter @hunit/desktop exec electron .
   ```
   Em cada janela, em **Configuração → Conexão com o servidor**: "Endereço do servidor"
   `https://localhost:8443`; "Escolher certificado raiz…" → `C:\hunit-homolog\raiz-homolog.crt`
   (a impressão digital tem de ser a do `certutil`); "Chave de acesso" → a chave correspondente;
   "Testar conexão" deve mostrar o cliente `homolog-operador` (ou `homolog-consulta`) e o perfil;
   depois "Salvar conexão". A janela "operador" faz o papel da máquina do Financeiro (§3 a §5), e a
   "consulta" o da Controladoria (§6).

Ao terminar (§7), desmonte tudo: `docker compose --env-file .env.homolog down -v` (o `-v` apaga só
os volumes `hunit-homolog_*`) e apague `C:\hunit-homolog` e o `.env.homolog`.

## 3. Comprovante e valor manual (US1) — janela "operador"

1. Em Reservas, filtre uma reserva **pendente de cobrança** e escolha "Anexar comprovante".
2. Escolha o PDF de teste: a pré-visualização aparece em até 3 s (SC-010). Cancele e confira que a
   reserva não mudou.
3. Repita e confirme: a reserva fica **Cobrada**, com o arquivo, quem anexou e quando (SC-001: em até
   1 min desde achar a reserva).
4. Informe o valor cobrado, confira o rótulo "informado à mão" e depois volte ao valor do Hunit.
5. Anexe outro comprovante (a pré-visualização mostra qual será substituído); depois **reverta**: o
   anterior volta a ser o atual (SC-009: em até 30 s).
6. Tente anexar a uma reserva **faturada** e a uma **já cobrada**: recusa com o motivo.
7. Tente o arquivo de 26 MB e o executável renomeado: recusa com o motivo, nada gravado.
8. Numa reserva **cobrar na maquininha**, anexe um comprovante: fica Cobrada.

## 4. Tratativa (US2)

1. Anexe o .eml de teste a uma reserva pendente: a pré-visualização mostra remetente, destinatários,
   assunto, data, texto e anexos; nenhuma imagem externa carrega.
2. Confirme: a reserva fica **Enviada** e continua aparecendo no filtro "pendente de cobrança".
3. Anexe o comprovante: fica **Cobrada**, com os dois documentos.
4. Desfaça o comprovante: volta a **Enviada**; o histórico mostra quem desfez e quando.
5. Repita o passo 1 com o .msg de teste.

## 5. Lote com seleção entre pesquisas (US3)

1. Pesquise 20 reservas, uma por vez, pelo número — trocando também hotel e período —, marcando cada
   uma; inclua 2 já cobradas. Confira que as 20 continuam marcadas ("Ver seleção") (SC-002).
2. "Anexar comprovante": a confirmação mostra a pré-visualização, 18 aceitas, 2 ignoradas e o
   total. Confirme: 18 Cobradas, 2 listadas com o motivo; a seleção fica vazia. Tudo em até 2 min.
3. Baixe o documento de duas das reservas e confira que é o mesmo arquivo (SC-005).

## 6. Consulta e perfil consulta (US4) — janela "consulta"

1. Filtre "pendente de cobrança" + "Sem tratativa": só aparecem as pendentes sem registro, em até
   5 s (SC-008). Filtre "Cobrada": aparecem as do passo 3 e 5. Use "Falta cobrar": aparecem as
   pendentes, inclusive as "Enviadas", e nenhuma "Cobrada".
2. Abra uma reserva Cobrada: vê os documentos e o histórico e consegue baixar o arquivo.
3. Confira que nenhuma ação de registro aparece (anexar, substituir, desfazer, reverter, valor).
4. Com a chave `homolog-consulta`, tente `POST /v1/treatment-documents` pela API de homologação
   (`http://127.0.0.1:3100`): deve dar `403 forbidden_for_role` (SC-006). O perfil é conferido antes
   do corpo, então um corpo vazio basta:
   ```powershell
   curl.exe -i -X POST http://127.0.0.1:3100/v1/treatment-documents -H "Authorization: Bearer <chave homolog-consulta>" -H "Content-Type: application/json" -d "{}"
   ```

## 6.1 Ajustes da homologação (T066): situação da reserva, alerta e histórico

No mesmo ambiente de homologação (§2.1), com os dados da primeira rodada.

1. Atualize o servidor e o app: `docker compose --env-file .env.homolog up -d --build` (a migration
   nova roda sozinha) e `pnpm build`; feche e abra de novo as duas janelas do app (§2.1, passo 7).
2. Lista (janela "operador"): uma coluna só, **"Situação da reserva"**. A 100001 mostra
   "Comprovante enviado", a 100021 (a única só com tratativa) "Tratativa enviada" e a 100022
   "Pendente de cobrança". Não há mais as colunas "Situação de cobrança" e "Tratativa".
3. Filtros: "Situação da reserva" = "Pendente de cobrança" traz a 100022, mas não a 100001 nem a
   100021; "Comprovante enviado" traz as do §3 e do §5; o antigo filtro de ativas e canceladas se
   chama "Ativa ou cancelada".
4. Detalhe da 100001: a situação no topo e, à parte, o quadro **"Status do Hunit"** com
   "Pendente de cobrança". O histórico mostra 5 itens e **"Mostrar mais"** (ela tem 20).
5. Simule uma nova verificação em que o Hunit passou a 100021 (só com tratativa) para "Já cobrada":
   ```powershell
   docker compose --env-file .env.homolog exec db psql -U hunit -d hunit -c "update reservations set previous_classification = classification, classification = 'virtual_card_already_charged', status_changed = true, status_changed_at = now() where hotel_code = 'HML1' and reservation_number = '100021'"
   ```
   Recarregue a lista: a 100021 mostra "Já cobrada" com **"Verificar"**, e o atalho **"A verificar"**
   a encontra. No detalhe, o alerta explica o motivo; **"Confirmar"** tira o alerta, a tratativa
   continua lá e o histórico mostra "Confirmou a verificação: Já cobrada".
6. Janela "consulta": vê a coluna, o alerta e o "Status do Hunit", mas não o botão "Confirmar".

## 7. Registrar os resultados

1. Espere a próxima cópia de segurança da homologação (até 1 h e 15 min depois da anterior;
   `docker compose --env-file .env.homolog logs backup`) e anote o tamanho **depois**.
2. Registre em `research.md` ("Resultados da homologação") os tempos de SC-001, SC-002, SC-009 e
   SC-010, o tamanho da cópia antes e depois e o resultado de cada passo, como na 002.
3. Desmonte o ambiente de homologação (fim da §2.1).
