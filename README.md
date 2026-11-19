# HUNIT Control

Automatiza a consulta de reservas e cartões virtuais na extranet do Hunit, que não tem API
pública. O servidor faz o login no Hunit com Playwright/Chromium (o operador informa o token 2FA),
lê as reservas de cada hotel, classifica a situação de cobrança de cada uma e guarda tudo num
PostgreSQL. Uma API HTTP expõe as execuções e os resultados para os clientes: o app desktop
(Electron, nas máquinas do Financeiro e da Controladoria) e, no futuro, o Sura.

O sistema **só lê** o Hunit: rotas de cobrança, cartão e alteração são bloqueadas no próprio
servidor.

- O que a feature faz e por quê: [specs/001-consulta-reservas-hunit/spec.md](specs/001-consulta-reservas-hunit/spec.md)
- Como foi construída: [plan.md](specs/001-consulta-reservas-hunit/plan.md) e
  [research.md](specs/001-consulta-reservas-hunit/research.md)
- Contrato da API: [packages/contracts/openapi.yaml](packages/contracts/openapi.yaml)
- Validação ponta a ponta: [quickstart.md](specs/001-consulta-reservas-hunit/quickstart.md)
- App desktop: [specs/002-app-desktop/spec.md](specs/002-app-desktop/spec.md),
  [plan.md](specs/002-app-desktop/plan.md) e [quickstart.md](specs/002-app-desktop/quickstart.md)
- Envio ao Comercial pela planilha do Google: [specs/005-envio-comercial/spec.md](specs/005-envio-comercial/spec.md),
  [plan.md](specs/005-envio-comercial/plan.md) e [quickstart.md](specs/005-envio-comercial/quickstart.md)
- Homologação de cada feature, antes da produção: seção [Homologação](#homologação)
- Guia para agentes de código, estrutura do repositório e todos os comandos: [AGENTS.md](AGENTS.md)

## Desenvolvimento

Pré-requisitos: Node.js 24 LTS ou mais novo, pnpm na versão do campo `packageManager` do
`package.json` (`npm install -g pnpm@<versão>`) e Docker Desktop em execução.

```powershell
pnpm install
pnpm --filter @hunit/server exec playwright install chromium   # uma vez
pnpm test          # todos os testes; os de banco sobem um PostgreSQL temporário no Docker
pnpm typecheck
pnpm lint
```

O app desktop abre em desenvolvimento com `pnpm --filter @hunit/desktop dev`. No terminal do
VS Code, rode antes `Remove-Item Env:ELECTRON_RUN_AS_NODE`: o editor define essa variável, e com ela
o Electron não abre a janela. Os testes de ponta a ponta do app (`pnpm test --project desktop-e2e`)
abrem janelas na tela por alguns segundos.

No desenvolvimento o Hunit é simulado nos testes. O acesso ao Hunit real só acontece com uma
pessoa digitando as credenciais e o token no próprio terminal (`hunit:login-check` e
`hunit:reservations-check`, ver [AGENTS.md](AGENTS.md)).

## Implantação no PC de produção

Por enquanto o servidor roda num PC comum da rede da empresa, com Docker Desktop, ligado e
desligado manualmente. As pessoas que usam o sistema acessam a API a partir das próprias máquinas,
na mesma rede, sempre por HTTPS (research R-20 e R-21).

```text
máquinas da rede ──HTTPS (porta 443)──► proxy (Caddy) ──► server (porta 3000, só 127.0.0.1) ──► db
                                                                                                │
                                              backup ── cópia cifrada a cada 24 h ──► BACKUP_DIR
```

| Serviço | O que faz |
|---|---|
| `server` | API HTTP e automação do Hunit. A porta HTTP só aceita conexões do próprio PC |
| `db` | PostgreSQL 17, com os dados no volume `pgdata` |
| `proxy` | Recebe o HTTPS da rede, com certificado emitido pela autoridade certificadora interna do Caddy |
| `backup` | Cópia cifrada do banco para a pasta `BACKUP_DIR` e restauração |

### 1. Preparar o PC

1. **Endereço fixo**: reserve um IP para o PC no roteador (reserva de DHCP pelo endereço MAC) ou
   configure um IP fixo no Windows. Alternativa: um nome que as outras máquinas resolvam na rede.
   Esse IP ou nome é o `SERVER_HOSTNAME`.
2. **Rede privada**: em Configurações → Rede e Internet, a rede do PC deve estar como **Privada**.
3. **Docker Desktop**: instale, abra uma vez e, em Settings → General, marque *Start Docker
   Desktop when you sign in to your computer*. Os containers voltam sozinhos quando o Docker sobe
   (`restart: unless-stopped`). O Docker Desktop só inicia depois que alguém entra no Windows.
4. **Sem suspensão**: enquanto a ferramenta estiver em uso, o PC não pode dormir. No PowerShell:

   ```powershell
   powercfg /change standby-timeout-ac 0
   ```

5. **Código**: clone o repositório numa pasta do PC (ex.: `C:\hunit-control`).

### 2. Escolher a pasta das cópias de segurança

As cópias precisam ficar **fora do PC**. Use uma destas opções:

- uma pasta sincronizada com a nuvem, como o Google Drive para computador no modo
  **Espelhar arquivos** (a pasta existe de verdade no disco). O modo *Fazer streaming* cria uma
  unidade virtual (ex.: `G:`) que o Docker Desktop pode não conseguir montar;
- um disco externo sempre conectado.

Unidades de rede mapeadas por letra costumam não funcionar no Docker Desktop. O teste com uma pasta
local do Windows funcionou; confira a pasta escolhida na homologação (quickstart, seção 5).

### 3. Configurar o `.env`

Na pasta do repositório:

```powershell
Copy-Item .env.example .env
notepad .env
```

Para gerar valores aleatórios:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variável | Valor |
|---|---|
| `POSTGRES_PASSWORD` | Aleatório (só letras e números) |
| `ACCOUNT_KEY_SECRET` | Aleatório. **Não troque depois**: o controle de "uma execução por conta" e o histórico dependem dele |
| `SERVER_HOSTNAME` | IP fixo ou nome do PC na rede (passo 1) |
| `HTTPS_PORT` | `443`, ou outra porta se a 443 estiver ocupada |
| `BACKUP_DIR` | Pasta do passo 2, com barras normais (ex.: `C:/Users/financeiro/Google Drive/hunit-backups`) |
| `BACKUP_PASSPHRASE` | Aleatório. Sem ela as cópias não podem ser restauradas |

**Guarde `ACCOUNT_KEY_SECRET` e `BACKUP_PASSPHRASE` fora do PC** (ex.: no gerenciador de senhas
da empresa). O `.env` não entra nas cópias de segurança: se o PC for perdido, esses dois valores
são necessários para restaurar.

### 4. Subir

```powershell
docker compose up -d --build
docker compose ps                                   # server, db, proxy e backup "Up"
curl.exe http://127.0.0.1:3000/v1/health            # → {"status":"ok"} (só no próprio PC)
```

Use `curl.exe`: no PowerShell 5.1, `curl` é outro comando.

### 5. Liberar a porta HTTPS no Firewall do Windows

No PowerShell **como administrador** (troque `443` se mudou o `HTTPS_PORT`):

```powershell
New-NetFirewallRule -DisplayName "HUNIT Control (HTTPS)" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -Profile Private
```

Só a porta HTTPS do proxy é aberta para a rede. A porta 3000 do servidor fica presa a
`127.0.0.1` e recusa conexões de outras máquinas (SC-013).

### 6. Instalar o certificado raiz nas máquinas que usam o sistema

O proxy emite o certificado HTTPS com uma autoridade certificadora própria, criada no primeiro
`up` e guardada no volume `caddy-data`. Cada máquina que acessa a API precisa confiar nela.

No PC do servidor, exporte o certificado raiz:

```powershell
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt .\hunit-raiz.crt
```

**Para o app desktop, não instale nada no Windows**: o app guarda o `hunit-raiz.crt` na própria
configuração e confia só nele (seção "App desktop", abaixo). Isso dispensa administrador e evita o
bloqueio por política da TI.

Instalar no Windows só é preciso para acessar a API pelo navegador ou pelo `curl`. Nesse caso,
instale como autoridade raiz, no PowerShell **como administrador**:

```powershell
Import-Certificate -FilePath .\hunit-raiz.crt -CertStoreLocation Cert:\LocalMachine\Root
```

(Ou: duplo clique no arquivo → Instalar Certificado → Máquina Local → "Colocar todos os
certificados no repositório a seguir" → Autoridades de Certificação Raiz Confiáveis.)

Depois, numa máquina cliente:

```powershell
curl.exe --ssl-no-revoke https://<SERVER_HOSTNAME>/v1/health        # → {"status":"ok"}
```

O `--ssl-no-revoke` é preciso no Windows: o `curl.exe` tenta conferir se o certificado foi
revogado, e a autoridade interna do Caddy não publica essa lista. O app desktop não faz essa
consulta.

Trocar o `SERVER_HOSTNAME` gera um certificado novo, mas o raiz continua o mesmo enquanto o volume
`caddy-data` existir. **Não apague esse volume**: se ele for perdido, um novo raiz é criado e
precisa ser instalado de novo em todas as máquinas.

### 7. Cadastrar os clientes da API

```powershell
docker compose exec server node dist/cli.js create-client --name desktop --role operator
docker compose exec server node dist/cli.js create-client --name consulta --role reader
```

A chave aparece **uma única vez**; entregue-a a quem vai usar. `operator` inicia, cancela e
retoma execuções e informa o token; `reader` só consulta. Crie **uma chave por máquina** (ex.:
`--name desktop-financeiro-ana`): o app reconhece as execuções iniciadas na própria máquina pelo
nome do cliente, e é só para essa máquina que ele avisa o pedido de token. Para revogar:
`docker compose exec server node dist/cli.js revoke-client --name <nome>`.

### 8. Validar

Siga a seção 5 do [quickstart](specs/001-consulta-reservas-hunit/quickstart.md): conexão cifrada
de outra máquina, cópia em atraso depois de o PC ficar desligado e uma restauração de teste.

### 9. Atualizar para uma versão nova

Depois que a feature foi homologada (seção "Homologação") e entrou na `master`. Na pasta da
produção, no PowerShell:

1. Confira que há uma cópia de segurança de hoje (`docker compose logs backup` ou a pasta
   `BACKUP_DIR`).
2. Atualize o código, compile e suba o servidor de novo. As migrations novas entram sozinhas quando
   o servidor sobe:
   ```powershell
   git checkout master
   git pull
   pnpm install
   pnpm build
   docker compose up -d --build
   docker compose ps                                   # server, db, proxy e backup "Up"
   curl.exe http://127.0.0.1:3000/v1/health            # {"status":"ok"}
   ```
3. Se a feature mudou a planilha do Comercial, rode o `commercial-sheet setup` e o `check` de novo
   ("Planilha do Comercial", passo 5).
4. Gere o instalador nesta mesma pasta ("App desktop" → "Gerar o instalador") e instale-o nas
   máquinas do Financeiro e da Controladoria. **Sempre o servidor antes do app**: o app novo pode
   usar rotas novas da API; o app antigo continua funcionando com o servidor novo, porque a API só
   ganha acréscimos.
5. Numa máquina, abra o app e confira a versão no rodapé da **Configuração** e as telas que a
   feature mudou.

## App desktop

O app desktop (`apps/desktop`) é como o Financeiro e a Controladoria usam o sistema: executar a
consulta e responder ao token, acompanhar, cancelar e retomar execuções, consultar reservas e
evidências e registrar as tratativas. Ele só fala com a API, por HTTPS, confirmando o servidor pelo
certificado raiz.

Perfis: as máquinas do Financeiro usam chave de perfil **operador** (executam e registram
tratativas); a Controladoria usa chave de perfil **consulta** (vê tudo e baixa os documentos, sem
executar nem registrar).

### Gerar o instalador

Numa máquina de desenvolvimento:

```powershell
pnpm install
pnpm build                          # compila o @hunit/domain e o @hunit/contracts que o app empacota
pnpm --filter @hunit/desktop dist
```

Sem o `pnpm build`, o instalador usa o `dist` antigo dos pacotes e a compilação falha com
`MISSING_EXPORT` quando o domínio ganhou funções novas (aconteceu na implantação da 005).

O instalador fica em `apps/desktop/release/` (`HUNIT Control Setup <versão>.exe`). Ele instala só
para o usuário do Windows, sem pedir administrador, e cria o atalho no Menu Iniciar.

A versão é `major.minor.<commits>`. O major e o minor vêm do campo `version` de
`apps/desktop/package.json` (ex.: `0.2.0`), e o último número é a quantidade de commits do Git, por
exemplo `0.2.131`. Por isso, cada atualização puxada para a pasta de produção gera um instalador com
número novo, e o mesmo código gera sempre o mesmo número. A versão aparece no rodapé da
**Configuração** ("HUNIT Control — versão …") e no nome do instalador. Suba o minor à mão só numa
feature nova com mudança no app (ex.: `0.2.0` → `0.3.0`). O último número do `package.json` fica
sempre `0`. Gere o instalador a partir de um clone completo do repositório: com
`git clone --depth`, a contagem fica errada.

### Instalar numa máquina

1. Copie o instalador para a máquina e abra.
2. O instalador não tem assinatura de código: o Windows mostra "O Windows protegeu o computador".
   Clique em **Mais informações** → **Executar assim mesmo**.
3. Abra o **HUNIT Control** pelo Menu Iniciar.

Desde a versão 0.3 (feature 006), o app tem o ícone novo. Ao atualizar uma máquina que já tinha o
app, o atalho do Menu Iniciar ou da barra de tarefas pode continuar com o ícone antigo por um tempo:
é o cache de ícones do Windows. Ele se atualiza sozinho; para forçar, desafixe e fixe o atalho de
novo na barra de tarefas ou reinicie o Windows.

### Configurar a conexão (primeira vez)

Tenha em mãos o endereço do servidor (`https://<SERVER_HOSTNAME>`), o `hunit-raiz.crt` (passo 6) e a
chave desta máquina (passo 7).

1. Em **Configuração**, informe o endereço do servidor.
2. Clique em **Escolher certificado raiz…** e escolha o `hunit-raiz.crt`. Confira a impressão
   digital mostrada com a do servidor:

   ```powershell
   # No PC do servidor
   certutil -dump .\hunit-raiz.crt | Select-String sha256
   ```

   A linha "Cert Hash(sha256)" mostra a mesma sequência que o app, com espaços no lugar dos
   dois-pontos.

3. Cole a chave de acesso e clique em **Testar conexão**. O app mostra o nome do cliente e o
   perfil. Só então **Salvar conexão** fica disponível.
4. Clique em **Testar aviso** e confira se a notificação do Windows aparece. Se não aparecer, ative
   as notificações do HUNIT Control em Configurações do Windows → Sistema → Notificações (e confira
   o "Não perturbe"). Mesmo sem a notificação, o app vem para a frente e toca o som.

A chave fica cifrada para o usuário do Windows (outro usuário da máquina não consegue lê-la). Usuário
e senha do Hunit nunca são gravados: ficam só na memória até o app ser fechado ou passar o prazo de
inatividade (8 horas, ajustável na Configuração). Para tirar a máquina do sistema, use **Remover a
configuração desta máquina** e revogue a chave no servidor.

Fechar a janela encerra o app. Se houver uma execução desta máquina em andamento, o app avisa antes:
ela continua no servidor, mas o pedido de token não chega com o app fechado. Ao abrir de novo, um
pedido de token ainda no prazo reaparece.

### Telas do app

Desde a versão 0.3 (feature 006), o app tem o visual do design da UX: menu lateral (só os ícones
quando a janela é estreita), uma ação principal por bloco, em preto (ou lima nos cards escuros), e
selos de situação com cores fixas (verde concluído, âmbar atenção, vermelho erro, lima em andamento,
cinza neutro). As telas se ajustam à janela de 960 a 1 920 px e ao zoom (Ctrl + / Ctrl −): nas
listas, as colunas que não cabem passam para a segunda linha.

- **Executar**: o acesso ao Hunit, o período e os hotéis; a execução em andamento e o resultado
  aparecem logo abaixo.
- **Execuções**: as em andamento ficam em cards escuros no topo, com o progresso; as encerradas,
  na lista. Clicar numa abre o detalhe, com os hotéis, as contagens e as evidências.
- **Reservas**: uma busca só, por hóspede, número da reserva, transação, autorização ou valor
  (`380,00`); **Origem** ao lado; **Filtros** abre os filtros avançados (hotel, período, situação…),
  e a linha **Filtros aplicados** mostra o que está valendo. Os filtros rápidos **Todas**, **Falta
  cobrar**, **A verificar**, **Com erro** e **Concluídas** mostram quantas reservas há em cada um. A
  lista vem ordenada por hotel e check-in. Clicar na linha abre o detalhe da reserva; a caixa à
  esquerda só marca.
- **Comercial**: as abas **Envios** (os em andamento em cards escuros no topo), **Retornos a
  validar**, **Retornos com problema** e **Planilha**.

### Tratativas manuais

Para as reservas que exigem cobrança (pendente de cobrança, erro na cobrança, cartão validado,
erro de análise e cobrar na maquininha), o Financeiro registra, no detalhe da reserva:

- a **tratativa** — o pedido de cobrança ao Comercial (por exemplo, o e-mail): a reserva fica
  **Tratativa enviada** e continua pendente;
- o **comprovante** — a prova de que o Comercial cobrou: a reserva fica **Comprovante enviado**.

Aceita e-mail (.eml ou .msg), PDF e imagem (.png, .jpg), de até 25 MB. Antes de confirmar, o app
mostra o arquivo; o servidor confere o conteúdo contra a extensão. Um documento substituído ou
desfeito fica guardado por **30 dias** e pode ser revertido nesse prazo. O valor cobrado pode ser
informado à mão quando o Hunit não traz o valor.

Para aplicar o mesmo documento a várias reservas, marque-as na lista (a seleção se mantém entre
pesquisas, até 2 000 reservas). A barra escura da seleção mostra quantas e o total; **Ver seleção**
lista as marcadas, e **Anexar ▾** tem **Anexar tratativa** e **Anexar comprovante**. O filtro
rápido **Falta cobrar** lista as reservas que exigem cobrança e ainda não têm comprovante. Nada
disso acessa o Hunit.

### Envio ao Comercial

Com a planilha do Comercial configurada no servidor ("Planilha do Comercial", abaixo), o
Financeiro envia os pedidos de cobrança direto para ela:

- **Enviar ao Comercial**, na barra da seleção: o app mostra quais reservas aceitam o envio e o
  total; pede o acesso ao Hunit (o mesmo das execuções) e o token. Antes de ir para a planilha, cada
  reserva é verificada no Hunit (só leitura): a que não exige mais cobrança é retirada, e a que não
  pode ser verificada não é enviada. A enviada fica como **Tratativa enviada**, como a tratativa por
  e-mail.
- O Comercial preenche, na aba "A cobrar", o código de autorização, o hotel da cobrança (o que
  aparece na maquininha), o valor cobrado e o responsável. O servidor lê os retornos a cada
  10 minutos (ou na hora, com **Ler retornos agora**, na área **Comercial**) e a reserva passa a
  **Validar comprovante**.
- O Financeiro confere o retorno no detalhe da reserva ou na aba **Retornos a validar** e
  **confirma** (vale como comprovante, e o valor cobrado do Comercial passa a valer) ou **recusa**
  com o motivo, que o Comercial vê na planilha. A confirmação pode ser em lote (**Confirmar
  marcados** na aba, ou **Confirmar ▾** → **Confirmar retornos** na barra da seleção), com uma
  lista de revisão antes; a recusa é sempre uma a uma.
- A lista de reservas mostra o **valor cobrado** com a origem (Hunit, manual ou Comercial).
- **Selecionar todas do filtro** marca até 2 000 reservas de todas as páginas; **Confirmar ▾** →
  **Confirmar "Verificar"** tira o alerta de várias de uma vez; **Copiar para e-mail** copia o
  resultado da pesquisa (ou a seleção) numa tabela com as colunas da planilha, sem o nome do
  hóspede, para colar no corpo do e-mail.
- Um envio em andamento aparece em card escuro no topo da aba **Envios**; fechar o diálogo do envio
  não o interrompe.

## Planilha do Comercial

Feita uma vez, no PC de produção, por quem administra a implantação (specs/005, FR-008a). A planilha
é uma planilha do Google com duas abas ("A cobrar" e "Concluídas"); o servidor escreve nela com uma
**conta de serviço** do Google, e a chave dessa conta fica só no servidor, numa pasta montada só para
leitura. Sem as duas variáveis da planilha, o envio ao Comercial fica desligado e o resto funciona.

1. No Google Cloud (console.cloud.google.com), num projeto da empresa: ative a **API do Google
   Sheets**, crie uma **conta de serviço** (sem papéis no projeto) e, nela, uma **chave JSON**.
2. Salve a chave como `deploy\secrets\commercial-sheet-key.json` na pasta de produção
   (`C:\Dev\producao\hunit-control`). A pasta é ignorada pelo Git (menos o README dela). Nunca
   envie a chave por e-mail ou chat nem a cole no `.env`.
3. Crie a planilha vazia no Google Drive da empresa (ex.: "HUNIT Comercial") e compartilhe-a com o
   e-mail da conta de serviço (`...@....iam.gserviceaccount.com`, no JSON) como **Editor**.
4. No `.env`, preencha as duas juntas:
   - `COMMERCIAL_SHEET_ID`: o ID da planilha (o trecho do endereço entre `/d/` e `/edit`);
   - `COMMERCIAL_SHEET_KEY_FILE=/run/secrets/commercial-sheet/commercial-sheet-key.json`.
5. Suba de novo e prepare a planilha (cria as abas, os cabeçalhos, a aparência e as proteções;
   pode rodar de novo sem estragar nada) e confira:
   ```powershell
   docker compose up -d
   docker compose exec server node dist/cli.js commercial-sheet setup
   docker compose exec server node dist/cli.js commercial-sheet check
   ```
   O `check` deve dizer "acesso OK" e "OK" nas duas abas, com a quantidade de linhas: o "OK" já
   quer dizer que o cabeçalho e as proteções estão certos. Ele não muda nada; se alguém alterar o
   formato da planilha, ele aponta o que mudou (rode o `setup` de novo).
   A aparência (cabeçalho preto e lima, listras, bordas tracejadas e a coluna "Validação do
   Financeiro" em lima, laranja ou vermelho, conforme o status) não é conferida: se alguém mudá-la,
   o `setup` a refaz. As regras de formatação condicional das duas abas são do sistema: o `setup`
   apaga as que alguém tiver criado ali.
6. Compartilhe a planilha com as contas do Comercial no Google, como **Editor**: as colunas do
   sistema (A a J de "A cobrar") e a aba "Concluídas" ficam protegidas; o Comercial só preenche as
   colunas de retorno (K a N).
7. No app, a área **Comercial → Planilha** deve mostrar "Funcionando".

Se a planilha ficar fora do ar, nada se perde: o servidor guarda as atualizações e as aplica quando
ela volta (a área **Comercial → Planilha** mostra as pendências e desde quando). As linhas de
"Concluídas" saem da planilha 90 dias depois (`COMMERCIAL_SHEET_DONE_RETENTION_DAYS`) e continuam
no banco. Variáveis e opções: `.env.example`; comando: [contracts/cli.md](specs/005-envio-comercial/contracts/cli.md).

## Importar o histórico do sistema anterior

Feita uma vez, no PC de produção, por quem administra a implantação (specs/004). A importação nunca
acessa o Hunit e não pede token. Os comandos rodam na pasta de produção, num container de uso único
que lê a pasta da importação só para leitura.

1. Confira que a cópia de segurança do dia foi feita (`docker compose logs backup`).
2. Baixe a cópia **.xlsx** da planilha do sistema anterior (abas "Reservas" e "Tratativas") e copie
   a pasta de anexos para `C:\importacao`, **fora de qualquer repositório**:
   `C:\importacao\planilha.xlsx` e `C:\importacao\anexos\`.
3. Simule. Nada é gravado; o relatório mostra o que seria criado, atualizado, ignorado ou recusado
   e por quê, sem dados de hóspedes nem valores, e termina com o id da simulação:
   ```powershell
   docker compose run --rm -v "C:\importacao:/import:ro" server node dist/cli.js legacy-import simulate --xlsx /import/planilha.xlsx --files /import/anexos
   ```
4. Associe os hotéis do sistema anterior aos do catálogo. A simulação propõe pelo nome; confira e
   confirme (ou troque, ou deixe sem associação):
   ```powershell
   docker compose run --rm server node dist/cli.js legacy-import hotels
   docker compose run --rm server node dist/cli.js legacy-import hotels --accept-proposals
   docker compose run --rm server node dist/cli.js legacy-import hotels --set <código antigo> --hotel <código do catálogo>
   ```
5. Simule de novo e revise as recusas com o Financeiro **antes** de importar.
6. Importe a simulação conferida. Se a planilha, a pasta ou a associação mudaram depois dela, o
   comando recusa e pede uma nova simulação:
   ```powershell
   docker compose run --rm -v "C:\importacao:/import:ro" server node dist/cli.js legacy-import run --simulation <id> --xlsx /import/planilha.xlsx --files /import/anexos
   ```
   Pode ser interrompida (Ctrl+C): o que entrou fica completo, e uma nova simulação e importação
   completam o resto sem duplicar. `legacy-import report --id <id>` mostra o relatório de novo
   (`--all` lista também cada linha já importada, que normalmente aparece só como contagem).
7. No app, confira por amostragem (filtro **Origem → Sistema anterior**). Depois, rode uma execução
   no Hunit cobrindo o período do sistema anterior: as reservas "A revisar (sistema anterior)"
   recebem a classificação do Hunit e as pendências antigas são atualizadas.
8. **Apague `C:\importacao`** e esvazie a lixeira. Os dados ficam só no banco e nas cópias de
   segurança cifradas.

## Rotinas automáticas

| Rotina | Quando | O que faz |
|---|---|---|
| Manutenção (no `server`) | Ao subir e a cada 24 h | Apaga evidências com mais de `EVIDENCE_RETENTION_DAYS` dias (padrão 30), anonimiza o nome do hóspede das reservas com check-in há mais de `RESERVATION_RETENTION_YEARS` anos (padrão 5) e apaga os arquivos das tratativas vencidos: substituídos ou desfeitos há 30 dias, os de reservas anonimizadas e os enviados e nunca registrados (o registro e o histórico ficam) |
| Planilha do Comercial (no `server`, quando configurada) | Segundos depois de cada mudança; confere pendências a cada 30 s e lê os retornos a cada 10 min | Escreve as linhas novas e as mudanças, move as concluídas para "Concluídas", lê os retornos do Comercial e tira da planilha as concluídas há mais de `COMMERCIAL_SHEET_DONE_RETENTION_DAYS` dias (padrão 90). Com a planilha fora do ar, tenta de novo sozinha |
| Cópia de segurança (no `backup`) | Verifica a cada 15 min | Faz uma cópia quando a mais nova tem mais de `BACKUP_INTERVAL_HOURS` horas (padrão 24) e apaga as com mais de `BACKUP_RETENTION_DAYS` dias (padrão 30) |

As duas olham o que está vencido, e não o horário: o que atrasou com o PC desligado é feito logo
que ele volta (FR-029).

Para acompanhar: `docker compose logs backup` e `docker compose logs server`. As cópias ficam em
`BACKUP_DIR` com o nome `hunit-AAAAMMDD-HHMMSS.dump.gpg` (horário UTC), cifradas com AES-256.
Elas contêm reservas, histórico, execuções, clientes da API (só o hash das chaves) e os documentos
das tratativas, que ficam no próprio banco — por isso as cópias crescem com eles; não contêm
credenciais nem token do Hunit, nem as evidências. Também têm os envios e os retornos do Comercial;
depois de uma restauração, a primeira rodada reconstrói a planilha a partir do banco. A chave da
planilha (`deploy/secrets`) não entra nas cópias: guarde-a fora do PC, como o `.env`.

## Restaurar uma cópia de segurança

A restauração substitui **todo** o conteúdo do banco pelo da cópia escolhida, numa única
transação: se algo falhar, nada muda.

### No mesmo PC

```powershell
docker compose stop server
docker compose run --rm --entrypoint bash backup /scripts/restore.sh hunit-AAAAMMDD-HHMMSS.dump.gpg
docker compose start server
```

### Num PC novo

1. Prepare o PC (seção "Implantação", passos 1 a 3) com um `.env` que tenha o
   **`ACCOUNT_KEY_SECRET` e a `BACKUP_PASSPHRASE` originais**. O `POSTGRES_PASSWORD` pode ser
   novo. O `BACKUP_DIR` deve apontar para a pasta com as cópias.
2. Restaure antes de subir o servidor:

   ```powershell
   docker compose up -d db
   docker compose run --rm --entrypoint bash backup /scripts/restore.sh hunit-AAAAMMDD-HHMMSS.dump.gpg
   docker compose up -d --build
   ```

3. Instale o novo certificado raiz nas máquinas clientes (passo 6): o volume `caddy-data` não vem
   na cópia.

As chaves dos clientes da API continuam valendo depois da restauração. Confira o resultado como na
seção 5 do quickstart.

## Homologação

Toda feature é homologada antes de ir para a produção, num ambiente próprio no PC do servidor: a
pilha `hunit-homolog`, com dados fictícios. Ela tem containers, volumes, rede, portas, chaves e
certificado próprios e nunca acessa o Hunit (o endereço dele é inválido de propósito). Os arquivos
da pilha estão em [deploy/homolog/](deploy/homolog/). O que cada feature confere está no quickstart
dela, e o resultado vai para o `research.md` dela ("Homologação").

Nomes e lugares fixos:

| | Produção | Homologação |
|---|---|---|
| Código | Clone da produção, na `master` | `C:\hunit-homolog\hunit-control`, clone próprio na branch da feature |
| Variáveis | `.env` | `.env.homolog` no clone da homologação (modelo: `deploy\homolog\homolog.env.example`). Não há `.env` nesse clone |
| Projeto do Docker | `hunit-control` | `hunit-homolog` |
| Portas | 443 (HTTPS, para a rede) e 3000 (só o PC) | 8443 (HTTPS) e 3100 (só o PC); banco em `127.0.0.1:55432`, para a carga dos dados fictícios |
| Endereço no app | `https://<SERVER_HOSTNAME>` | `https://localhost:8443` |
| Certificado raiz | `hunit-raiz.crt` | `C:\hunit-homolog\raiz-homolog.crt` |
| Clientes da API | Um por máquina | `homolog-operador` (perfil operador) e `homolog-consulta` (perfil consulta) |
| App | O instalado | O compilado do clone, numa janela por perfil, com dados em `C:\hunit-homolog\app-operador` e `app-consulta` |
| Planilha do Comercial | A real | "HUNIT Comercial — homologação", com conta de serviço e chave próprias em `C:\hunit-homolog\secrets` |
| Cópias de segurança | `BACKUP_DIR` da produção | `C:\hunit-homolog\backups`, uma por hora, guardadas por 2 dias |
| Dados | Reais | Fictícios: hotéis `HML1` a `HML4`, 2 000 reservas e arquivos de teste em `C:\hunit-homolog\arquivos` |

Regras:

- **Todo comando roda em `C:\hunit-homolog\hunit-control` e leva `--env-file .env.homolog`.** Sem
  ele, o Docker Compose vai para o projeto da produção. Como o clone da homologação não tem `.env`,
  um comando sem o `--env-file` para no erro "required variable POSTGRES_PASSWORD is missing" sem
  mexer em nada. Nunca crie um `.env` nesse clone.
- A homologação usa o código que está no GitHub: dê push na branch antes de atualizar.
- Nunca use valores do `.env` da produção nem dados reais (reservas, documentos, a planilha real).
- O que depende do Hunit (token, leitura das reservas, verificação do envio) não roda aqui: fica com
  os testes automáticos, com o Hunit simulado. Executar e "Enviar ao Comercial" falham no acesso, de
  propósito. O Hunit real só na produção e com autorização.
- Não libere a porta 8443 no Firewall: o app da homologação roda no próprio PC.
- O app instalado no PC continua ligado à produção. Na homologação, use sempre o app compilado do
  clone (passo 7), que guarda a configuração em outra pasta. Instalar o app novo no PC antes de
  atualizar a produção deixaria o app da produção mais novo que o servidor.

### Montar a homologação (uma vez)

No PowerShell. O PC precisa do Docker Desktop, do Node.js e do pnpm, como no desenvolvimento.

1. Crie a pasta e o clone na branch da feature, e compile (o app compilado é usado no passo 7):
   ```powershell
   New-Item -ItemType Directory -Force C:\hunit-homolog | Out-Null
   git clone https://github.com/SURA-Team/hunit-control.git C:\hunit-homolog\hunit-control
   cd C:\hunit-homolog\hunit-control
   git checkout <branch-da-feature>
   pnpm install
   pnpm build
   ```
2. Crie o `.env.homolog` (o Git ignora). O trecho abaixo copia o modelo e preenche
   `POSTGRES_PASSWORD`, `ACCOUNT_KEY_SECRET` e `BACKUP_PASSPHRASE` com valores aleatórios novos, sem
   mostrá-los. O modelo já tem o projeto, as portas, as pastas e o Hunit inválido; não mude essas
   linhas.
   ```powershell
   $s = { node -e "console.log(require('crypto').randomBytes(24).toString('hex'))" }
   $linhas = (Get-Content deploy\homolog\homolog.env.example) -replace '^POSTGRES_PASSWORD=$', "POSTGRES_PASSWORD=$(& $s)" -replace '^ACCOUNT_KEY_SECRET=$', "ACCOUNT_KEY_SECRET=$(& $s)" -replace '^BACKUP_PASSPHRASE=$', "BACKUP_PASSPHRASE=$(& $s)"
   [IO.File]::WriteAllLines("$PWD\.env.homolog", $linhas)
   ```
3. Suba a pilha **sem** o `backup`, para a primeira cópia já sair com os dados fictícios:
   ```powershell
   docker compose --env-file .env.homolog up -d --build db server proxy
   docker compose --env-file .env.homolog ps          # hunit-homolog-db, -server e -proxy "Up"
   curl.exe http://127.0.0.1:3100/v1/health            # {"status":"ok"}
   ```
4. Grave os dados fictícios e gere os arquivos de teste (PDFs, PNG, .eml, .msg, um arquivo de 26 MB,
   um executável renomeado e `reservas.txt`, com números para as pesquisas). O script recusa um banco
   que já tenha reservas.
   ```powershell
   $pw = (Select-String -Path .env.homolog -Pattern '^POSTGRES_PASSWORD=(.+)$').Matches[0].Groups[1].Value
   $env:HUNIT_HOMOLOG_DATABASE_URL = "postgres://hunit:$pw@127.0.0.1:55432/hunit"
   $env:HUNIT_HOMOLOG_FILES_DIR = "C:\hunit-homolog\arquivos"
   pnpm test --project desktop homolog-prepare         # "1 passed", não "skipped"
   ```
   Falta um .jpg: desenhe qualquer coisa no Paint, sem dados reais, e salve como
   `C:\hunit-homolog\arquivos\imagem-teste.jpg`.
5. Ligue o `backup` (a primeira cópia sai em alguns segundos):
   ```powershell
   docker compose --env-file .env.homolog up -d backup
   Get-ChildItem C:\hunit-homolog\backups | Select-Object Name, Length, LastWriteTime
   ```
6. Crie as duas chaves (cada uma aparece **uma única vez**: guarde num bloco de notas temporário
   até o passo 7) e exporte o certificado raiz:
   ```powershell
   docker compose --env-file .env.homolog exec server node dist/cli.js create-client --name homolog-operador --role operator
   docker compose --env-file .env.homolog exec server node dist/cli.js create-client --name homolog-consulta --role reader
   docker compose --env-file .env.homolog cp proxy:/data/caddy/pki/authorities/local/root.crt C:\hunit-homolog\raiz-homolog.crt
   certutil -dump C:\hunit-homolog\raiz-homolog.crt | Select-String "sha256"
   ```
7. Abra o app compilado duas vezes, cada uma com a sua pasta de dados, em dois terminais
   PowerShell, no clone:
   ```powershell
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   $env:HUNIT_DESKTOP_USER_DATA_DIR = "C:\hunit-homolog\app-operador"   # no 2º terminal: app-consulta
   pnpm --filter @hunit/desktop exec electron .
   ```
   Em cada janela, em **Configuração**, configure a conexão como em "Configurar a conexão", com o
   endereço `https://localhost:8443`, o `C:\hunit-homolog\raiz-homolog.crt` (a impressão digital tem
   de ser a do `certutil`) e a chave do perfil. "Testar conexão" mostra `homolog-operador` ou
   `homolog-consulta`. A janela "operador" faz o papel da máquina do Financeiro, e a "consulta", o da
   Controladoria.
8. **Planilha de teste** (só para homologar o envio ao Comercial):
   1. Numa conta Google de quem administra, crie a planilha vazia "HUNIT Comercial — homologação".
      Crie uma conta de serviço e uma chave JSON só para ela, como no passo 1 de "Planilha do
      Comercial", e compartilhe a planilha com o e-mail da conta de serviço como **Editor**.
   2. Salve a chave como `C:\hunit-homolog\secrets\commercial-sheet-key.json` e preencha, no
      `.env.homolog`, `COMMERCIAL_SHEET_ID` e
      `COMMERCIAL_SHEET_KEY_FILE=/run/secrets/commercial-sheet/commercial-sheet-key.json`.
   3. Suba de novo, prepare e confira a planilha:
      ```powershell
      docker compose --env-file .env.homolog up -d
      docker compose --env-file .env.homolog exec server node dist/cli.js commercial-sheet setup
      docker compose --env-file .env.homolog exec server node dist/cli.js commercial-sheet check
      ```
   4. Compartilhe a planilha como **Editor** com uma segunda conta Google, que faz o papel do
      Comercial.
   5. O "Enviar ao Comercial" do app falha sem o Hunit. Para ter linhas na planilha, grave um envio
      fictício (12 reservas por hotel em "A cobrar" e 3 em "Concluídas", com o alerta "Verificar";
      `C:\hunit-homolog\arquivos\envios.txt` lista os números). Elas aparecem na planilha em até 30 s:
      ```powershell
      $env:HUNIT_HOMOLOG_COMMERCIAL = "1"                 # com as variáveis do passo 4
      pnpm test --project desktop homolog-commercial      # "1 passed", não "skipped"
      ```

Se a homologação já rodava a partir de outro clone, não é preciso montar de novo: faça o passo 1,
mova o `.env.homolog` para o clone novo e siga "Atualizar". Os volumes são do projeto
`hunit-homolog` e continuam com os dados, as chaves e o certificado.

### Atualizar para uma feature (ou versão nova da mesma)

```powershell
cd C:\hunit-homolog\hunit-control
git fetch
git checkout <branch-da-feature>
git pull
pnpm install
pnpm build
docker compose --env-file .env.homolog up -d --build
docker compose --env-file .env.homolog ps           # 4 containers hunit-homolog-…, "Up"
curl.exe http://127.0.0.1:3100/v1/health             # {"status":"ok"}
```

- As migrations novas entram sozinhas quando o servidor sobe.
- Com a planilha de teste configurada, rode o `commercial-sheet setup` e o `check` de novo quando a
  feature mudar a planilha.
- Feche e abra de novo as duas janelas do app (passo 7): o `pnpm build` já compilou o app novo.
- Depois, siga o quickstart da feature. Alguns pedem dados fictícios a mais (o `homolog-commercial`
  da 005, o `legacy-homolog-prepare` da 004).
- Para conferir o instalador (ícone, atalho, versão), gere-o no clone com
  `pnpm --filter @hunit/desktop dist` e instale-o numa máquina, ou conta do Windows, que não use a
  produção. Se não houver nenhuma, confira na primeira máquina da produção, logo depois de atualizar
  o servidor de produção. O app atualizado continua com a conexão que a máquina já tinha.

### Recomeçar com dados limpos

```powershell
cd C:\hunit-homolog\hunit-control
docker compose --env-file .env.homolog ps            # confira: só containers hunit-homolog-…
docker compose --env-file .env.homolog down -v       # apaga só os volumes hunit-homolog_*
```

Depois, faça os passos 3 a 7 de novo. O banco volta vazio, e o certificado raiz e as chaves são
novos: nas duas janelas do app, escolha o `raiz-homolog.crt` novo e cole as chaves novas. Com a
planilha de teste, apague as linhas das duas abas (menos o cabeçalho) antes de subir e rode o
`commercial-sheet setup` depois.

### Desmontar

```powershell
cd C:\hunit-homolog\hunit-control
docker compose --env-file .env.homolog down -v
cd C:\
Remove-Item -Recurse -Force C:\hunit-homolog
```

Isso apaga o clone, o `.env.homolog`, as cópias, os arquivos de teste, os dados do app e a chave da
planilha de teste. Apague também a chave no Google Cloud (ou a conta de serviço inteira) e, se não
for mais usada, a planilha de teste.

## Segurança

- Usuário, senha e token do Hunit ficam só na memória do servidor durante o acesso: nunca vão para
  o banco, logs, evidências ou cópias. Um teste automatizado procura esses valores em tudo o que o
  servidor grava (SC-004).
- Nunca envie credenciais do Hunit por chat, e-mail ou arquivo; elas são digitadas só no app ou no
  terminal do operador.
- A chave da conta de serviço da planilha do Comercial fica só em `deploy/secrets` do PC do
  servidor; o ID da planilha e a chave nunca aparecem no app, na API, nos logs nem nas mensagens de
  erro. A planilha nunca recebe o nome do hóspede.
- Os dados de reservas são pessoais e financeiros: não copie o banco, as cópias decifradas, as
  evidências nem planilhas para fora dos locais previstos.
