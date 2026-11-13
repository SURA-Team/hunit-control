---
name: figma-screens-sync
description: Mantém o espelho do app desktop no Figma (página "Telas — app atual (espelho)") igual ao app implementado, a partir de prints do app real. Use depois de qualquer mudança visível no app desktop (apps/desktop/src/renderer, rótulos em presentation/, ícone, tema), ao concluir uma feature com interface, ou quando pedirem para atualizar as telas, os prints ou a identidade visual no Figma. Nunca altera a cópia de trabalho da UX nem implementa o design dela.
---

# Espelho do app no Figma

Arquivo: [Hunit Control](https://www.figma.com/design/YCbxTAacFxbGuOF8uwoLtt/Hunit-Control) — `fileKey`
`YCbxTAacFxbGuOF8uwoLtt`.

## Quem é a fonte da verdade

| O quê | Onde | Papel | O agente pode |
|---|---|---|---|
| **Espelho** | páginas `Identidade visual`, `Telas — app atual (espelho)` e `Componentes` | Como o app **está** no código | Ler e escrever (só por esta skill) |
| **Design oficial** | cópia de trabalho da UX (outra página ou outro arquivo) | Como o app **deve ser**: fonte da verdade oficial do design | Só ler |

- O espelho segue o código, nunca o contrário. Se o app mudou, o espelho muda.
- Levar o design da UX para o código **não** é tarefa desta skill: é trabalho de uma spec (a de
  alinhamento das telas, ou a da feature). Se notar diferença entre o app e a cópia da UX, liste-a
  no relatório final; não corrija nada por conta própria.

## Quando usar

- Ao concluir uma task ou feature que mudou o que aparece na tela: `apps/desktop/src/renderer/**`,
  `presentation/labels.ts` (nomes e cores das situações), `apps/desktop/resources/icon.*`, o tema em
  `src/renderer/src/main.tsx`. Uma vez por entrega (antes do PR), não a cada commit.
- Quando o usuário pedir para atualizar as telas, os prints ou a identidade visual.

## Regras

1. **Escreva só nas três páginas do espelho.** Nunca renomeie, mova ou apague outra página.
2. **Componentes, variáveis e estilos são compartilhados.** Uma página duplicada dentro do mesmo
   arquivo continua usando os componentes daqui. Antes de **alterar** um componente existente, rode
   a verificação de uso (abaixo). Se houver uso fora do espelho, não altere: crie uma variante ou um
   componente novo para o espelho e avise o usuário. Nunca mude o valor de uma variável ou de um
   estilo de texto que já existe; crie outro.
3. **Telas editáveis, sem imagem.** Nada de print colado no Figma. Os prints ficam fora do Git e
   fora do Figma, numa pasta temporária.
4. **Dados fictícios.** Use os hotéis, hóspedes e valores do roteiro de captura. Nunca use nomes
   reais de hotéis, da empresa ou de hóspedes (o repositório é público; veja o AGENTS.md).
5. **Uma tela é reconstruída inteira**, não remendada: o `rebuild()` apaga o frame antigo e cria o
   novo no mesmo lugar, com o mesmo número.

## Passo a passo

### 1. Descobrir as telas afetadas

```bash
git diff --stat master...HEAD -- apps/desktop/src/renderer apps/desktop/resources
```

Cruze os arquivos com a coluna "Código" de [references/screens.md](references/screens.md). Se surgiu
um estado novo de tela, dê a ele o próximo número livre da área (ex.: `2.11`) e registre-o no
catálogo, no roteiro de captura e no arquivo de telas da área.

### 2. Capturar os prints do app real

Pré-requisitos: Docker rodando e o Chromium do Playwright instalado (veja o AGENTS.md). No
PowerShell, a partir da raiz do repositório:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:HUNIT_SCREENS_DIR = "<pasta temporária>\telas"
pnpm test --project desktop-e2e screens-capture
```

A captura leva uns 3 minutos e grava `<número>-<nome>.png` (1440 × 900, ou a página inteira nas
telas mais altas). Abra `falhas.txt` na mesma pasta: um passo que falhou não interrompe os outros.
Se a tela nova precisa de um estado que o roteiro não alcança, adicione o passo em
`apps/desktop/test/e2e/screens-capture.test.ts` (função `shot('x.y', 'nome')`).

### 3. Comparar

Para cada tela afetada, olhe o PNG (Read) e o frame atual no Figma (`get_screenshot`, com o
`node-id` do frame). Anote cada diferença: texto, ordem, componente, cor, estado novo.

### 4. Atualizar o construtor da tela

As telas são geradas por código em `references/screens/`, um arquivo por área, que registra
`SCREENS['x.y'] = { name, h, profile, nav, active, build }`. Edite o `build` da tela para refletir o
app. Use os auxiliares do prelúdio (`card`, `field`, `btn`, `badge`, `alert`, `table`, `statGrid`,
`modal`, `drawer`, `overlay`, `row`, `rich`…) e os componentes existentes.

- Componente novo ou variante nova: crie na página `Componentes` (respeitando a regra 2) e exponha
  no `K`/`P` do prelúdio.
- Cor ou estilo de texto novo: crie na coleção `Cores do app` ou nos estilos de texto e acrescente
  na página `Identidade visual`.

### 5. Aplicar no Figma

1. Carregue as instruções do Figma: `get_figma_skill` com `skill://figma/figma-use/SKILL.md` e
   `skill://figma/figma-generate-design/SKILL.md`.
2. `create_session` com o `fileKey` e uma descrição curta; reutilize o `sessionId`.
3. `use_figma` com `skillNames: "resource:figma-use,resource:figma-generate-design"` e o `code`
   montado assim, nesta ordem:
   - o conteúdo de [references/figma-prelude.js](references/figma-prelude.js);
   - o conteúdo do arquivo da área em `references/screens/`;
   - `return { rebuilt: await rebuild(['2.4', '2.6']), created };`

   O limite do `code` é de 50 mil caracteres: o prelúdio mais **todos** os arquivos passa disso.
   Faça **uma área por chamada**. Uma chamada que dá erro é desfeita inteira; corrija e reenvie.

### 6. Validar

- `get_screenshot` de cada frame reconstruído, lado a lado com o print. Corrija no construtor e
  reconstrua se algo ficou diferente.
- Uma leitura rápida: nenhuma pintura `IMAGE` na página de telas; fontes só Noto Sans e Roboto Mono.

### 7. Registrar no histórico do espelho

Acrescente uma linha na tabela do frame `Histórico de atualizações do espelho`, no topo da página
de telas:

```js
const page = figma.root.children.find((p) => p.name === 'Telas — app atual (espelho)');
await figma.setCurrentPageAsync(page);
const table = page.findOne((n) => n.name === 'Atualizações');
const line = table.children.at(-1).clone(); table.appendChild(line);
const cells = line.children.filter((n) => n.type === 'TEXT');
for (const c of cells) await figma.loadFontAsync(c.fontName);
['DD/MM/AAAA', 'spec 00N — <feature>', '2.4, 2.6', '<o que mudou, em uma frase>'].forEach((v, i) => { cells[i].characters = v; });
return { line: line.id };
```

### 8. Relatar

Diga ao usuário quais telas mudaram (com link `…?node-id=<id>`), o que mudou em cada uma e as
diferenças que notou entre o app e o design da UX, se houver. Se você alterou o roteiro de captura
ou os arquivos da skill, eles entram no commit da feature (os prints, nunca).

## Verificação de uso fora do espelho (regra 2)

```js
const OWN = ['Identidade visual', 'Telas — app atual (espelho)', 'Componentes'];
const comps = figma.root.children.find((p) => p.name === 'Componentes');
await comps.loadAsync();
const set = comps.findOne((n) => n.type === 'COMPONENT_SET' && n.name === 'Botão'); // o que vai mudar
const ids = new Set([set.id, ...set.children.map((c) => c.id)]);
const usedIn = [];
for (const page of figma.root.children) {
  if (OWN.includes(page.name)) continue;
  await page.loadAsync();
  for (const inst of page.findAllWithCriteria({ types: ['INSTANCE'] })) {
    const main = await inst.getMainComponentAsync();
    if (main && ids.has(main.id)) { usedIn.push(page.name); break; }
  }
}
return { usedIn }; // vazio = pode alterar
```

## Armadilhas conhecidas

**API do Figma**
- `resize()` volta o dimensionamento para fixo: chame-o **antes** de `primaryAxisSizingMode = 'AUTO'`
  ou de `layoutSizing* = 'HUG'/'FILL'`.
- Com a cor ligada a uma variável, a opacidade da pintura se perde. Use `node.opacity` (veja
  `overlay()`).
- Texto: `await node.setTextStyleIdAsync(id)` (a atribuição direta não funciona), sempre com as
  fontes carregadas.
- Ícones e a marca são formas dentro de componentes; para a instância escalar ao ser redimensionada,
  as formas precisam de `constraints = { horizontal: 'SCALE', vertical: 'SCALE' }`.
- Cada chamada começa na primeira página (`Identidade visual`). O prelúdio troca para a de telas;
  não troque de página de novo na mesma chamada.

**App e roteiro de captura**
- O Segoe UI do app não existe no Figma: os estilos usam Noto Sans. O peso 500 do Segoe aparece
  semi-negrito no Windows, por isso os rótulos usam SemiBold.
- O resultado da execução só fica na tela Executar enquanto ela não é trocada por outra área: o
  roteiro captura o resultado (2.7) sem sair dela.
- Sem conexão com o servidor, o app não sabe o perfil da chave: o cliente some do cabeçalho e
  "Executar" some do menu (tela 5.1).
- O console do Vitest não mostra `console.log`; as falhas vão para `falhas.txt`.
- O terminal do VS Code define `ELECTRON_RUN_AS_NODE=1`; o roteiro tira a variável do processo do app,
  mas remova-a do terminal mesmo assim.
- O app aberto pelo teste mostra "versão 45.2.3" (a versão do Electron, porque ele não é aberto pelo
  instalador). No espelho use a versão do `apps/desktop/package.json`.
