// Sincronizador automático SimplesVet → Gestão Pet Puppy (v1.1).
// Faz tudo sozinho com o Chrome aberto:
//  • mantém uma aba fixada do SimplesVet aberta (o login não cai por inatividade);
//  • a cada 10 min "cutuca" o SimplesVet para manter a sessão viva;
//  • a cada 30 min lê o SimplesVet e grava no Gestão Pet Puppy;
//  • se falhar, tenta de novo em 5 min;
//  • se o login cair, avisa; assim que você entrar de novo, sincroniza na hora.
// Nenhuma senha é guardada.
const SV_URL = 'https://app.simples.vet/principal/dashboard.php';
const SV_PADRAO = 'https://app.simples.vet/*';
const GP_URL = 'https://gestaopetpuppy.com.br/#svsync';
const GP_PADRAO = 'https://gestaopetpuppy.com.br/*';
const SYNC_MIN = 30, VIVO_MIN = 10, REPETIR_MIN = 5;
let rodando = false;

// ---------- agenda ----------
function agendar() {
  chrome.alarms.create('pp-sync', { delayInMinutes: 1, periodInMinutes: SYNC_MIN });
  chrome.alarms.create('pp-vivo', { delayInMinutes: VIVO_MIN, periodInMinutes: VIVO_MIN });
}
chrome.runtime.onInstalled.addListener(() => { agendar(); garantirAbaSV(); });
chrome.runtime.onStartup.addListener(() => { agendar(); garantirAbaSV(); });
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === 'pp-sync' || a.name === 'pp-repetir') sincronizar();
  if (a.name === 'pp-vivo') manterVivo();
});
chrome.runtime.onMessage.addListener((m, _s, responder) => {
  if (m && m.tipo === 'agora') { sincronizar(true).then(() => responder(true)); return true; }
  if (m && m.tipo === 'abrirSV') { abrirLoginSV(); responder(true); }
});
chrome.notifications.onClicked.addListener(id => { if (id.startsWith('pp-login')) abrirLoginSV(); chrome.notifications.clear(id); });

// Quando você termina o login no SimplesVet, sincroniza na hora.
chrome.tabs.onUpdated.addListener(async (id, info, tab) => {
  if (info.status !== 'complete' || !tab.url || !tab.url.startsWith('https://app.simples.vet/')) return;
  if (/\/login\//.test(tab.url)) return;
  const { ultimo } = await chrome.storage.local.get('ultimo');
  if (ultimo && ultimo.semLoginSV) { await chrome.storage.local.set({ ultimo: { ...ultimo, semLoginSV: false } }); setTimeout(() => sincronizar(), 3000); }
});

// ---------- utilidades ----------
const pausa = ms => new Promise(r => setTimeout(r, ms));
async function status(s) {
  s.em = new Date().toISOString();
  await chrome.storage.local.set({ ultimo: s });
  chrome.action.setBadgeText({ text: s.ok ? '✓' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: s.ok ? '#2e9e5b' : '#d93025' });
}
function emAndamento() { chrome.action.setBadgeText({ text: '…' }); chrome.action.setBadgeBackgroundColor({ color: '#F2B600' }); }
async function avisar(id, titulo, texto) {
  // não repete o mesmo aviso mais de 1x a cada 2 horas
  const k = 'aviso_' + id, agora = Date.now(), o = await chrome.storage.local.get(k);
  if (o[k] && agora - o[k] < 2 * 3600e3) return;
  await chrome.storage.local.set({ [k]: agora });
  chrome.notifications.create(id + '-' + agora, { type: 'basic', iconUrl: 'icon128.png', title: titulo, message: texto, priority: 2, requireInteraction: id === 'pp-login' });
}
function esperarCarregar(tabId, ms = 45000) {
  return new Promise(res => {
    const fim = setTimeout(() => { chrome.tabs.onUpdated.removeListener(f); res(); }, ms);
    function f(id, info) { if (id === tabId && info.status === 'complete') { clearTimeout(fim); chrome.tabs.onUpdated.removeListener(f); res(); } }
    chrome.tabs.get(tabId, t => { if (chrome.runtime.lastError) { clearTimeout(fim); return res(); } if (t && t.status === 'complete') { clearTimeout(fim); res(); } else chrome.tabs.onUpdated.addListener(f); });
  });
}
async function pronta(t) {
  if (t.discarded) await chrome.tabs.reload(t.id);
  if (t.discarded || t.status !== 'complete') await esperarCarregar(t.id);
  return chrome.tabs.get(t.id);
}

// Aba fixada do SimplesVet: fica aberta o tempo todo (não é fechada pela extensão).
async function garantirAbaSV() {
  const abas = await chrome.tabs.query({ url: SV_PADRAO });
  let t = abas.find(a => !/\/login\//.test(a.url || '')) || abas[0];
  if (!t) { t = await chrome.tabs.create({ url: SV_URL, active: false, pinned: true, index: 0 }); await esperarCarregar(t.id); }
  else if (!t.pinned) { try { await chrome.tabs.update(t.id, { pinned: true, autoDiscardable: false }); } catch (e) {} }
  try { await chrome.tabs.update(t.id, { autoDiscardable: false }); } catch (e) {}
  return pronta(t);
}
async function abrirLoginSV() {
  const t = await garantirAbaSV();
  await chrome.tabs.update(t.id, { active: true });
  await chrome.windows.update(t.windowId, { focused: true });
}
async function semLoginSV() {
  await status({ ok: false, semLoginSV: true, texto: 'O login do SimplesVet caiu. Clique em "Abrir SimplesVet", entre, e a sincronização roda sozinha logo em seguida.' });
  avisar('pp-login', 'Pet Puppy: entre no SimplesVet', 'O login do SimplesVet caiu. Clique aqui, entre, e eu sincronizo sozinho na hora.');
}

// ---------- manter a sessão viva ----------
async function manterVivo() {
  if (rodando) return;
  try {
    const t = await garantirAbaSV();
    if (/\/login\//.test(t.url || '')) return semLoginSV();
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'MAIN', func: cutucarSV });
    if (result === 'login') { await chrome.tabs.reload(t.id); await esperarCarregar(t.id); const t2 = await chrome.tabs.get(t.id); if (/\/login\//.test(t2.url || '')) semLoginSV(); }
  } catch (e) { /* tenta de novo no próximo ciclo */ }
}
async function cutucarSV() {
  try { const r = await fetch('https://api.simples.vet/app/v3/comercial/produtos?_porPagina=1&_pagina=1', { credentials: 'include', headers: { Accept: 'application/json' } });
    return (r.status === 401 || r.status === 403) ? 'login' : 'ok'; } catch (e) { return 'erro'; }
}

// ---------- sincronização ----------
async function sincronizar(manual) {
  if (rodando) return; rodando = true; emAndamento();
  chrome.alarms.clear('pp-repetir');
  let criadaGP = null, falhou = false;
  const vivo = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000); // mantém o serviço acordado
  try {
    // 1) Ler o SimplesVet (aba fixada)
    const sv = await garantirAbaSV();
    if (/\/login\//.test(sv.url || '')) { await semLoginSV(); return; }
    const [{ result: dados }] = await chrome.scripting.executeScript({ target: { tabId: sv.id }, world: 'MAIN', func: lerSimplesVet });
    if (dados && dados.erro === 'LOGIN') { await semLoginSV(); return; }
    if (!dados || dados.erro) throw new Error(dados ? dados.erro : 'sem resposta do SimplesVet');

    // 2) Gravar pelo Gestão Pet Puppy
    let [gpTab] = await chrome.tabs.query({ url: GP_PADRAO });
    if (gpTab) gpTab = await pronta(gpTab);
    else { gpTab = await chrome.tabs.create({ url: GP_URL, active: false }); criadaGP = gpTab.id; await esperarCarregar(gpTab.id); }
    let r = null, recarregou = false;
    for (let i = 0; i < 25; i++) {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: gpTab.id }, world: 'MAIN', func: gravarNoGestao, args: [dados] });
      r = result;
      if (r && r.velho && !recarregou) { recarregou = true; await chrome.tabs.reload(gpTab.id); await esperarCarregar(gpTab.id); await pausa(2000); continue; }
      if (!r || r.esperar || r.velho) { await pausa(3000); continue; } break;
    }
    if (!r || r.esperar || r.velho) throw new Error('o Gestão Pet Puppy não terminou de abrir');
    if (r.semLogin) {
      falhou = true;
      await status({ ok: false, texto: 'Entre no Gestão Pet Puppy neste Chrome (uma vez) para a sincronização gravar.' });
      avisar('pp-gp', 'Pet Puppy: entre no Gestão Pet Puppy', 'Faça login no gestaopetpuppy.com.br neste Chrome. Depois disso fica automático.');
      return;
    }
    if (r.erro) falhou = true;
    await status({ ok: !r.erro, texto: r.texto || r.erro, lidos: dados.lidos });
  } catch (e) {
    falhou = true;
    await status({ ok: false, texto: 'Erro: ' + (e && e.message || e) + ' — tento de novo em ' + REPETIR_MIN + ' min.' });
  } finally {
    if (criadaGP) { try { await chrome.tabs.remove(criadaGP); } catch (e) {} }
    clearInterval(vivo);
    rodando = false;
    if (falhou) chrome.alarms.create('pp-repetir', { delayInMinutes: REPETIR_MIN });
  }
}

// Roda dentro da página do SimplesVet (mesma leitura do favorito "Sincronizar Pet Puppy").
async function lerSimplesVet() {
  try {
    if (/\/login\//.test(location.pathname)) return { erro: 'LOGIN' };
    const pagina = (p, n) => fetch('https://api.simples.vet/app/v3/' + p + '?_porPagina=100&_pagina=' + n, { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(r => { if (r.status === 401 || r.status === 403) throw new Error('LOGIN'); if (!r.ok) throw new Error('SimplesVet respondeu ' + r.status); return r.json(); });
    const tudo = async p => { const out = [], vistos = {}; for (let n = 1; n < 500; n++) { const x = await pagina(p, n); if (!Array.isArray(x) || !x.length) break; let novos = 0; x.forEach(i => { if (!vistos[i.id]) { vistos[i.id] = 1; out.push(i); novos++; } }); if (!novos) break; } return out; };
    const num = v => { v = Number(v); return isFinite(v) ? v : 0; };
    const vendas = await tudo('comercial/vendas'), produtos = await tudo('comercial/produtos');
    const vendido = {}; let primeira = null;
    const V = vendas.map(a => {
      let dh = String(a.dataHora || a.data || '').replace(' ', 'T').slice(0, 19); if (dh.length === 10) dh += 'T12:00:00';
      if (!primeira || dh < primeira) primeira = dh;
      const itens = (a.produtos || []).map((p, k) => { const serv = p.tipo === 'S'; const q = num(p.quantidade), pu = num(p.precoUnitario), vl = num(p.valorLiquido);
        if (!serv && a.status !== 'C') vendido[p.id] = (vendido[p.id] || 0) + q;
        return { n: k + 1, codigo: String(p.id), descricao: p.nome, qtd: q, preco_unit: pu, desconto: Math.max(0, Math.round((q * pu - vl) * 100) / 100), servico: serv, eh_servico: serv }; });
      return { id: String(a.id), data: dh + '-03:00', status: a.status, bruto: num(a.valorBruto), desconto: num(a.valorDesconto), devolvido: num(a.valorDevolucoes), cliente: a.nome || null, itens };
    });
    const P = produtos.filter(p => { const est = p.estoque ? num(p.estoque.valor) : 0; const tipo = p.tipo && p.tipo.valor; return tipo !== 'S' && (est !== 0 || vendido[p.id]); }).map(p => {
      const est = p.estoque ? num(p.estoque.valor) : 0; const ean = String(p.codigoBarras || '').replace(/\D/g, '');
      return { id: String(p.id), nome: p.nome, ean: ean.length >= 8 ? ean : '', categoria: p.grupo && p.grupo.nome || '', unidade: p.unidade || 'UN', preco: p.preco ? num(p.preco.valor) : 0, custo: num(p.custo), estoque: est, abertura: est + (vendido[p.id] || 0) };
    });
    const inicio = new Date(new Date(primeira + '-03:00').getTime() - 864e5).toISOString().slice(0, 10) + 'T00:00:00-03:00';
    return { tipo: 'pp-dados', origem: 'simplesvet', inicio, produtos: P, vendas: V, lidos: { vendas: vendas.length, produtos: produtos.length }, em: new Date().toISOString(), automatico: true };
  } catch (e) { return { erro: e.message }; }
}

// Roda dentro do Gestão Pet Puppy: usa a mesma gravação do botão manual.
async function gravarNoGestao(dados) {
  try {
    if (typeof sb === 'undefined' || typeof ir !== 'function') return { esperar: true };
    if (typeof sincronizarSV !== 'function') return { velho: true };
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) return { semLogin: true };
    if (typeof perfil === 'undefined' || !perfil || !perfil.papel || typeof REF === 'undefined' || !REF.locais.length) return { esperar: true };
    if (!tem('financeiro')) return { erro: 'Este login não tem permissão de financeiro.' };
    if (typeof svRodando !== 'undefined' && svRodando) return { esperar: true };
    let texto = '';
    await sincronizarSV(dados, { postMessage: m => { texto = m && m.texto || ''; } });
    try { fechar(); } catch (e) {}
    return { texto: texto || 'Sincronização concluída.' };
  } catch (e) { return { erro: e.message }; }
}
