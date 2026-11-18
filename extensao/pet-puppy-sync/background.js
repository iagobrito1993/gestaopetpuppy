// Sincronizador automático SimplesVet → Gestão Pet Puppy.
// A cada hora: lê os dados numa aba do SimplesVet (com o login que já está no Chrome)
// e grava pelo Gestão Pet Puppy (com o login de lá). Nenhuma senha é guardada.
const SV = 'https://app.simples.vet/principal/dashboard.php';
const GP = 'https://gestaopetpuppy.com.br/#svsync';
const INTERVALO_MIN = 60;
let rodando = false;

chrome.runtime.onInstalled.addListener(() => { agendar(); setTimeout(sincronizar, 5000); });
chrome.runtime.onStartup.addListener(() => { agendar(); setTimeout(sincronizar, 60000); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'pp-sync') sincronizar(); });
chrome.runtime.onMessage.addListener((m, _s, responder) => {
  if (m && m.tipo === 'agora') { sincronizar().then(() => responder(true)); return true; }
});
function agendar() { chrome.alarms.create('pp-sync', { periodInMinutes: INTERVALO_MIN }); }

async function status(s) {
  s.em = new Date().toISOString();
  await chrome.storage.local.set({ ultimo: s });
  chrome.action.setBadgeText({ text: s.ok ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
}
function avisar(titulo, texto) {
  chrome.notifications.create('pp-' + Date.now(), { type: 'basic', iconUrl: 'icon128.png', title: titulo, message: texto, priority: 1 });
}
function esperarCarregar(tabId, ms = 45000) {
  return new Promise(res => {
    const fim = setTimeout(() => { chrome.tabs.onUpdated.removeListener(f); res(); }, ms);
    function f(id, info) { if (id === tabId && info.status === 'complete') { clearTimeout(fim); chrome.tabs.onUpdated.removeListener(f); res(); } }
    chrome.tabs.get(tabId, t => { if (t && t.status === 'complete') { clearTimeout(fim); res(); } else chrome.tabs.onUpdated.addListener(f); });
  });
}
async function abaDe(padrao, url) {
  const [t] = await chrome.tabs.query({ url: padrao });
  if (t) { if (t.discarded || t.status !== 'complete') { if (t.discarded) await chrome.tabs.reload(t.id); await esperarCarregar(t.id); } return { tab: await chrome.tabs.get(t.id), criada: false }; }
  const nova = await chrome.tabs.create({ url, active: false, pinned: false });
  await esperarCarregar(nova.id);
  return { tab: await chrome.tabs.get(nova.id), criada: true };
}
const pausa = ms => new Promise(r => setTimeout(r, ms));

async function sincronizar() {
  if (rodando) return; rodando = true;
  const criadas = [];
  const vivo = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000); // mantém o serviço acordado durante a sincronização
  try {
    // 1) Ler o SimplesVet
    const sv = await abaDe('https://app.simples.vet/*', SV);
    if (sv.criada) criadas.push(sv.tab.id);
    if (/\/login\//.test(sv.tab.url || '')) {
      await status({ ok: false, texto: 'O SimplesVet saiu do login. Entre no SimplesVet neste Chrome e a sincronização volta sozinha.' });
      avisar('Pet Puppy: entre no SimplesVet', 'O login do SimplesVet expirou. Entre de novo neste Chrome para a sincronização continuar.');
      return;
    }
    const [{ result: dados }] = await chrome.scripting.executeScript({ target: { tabId: sv.tab.id }, world: 'MAIN', func: lerSimplesVet });
    if (!dados || dados.erro) throw new Error(dados ? dados.erro : 'sem resposta do SimplesVet');

    // 2) Gravar pelo Gestão Pet Puppy
    const gp = await abaDe('https://gestaopetpuppy.com.br/*', GP);
    if (gp.criada) criadas.push(gp.tab.id);
    let r = null, recarregou = false;
    for (let i = 0; i < 20; i++) {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: gp.tab.id }, world: 'MAIN', func: gravarNoGestao, args: [dados] });
      r = result;
      if (r && r.velho && !recarregou) { recarregou = true; await chrome.tabs.reload(gp.tab.id); await esperarCarregar(gp.tab.id); await pausa(2000); continue; }
      if (!r || r.esperar || r.velho) { await pausa(3000); continue; } break;
    }
    if (!r || r.esperar || r.velho) throw new Error('o Gestão Pet Puppy não terminou de abrir');
    if (r.semLogin) {
      await status({ ok: false, texto: 'Entre no Gestão Pet Puppy neste Chrome para a sincronização gravar.' });
      avisar('Pet Puppy: entre no Gestão Pet Puppy', 'Faça login no gestaopetpuppy.com.br neste Chrome.');
      return;
    }
    await status({ ok: !r.erro, texto: r.texto || r.erro });
  } catch (e) {
    await status({ ok: false, texto: 'Erro: ' + (e && e.message || e) });
  } finally {
    for (const id of criadas) { try { await chrome.tabs.remove(id); } catch (e) {} }
    clearInterval(vivo);
    rodando = false;
  }
}

// Roda dentro da página do SimplesVet (mesma leitura do favorito "Sincronizar Pet Puppy").
async function lerSimplesVet() {
  try {
    if (/\/login\//.test(location.pathname)) return { erro: 'SimplesVet sem login' };
    const pagina = (p, n) => fetch('https://api.simples.vet/app/v3/' + p + '?_porPagina=100&_pagina=' + n, { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(r => { if (!r.ok) throw new Error('SimplesVet respondeu ' + r.status); return r.json(); });
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
