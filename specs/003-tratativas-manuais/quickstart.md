# Quickstart: validação da feature 003 (tratativas manuais)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contratos**: [api-changes.md](./contracts/api-changes.md), [ipc.md](./contracts/ipc.md) | **Dados**: [data-model.md](./data-model.md)

Roteiro para provar que as tratativas funcionam de ponta a ponta. A seção 1 roda sem o Hunit real.
As seções 3 a 6 são a homologação, feita com o servidor de produção e o app instalado na máquina do
Financeiro (perfil operador) e na da Controladoria (perfil consulta). A homologação **não acessa o
Hunit**: usa as reservas que já estão gravadas.

## Pré-requisitos

- Servidor atualizado para o contrato 1.5.0 (`docker compose up -d --build` no clone de produção;
  a migration nova roda sozinha ao subir).
- App da 003 instalado nas duas máquinas (`pnpm --filter @hunit/desktop dist`).
- Arquivos de teste **sem dados reais**: um PDF, uma imagem .png, um .jpg, um e-mail .eml e um
  .msg criados para o teste, um arquivo de 26 MB e um executável renomeado para `.pdf`.
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

## 3. Comprovante e valor manual (US1) — máquina do Financeiro

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

## 6. Consulta e perfil consulta (US4) — máquina da Controladoria

1. Filtre "pendente de cobrança" + "Sem tratativa": só aparecem as pendentes sem registro, em até
   5 s (SC-008). Filtre "Cobrada": aparecem as do passo 3 e 5.
2. Abra uma reserva Cobrada: vê os documentos e o histórico e consegue baixar o arquivo.
3. Confira que nenhuma ação de registro aparece (anexar, substituir, desfazer, reverter, valor).
4. No PC do servidor, com uma chave de perfil consulta, tente
   `POST /v1/treatment-documents` pela API: `403 forbidden_for_role` (SC-006).

## 7. Registrar os resultados

Registrar em `research.md` ("Resultados da homologação") os tempos de SC-001, SC-002, SC-009 e
SC-010 e o resultado de cada passo, como na 002.
