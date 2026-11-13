// Telas 2.x — Executar (apps/desktop/src/renderer/src/screens/run/ e components/TwoFactorDialog.tsx).
// Requer o figma-prelude.js antes deste arquivo.

async function accessFormCard(main, filled) {
  const c = await card(main, 'Acesso ao Hunit', 980);
  const r = row(c, 'Usuário e senha', { itemSpacing: 16, counterAxisAlignItems: 'MIN' });
  (await field(r, { label: 'Usuário do Hunit', value: filled ? 'operador@exemplo.com.br' : '' })).layoutSizingHorizontal = 'FILL';
  (await field(r, { label: 'Senha do Hunit', value: filled ? '••••••••••••••' : '', variant: 'Preenchido/Olho' })).layoutSizingHorizontal = 'FILL';
  const f = row(c, 'Rodapé', { itemSpacing: 16, primaryAxisAlignItems: 'SPACE_BETWEEN' });
  f.appendChild(await T('Fica só na memória do app até ele ser fechado ou ficar sem uso pelo prazo de inatividade; nunca é gravado.', 'descrição', 'texto/apagado'));
  await btn(f, 'Guardar acesso', filled ? 'Leve xs' : 'Desabilitado xs');
}
async function accessSavedCard(main) {
  const c = await card(main, 'Acesso ao Hunit', 980);
  const r = row(c, 'Acesso guardado', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  r.appendChild(await rich([['Usuário '], ['operador@exemplo.com.br', 'b'], [' — senha guardada nesta sessão']]));
  await btn(r, 'Limpar acesso', 'Contorno xs');
}
async function queryCard(main, { choose = false } = {}) {
  const c = await card(main, 'Consulta', 980);
  await field(c, { label: 'Período de check-in', value: PERIOD, width: 360 });
  const g = AL('VERTICAL', { name: 'Hotéis', itemSpacing: 8 }); put(c, g, 'fill');
  put(g, await T('Hotéis', 'rótulo'));
  g.appendChild(await I(K.radio[choose ? 'Desmarcado' : 'Marcado'], { [P.radio]: 'Todos os hotéis do catálogo' }));
  g.appendChild(await I(K.radio[choose ? 'Marcado' : 'Desmarcado'], { [P.radio]: 'Escolher hotéis' }));
  if (choose) await field(c, { label: 'Hotéis escolhidos', value: 'Busque pelo nome ou pelo código', variant: 'Placeholder/Seletor' });
  await btn(c, 'Iniciar execução', 'Preenchido lg');
}
/** Card do resultado/andamento: título + badge à esquerda, período à direita. */
async function resultCard(main, title, tone, label) {
  const c = await card(main, null, 980);
  const h = row(c, 'Cabeçalho', { primaryAxisAlignItems: 'SPACE_BETWEEN' });
  const l = AL('HORIZONTAL', { name: 'Título', itemSpacing: 12, counterAxisAlignItems: 'CENTER' }); h.appendChild(l);
  l.appendChild(await T(title, 'título seção')); await badge(l, tone, label);
  h.appendChild(await T('Check-in de ' + PERIOD, 'corpo', 'texto/apagado'));
  return c;
}
async function runBase(main) { put(main, await T('Executar', 'título página')); await accessSavedCard(main); await queryCard(main); }
async function failBox(parent, message, withButton) {
  if (!withButton) return alert(parent, 'Vermelho', null, message);
  const b = AL('HORIZONTAL', { name: 'Alerta — falha com ação', counterAxisAlignItems: 'CENTER', primaryAxisAlignItems: 'SPACE_BETWEEN', paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16, cornerRadius: 8 });
  b.fills = [paint('vermelho/1')]; put(parent, b, 'fill'); b.appendChild(await T(message)); await btn(b, 'Iniciar de novo', 'Preenchido xs'); return b;
}
async function tokenOutcomeDialog(root, tone, message) {
  overlay(root);
  const m = modal(root, 440, 'Diálogo — pedido de token');
  await titleWithClose(m, 'O Hunit pediu o token');
  await alert(m, tone, null, message);
  const a = row(m, 'Ações', { primaryAxisAlignItems: 'MAX' }); await btn(a, 'Fechar');
  center(root, m);
}
async function calendar(root, x, y) {
  const cal = AL('HORIZONTAL', { name: 'Calendário — período de check-in', itemSpacing: 24, paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16, cornerRadius: 8 });
  cal.fills = [paint('fundo/padrão')]; cal.strokes = [paint('borda/padrão')]; cal.effects = SHADOW; root.appendChild(cal); cal.x = x; cal.y = y;
  // [título, dia da semana do dia 1 (0 = domingo), dias no mês, seta, intervalo escolhido]
  for (const [title, startDow, days, chev, range] of [['Novembro 2026', 0, 30, 'Seta esquerda', [13, 19]], ['Dezembro 2026', 2, 31, 'Seta direita', null]]) {
    const m = AL('VERTICAL', { name: title }); cal.appendChild(m);
    const head = AL('HORIZONTAL', { name: 'Cabeçalho do mês', counterAxisAlignItems: 'CENTER', primaryAxisAlignItems: 'SPACE_BETWEEN' }); m.appendChild(head);
    head.primaryAxisSizingMode = 'FIXED'; head.resize(259, 40);
    const slot = async () => { if (chev === 'Seta esquerda') return I(K.icone[chev]); const f = figma.createFrame(); f.resize(20, 20); f.fills = []; f.name = 'espaço'; return f; };
    const slotEnd = async () => { if (chev === 'Seta direita') return I(K.icone[chev]); const f = figma.createFrame(); f.resize(20, 20); f.fills = []; f.name = 'espaço'; return f; };
    head.appendChild(await slot()); head.appendChild(await T(title, 'corpo forte')); head.appendChild(await slotEnd());
    const cell = (parent) => { const c = AL('HORIZONTAL', { name: 'Dia', primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' }); parent.appendChild(c); c.primaryAxisSizingMode = 'FIXED'; c.counterAxisSizingMode = 'FIXED'; c.resize(37, 37); return c; };
    const wd = AL('HORIZONTAL', { name: 'Dias da semana' }); m.appendChild(wd);
    for (const d of ['Do', '2ª', '3ª', '4ª', '5ª', '6ª', 'Sá']) cell(wd).appendChild(await T(d, 'corpo', 'texto/apagado'));
    for (let day = 1 - startDow; day <= days;) {
      const w = AL('HORIZONTAL', { name: 'Semana' }); m.appendChild(w);
      for (let i = 0; i < 7; i++, day++) {
        const c = cell(w); if (day < 1 || day > days) continue;
        const edge = range && (day === range[0] || day === range[1]); const inside = range && day > range[0] && day < range[1];
        if (edge) { c.fills = [paint('azul/6')]; c.cornerRadius = 8; } else if (inside) c.fills = [paint('azul/1')];
        c.appendChild(await T(String(day), 'corpo', edge ? 'fundo/padrão' : i === 0 || i === 6 ? 'vermelho/6' : 'texto/padrão'));
      }
    }
  }
}
const COUNTS_RUNNING = [['Amarelo', 'Pendente de cobrança', 2], ['Amarelo', 'Cobrar na maquininha', 1], ['Amarelo', 'Cartão validado (não cobrado)', 1], ['Vermelho', 'Erro na cobrança', 2], ['Vermelho', 'Erro de análise', 1], ['Verde', 'Já cobrada', 2], ['Verde', 'Faturada', 1]];
const COUNTS_DONE = [['Amarelo', 'Pendente de cobrança', 4], ['Amarelo', 'Cobrar na maquininha', 3], ['Amarelo', 'Cartão validado (não cobrado)', 3], ['Vermelho', 'Erro na cobrança', 3], ['Vermelho', 'Erro de análise', 3], ['Verde', 'Já cobrada', 3], ['Verde', 'Faturada', 3]];
const RUN_COLS = [['Hotel', 352], ['Situação', 184], ['Reservas', 145], ['Duração', 140], ['Motivo', 'fill']];
const DONE = { badge: 'Verde', text: 'Concluído' };

SCREENS['2.1'] = { name: 'Executar — vazio', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Executar',
  async build({ main }) { put(main, await T('Executar', 'título página')); await accessFormCard(main, false); await queryCard(main); } };

SCREENS['2.2'] = { name: 'Executar — escolhendo o período', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Executar',
  async build({ root, main }) { put(main, await T('Executar', 'título página')); await accessFormCard(main, true); await queryCard(main); await calendar(root, 253, 442); } };

SCREENS['2.3'] = { name: 'Executar — escolher hotéis', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Executar',
  async build({ main }) { put(main, await T('Executar', 'título página')); await accessFormCard(main, true); await queryCard(main, { choose: true }); } };

SCREENS['2.4'] = { name: 'Executar — o Hunit pediu o token', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Executar',
  async build({ root, main }) {
    await runBase(main); await resultCard(main, 'Execução em andamento', 'Amarelo', 'Aguardando token');
    overlay(root);
    const m = modal(root, 440, 'Diálogo — pedido de token');
    put(m, await T('O Hunit pediu o token', 'título diálogo'), 'fill');
    const t = row(m, 'Tempo restante', { primaryAxisAlignItems: 'SPACE_BETWEEN' }); t.appendChild(await T('Tempo restante')); t.appendChild(await T('1:59', 'cronômetro'));
    const f = AL('VERTICAL', { name: 'Campo — Token do autenticador', itemSpacing: 4 }); put(m, f, 'fill'); put(f, await T('Token do autenticador', 'rótulo grande'));
    const inp = await I(K.campo['Foco'], { [P.campo]: '' }); put(f, inp, 'fill'); inp.resize(inp.width, 50);
    const a = row(m, 'Ações', { primaryAxisAlignItems: 'MAX' }); await btn(a, 'Enviar token');
    center(root, m);
  } };

SCREENS['2.5'] = { name: 'Executar — token aceito', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Executar',
  async build({ root, main }) { await runBase(main); await resultCard(main, 'Execução em andamento', 'Azul', 'Em andamento'); await tokenOutcomeDialog(root, 'Verde', 'Token aceito pelo Hunit. A execução continua.'); } };

SCREENS['2.6'] = { name: 'Executar — execução em andamento', h: 1120, profile: 'Operador', nav: NAV_OP, active: 'Executar',
  async build({ main }) {
    await runBase(main);
    const c = await resultCard(main, 'Execução em andamento', 'Azul', 'Em andamento');
    await statGrid(c, COUNTS_RUNNING);
    await table(c, RUN_COLS, [
      [hotelCell('Hotel Praia Azul', 101), DONE, '6', '42 s', ''],
      [hotelCell('Pousada Serra Verde', 102), DONE, '4', '31 s', ''],
      [hotelCell('Hotel Centro Histórico', 103), { badge: 'Azul', text: 'Em andamento' }, '0', '—', ''],
      [hotelCell('Resort Lagoa Clara', 104), { badge: 'Cinza', text: 'Pendente' }, '0', '—', ''],
    ]);
  } };

SCREENS['2.7'] = { name: 'Executar — resultado (concluída)', h: 1120, profile: 'Operador', nav: NAV_OP, active: 'Executar',
  async build({ main }) {
    await runBase(main);
    const c = await resultCard(main, 'Resultado da execução', 'Verde', 'Concluída');
    await statGrid(c, COUNTS_DONE);
    await table(c, RUN_COLS, [
      [hotelCell('Hotel Praia Azul', 101), DONE, '6', '42 s', ''],
      [hotelCell('Pousada Serra Verde', 102), DONE, '4', '31 s', ''],
      [hotelCell('Hotel Centro Histórico', 103), DONE, '5', '38 s', ''],
      [hotelCell('Resort Lagoa Clara', 104), DONE, '7', '51 s', ''],
    ]);
  } };

SCREENS['2.8'] = { name: 'Executar — usuário ou senha incorretos', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Executar',
  async build({ main }) { await runBase(main); const c = await resultCard(main, 'Resultado da execução', 'Vermelho', 'Falhou'); await failBox(c, 'Usuário ou senha do Hunit incorretos.', false); } };

SCREENS['2.9'] = { name: 'Executar — token recusado (diálogo)', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Executar',
  async build({ root, main }) {
    await runBase(main); const c = await resultCard(main, 'Resultado da execução', 'Vermelho', 'Falhou'); await failBox(c, 'O Hunit recusou o token.', true);
    await tokenOutcomeDialog(root, 'Vermelho', 'O Hunit recusou o token.');
  } };

SCREENS['2.10'] = { name: 'Executar — falhou, com "Iniciar de novo"', h: 900, profile: 'Operador', nav: NAV_OP, active: 'Executar',
  async build({ main }) { await runBase(main); const c = await resultCard(main, 'Resultado da execução', 'Vermelho', 'Falhou'); await failBox(c, 'O Hunit recusou o token.', true); } };
