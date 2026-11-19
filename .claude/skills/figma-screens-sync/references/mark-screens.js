// Marcação das telas no Figma (skill figma-screens-sync).
//
// Montagem do `code` do use_figma:
//   const FEATURE = '<NNN-nome da feature concluída>';  // ex.: '006-redesign-app-desktop'
//   const DRY_RUN = true;                               // true = só relata; false = aplica
//   <este arquivo>
//
// Percorre as páginas de feature (`NNN-…`) até a feature informada, inclusive. Em cada uma, os
// frames de tela ficam no nível da página ou dentro de uma seção, com o nome começando pelo número
// da tela (`4.1 Reservas — lista`, com ou sem ✅/❌ na frente). Para cada número, a versão da página
// mais recente é a ativa (✅, visível); as outras ficam obsoletas (❌, ocultas). Páginas de features
// posteriores (ainda em desenvolvimento) não são tocadas.
//
// Só muda o nome (o prefixo) e a visibilidade dos frames de tela. Nunca apaga, move nem altera o
// conteúdo de um frame, nem mexe em páginas que não sejam de feature.

const PAGE_RE = /^(\d{3})-[a-z0-9-]+$/;
const SCREEN_RE = /^(?:(?:✅|❌)\s*)?(\d+\.\d+)\s+(.+)$/u;

const featureMatch = PAGE_RE.exec(FEATURE);
if (!featureMatch) throw new Error(`FEATURE inválida: "${FEATURE}" (esperado NNN-nome-da-branch)`);
const featureNumber = Number(featureMatch[1]);
if (!figma.root.children.some((page) => page.name === FEATURE)) {
  throw new Error(`Página "${FEATURE}" não encontrada no arquivo`);
}

const pages = figma.root.children
  .map((page) => ({ page, match: PAGE_RE.exec(page.name) }))
  .filter(({ match }) => match && Number(match[1]) <= featureNumber)
  .map(({ page, match }) => ({ page, number: Number(match[1]) }));

/** número da tela → versões encontradas */
const byScreen = new Map();
for (const { page, number } of pages) {
  await page.loadAsync();
  const nodes = [];
  for (const child of page.children) {
    if (child.type === 'SECTION') nodes.push(...child.children);
    else nodes.push(child);
  }
  for (const node of nodes) {
    if (node.type !== 'FRAME') continue;
    const match = SCREEN_RE.exec(node.name);
    if (!match) continue;
    const versions = byScreen.get(match[1]) ?? [];
    versions.push({ node, pageNumber: number, page: page.name, title: match[2] });
    byScreen.set(match[1], versions);
  }
}

const compare = (a, b) => {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
};

const report = { feature: FEATURE, dryRun: DRY_RUN, active: [], obsolete: [], changed: 0, conflicts: [] };
for (const screen of [...byScreen.keys()].sort(compare)) {
  const versions = byScreen.get(screen);
  const latest = Math.max(...versions.map((version) => version.pageNumber));
  const top = versions.filter((version) => version.pageNumber === latest);
  if (top.length > 1) {
    // Duas versões do mesmo número na mesma página: não adivinha qual vale.
    report.conflicts.push({ screen, page: top[0].page, ids: top.map((version) => version.node.id) });
    continue;
  }
  for (const version of versions) {
    const active = version === top[0];
    const name = `${active ? '✅' : '❌'} ${screen} ${version.title}`;
    const changed = version.node.name !== name || version.node.visible !== active;
    if (changed) report.changed += 1;
    if (changed && !DRY_RUN) {
      version.node.name = name;
      version.node.visible = active;
    }
    (active ? report.active : report.obsolete).push({
      screen,
      page: version.page,
      id: version.node.id,
      changed,
    });
  }
}
return report;
