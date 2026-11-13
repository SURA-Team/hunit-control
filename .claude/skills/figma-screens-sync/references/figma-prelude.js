// Prelúdio do espelho no Figma (skill figma-screens-sync).
// Cole este arquivo no início do `code` de cada chamada `use_figma`, seguido do arquivo de telas
// da área (references/screens/*.js) e, por último, da chamada `await rebuild([...])`.
// Tudo é resolvido pelo NOME (páginas, componentes, variáveis, estilos): não guarde IDs.

const PAGES = { identity: 'Identidade visual', screens: 'Telas — app atual (espelho)', components: 'Componentes' };
const SECTIONS = {
  1: '1. Configuração',
  2: '2. Executar',
  3: '3. Execuções',
  4: '4. Reservas',
  5: '5. Estados do sistema',
  6: '6. Perfil consulta (sem ações de operador)',
};

await Promise.all([['Noto Sans', 'Regular'], ['Noto Sans', 'Medium'], ['Noto Sans', 'SemiBold'], ['Noto Sans', 'Bold'], ['Roboto Mono', 'Regular']]
  .map(([family, style]) => figma.loadFontAsync({ family, style })));

const pageByName = (name) => {
  const page = figma.root.children.find((p) => p.name === name);
  if (!page) throw new Error(`Página "${name}" não encontrada`);
  return page;
};
const screensPage = pageByName(PAGES.screens);
const componentsPage = pageByName(PAGES.components);
await componentsPage.loadAsync();
await figma.setCurrentPageAsync(screensPage); // a única troca de página da chamada

// --- Componentes (por nome do conjunto e da variante)
const SETS = Object.fromEntries(componentsPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).map((s) => [s.name, s]));
const SINGLES = Object.fromEntries(componentsPage.findAllWithCriteria({ types: ['COMPONENT'] })
  .filter((c) => c.parent.type !== 'COMPONENT_SET').map((c) => [c.name, c]));
function variant(setName, variantName) {
  const set = SETS[setName];
  if (!set) throw new Error(`Conjunto de componentes "${setName}" não encontrado`);
  const v = set.children.find((c) => c.name === variantName);
  if (!v) throw new Error(`Variante "${variantName}" não existe em "${setName}"`);
  return v;
}
function propKey(owner, prop) {
  const defs = owner.componentPropertyDefinitions; // só em COMPONENT_SET ou COMPONENT avulso
  const key = Object.keys(defs).find((k) => k === prop || k.startsWith(prop + '#'));
  if (!key) throw new Error(`Propriedade "${prop}" não existe em "${owner.name}"`);
  return key;
}
const BTN = (v, size = 'md') => variant('Botão', `Variante=${v}, Tamanho=${size}`);
const K = {
  btn: {
    'Preenchido': BTN('Preenchido'), 'Contorno': BTN('Contorno'), 'Leve': BTN('Leve'), 'Desabilitado': BTN('Desabilitado'),
    'Perigo leve': BTN('Perigo leve'), 'Perigo': BTN('Perigo'),
    'Preenchido xs': BTN('Preenchido', 'xs'), 'Contorno xs': BTN('Contorno', 'xs'), 'Leve xs': BTN('Leve', 'xs'),
    'Desabilitado xs': BTN('Desabilitado', 'xs'), 'Preenchido lg': BTN('Preenchido', 'lg'),
  },
  badge: Object.fromEntries(['Azul', 'Amarelo', 'Verde', 'Vermelho', 'Cinza'].map((c) => [c, variant('Badge', `Cor=${c}`)])),
  campo: {
    'Preenchido': variant('Campo', 'Estado=Preenchido, Ícone=Nenhum'), 'Preenchido/Olho': variant('Campo', 'Estado=Preenchido, Ícone=Olho'),
    'Preenchido/Seletor': variant('Campo', 'Estado=Preenchido, Ícone=Seletor'), 'Placeholder': variant('Campo', 'Estado=Placeholder, Ícone=Nenhum'),
    'Placeholder/Olho': variant('Campo', 'Estado=Placeholder, Ícone=Olho'), 'Placeholder/Seletor': variant('Campo', 'Estado=Placeholder, Ícone=Seletor'),
    'Foco': variant('Campo', 'Estado=Foco, Ícone=Nenhum'),
  },
  nav: { 'Padrão': variant('Menu/Item', 'Estado=Padrão'), 'Ativo': variant('Menu/Item', 'Estado=Ativo') },
  radio: { 'Marcado': variant('Rádio', 'Estado=Marcado'), 'Desmarcado': variant('Rádio', 'Estado=Desmarcado') },
  stat: Object.fromEntries(['Amarelo', 'Vermelho', 'Verde'].map((t) => [t, variant('Card de contagem', `Tom=${t}`)])),
  alerta: Object.fromEntries(['Azul', 'Verde', 'Vermelho', 'Amarelo'].map((t) => [t, variant('Alerta', `Tom=${t}`)])),
  icone: Object.fromEntries(['Fechar', 'Seta esquerda', 'Seta direita', 'Olho', 'Seletor'].map((n) => [n, variant('Ícone', `Nome=${n}`)])),
  checkbox: SINGLES['Checkbox'],
  switch: SINGLES['Switch'],
  header: Object.fromEntries(['Operador', 'Consulta', 'Sem conexão'].map((p) => [p, variant('Cabeçalho do app', `Perfil=${p}`)])),
};
const P = {
  btn: propKey(SETS['Botão'], 'Rótulo'), badge: propKey(SETS['Badge'], 'Texto'), campo: propKey(SETS['Campo'], 'Valor'),
  nav: propKey(SETS['Menu/Item'], 'Rótulo'), radio: propKey(SETS['Rádio'], 'Rótulo'),
  statL: propKey(SETS['Card de contagem'], 'Rótulo'), statN: propKey(SETS['Card de contagem'], 'Número'),
  alT: propKey(SETS['Alerta'], 'Título'), alM: propKey(SETS['Alerta'], 'Mensagem'), alShow: propKey(SETS['Alerta'], 'Mostrar título'),
  checkbox: propKey(SINGLES['Checkbox'], 'Rótulo'), switch: propKey(SINGLES['Switch'], 'Rótulo'),
  cliente: propKey(SETS['Cabeçalho do app'], 'Cliente'),
};

// --- Cores (variáveis da coleção "Cores do app") e estilos de texto
const collection = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === 'Cores do app');
const VARS = {};
for (const id of collection.variableIds) { const v = await figma.variables.getVariableByIdAsync(id); VARS[v.name] = v; }
const MODE = collection.modes[0].modeId;
const paint = (name) => {
  const v = VARS[name];
  if (!v) throw new Error(`Variável de cor "${name}" não existe`);
  return figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: v.valuesByMode[MODE] }, 'color', v);
};
const TEXT_STYLES = Object.fromEntries((await figma.getLocalTextStylesAsync()).map((s) => [s.name, s]));
const STYLE = {
  'título app': 'App/Título do app', 'título página': 'App/Título da página', 'título seção': 'App/Título da seção', 'título diálogo': 'App/Título do diálogo',
  'corpo': 'Texto/Corpo', 'corpo forte': 'Texto/Corpo forte', 'corpo grande': 'Texto/Corpo grande', 'rótulo': 'Texto/Rótulo', 'rótulo grande': 'Texto/Rótulo grande',
  'descrição': 'Texto/Descrição', 'cronômetro': 'Texto/Cronômetro', 'tabela': 'Texto/Tabela cabeçalho', 'mono': 'Texto/Mono',
};

// --- Construção
const created = [];
const SHADOW = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 6 }, radius: 24, spread: 0, visible: true, blendMode: 'NORMAL' }];
const NAV_OP = ['Executar', 'Execuções', 'Reservas', 'Configuração'];
const NAV_RD = ['Execuções', 'Reservas', 'Configuração'];
const PERIOD = '13/11/2026 a 19/11/2026';

async function I(component, props = {}) { const n = component.createInstance(); if (Object.keys(props).length) n.setProperties(props); return n; }
async function T(chars, style = 'corpo', color = 'texto/padrão') {
  const t = figma.createText(); await t.setTextStyleIdAsync(TEXT_STYLES[STYLE[style] ?? style].id); t.characters = chars; t.fills = [paint(color)]; return t;
}
function AL(dir, props = {}) { const f = figma.createAutoLayout(dir); f.fills = []; f.set(props); return f; }
/** Anexa e dimensiona: 'fill' ocupa a largura do pai; número fixa a largura. */
function put(parent, node, w) {
  parent.appendChild(node);
  if (w === 'fill') { node.layoutSizingHorizontal = 'FILL'; if (node.type === 'TEXT') node.textAutoResize = 'HEIGHT'; }
  else if (typeof w === 'number') {
    if (node.type === 'TEXT') { node.textAutoResize = 'HEIGHT'; node.resize(w, node.height); }
    else { node.resize(w, node.height); node.layoutSizingHorizontal = 'FIXED'; }
  }
  return node;
}
/** Texto com trechos: 'b' negrito, 'dim' apagado, 'dimsm' apagado e 12 px. */
async function rich(parts, style = 'corpo') {
  const t = await T(parts.map((p) => p[0]).join(''), style); let i = 0;
  for (const [s, kind] of parts) {
    if (kind === 'b') t.setRangeFontName(i, i + s.length, { family: 'Noto Sans', style: 'Bold' });
    if (kind === 'dim' || kind === 'dimsm') t.setRangeFills(i, i + s.length, [paint('texto/apagado')]);
    if (kind === 'dimsm') t.setRangeFontSize(i, i + s.length, 12);
    i += s.length;
  }
  return t;
}
/** Moldura de tela 1440 × h: cabeçalho, menu lateral e área de conteúdo (auto-layout vertical). */
async function screen(section, name, x, y, h, profile, items, active) {
  const root = figma.createFrame(); root.name = name; section.appendChild(root); root.x = x; root.y = y; root.resize(1440, h);
  root.fills = [paint('fundo/padrão')]; root.clipsContent = true; created.push(root.id);
  const header = await I(K.header[profile], profile === 'Sem conexão' ? {} : { [P.cliente]: profile === 'Consulta' ? 'Financeiro — consulta' : 'Recepção — PC 1' });
  root.appendChild(header); header.x = 0; header.y = 0;
  const nav = figma.createFrame(); nav.name = 'Menu lateral'; root.appendChild(nav);
  nav.layoutMode = 'VERTICAL'; nav.primaryAxisSizingMode = 'FIXED'; nav.counterAxisSizingMode = 'FIXED'; nav.resize(220, h - 56); nav.x = 0; nav.y = 56;
  nav.paddingLeft = nav.paddingTop = 10; nav.paddingRight = 11; nav.fills = [paint('fundo/padrão')]; nav.strokes = [paint('borda/padrão')];
  nav.strokeTopWeight = 0; nav.strokeLeftWeight = 0; nav.strokeBottomWeight = 0; nav.strokeRightWeight = 1;
  for (const it of items) { const n = await I(K.nav[it === active ? 'Ativo' : 'Padrão'], { [P.nav]: it }); nav.appendChild(n); n.layoutSizingHorizontal = 'FILL'; }
  const main = AL('VERTICAL', { name: 'Conteúdo', itemSpacing: 16, paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16 });
  root.appendChild(main); main.primaryAxisSizingMode = 'FIXED'; main.counterAxisSizingMode = 'FIXED'; main.resize(1220, h - 56); main.x = 220; main.y = 56;
  return { root, main };
}
async function card(parent, title, width = 'fill', gap = 16) {
  const c = AL('VERTICAL', { name: title ? 'Card — ' + title : 'Card', itemSpacing: gap, paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16, cornerRadius: 8 });
  c.fills = [paint('fundo/padrão')]; c.strokes = [paint('borda/padrão')]; c.strokeWeight = 1; put(parent, c, width);
  if (title) put(c, await T(title, 'título seção'));
  return c;
}
async function field(parent, { label, desc, value = '', variant: v = 'Preenchido', width = 'fill', name }) {
  const f = AL('VERTICAL', { name: name ?? 'Campo — ' + label, itemSpacing: 4 }); put(parent, f, width);
  put(f, await T(label, 'rótulo'));
  if (desc) put(f, await T(desc, 'descrição', 'texto/apagado'), 'fill');
  put(f, await I(K.campo[v], { [P.campo]: value }), 'fill');
  return f;
}
async function btn(parent, label, v = 'Preenchido') { const b = await I(K.btn[v], { [P.btn]: label }); parent.appendChild(b); return b; }
async function badge(parent, tone, label) { const b = await I(K.badge[tone], { [P.badge]: label }); parent.appendChild(b); return b; }
async function alert(parent, tone, title, message, width = 'fill') {
  const a = await I(K.alerta[tone], title ? { [P.alT]: title, [P.alM]: message } : { [P.alShow]: false, [P.alM]: message });
  put(parent, a, width); return a;
}
function divider(parent) { const r = figma.createRectangle(); r.name = 'divisor'; r.resize(100, 1); r.fills = [paint('borda/padrão')]; put(parent, r, 'fill'); return r; }
function spacer(parent) { const f = figma.createFrame(); f.name = 'espaço'; f.fills = []; parent.appendChild(f); f.resize(10, 10); f.layoutSizingHorizontal = 'FILL'; return f; }
/** Sobreposição escura: a opacidade vai na camada (com cor ligada a variável, a opacidade da pintura se perde). */
function overlay(root) { const r = figma.createRectangle(); r.name = 'Sobreposição'; root.appendChild(r); r.resize(root.width, root.height); r.x = 0; r.y = 0; r.fills = [paint('sobreposição')]; r.opacity = 0.6; return r; }
function modal(root, width, name) {
  const m = AL('VERTICAL', { name, itemSpacing: 16, paddingLeft: 16, paddingRight: 16, paddingTop: 20, paddingBottom: 16, cornerRadius: 8 });
  m.fills = [paint('fundo/padrão')]; m.effects = SHADOW; root.appendChild(m); m.resize(width, m.height); m.counterAxisSizingMode = 'FIXED'; return m;
}
function center(root, m) { m.x = Math.round((root.width - m.width) / 2); m.y = Math.round((root.height - m.height) / 2); }
/** Gaveta de detalhe à direita (780 px), altura da tela. */
function drawer(root, name) {
  const d = AL('VERTICAL', { name, itemSpacing: 16, paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16 });
  d.fills = [paint('fundo/padrão')]; d.effects = SHADOW; root.appendChild(d);
  d.primaryAxisSizingMode = 'FIXED'; d.counterAxisSizingMode = 'FIXED'; d.resize(780, root.height); d.x = root.width - 780; d.y = 0; d.clipsContent = true; return d;
}
/** Linha horizontal centrada; ocupa a largura do pai, a não ser com `fill: false`. */
function row(parent, name, { fill = true, ...props } = {}) { const r = AL('HORIZONTAL', { name, counterAxisAlignItems: 'CENTER', ...props }); put(parent, r, fill ? 'fill' : undefined); return r; }
async function closeIcon(parent) { const i = await I(K.icone['Fechar']); parent.appendChild(i); return i; }
/** Cabeçalho de diálogo ou gaveta: título + X. */
async function titleWithClose(parent, title, style = 'título diálogo') {
  const h = row(parent, 'Cabeçalho', { primaryAxisAlignItems: 'SPACE_BETWEEN' }); h.appendChild(await T(title, style)); await closeIcon(h); return h;
}
/** Tabela listrada. cols: [[título, largura | 'fill']]; células: texto, {badge, text} ou {rich}. */
async function table(parent, cols, rows) {
  const t = AL('VERTICAL', { name: 'Tabela' }); put(parent, t, 'fill');
  const mk = async (cells, header, striped) => {
    const r = AL('HORIZONTAL', { name: header ? 'Cabeçalho da tabela' : 'Linha' }); t.appendChild(r);
    r.resize(100, header ? 38 : 35); r.layoutSizingHorizontal = 'FILL'; r.layoutSizingVertical = 'FIXED';
    r.fills = striped ? [paint('fundo/sutil')] : []; r.strokes = [paint('borda/padrão')];
    r.strokeTopWeight = 0; r.strokeLeftWeight = 0; r.strokeRightWeight = 0; r.strokeBottomWeight = 1;
    for (let i = 0; i < cols.length; i++) {
      const cell = AL('HORIZONTAL', { name: cols[i][0], counterAxisAlignItems: 'CENTER', paddingLeft: 10, paddingRight: 10 }); r.appendChild(cell);
      if (cols[i][1] === 'fill') cell.layoutSizingHorizontal = 'FILL'; else { cell.resize(cols[i][1], 10); cell.layoutSizingHorizontal = 'FIXED'; }
      cell.layoutSizingVertical = 'FILL';
      const v = cells[i]; if (v == null || v === '') continue;
      if (typeof v === 'string') cell.appendChild(await T(v, header ? 'tabela' : 'corpo'));
      else if (v.badge) await badge(cell, v.badge, v.text);
      else if (v.rich) cell.appendChild(await rich(v.rich));
    }
  };
  await mk(cols.map((c) => c[0]), true, false);
  for (let i = 0; i < rows.length; i++) await mk(rows[i], false, i % 2 === 0);
  return t;
}
/** Cards de contagem por situação, `perRow` por linha, mesma altura na linha. items: [[tom, rótulo, número]]. */
async function statGrid(parent, items, perRow = 5) {
  const g = AL('VERTICAL', { name: 'Contagens por situação', itemSpacing: 12 }); put(parent, g, 'fill');
  for (let i = 0; i < items.length; i += perRow) {
    const r = AL('HORIZONTAL', { name: 'Linha de contagens', itemSpacing: 12 }); put(g, r, 'fill');
    const tiles = [];
    for (let j = 0; j < perRow; j++) {
      const it = items[i + j];
      if (it) { const s = await I(K.stat[it[0]], { [P.statL]: it[1], [P.statN]: String(it[2]) }); r.appendChild(s); s.layoutSizingHorizontal = 'FILL'; tiles.push(s); }
      else spacer(r);
    }
    const max = Math.max(...tiles.map((s) => s.height));
    for (const s of tiles) { s.resize(s.width, max); s.layoutSizingHorizontal = 'FILL'; }
  }
  return g;
}
const hotelCell = (name, code) => ({ rich: [[name], [` (${code})`, 'dimsm']] });

// --- Registro das telas e reconstrução
/** Cada arquivo de references/screens/ preenche SCREENS['x.y'] = { name, h, profile, nav, active, build }. */
const SCREENS = {};
function sectionFor(id) {
  const name = SECTIONS[id.split('.')[0]];
  let s = screensPage.children.find((n) => n.type === 'SECTION' && n.name === name);
  if (!s) {
    let maxY = 0; for (const c of screensPage.children) if (c.type === 'SECTION') maxY = Math.max(maxY, c.y + c.height + 240);
    s = figma.createSection(); s.name = name; s.x = 0; s.y = maxY; created.push(s.id);
  }
  return s;
}
function fitSection(s) { let w = 0, h = 0; for (const c of s.children) { w = Math.max(w, c.x + c.width); h = Math.max(h, c.y + c.height); } s.resizeWithoutConstraints(w + 120, h + 120); }
/**
 * Reconstrói as telas pedidas: apaga o frame antigo (o nome começa com "x.y ") e cria o novo no
 * mesmo lugar. Tela nova: entra à direita da última da seção (ou na próxima linha, depois de 5).
 */
async function rebuild(ids) {
  const done = [];
  for (const id of ids) {
    const def = SCREENS[id];
    if (!def) throw new Error(`Tela ${id} não está registrada em SCREENS`);
    const section = sectionFor(id);
    const old = section.children.find((n) => n.type === 'FRAME' && n.name.startsWith(id + ' '));
    let x, y;
    if (old) { x = old.x; y = old.y; old.remove(); }
    else {
      const frames = section.children.filter((n) => n.type === 'FRAME');
      const last = frames.sort((a, b) => a.y - b.y || a.x - b.x).at(-1);
      if (!last) { x = 120; y = 120; } else if (last.x + 1560 > 120 + 5 * 1560 - 1) { x = 120; y = last.y + last.height + 200; } else { x = last.x + 1560; y = last.y; }
    }
    const s = await screen(section, `${id} ${def.name}`, x, y, def.h, def.profile, def.nav, def.active);
    await def.build(s);
    fitSection(section);
    done.push({ id, frameId: s.root.id });
  }
  return done;
}
