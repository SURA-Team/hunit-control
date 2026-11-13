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
curl.exe https://<SERVER_HOSTNAME>/v1/health        # → {"status":"ok"}
```

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

## App desktop

O app desktop (`apps/desktop`) é como o Financeiro e a Controladoria usam o sistema: executar a
consulta e responder ao token, acompanhar, cancelar e retomar execuções e consultar reservas e
evidências. Ele só fala com a API, por HTTPS, confirmando o servidor pelo certificado raiz.

### Gerar o instalador

Numa máquina de desenvolvimento:

```powershell
pnpm install
pnpm --filter @hunit/desktop dist
```

O instalador fica em `apps/desktop/release/` (`HUNIT Control Setup <versão>.exe`). Ele instala só
para o usuário do Windows, sem pedir administrador, e cria o atalho no Menu Iniciar.

### Instalar numa máquina

1. Copie o instalador para a máquina e abra.
2. O instalador não tem assinatura de código: o Windows mostra "O Windows protegeu o computador".
   Clique em **Mais informações** → **Executar assim mesmo**.
3. Abra o **HUNIT Control** pelo Menu Iniciar.

### Configurar a conexão (primeira vez)

Tenha em mãos o endereço do servidor (`https://<SERVER_HOSTNAME>`), o `hunit-raiz.crt` (passo 6) e a
chave desta máquina (passo 7).

1. Em **Configuração**, informe o endereço do servidor.
2. Clique em **Escolher certificado raiz…** e escolha o `hunit-raiz.crt`. Confira a impressão
   digital mostrada com a do servidor:

   ```powershell
   # No PC do servidor
   (Get-PfxCertificate .\hunit-raiz.crt).GetCertHashString('SHA256')
   ```

   O comando mostra a mesma sequência que o app, sem os dois-pontos.

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

## Rotinas automáticas

| Rotina | Quando | O que faz |
|---|---|---|
| Manutenção (no `server`) | Ao subir e a cada 24 h | Apaga evidências com mais de `EVIDENCE_RETENTION_DAYS` dias (padrão 30) e anonimiza o nome do hóspede das reservas com check-in há mais de `RESERVATION_RETENTION_YEARS` anos (padrão 5) |
| Cópia de segurança (no `backup`) | Verifica a cada 15 min | Faz uma cópia quando a mais nova tem mais de `BACKUP_INTERVAL_HOURS` horas (padrão 24) e apaga as com mais de `BACKUP_RETENTION_DAYS` dias (padrão 30) |

As duas olham o que está vencido, e não o horário: o que atrasou com o PC desligado é feito logo
que ele volta (FR-029).

Para acompanhar: `docker compose logs backup` e `docker compose logs server`. As cópias ficam em
`BACKUP_DIR` com o nome `hunit-AAAAMMDD-HHMMSS.dump.gpg` (horário UTC), cifradas com AES-256.
Elas contêm reservas, histórico, execuções e clientes da API (só o hash das chaves); não contêm
credenciais nem token do Hunit, nem as evidências.

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

## Segurança

- Usuário, senha e token do Hunit ficam só na memória do servidor durante o acesso: nunca vão para
  o banco, logs, evidências ou cópias. Um teste automatizado procura esses valores em tudo o que o
  servidor grava (SC-004).
- Nunca envie credenciais do Hunit por chat, e-mail ou arquivo; elas são digitadas só no app ou no
  terminal do operador.
- Os dados de reservas são pessoais e financeiros: não copie o banco, as cópias decifradas, as
  evidências nem planilhas para fora dos locais previstos.
