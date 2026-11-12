# Quickstart: validação da feature 002 (app desktop)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contratos**: [api-changes.md](./contracts/api-changes.md), [ipc.md](./contracts/ipc.md)

Roteiro para provar que o app funciona de ponta a ponta. A seção 1 roda sem o Hunit real; as
seções 3 a 7 são a homologação, feita nas máquinas Windows dos usuários com o servidor da feature
001 em produção (PC da rede, HTTPS — ver `README.md`).

## Pré-requisitos

- Servidor da 001 no ar com o proxy HTTPS (`docker compose up -d`) e o certificado raiz exportado
  (`docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt .\hunit-raiz.crt`).
- Uma chave de API por máquina, criada no servidor:
  - Financeiro e Controladoria (perfil operador): `docker compose exec server node dist/cli.js create-client --name <setor>-<pessoa> --role operator`
  - Uma chave de perfil consulta só para validar a SC-009 (revogar depois com `revoke-client`): `docker compose exec server node dist/cli.js create-client --name teste-consulta --role reader`
- Para os testes automatizados: Node 24, pnpm e Docker em execução (como na 001).

## 1. Testes automatizados (sem o Hunit real)

```powershell
pnpm test --project desktop        # processo principal: TLS fixado, cofre, configuração, validação da ponte, eventos
pnpm test --project desktop-ui     # interface: nomes e cores, diálogo do token, dados antigos, perfil consulta
pnpm test --project server-db      # inclui os testes de contrato dos acréscimos à API (1.4.0)
pnpm test --project desktop-e2e    # app real (Electron) contra o servidor de teste; exige o Docker
```

| Grupo | Deve comprovar |
|---|---|
| `desktop` | SC-007: raiz errada, nome do servidor errado e certificado vencido são recusados sem enviar nenhuma requisição; a chave só é gravada cifrada; o cofre esvazia após o prazo de inatividade e não esvazia com eventos em segundo plano; entrada inválida da interface é recusada |
| `desktop-ui` | todo valor dos enums da API tem nome em português e tom; a contagem do token usa a diferença de relógio; "dados de HH:MM — servidor indisponível" aparece com dados antigos; perfil consulta não vê iniciar, token, cancelar nem retomar (SC-009); "1.234,56" vira "1234.56" |
| `server-db` | `/me`, `/channels`, evidências da execução, `requestedClient` e `active` na lista de execuções, `q`/`channel`/`amount` nas reservas — respostas validadas contra o `openapi.yaml` 1.4.0 e os exemplos de [api-changes.md](./contracts/api-changes.md) |
| `desktop-e2e` | US1 (configurar, iniciar, aviso de token com janela minimizada, token aceito e recusado, resumo final), US2 (acompanhar, cancelar, retomar), US3 (busca por código de autorização e por valor, evidência salva), servidor caindo e voltando (SC-006) e varredura da pasta de dados do app sem senha, token nem nomes de hóspedes (SC-004) |

## 2. Gerar o instalador

```powershell
pnpm install
pnpm build
pnpm --filter @hunit/desktop dist      # gera apps/desktop/release/HUNIT Control Setup <versão>.exe
```

O instalador não é assinado (research R-11): na primeira execução, o Windows pode mostrar "O
Windows protegeu o computador" → **Mais informações** → **Executar assim mesmo**.

## 3. Instalação e configuração numa máquina nova (SC-008: até 15 min)

Cronometrar a partir da cópia do instalador para a máquina.

1. Rodar o instalador (sem administrador); o app abre na tela de configuração (US1, cenário 1).
2. Informar o endereço `https://<SERVER_HOSTNAME>`, escolher o `hunit-raiz.crt` e conferir a
   impressão digital mostrada com a do servidor
   (`docker compose exec proxy sh -c "openssl x509 -in /data/caddy/pki/authorities/local/root.crt -noout -fingerprint -sha256"`).
3. Colar a chave e clicar em **Testar conexão** → mostra o nome do cliente e o perfil.
4. **Salvar** e clicar em **Testar aviso** → notificação do Windows, janela à frente e som. Se a
   notificação não aparecer, liberar as notificações do "HUNIT Control" nas configurações do
   Windows e testar de novo.

**Esperado**: concluído em até 15 minutos, sem ajuda técnica.

## 4. Homologação com o Hunit real — Financeiro (perfil operador)

### US1 — Executar e responder ao token

1. Em **Executar**, informar usuário e senha do Hunit, período de uma semana e "todos os hotéis";
   cronometrar da abertura do app até **Iniciar** (SC-001: até 1 min).
2. **Minimizar** o app e abrir outro programa.
3. Quando o Hunit pedir o token, cronometrar até o aviso (SC-002: até 5 s): notificação com som,
   janela à frente piscando, diálogo do token com contagem regressiva.
4. Informar o token → "token aceito"; a execução segue.
5. Ao terminar: notificação com o resumo; o resultado mostra contagens por situação e hotéis com
   falha e motivo (US1, cenário 7).
6. Voltar a **Executar**: usuário continua preenchido e a senha aparece como guardada (FR-006).
7. Testar senha errada → mensagem clara, sem repetir a senha (US1, cenário 8).
8. Iniciar e **não** informar o token → ao vencer o prazo, mensagem de prazo esgotado e opção de
   iniciar de novo com os dados preenchidos (US1, cenário 5).

### US2 — Acompanhar, cancelar e retomar

1. Iniciar uma execução com vários hotéis; conferir hotel atual, progresso por hotel, estimativa e
   contagens se atualizando (FR-016).
2. **Cancelar** e confirmar → execução cancelada.
3. **Retomar** → pede o token; a nova execução processa só os hotéis pendentes e mostra a ligação
   com a original.
4. Na outra máquina do Financeiro, ao mesmo tempo, iniciar uma execução com a outra conta do Hunit:
   cada máquina recebe só o seu pedido de token; a lista das duas mostra as duas execuções com quem
   iniciou (FR-012, FR-015).
5. Fechar o app com uma execução ativa → aviso de que o pedido de token não será recebido; reabrir
   com a execução aguardando token dentro do prazo → o pedido reaparece com o tempo correto
   (FR-019, FR-026).

## 5. Homologação — consulta (Financeiro e Controladoria)

1. Pegar uma linha real do extrato da operadora do cartão: buscar pelo **código de autorização** e
   depois pelo **valor** → a reserva aparece sem informar o hotel (US3, cenário 2; SC-005: até 30 s).
2. Filtrar pendentes de cobrança de um hotel numa semana; abrir uma reserva e conferir dados da
   cobrança, motivo e histórico de verificação.
3. Buscar parte do nome de um hóspede sem acento (ex.: "joao" para "João").
4. Numa execução com hotel em falha, abrir as evidências e salvar uma → arquivo gravado onde foi
   escolhido.
5. Configurar o app com a chave `teste-consulta` (perfil consulta): as ações iniciar, token,
   cancelar e retomar não aparecem (SC-009); consultas e evidências funcionam. Voltar à chave da
   máquina e revogar a de teste.

## 6. Servidor indisponível (FR-005, SC-006)

1. Com uma lista de reservas na tela, parar o servidor: `docker compose stop server`.
2. **Esperado**: aviso "servidor indisponível" em todas as telas; a lista continua visível com
   "dados de HH:MM"; ações que dependem do servidor desabilitadas.
3. `docker compose start server` → o app volta a funcionar sozinho em até 30 s, sem reiniciar.

## 7. Verificações de segurança

**Nada sensível no disco (SC-004)** — depois de um ciclo completo (execução, retomada, senha errada,
token errado), fechar o app e procurar a senha, o token e o nome de um hóspede visto na tela:

```powershell
# pasta de dados do app e pasta de instalação (o instalador por usuário instala em
# $env:LOCALAPPDATA\Programs\<nome do app>; conferir o nome exato depois da instalação)
$alvos = "$env:APPDATA\HUNIT Control", "$env:LOCALAPPDATA\Programs\<pasta do HUNIT Control>"
Get-ChildItem -Recurse -File $alvos -ErrorAction SilentlyContinue |
  Select-String -SimpleMatch -Pattern "<senha usada>", "<token usado>", "<nome de hóspede>" |
  Select-Object -First 5      # → nenhum resultado
```

**Servidor não confirmado (SC-007)**:

1. Na configuração, escolher outro certificado (qualquer `.crt` que não seja a raiz do servidor)
   → **Testar conexão** recusa com "não foi possível confirmar a identidade do servidor", sem
   opção de continuar.
2. Trocar o endereço para o IP do servidor quando o certificado foi emitido para o nome (ou o
   contrário) → recusado da mesma forma.

**Inatividade (FR-006)**: coberta pelo teste automatizado com relógio simulado; na homologação,
basta conferir em **Configuração** que o prazo é 8 horas e que **Limpar acesso** esvazia o usuário
e a senha na hora.

Registrar os tempos medidos (SC-001, SC-002, SC-005, SC-006, SC-008) em
[research.md](./research.md), numa seção "Resultados da homologação".
