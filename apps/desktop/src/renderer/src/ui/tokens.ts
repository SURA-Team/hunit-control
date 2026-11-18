/**
 * Tokens da nova identidade visual (specs/006, research R-02): os valores das variáveis e dos
 * estilos do design (arquivo "Hunit Control" no Figma: coleção "Cores do app", modo "Nova
 * identidade", e estilos "Nova identidade/…"), com os mesmos nomes. Cores, sombras, raios e
 * tipografia do app saem só daqui: o tema do Mantine e as variáveis CSS `--hc-*`, que os módulos CSS
 * de ui/ usam, são gerados a partir destes valores (ui/theme.ts).
 *
 * Valores lidos do design em 2026-11-18. Mudou no Figma? Mude aqui e rode o teste de contraste
 * (test/renderer/tokens-contrast.test.ts).
 */

/** Variáveis de cor do design (nome no Figma → valor). */
export const colors = {
  'fundo/app': '#ecedf0',
  'fundo/padrão': '#ffffff',
  'fundo/sutil': '#f4f5f7',
  'fundo/desabilitado': '#ecedf0',
  'superfície/escura': '#0e0e10',
  'superfície/escura 2': '#1c1d21',
  sobreposição: '#0e0e10',
  'destaque/lima': '#d4f25a',
  'destaque/lima suave': '#f0fad2',
  'texto/padrão': '#0e0e10',
  'texto/ícone': '#2a2c31',
  'texto/apagado': '#787b83',
  'texto/placeholder': '#a6a9b0',
  'texto/inverso': '#ffffff',
  'texto/inverso apagado': '#9a9ca3',
  'borda/padrão': '#e7e8eb',
  'borda/campo': '#dcdee2',
  'cinza/1': '#eeeff1',
  'cinza/9': '#0e0e10',
  'verde/1': '#e2f5e7',
  'verde/8': '#1f9d55',
  'verde/9': '#17703d',
  'amarelo/1': '#fff0d9',
  'amarelo/8': '#d97a00',
  'amarelo/9': '#9a5500',
  'vermelho/1': '#fde5e2',
  'vermelho/6': '#e5484d',
  'vermelho/8': '#d13438',
  'vermelho/9': '#a3282c',
  // O design guardou os nomes "azul/*" da paleta anterior, já com as cores da nova identidade.
  'azul/1': '#f0fad2',
  'azul/6': '#0e0e10',
  'azul/9': '#4a5a10',
} as const satisfies Record<string, `#${string}`>;

export type ColorToken = keyof typeof colors;

/** Estilos de sombra "Nova identidade/Sombra — card", "… — flutuante" e "… — diálogo" (cor #0E0E12 translúcida). */
export const shadows = {
  card: '0 1px 2px #0e0e120a, 0 8px 24px #0e0e120d',
  flutuante: '0 2px 4px #0e0e120a, 0 16px 40px #0e0e1214',
  diálogo: '0 4px 8px #0e0e120f, 0 32px 64px #0e0e122e',
} as const;

export type ShadowToken = keyof typeof shadows;

/** Raios dos cantos, em px, como nos componentes do design. */
export const radii = {
  /** Cards brancos e escuros, listas, barra de lote. */
  card: 20,
  /** Campos, ícone do documento. */
  field: 12,
  /** Botões, selos, chips, abas, itens do menu: pílula. */
  pill: 999,
  /** Diálogos e gaveta. */
  dialog: 28,
  /** Menu lateral e calendário. */
  menu: 24,
  /** Caixas cinza dentro dos cards e menus suspensos. */
  box: 16,
  /** Alertas e cards de contagem. */
  notice: 18,
  /** Opções dos menus suspensos. */
  option: 10,
  /** Caixa de seleção. */
  checkbox: 6,
} as const;

/** Sobreposição atrás de diálogos e da gaveta: `sobreposição` com 60 % de opacidade e 3 px de desfoque. */
export const overlay = { opacity: 0.6, blur: 3 } as const;

/** Fonte do design, embutida no app (research R-03), com as do sistema como reserva. */
export const fontFamily = "'Manrope Variable', 'Segoe UI', system-ui, sans-serif";

/** Fonte de códigos (impressão digital do certificado). O design usa Geist Mono, que não é embutida: as monoespaçadas do sistema. */
export const monoFontFamily = "ui-monospace, 'Cascadia Mono', Consolas, monospace";

export interface TextStyle {
  fontWeight: 500 | 600 | 700;
  /** Em px. */
  fontSize: number;
  /** Múltiplo do tamanho da fonte. */
  lineHeight: number;
  /** Em % do tamanho da fonte, como no Figma: -2,5 = -0,025em. */
  letterSpacing: number;
}

/** Estilos de texto "Nova identidade/…" do design (sem o prefixo). */
export const textStyles = {
  'App/Título da página': { fontWeight: 700, fontSize: 34, lineHeight: 1.15, letterSpacing: -2.5 },
  'App/Título da seção': { fontWeight: 700, fontSize: 18, lineHeight: 1.45, letterSpacing: -1 },
  'App/Título do app': { fontWeight: 700, fontSize: 17, lineHeight: 1.3, letterSpacing: -1 },
  'App/Título do diálogo': { fontWeight: 700, fontSize: 22, lineHeight: 1.4, letterSpacing: -1.5 },
  'Texto/Corpo': { fontWeight: 500, fontSize: 14, lineHeight: 1.55, letterSpacing: 0 },
  'Texto/Corpo forte': { fontWeight: 700, fontSize: 14, lineHeight: 1.55, letterSpacing: 0 },
  'Texto/Rótulo': { fontWeight: 600, fontSize: 13, lineHeight: 1.55, letterSpacing: 0 },
  'Texto/Rótulo grande': { fontWeight: 600, fontSize: 15, lineHeight: 1.55, letterSpacing: -0.5 },
  'Texto/Descrição': { fontWeight: 500, fontSize: 12, lineHeight: 1.4, letterSpacing: 0 },
  'Texto/Botão': { fontWeight: 600, fontSize: 14, lineHeight: 1, letterSpacing: 0 },
  'Texto/Botão pequeno': { fontWeight: 600, fontSize: 12, lineHeight: 1, letterSpacing: 0 },
  'Texto/Botão grande': { fontWeight: 600, fontSize: 16, lineHeight: 1, letterSpacing: -0.5 },
  'Texto/Badge': { fontWeight: 700, fontSize: 10, lineHeight: 1, letterSpacing: 6 },
  'Texto/Tabela cabeçalho': { fontWeight: 600, fontSize: 12, lineHeight: 1.55, letterSpacing: 2 },
  'Texto/Contagem rótulo': { fontWeight: 600, fontSize: 12, lineHeight: 1.4, letterSpacing: 0 },
  'Texto/Contagem número': { fontWeight: 700, fontSize: 30, lineHeight: 1.15, letterSpacing: -2.5 },
  'Texto/Cronômetro': { fontWeight: 700, fontSize: 48, lineHeight: 1.15, letterSpacing: -3 },
} as const satisfies Record<string, TextStyle>;

export type TextStyleToken = keyof typeof textStyles;

/**
 * Medidas da estrutura, em px (spec FR-046, FR-047; research R-07 e R-14). O cabeçalho tem 56 px no
 * design (a research falava em 72, que é onde o conteúdo começa: 56 + 16 de espaçamento).
 */
export const layout = {
  headerHeight: 56,
  menuWidth: 196,
  collapsedMenuWidth: 64,
  contentMaxWidth: 1600,
  dialogSm: 520,
  dialogLg: 780,
  drawerWidth: 780,
} as const;

/**
 * Pontos de quebra, em px (research R-07). `@media` e `@container` não aceitam variáveis CSS: os
 * módulos CSS repetem estes números, com um comentário apontando para cá.
 */
export const breakpoints = {
  /** Janela abaixo disto: menu lateral só com os ícones. */
  collapsedMenu: 1180,
  /** Conteúdo abaixo disto: o hotel vai para a segunda linha do hóspede na lista de reservas. */
  narrowList: 1000,
  /** Conteúdo abaixo disto: as grades de dados dos cards passam de 3 para 2 colunas. */
  narrowGrid: 820,
} as const;

/** Variável CSS de um nome do design: `cssVarName('superfície/escura 2')` = `--hc-superficie-escura-2`. */
export function cssVarName(name: string, prefix = ''): `--hc-${string}` {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `--hc-${prefix}${slug}`;
}

/** `var(--hc-…)` de uma cor, para estilos em linha dentro de ui/. */
export function colorVar(token: ColorToken): string {
  return `var(${cssVarName(token)})`;
}

/** Variável CSS de um estilo de texto (fonte completa): `--hc-font-titulo-da-pagina`. */
export function textStyleVarName(token: TextStyleToken): `--hc-${string}` {
  return cssVarName(token.slice(token.indexOf('/') + 1), 'font-');
}

/**
 * Todas as variáveis `--hc-*`, aplicadas na raiz do documento pelo tema (ui/theme.ts):
 * - cores: `--hc-fundo-app`, `--hc-destaque-lima`…;
 * - sombras: `--hc-shadow-card`, `--hc-shadow-flutuante`; raios: `--hc-radius-card`…;
 * - estilos de texto: `--hc-font-corpo` (para `font:`) e `--hc-font-corpo-tracking` (para
 *   `letter-spacing:`); a família em `--hc-font-family`;
 * - estrutura: `--hc-header-height`, `--hc-menu-width`, `--hc-dialog-sm`…
 */
export function cssVariables(): Record<`--hc-${string}`, string> {
  const vars: Record<`--hc-${string}`, string> = {};
  for (const [name, value] of Object.entries(colors)) vars[cssVarName(name)] = value;
  for (const [name, value] of Object.entries(shadows)) vars[cssVarName(name, 'shadow-')] = value;
  for (const [name, value] of Object.entries(radii))
    vars[cssVarName(name, 'radius-')] = `${value}px`;
  vars['--hc-font-family'] = fontFamily;
  vars['--hc-font-mono'] = monoFontFamily;
  for (const [name, style] of Object.entries(textStyles) as [TextStyleToken, TextStyle][]) {
    const base = textStyleVarName(name);
    vars[base] = `${style.fontWeight} ${style.fontSize}px/${style.lineHeight} ${fontFamily}`;
    vars[`${base}-tracking`] = `${style.letterSpacing / 100}em`;
  }
  const layoutVars: Record<keyof typeof layout, `--hc-${string}`> = {
    headerHeight: '--hc-header-height',
    menuWidth: '--hc-menu-width',
    collapsedMenuWidth: '--hc-menu-collapsed-width',
    contentMaxWidth: '--hc-content-max-width',
    dialogSm: '--hc-dialog-sm',
    dialogLg: '--hc-dialog-lg',
    drawerWidth: '--hc-drawer-width',
  };
  for (const [key, name] of Object.entries(layoutVars) as [
    keyof typeof layout,
    `--hc-${string}`,
  ][]) {
    vars[name] = `${layout[key]}px`;
  }
  return vars;
}

/** Par de cores de texto sobre fundo usado nas telas (SC-005). */
export interface TextColorPair {
  text: ColorToken;
  background: ColorToken;
  /** Onde o par aparece. */
  usage: string;
}

/**
 * Pares de texto sobre fundo usados nas telas do design, conferidos pelo teste de contraste
 * (SC-005: 4,5:1). Um par novo numa tela entra aqui. Texto de botão desabilitado fica de fora: a
 * WCAG não exige contraste de componente inativo.
 */
export const TEXT_COLOR_PAIRS: readonly TextColorPair[] = [
  {
    text: 'texto/padrão',
    background: 'fundo/padrão',
    usage: 'textos dos cards, diálogos e listas',
  },
  { text: 'texto/padrão', background: 'fundo/app', usage: 'título da página' },
  { text: 'texto/padrão', background: 'fundo/sutil', usage: 'valor dos campos, caixas cinza' },
  {
    text: 'texto/padrão',
    background: 'destaque/lima',
    usage: 'principal em superfície escura, contagem do chip ativo',
  },
  {
    text: 'texto/padrão',
    background: 'destaque/lima suave',
    usage: 'linha aberta ou marcada, opção escolhida',
  },
  { text: 'texto/padrão', background: 'cinza/1', usage: 'contagem das abas' },
  { text: 'texto/padrão', background: 'verde/1', usage: 'mensagem do alerta verde' },
  { text: 'texto/padrão', background: 'amarelo/1', usage: 'mensagem do alerta âmbar' },
  { text: 'texto/padrão', background: 'vermelho/1', usage: 'mensagem do alerta vermelho' },
  {
    text: 'texto/inverso',
    background: 'superfície/escura',
    usage: 'principal, chip ativo, barra de lote, card escuro, menu ativo',
  },
  {
    text: 'texto/inverso apagado',
    background: 'superfície/escura',
    usage: 'apoio em superfície escura',
  },
  {
    text: 'destaque/lima',
    background: 'superfície/escura',
    usage: 'percentual e ícone ativo no escuro',
  },
  { text: 'azul/9', background: 'azul/1', usage: 'selo e alerta lima' },
  { text: 'verde/9', background: 'verde/1', usage: 'selo e alerta verdes' },
  { text: 'amarelo/9', background: 'amarelo/1', usage: 'selo e alerta âmbar, ação "Reverter"' },
  {
    text: 'vermelho/9',
    background: 'vermelho/1',
    usage: 'selo e alerta vermelhos, "Perigo leve", "Desfazer"',
  },
  { text: 'cinza/9', background: 'cinza/1', usage: 'selo cinza' },
  { text: 'vermelho/8', background: 'fundo/sutil', usage: 'rótulo do card de contagem vermelho' },
  { text: 'amarelo/9', background: 'fundo/app', usage: '"dados de HH:MM — servidor indisponível"' },
  {
    text: 'verde/9',
    background: 'fundo/padrão',
    usage: 'confirmação curta ("Preferências salvas.")',
  },
  {
    text: 'vermelho/6',
    background: 'superfície/escura',
    usage: 'contagem do token no fim, erro no diálogo do token',
  },
  { text: 'texto/apagado', background: 'fundo/padrão', usage: 'texto secundário nos cards' },
  { text: 'texto/apagado', background: 'fundo/app', usage: 'subtítulo da página' },
  {
    text: 'texto/apagado',
    background: 'fundo/sutil',
    usage: 'contagem dos chips, texto secundário em caixa cinza',
  },
  { text: 'texto/apagado', background: 'cinza/1', usage: 'abas não escolhidas' },
  {
    text: 'texto/apagado',
    background: 'destaque/lima suave',
    usage: 'segunda linha da linha aberta ou marcada',
  },
  { text: 'texto/placeholder', background: 'fundo/sutil', usage: 'placeholder dos campos' },
  {
    text: 'texto/placeholder',
    background: 'fundo/padrão',
    usage: 'dias de fora do mês no calendário',
  },
  { text: 'texto/inverso', background: 'amarelo/8', usage: 'selo "Verificar"' },
  { text: 'fundo/padrão', background: 'vermelho/6', usage: 'botão "Perigo" ("Sim, cancelar")' },
  { text: 'amarelo/8', background: 'fundo/sutil', usage: 'rótulo do card de contagem âmbar' },
  { text: 'verde/8', background: 'fundo/sutil', usage: 'rótulo do card de contagem verde' },
];

/**
 * Pares do design abaixo de 4,5:1, aceitos nesta feature. SC-005: ficam para uma próxima spec
 * (research UX-1). O teste confere que continuam abaixo, para a lista não ficar velha quando a UX
 * ajustar as cores.
 */
export const CONTRAST_EXCEPTIONS: readonly Pick<TextColorPair, 'text' | 'background'>[] = [
  { text: 'texto/apagado', background: 'fundo/padrão' },
  { text: 'texto/apagado', background: 'fundo/app' },
  { text: 'texto/apagado', background: 'fundo/sutil' },
  { text: 'texto/apagado', background: 'cinza/1' },
  { text: 'texto/apagado', background: 'destaque/lima suave' },
  { text: 'texto/placeholder', background: 'fundo/sutil' },
  { text: 'texto/placeholder', background: 'fundo/padrão' },
  { text: 'texto/inverso', background: 'amarelo/8' },
  { text: 'fundo/padrão', background: 'vermelho/6' },
  { text: 'amarelo/8', background: 'fundo/sutil' },
  { text: 'verde/8', background: 'fundo/sutil' },
];
