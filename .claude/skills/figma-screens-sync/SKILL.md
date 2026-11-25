---
name: figma-screens-sync
description: Marca no Figma quais telas do app estão em uso (✅, visíveis) e quais ficaram obsoletas (❌, ocultas), varrendo todas as páginas de feature até a feature concluída. Use ao concluir uma feature que mudou telas do app desktop (antes do PR final ou logo depois do merge), ou quando pedirem para atualizar a marcação das telas no Figma. Só renomeia e oculta frames de tela; não desenha, não reconstrói e não altera o conteúdo das telas da UX.
---

# Marcação das telas no Figma

Arquivo: [Hunit Control](https://www.figma.com/design/YCbxTAacFxbGuOF8uwoLtt/Hunit-Control) — `fileKey`
`YCbxTAacFxbGuOF8uwoLtt`.

## Como o arquivo está organizado

Desde 18/11/2026, nenhuma spec começa sem passar pela PM, e toda feature que muda telas já chega com
elas desenhadas pela UX no Figma. O agente **não desenha nem reconstrói telas**: leva o design para o
código (trabalho da spec) e, ao concluir a feature, marca no Figma o que está em uso.

| Página | Quem cuida | O que tem |
|---|---|---|
| `NNN-<nome da branch>` (uma por feature) | UX (da 006 em diante); agente (002 a 005, espelhos antigos, congelados) | As telas que a feature criou ou mudou |
| `Componentes — nova identidade` e outras sem número | UX | Biblioteca e guias. O agente só lê |
| `Identidade visual`, `Componentes` | Ninguém (espelho antigo, até a 005) | Ficam como estão |

- **Numeração única.** Cada tela tem um número `área.ordem` (`4.2`), o mesmo em todas as páginas,
  nos prints do roteiro de captura e no catálogo ([references/screens.md](references/screens.md)).
- **Uma tela ativa por número.** A versão ativa é a da página de feature mais recente, entre as
  features concluídas, que tem aquele número. Ela fica com `✅ ` no começo do nome e visível; as
  versões das páginas anteriores ficam com `❌ ` e ocultas (nunca são apagadas).
- **Feature em desenvolvimento não entra.** As páginas de features posteriores à concluída ficam
  como estão: o app ainda não mostra aquelas telas. Se uma feature de número menor ainda está em
  desenvolvimento (a 008 foi concluída antes da 007), liste a página dela em `SKIP`.

## Quando usar

Ao concluir uma feature que mudou telas do app desktop: depois que o app passou na comparação com o
design da feature (prints do roteiro de captura ao lado dos frames), antes do PR final ou logo
depois do merge. Também quando pedirem para refazer a marcação.

## Regras

1. **Só nome e visibilidade.** O script troca o prefixo (`✅`/`❌`) e a visibilidade dos frames de
   tela. Nunca apaga, move, redimensiona ou altera o conteúdo de um frame; nunca renomeia, move ou
   apaga páginas.
2. **Simule antes.** Rode primeiro com `DRY_RUN = true`, mostre o relatório ao usuário e só aplique
   (`DRY_RUN = false`) depois do ok dele: as páginas da UX são compartilhadas.
3. **Conflito não se resolve sozinho.** Duas telas com o mesmo número na mesma página aparecem em
   `conflicts` e não são tocadas: avise o usuário (a UX decide qual fica).
4. **Dados fictícios.** Nunca escreva nomes reais de hotéis, da empresa ou de hóspedes no Figma (o
   repositório é público; veja o AGENTS.md).

## Passo a passo

### 1. Conferir a feature

```bash
git branch --show-current     # a feature concluída (NNN-nome); o número define até onde varrer
```

A página do Figma com esse nome precisa existir. Se a feature não mudou telas, não há o que marcar.

### 2. Simular

1. Carregue as instruções do Figma: `get_figma_skill` com `skill://figma/figma-use/SKILL.md`.
2. `create_session` com o `fileKey` e uma descrição curta; reutilize o `sessionId`.
3. `use_figma` com `skillNames: "resource:figma-use"` e o `code`:

```js
const FEATURE = '<NNN-nome da branch>';
const DRY_RUN = true;
const SKIP = []; // páginas de features de número menor ainda em desenvolvimento (ex.: '007-…')
// + o conteúdo de references/mark-screens.js
```

Uma página com ❌ no próprio nome (as espelho antigas, 002 a 005) não é varrida.

O retorno lista `active` e `obsolete` (número, página, `id`, se muda) e `conflicts`. Mostre ao usuário
um resumo: quantas telas ficam ativas em cada página, quais mudam de estado e os conflitos.

### 3. Aplicar

Com o ok do usuário, rode de novo com `DRY_RUN = false`. Confira o `changed` do retorno e, por
amostragem, o `get_screenshot` de uma tela ativa e o `get_metadata` de uma página antiga (frames com
❌ ocultos).

### 4. Atualizar o catálogo e relatar

- Em [references/screens.md](references/screens.md), atualize a coluna "Ativa em" das telas que
  mudaram de página e acrescente as telas novas.
- Relate ao usuário: telas ativas por página (com link `…?node-id=<id>`), as que viraram ❌ e os
  conflitos. Os arquivos da skill alterados entram no commit da feature.

## Armadilhas conhecidas

- A UX trabalha no mesmo arquivo, ao mesmo tempo: o script procura páginas pelo nome a cada chamada,
  nunca por posição ou ID guardado.
- Cada chamada do `use_figma` começa na primeira página; o script carrega as outras com
  `loadAsync()`, sem trocar de página.
- Frames de tela podem estar soltos na página ou dentro de seções (as páginas da UX usam seções por
  área); o script olha os dois níveis e ignora frames internos das telas.
- O roteiro de captura (`apps/desktop/test/e2e/screens-capture.test.ts`) grava um PNG por tela, com o
  número do Figma, em 1 440 × 900. Ele serve à comparação com o design durante a feature, não a esta
  skill.
