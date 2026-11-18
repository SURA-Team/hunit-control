---
name: figma-screens-sync
description: Mantém no Figma o espelho das telas do app desktop, com uma página por feature (o nome da página é o nome da branch), a partir de prints do app real. Só para as features 002 a 006; a partir da 007 a UX desenha as telas antes do desenvolvimento e esta skill não se aplica. Use depois de uma mudança visível no app desktop (apps/desktop/src/renderer, rótulos em presentation/, ícone, tema) numa dessas features, ao concluí-la, ou quando pedirem para atualizar as telas, os prints ou a identidade visual no Figma. Nunca altera as páginas da UX nem implementa o design dela.
---

# Espelho do app no Figma

Arquivo: [Hunit Control](https://www.figma.com/design/YCbxTAacFxbGuOF8uwoLtt/Hunit-Control) — `fileKey`
`YCbxTAacFxbGuOF8uwoLtt`.

## Quando NÃO usar

**A partir da feature 007**, a UX escreve as specs e desenha as telas antes do desenvolvimento: o
Figma já tem as telas da feature, feitas por ela. Nessas branches (`007-…`, `008-…`, …), não rode
esta skill nem crie páginas de espelho. Avise o usuário e pare. O prelúdio recusa nomes de página
fora de `002-…` a `006-…`.

## Como o arquivo está organizado

| Página | Quem cuida | O que tem |
|---|---|---|
| `002-app-desktop`, `003-tratativas-manuais`, … até `006-…` (nome = branch no GitHub) | Agente, por esta skill | Espelho: as telas que **aquela feature criou ou mudou**, como ficaram no código |
| `Identidade visual`, `Componentes` | Agente | Marca, cores, tipografia e os componentes usados pelo espelho (sempre do app atual) |
| `007-…` em diante, `Componentes — nova identidade` e outras | UX | Design oficial: como o app **deve ser**. O agente só lê |

- **Numeração única.** Cada tela tem um número `área.ordem` (`4.2`), o mesmo em todas as páginas,
  nos prints e no código (`SCREENS['4.2']`). Catálogo: [references/screens.md](references/screens.md).
- **Página da feature = só o que ela mexeu.** Tela que a feature não alterou fica só na página da
  feature anterior que a tem.
- **Versão substituída: ❌ e oculta.** Quando a feature reconstrói uma tela que já existia numa
  página anterior, a versão antiga recebe `❌ ` no começo do nome e fica oculta (não é apagada). O
  `rebuild()` faz isso sozinho. O app de hoje é a versão visível mais recente de cada número.
- **Página de feature encerrada fica congelada.** Os construtores refletem o código **atual**:
  reconstruir uma tela numa página antiga a deixaria errada. Só escreva na página da branch atual.
- O espelho segue o código, nunca o contrário. Levar o design da UX para o código é trabalho de
  uma spec; se notar diferença entre o app e o design da UX, liste-a no relatório final.

## Regras

1. **Escreva só na página da branch atual**, além de `Identidade visual` e `Componentes`. O
   `supersedeOlder()` do prelúdio é a única coisa que toca páginas anteriores (marca ❌ e oculta).
   Nunca renomeie, mova ou apague páginas da UX.
2. **Componentes, variáveis e estilos são compartilhados** com as outras páginas do espelho. Antes
   de alterar um componente existente, rode a verificação de uso (abaixo). Se houver uso em página
   da UX, não altere: crie uma variante ou um componente novo. Nunca mude o valor de uma variável
   ou de um estilo de texto que já existe; crie outro.
3. **Telas editáveis, sem imagem.** Os prints ficam fora do Git e fora do Figma.
4. **Dados fictícios.** Use os do roteiro de captura. Nunca use nomes reais de hotéis, da empresa
   ou de hóspedes (o repositório é público; veja o AGENTS.md).
5. **Uma tela é reconstruída inteira**, não remendada: o `rebuild()` apaga o frame da página atual,
   cria o novo no mesmo lugar e marca com ❌ as versões anteriores.

## Passo a passo

### 1. Conferir a branch e descobrir as telas afetadas

```bash
git branch --show-current            # deve ser 002-… a 006-…; senão, pare (veja "Quando NÃO usar")
git diff --stat master...HEAD -- apps/desktop/src/renderer apps/desktop/resources
```

Cruze os arquivos com a coluna "Código" de [references/screens.md](references/screens.md). Estado
novo de tela: dê o próximo número livre da área (ex.: `4.9`) e registre-o no catálogo, no roteiro de
captura e no arquivo de telas da área. Só a versão do app no rodapé (`HUNIT Control — versão`) não
é motivo para pôr uma tela na página da feature: a versão aparece no aviso da página.

### 2. Capturar os prints do app real

Pré-requisitos: Docker rodando e o Chromium do Playwright instalado (veja o AGENTS.md). No
PowerShell, a partir da raiz do repositório:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:HUNIT_SCREENS_DIR = "<pasta temporária>\telas"
pnpm test --project desktop-e2e screens-capture
```

A captura leva poucos minutos e grava `<número>-<nome>.png` (1440 × 900, ou a página inteira nas
telas mais altas). Abra `falhas.txt` na mesma pasta: um passo que falhou não interrompe os outros.
Para um estado que o roteiro não alcança, acrescente o passo em
`apps/desktop/test/e2e/screens-capture.test.ts` (função `shot('x.y', 'nome')`).

### 3. Comparar

Para cada tela afetada, olhe o PNG (Read) e a versão visível mais recente no Figma
(`get_screenshot` com o `node-id` do frame). Anote cada diferença: texto, ordem, componente, cor,
estado novo.

### 4. Atualizar o construtor da tela

As telas são geradas por código em `references/screens/`, um arquivo por área, que registra
`SCREENS['x.y'] = { name, h, profile, nav, active, build }`. Edite o `build` para refletir o app,
com os auxiliares do prelúdio (`card`, `field`, `btn`, `badge`, `alert`, `table`, `statGrid`,
`modal`, `drawer`, `overlay`, `row`, `rich`, `tick`…) e os componentes existentes.

- Componente ou variante nova: crie na página `Componentes` (regra 2) e exponha no `K`/`P` do
  prelúdio.
- Cor ou estilo de texto novo: crie na coleção `Cores do app` ou nos estilos de texto e acrescente
  na página `Identidade visual`.

### 5. Aplicar no Figma

1. Carregue as instruções do Figma: `get_figma_skill` com `skill://figma/figma-use/SKILL.md` e
   `skill://figma/figma-generate-design/SKILL.md`.
2. `create_session` com o `fileKey` e uma descrição curta; reutilize o `sessionId`.
3. `use_figma` com `skillNames: "resource:figma-use,resource:figma-generate-design"` e o `code`
   montado nesta ordem:
   - `const FEATURE_PAGE = '<saída do git branch --show-current>';`
   - o conteúdo de [references/figma-prelude.js](references/figma-prelude.js) (cria a página da
     feature se ela ainda não existir, depois das páginas de features anteriores);
   - o conteúdo do(s) arquivo(s) da área em `references/screens/` (veja as dependências no fim do
     catálogo);
   - na primeira vez da feature: `await featureHeader('<nome curto da feature>', '<versão do app>');`
     (aviso e histórico no topo da página; chame de novo se a versão do app mudar);
   - `return { rebuilt: await rebuild(['4.2', '4.9']), created };`

   O limite do `code` é de 50 mil caracteres: faça **uma área por chamada**. Uma chamada que dá erro
   é desfeita inteira; corrija e reenvie.

### 6. Validar

- `get_screenshot` de cada frame reconstruído, lado a lado com o print. Corrija no construtor e
  reconstrua se algo ficou diferente.
- Confira no retorno do `rebuild()` (`superseded`) que as versões antigas certas ganharam ❌.
- Uma leitura rápida: nenhuma pintura `IMAGE` na página; fontes só Noto Sans e Roboto Mono.

### 7. Registrar no histórico da página

Na mesma chamada (ou numa seguinte, com o prelúdio):

```js
await addHistory('DD/MM/AAAA', '4.2, 4.9', '<o que mudou, em uma frase>');
```

### 8. Relatar

Diga ao usuário quais telas mudaram (com link `…?node-id=<id>`), quais versões antigas foram
marcadas com ❌, o que mudou em cada uma e as diferenças que notou entre o app e o design da UX, se
houver. Se você alterou o roteiro de captura ou os arquivos da skill, eles entram no commit da
feature (os prints, nunca).

## Verificação de uso fora do espelho (regra 2)

```js
const OWN = /^(00[2-6]-[a-z0-9-]+|Identidade visual|Componentes)$/;
const comps = figma.root.children.find((p) => p.name === 'Componentes');
await comps.loadAsync();
const set = comps.findOne((n) => n.type === 'COMPONENT_SET' && n.name === 'Botão'); // o que vai mudar
const ids = new Set([set.id, ...set.children.map((c) => c.id)]);
const usedIn = [];
for (const page of figma.root.children) {
  if (OWN.test(page.name)) continue;
  await page.loadAsync();
  for (const inst of page.findAllWithCriteria({ types: ['INSTANCE'] })) {
    const main = await inst.getMainComponentAsync();
    if (main && ids.has(main.id)) { usedIn.push(page.name); break; }
  }
}
return { usedIn }; // vazio = pode alterar
```

Em 16/11/2026 as páginas da UX não usavam nenhum componente do espelho (têm a biblioteca
`Componentes — nova identidade`).

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
- Cada chamada começa na primeira página. O prelúdio troca para a página da feature; não troque de
  novo na mesma chamada (outras páginas: `await page.loadAsync()`, sem trocar).
- A UX trabalha no mesmo arquivo, ao mesmo tempo: procure páginas pelo nome a cada chamada, nunca
  por posição ou ID guardado.

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
- O app aberto pelo teste mostra a versão do Electron no rodapé (ele não é aberto pelo instalador).
  No espelho, use a versão do `apps/desktop/package.json`.
