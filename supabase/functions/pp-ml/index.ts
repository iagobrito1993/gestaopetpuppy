// Gestão Pet Puppy — integração Mercado Livre / Mercado Pago (somente leitura)
// Segredos necessários (Supabase → Edge Functions → Secrets):
//   ML_CLIENT_ID, ML_CLIENT_SECRET, PP_SITE_URL (ex.: https://gestaopetpuppy.com.br)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente.
// Deploy com "Verify JWT" DESLIGADO (o retorno do ML chega sem login); a função valida o usuário sozinha.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML = "https://api.mercadolibre.com";
const MP = "https://api.mercadopago.com";
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CID = Deno.env.get("ML_CLIENT_ID") ?? "";
const CSEC = Deno.env.get("ML_CLIENT_SECRET") ?? "";
const SITE = Deno.env.get("PP_SITE_URL") ?? "https://gestaopetpuppy.com.br";
const REDIRECT = `${URL_SB}/functions/v1/pp-ml?acao=callback`;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const dia = (s?: string | null) => (s ? s.slice(0, 10) : null);

async function salvarTokens(conta: number, t: any) {
  await db.from("pp_ml_tokens").upsert({
    conta_id: conta, access_token: t.access_token, refresh_token: t.refresh_token,
    expira_em: new Date(Date.now() + (t.expires_in - 120) * 1000).toISOString(), atualizado_em: new Date().toISOString(),
  });
}
async function token(conta: number): Promise<{ tk: string; uid: number }> {
  const { data: t } = await db.from("pp_ml_tokens").select("*").eq("conta_id", conta).single();
  const { data: c } = await db.from("pp_ml_contas").select("ml_user_id").eq("id", conta).single();
  if (!t?.refresh_token || !c?.ml_user_id) throw new Error("Conta não conectada ao Mercado Livre");
  if (new Date(t.expira_em) > new Date()) return { tk: t.access_token, uid: c.ml_user_id };
  const r = await fetch(`${ML}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: CID, client_secret: CSEC, refresh_token: t.refresh_token }),
  });
  const n = await r.json();
  if (!r.ok) { await db.from("pp_ml_contas").update({ status: "reconectar" }).eq("id", conta); throw new Error("Token expirado: reconecte a conta (" + (n.message || r.status) + ")"); }
  await salvarTokens(conta, n);
  return { tk: n.access_token, uid: c.ml_user_id };
}
async function get(url: string, tk: string, tent = 0): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tk}` } });
  if (r.status === 429 && tent < 4) { await new Promise((x) => setTimeout(x, 1500 * (tent + 1))); return get(url, tk, tent + 1); }
  if (!r.ok) { const e: any = new Error(`${r.status} em ${url.replace(/access_token=[^&]+/, "")}`); e.status = r.status; throw e; }
  return r.json();
}
const talvez = async (url: string, tk: string) => { try { return await get(url, tk); } catch { return null; } };

// ---------- pedidos ----------
async function syncPedidos(conta: any, tk: string, uid: number, desde: string, log: any) {
  let offset = 0, total = 0;
  do {
    const p = await get(`${ML}/orders/search?seller=${uid}&order.date_last_updated.from=${encodeURIComponent(desde)}&sort=date_asc&limit=50&offset=${offset}`, tk);
    total = p.paging?.total ?? 0;
    for (const o of p.results ?? []) {
      log.lidos++;
      try {
        const pg = (o.payments ?? []).find((x: any) => x.status === "approved") ?? (o.payments ?? [])[0];
        let pay: any = null;
        if (pg?.id) pay = await talvez(`${MP}/v1/payments/${pg.id}`, tk);
        let freteVend = 0;
        if (o.shipping?.id) {
          const sc = await talvez(`${ML}/shipments/${o.shipping.id}/costs`, tk);
          freteVend = Number(sc?.senders?.[0]?.cost ?? 0);
        }
        const itens = (o.order_items ?? []).map((i: any) => ({
          sku: i.item?.seller_sku ?? i.item?.seller_custom_field ?? null, item_ml: i.item?.id, variacao_ml: i.item?.variation_id ? String(i.item.variation_id) : null,
          descricao: i.item?.title, qtd: i.quantity, preco_unit: i.unit_price, desconto: 0, tarifa: Number(i.sale_fee ?? 0) * Number(i.quantity ?? 1),
        }));
        const bruto = itens.reduce((s: number, i: any) => s + i.qtd * i.preco_unit, 0);
        const tarifa = itens.reduce((s: number, i: any) => s + i.tarifa, 0);
        const reemb = (o.payments ?? []).reduce((s: number, x: any) => s + Number(x.transaction_amount_refunded ?? 0), 0);
        let status = "concluida";
        if (o.status === "cancelled") status = "cancelada";
        else if (reemb > 0 && reemb >= bruto - 0.01) status = "devolvida";
        else if (reemb > 0) status = "devolvida_parcial";
        else if (o.status !== "paid") status = "pendente";
        const descontos = (o.coupon?.amount ?? 0);
        const liq = pay?.transaction_details?.net_received_amount ?? null;
        const r = await db.rpc("pp_gravar_venda", {
          p_venda: {
            canal: "mercado_livre", empresa_id: conta.empresa_id, ml_conta_id: conta.id, origem: "ml", origem_ref: String(o.id),
            pedido: String(o.id), pack_id: o.pack_id ? String(o.pack_id) : null, data_venda: o.date_created, status,
            cliente: o.buyer?.nickname ?? null, logistica: o.shipping?.logistic_type ?? null,
            valor_bruto: bruto, desconto: descontos, valor_cancelado: status === "cancelada" ? bruto : 0,
            valor_devolvido: status.startsWith("devolvida") ? reemb : 0, frete_cobrado: Number(o.shipping_cost ?? 0),
            tarifa_venda: tarifa, frete_vendedor: freteVend, valor_liquido_previsto: liq,
            data_pagamento: dia(pay?.date_approved ?? pg?.date_approved), data_liberacao: dia(pay?.money_release_date),
            liberado: pay ? pay.money_release_status === "released" : null,
          }, p_itens: itens,
        });
        if (r.error) throw r.error;
        if (r.data === "igual") log.duplicados++; else log.gravados++;
      } catch (e) { log.erros++; log.det.push(`Pedido ${o.id}: ${(e as Error).message}`); }
    }
    offset += 50;
  } while (offset < total && offset < 9950);
}

// ---------- anúncios e estoque (inclui Full) ----------
const skuDe = (x: any) => (x?.attributes ?? []).find((a: any) => a.id === "SELLER_SKU")?.value_name ?? x?.seller_custom_field ?? null;
async function syncAnuncios(conta: any, tk: string, uid: number, log: any) {
  const ids: string[] = [];
  let scroll = "";
  for (let k = 0; k < 200; k++) {
    const r = await get(`${ML}/users/${uid}/items/search?search_type=scan&limit=100${scroll ? `&scroll_id=${scroll}` : ""}`, tk);
    if (!r.results?.length) break;
    ids.push(...r.results); scroll = r.scroll_id;
  }
  for (let i = 0; i < ids.length; i += 20) {
    const lote = await get(`${ML}/items?ids=${ids.slice(i, i + 20).join(",")}&include_attributes=all`, tk);
    const linhas: any[] = [];
    for (const w of lote) {
      const it = w.body; if (!it?.id) continue;
      const log_t = it.shipping?.logistic_type ?? null;
      const vars = it.variations?.length ? it.variations : [null];
      for (const v of vars) {
        const inv = v?.inventory_id ?? it.inventory_id ?? null;
        let full: number | null = null;
        if (log_t === "fulfillment" && inv) {
          const s = await talvez(`${ML}/inventories/${inv}/stock/fulfillment`, tk);
          full = s ? Number(s.available_quantity ?? 0) : null;
        }
        linhas.push({
          conta_id: conta.id, item_id: it.id, variacao_id: v ? String(v.id) : "", titulo: it.title, sku: skuDe(v) ?? skuDe(it),
          preco: v?.price ?? it.price, status: it.status, logistica: log_t, inventory_id: inv,
          estoque_disponivel: v?.available_quantity ?? it.available_quantity, estoque_full: full, atualizado_em: new Date().toISOString(),
        });
      }
    }
    log.lidos += linhas.length;
    const { error } = await db.from("pp_ml_anuncios").upsert(linhas, { onConflict: "conta_id,item_id,variacao_id", ignoreDuplicates: false });
    if (error) { log.erros++; log.det.push(error.message); } else log.gravados += linhas.length;
  }
}

async function syncSaldo(conta: any, tk: string, uid: number, log: any) {
  const b = await talvez(`${ML}/users/${uid}/mercadopago_account/balance`, tk);
  if (!b) { log.det.push("Saldo do Mercado Pago não disponível para este token."); return; }
  await db.from("pp_ml_contas").update({
    saldo_disponivel: b.available_balance ?? null, saldo_a_liberar: b.unavailable_balance ?? null,
    saldo_bloqueado: b.unavailable_balance_by_reason?.dispute ?? null, saldo_em: new Date().toISOString(),
  }).eq("id", conta.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new URL(req.url);

  // Retorno da autorização do Mercado Livre
  if (u.searchParams.get("acao") === "callback") {
    const code = u.searchParams.get("code"), state = u.searchParams.get("state") ?? "";
    const conta = Number(state.split(".")[0]);
    const { data: st } = await db.from("pp_ml_oauth").select("*").eq("conta_id", conta).single();
    if (!code || !st || st.state !== state || Date.now() - new Date(st.criado_em).getTime() > 30 * 60e3)
      return Response.redirect(`${SITE}/#integracoes?ml=erro_estado`, 302);
    const r = await fetch(`${ML}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: CID, client_secret: CSEC, code, redirect_uri: REDIRECT }),
    });
    const t = await r.json();
    if (!r.ok) return Response.redirect(`${SITE}/#integracoes?ml=erro_token`, 302);
    const me = await get(`${ML}/users/me`, t.access_token);
    const { error } = await db.from("pp_ml_contas").update({ ml_user_id: me.id, nickname: me.nickname, status: "conectada", conectada_em: new Date().toISOString() }).eq("id", conta);
    if (error) return Response.redirect(`${SITE}/#integracoes?ml=erro_conta_duplicada`, 302);
    await salvarTokens(conta, t);
    await db.from("pp_ml_oauth").delete().eq("conta_id", conta);
    return Response.redirect(`${SITE}/#integracoes?ml=ok`, 302);
  }

  // Chamadas do site: exige usuário master ou financeiro
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: au } = await db.auth.getUser(jwt);
  if (!au?.user) return json({ erro: "Não autenticado" }, 401);
  const { data: pf } = await db.from("pp_perfis").select("papel,ativo").eq("user_id", au.user.id).single();
  if (!pf?.ativo || !["master", "financeiro"].includes(pf.papel)) return json({ erro: "Sem permissão" }, 403);

  const body = await req.json().catch(() => ({}));
  if (body.acao !== "sync") return json({ erro: "Ação desconhecida" }, 400);
  const { data: conta } = await db.from("pp_ml_contas").select("*").eq("id", body.conta_id).single();
  if (!conta) return json({ erro: "Conta não encontrada" }, 404);
  const tipos: string[] = body.tipos ?? ["pedidos", "anuncios", "saldo"];
  const desde = body.desde ?? (conta.ultima_sync ? new Date(new Date(conta.ultima_sync).getTime() - 3 * 864e5).toISOString() : new Date(Date.now() - 90 * 864e5).toISOString());
  const { data: lg } = await db.from("pp_sync_log").insert({ fonte: "mercado_livre", conta: conta.apelido, tipo: tipos.join(","), usuario: au.user.id }).select().single();
  const log = { lidos: 0, gravados: 0, duplicados: 0, erros: 0, det: [] as string[] };
  let status = "ok", msg = "";
  try {
    const { tk, uid } = await token(conta.id);
    if (tipos.includes("pedidos")) await syncPedidos(conta, tk, uid, desde, log);
    if (tipos.includes("anuncios")) await syncAnuncios(conta, tk, uid, log);
    if (tipos.includes("saldo")) await syncSaldo(conta, tk, uid, log);
    if (log.erros) status = "parcial";
    await db.from("pp_ml_contas").update({ ultima_sync: new Date().toISOString() }).eq("id", conta.id);
    msg = `Desde ${desde.slice(0, 10)}`;
  } catch (e) { status = "erro"; msg = (e as Error).message; }
  await db.from("pp_sync_log").update({
    terminado_em: new Date().toISOString(), status, lidos: log.lidos, gravados: log.gravados, duplicados: log.duplicados,
    erros: log.erros, mensagem: msg, detalhes: log.det.slice(0, 200),
  }).eq("id", lg.id);
  return json({ status, ...log, mensagem: msg });
});
