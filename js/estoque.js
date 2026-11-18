// =====================================================================
// Produtos e SKUs, Estoque e movimentações, Compras e recebimentos
// =====================================================================
const TIPOS_MOV={saldo_inicial:'Saldo inicial',compra:'Compra',bonificacao:'Bonificação',venda:'Venda',devolucao_venda:'Devolução de venda',devolucao_compra:'Devolução ao fornecedor',
  transferencia_saida:'Transferência (saída)',transferencia_entrada:'Transferência (entrada)',perda:'Perda/avaria',ajuste:'Ajuste',consumo_interno:'Consumo interno'};
const ORIGENS_COD={simplesvet:'SimplesVet',ml_sku:'SKU Mercado Livre',ml_item:'Anúncio ML',ml_variacao:'Variação ML',fornecedor:'Código do fornecedor (NF)',ean:'EAN/GTIN',interno:'Código interno'};
function locaisSomaveis(){return REF.locais.filter(l=>l.tipo!=='espelho');}
async function carregarSaldos(){return tudo(()=>sb.from('pp_v_saldos').select('*'));}
async function custosAtuais(){if(!veCusto())return {};const c=await tudo(()=>sb.from('pp_v_custo_atual').select('*'));const m={};c.forEach(x=>m[x.produto_id]=x);return m;}
async function resumoEstoque(){
  const [s,c]=await Promise.all([carregarSaldos(),custosAtuais()]);
  const por={};s.filter(x=>x.tipo_local!=='espelho'&&(!F.empresa||x.empresa_id==F.empresa)).forEach(x=>por[x.produto_id]=(por[x.produto_id]||0)+(+x.saldo));
  let valor=0,unidades=0,produtos=0,semCusto=0,negativos=0;
  Object.entries(por).forEach(([pid,q])=>{if(q<0)negativos++;if(q<=0)return;produtos++;unidades+=q;const cm=c[pid];if(cm&&cm.custo_medio!=null)valor+=q*cm.custo_medio;else semCusto++;});
  return {valor,unidades,produtos,semCusto,negativos};
}

// ---------- PRODUTOS E SKUs ----------
let abaProd='cadastro',buscaProd='';
TELAS.produtos=async function(extra){
  if(extra==='vinculos')abaProd='vinculos';
  const podeEditar=tem('compras','estoque');
  const ab=`<div class="abas2">${[['cadastro','Cadastro mestre'],['vinculos','Pendências de vínculo'],['duplicados','Duplicados e unidades']].map(([i,n])=>`<button class="${abaProd===i?'on':''}" onclick="abaProd='${i}';ir('produtos')">${n}</button>`).join('')}</div>`;
  if(abaProd==='cadastro'){
    const s=await carregarSaldos();const sal={};s.filter(x=>x.tipo_local!=='espelho').forEach(x=>sal[x.produto_id]=(sal[x.produto_id]||0)+(+x.saldo));
    const t=norm(buscaProd);
    const l=REF.produtos.filter(p=>!t||t.split(/\s+/).every(w=>norm(p.nome+' '+(p.ean||'')+' '+(p.categoria||'')+' '+REF.codigos.filter(c=>c.produto_id===p.id).map(c=>c.codigo).join(' ')).includes(w)));
    $('conteudo').innerHTML=ab+`<div class="barra-acoes"><input id="bp" type="search" placeholder="Buscar por nome, código, SKU, EAN…" value="${esc(buscaProd)}" style="flex:1;min-width:220px">
     ${podeEditar?'<button class="pri" onclick="modalProduto()">+ Produto</button>':''}<button onclick="exportarTabela('produtos',window._cp,window._lp)">CSV</button></div>
     <div class="secao">${tabela(window._cp=[{t:'Produto',v:p=>p.nome,h:p=>esc(p.nome)+(p.eh_kit?' <span class="tag b">kit</span>':'')+(p.ativo?'':' <span class="tag">inativo</span>')},{t:'Categoria',v:p=>p.categoria||''},{t:'Unidade',v:p=>p.unidade},{t:'EAN',v:p=>p.ean||''},
       {t:'Códigos vinculados',v:p=>REF.codigos.filter(c=>c.produto_id===p.id&&c.status==='confirmado').map(c=>ORIGENS_COD[c.origem]+': '+c.codigo).join(' | '),h:p=>REF.codigos.filter(c=>c.produto_id===p.id&&c.status==='confirmado').map(c=>`<span class="tag" title="${esc(ORIGENS_COD[c.origem])}">${esc(c.codigo)}${c.fator!=1?' ×'+nf(c.fator,3):''}</span>`).join(' ')},
       {t:'Saldo',v:p=>sal[p.id]??0,n:1,fmt:nf}],window._lp=l,{clique:p=>abrirProduto(p.id)})}</div>`;
    $('bp').oninput=e=>{buscaProd=e.target.value;clearTimeout(window._tbp);window._tbp=setTimeout(()=>{ir('produtos').then(()=>{const b=$('bp');if(b){b.focus();b.setSelectionRange(b.value.length,b.value.length);}});},350);};
    return;
  }
  if(abaProd==='vinculos'){
    $('conteudo').innerHTML=ab+'<div class="vazio">Levantando itens sem vínculo…</div>';
    const pend=await levantarSemVinculo();
    window._pv=pend;
    $('conteudo').innerHTML=ab+`<div class="info">Sugestões vêm apenas de códigos idênticos (EAN, SKU, código do SimplesVet ou do fornecedor). Nome parecido nunca vincula sozinho — um usuário autorizado precisa confirmar.</div>
     <div class="secao"><h2>${nf(pend.length)} códigos sem vínculo</h2>${tabela([{t:'Origem',v:x=>ORIGENS_COD[x.origem]+(x.escopo?' · '+x.escopo:'')},{t:'Código',v:x=>x.codigo},{t:'Descrição',v:x=>x.descricao},{t:'Ocorrências',v:x=>x.n,n:1,fmt:nf},
       {t:'Sugestão',v:x=>x.sug?nomeProd(x.sug.produto_id):'',h:x=>x.sug?`<span class="tag v">${esc(nomeProd(x.sug.produto_id))}</span> <span class="mut peq">${esc(x.sug.motivo)}</span>`:'<span class="mut">—</span>'}],pend,{clique:x=>modalVincular(x)})}</div>`;
    return;
  }
  // duplicados
  const porEan=agrupar(REF.produtos.filter(p=>p.ean),p=>p.ean);const porNome=agrupar(REF.produtos,p=>norm(p.nome).replace(/\s+/g,' '));
  const dups=[...Object.values(porEan).filter(a=>a.length>1).map(a=>({motivo:'Mesmo EAN '+a[0].ean,a})),...Object.values(porNome).filter(a=>a.length>1).map(a=>({motivo:'Mesmo nome',a}))];
  const {data:un}=await sb.from('pp_pendencias').select('*').eq('tipo','unidade_divergente').in('status',['aberta','em_analise']);
  $('conteudo').innerHTML=ab+`<div class="secao"><h2>Possíveis produtos duplicados</h2>${dups.length?dups.map(d=>`<div class="info"><b>${esc(d.motivo)}:</b> ${d.a.map(p=>`<button class="lk" onclick="abrirProduto('${p.id}')">${esc(p.nome)}</button>`).join(' · ')} ${tem('compras','estoque')?`<button class="sm" onclick="modalMesclar(${esc(JSON.stringify(d.a.map(p=>p.id)))})">Mesclar</button>`:''}</div>`).join(''):'<div class="vazio">Nenhum encontrado.</div>'}</div>
   <div class="secao"><h2>Divergências de unidade de medida</h2>${tabela([{t:'Descrição',v:x=>x.descricao},{t:'Status',v:x=>x.status}],un||[],{clique:x=>abrirPendencia(x)})}</div>`;
};
async function levantarSemVinculo(){
  const m={};const add=(origem,escopo,codigo,descricao,extra)=>{if(!codigo)return;const k=origem+'|'+escopo+'|'+codigo;const x=m[k]=m[k]||{origem,escopo,codigo,descricao,n:0,extra};x.n++;};
  const vinc=new Set(REF.codigos.filter(c=>c.status==='confirmado').map(c=>c.origem+'|'+c.escopo+'|'+c.codigo));
  if(tem('financeiro','operacao')){const vi=await tudo(()=>sb.from('pp_venda_itens').select('codigo,sku,item_ml,variacao_ml,descricao,eh_servico').is('produto_id',null));
    vi.filter(i=>!i.eh_servico).forEach(i=>{if(i.variacao_ml)add('ml_variacao','',i.variacao_ml,i.descricao);else if(i.sku)add('ml_sku','',i.sku,i.descricao);else if(i.item_ml)add('ml_item','',i.item_ml,i.descricao);else add('simplesvet','',i.codigo||i.descricao,i.descricao);});}
  if(veCusto()){const ni=await tudo(()=>sb.from('pp_nota_itens').select('codigo,ean,descricao,unidade,pp_notas!inner(parceiro_doc,parceiro_nome,tipo)').is('produto_id',null).eq('pp_notas.tipo','entrada'));
    ni.forEach(i=>add('fornecedor',i.pp_notas.parceiro_doc||'',i.codigo,i.descricao+' ('+(i.pp_notas.parceiro_nome||'')+', '+(i.unidade||'')+')',{ean:i.ean}));}
  const an=await tudo(()=>sb.from('pp_ml_anuncios').select('*'));
  an.forEach(a=>{const ok=(a.variacao_id&&vinc.has('ml_variacao||'+a.variacao_id))||(a.sku&&vinc.has('ml_sku||'+a.sku))||vinc.has('ml_item||'+a.item_id);if(!ok){if(a.variacao_id)add('ml_variacao','',a.variacao_id,a.titulo,{sku:a.sku});else if(a.sku)add('ml_sku','',a.sku,a.titulo);else add('ml_item','',a.item_id,a.titulo);}});
  REF.codigos.filter(c=>c.status==='sugerido').forEach(c=>{const k=c.origem+'|'+c.escopo+'|'+c.codigo;m[k]=m[k]||{origem:c.origem,escopo:c.escopo,codigo:c.codigo,descricao:c.descricao,n:1};m[k].sug={produto_id:c.produto_id,motivo:c.motivo_sugestao||'sugerido'};});
  return Object.values(m).filter(x=>!vinc.has(x.origem+'|'+x.escopo+'|'+x.codigo)).map(x=>({...x,sug:x.sug||sugerir(x)})).sort((a,b)=>b.n-a.n);
}
// Sugestão somente por código idêntico
function sugerir(x){
  const cods=[x.codigo,x.extra&&x.extra.ean,x.extra&&x.extra.sku].filter(Boolean).map(String);
  for(const c of cods){
    const pe=REF.produtos.find(p=>p.ean&&p.ean===c);if(pe)return {produto_id:pe.id,motivo:'EAN idêntico'};
    const pc=REF.codigos.find(k=>k.status==='confirmado'&&k.codigo===c&&k.produto_id);if(pc)return {produto_id:pc.produto_id,motivo:'código idêntico em '+ORIGENS_COD[pc.origem]};
  }
  return null;
}
function buscaProdutoHTML(id,ph){return `<input id="${id}" list="${id}_dl" placeholder="${ph||'Digite para buscar o produto…'}"><datalist id="${id}_dl">${REF.produtos.filter(p=>p.ativo).map(p=>`<option value="${esc(p.nome)}${p.ean?' · '+esc(p.ean):''}">`).join('')}</datalist>`;}
function lerProduto(id){const t=norm(val(id).split(' · ')[0]);return REF.produtos.find(p=>norm(p.nome)===t);}
function modalVincular(x){
  const sug=x.sug||sugerir(x);
  const parecidos=REF.produtos.filter(p=>{const a=norm(p.nome).split(/\s+/).filter(w=>w.length>3),b=norm(x.descricao||'');return a.length&&a.filter(w=>b.includes(w)).length>=Math.min(2,a.length);}).slice(0,6);
  abrir(`<h2>Vincular código</h2><div class="sub">${esc(ORIGENS_COD[x.origem])}${x.escopo?' · '+esc(x.escopo):''}: <b class="mono">${esc(x.codigo)}</b><br>${esc(x.descricao||'')}</div>
  ${sug?`<div class="info">Sugestão por código idêntico (${esc(sug.motivo)}): <button class="lk" onclick="$('vk_p').value=${esc(JSON.stringify(nomeProd(sug.produto_id)))}">${esc(nomeProd(sug.produto_id))}</button></div>`:''}
  ${parecidos.length?`<div class="campo"><label>Nomes parecidos — confira antes de escolher (não é vínculo automático)</label>${parecidos.map(p=>`<button class="sm chip-sug" onclick="$('vk_p').value=${esc(JSON.stringify(p.nome))}">${esc(p.nome)}${p.ean?' · '+esc(p.ean):''}</button>`).join('')}</div>`:''}
  <div class="campo"><label>Produto do cadastro mestre</label>${buscaProdutoHTML('vk_p')}</div>
  <div class="c2"><div class="campo"><label>Fator (unidades do produto por 1 deste código)</label><input id="vk_f" value="1" inputmode="decimal"><div class="mut peq">Ex.: caixa com 12 → 12. Kit vendido como 1 anúncio → 1 (a composição fica no kit).</div></div>
  <div class="campo"><label>&nbsp;</label><button onclick="novoProdutoDe()">Criar produto novo com esta descrição</button></div></div>
  <div class="erro"></div><div class="rodape">${x.sug&&x.origem?'<button class="perigo" id="vk_rej">Rejeitar sugestão</button>':''}<button onclick="fechar()">Cancelar</button><button class="pri" id="vk_ok">Confirmar vínculo</button></div>`);
  window._vk=x;
  $('vk_ok').onclick=()=>rodar($('vk_ok'),async()=>{const p=lerProduto('vk_p');if(!p)throw new Error('Escolha um produto da lista.');const f=num(val('vk_f'));if(!(f>0))throw new Error('Fator inválido.');
    await rpc('pp_vincular_codigo',{p_origem:x.origem,p_escopo:x.escopo||'',p_codigo:x.codigo,p_produto:p.id,p_fator:f,p_descricao:x.descricao||null});
    REF.codigos=await tudo(()=>sb.from('pp_codigos').select('*'));fechar();toast('Vinculado. Vendas e notas com este código foram atualizadas.');ir(area);});
  if($('vk_rej'))$('vk_rej').onclick=()=>rodar($('vk_rej'),async()=>{await q(sb.from('pp_codigos').update({status:'rejeitado'}).eq('origem',x.origem).eq('escopo',x.escopo||'').eq('codigo',x.codigo));REF.codigos=await tudo(()=>sb.from('pp_codigos').select('*'));fechar();ir(area);});
}
function novoProdutoDe(){const x=window._vk;modalProduto(null,{nome:x.descricao,ean:x.extra&&x.extra.ean||(x.origem==='ean'?x.codigo:'')},async p=>{await rpc('pp_vincular_codigo',{p_origem:x.origem,p_escopo:x.escopo||'',p_codigo:x.codigo,p_produto:p.id,p_fator:1,p_descricao:x.descricao||null});});}
function modalProduto(p,pre,depois){
  const e=p||pre||{};
  abrir(`<h2>${p?'Editar produto':'Novo produto'}</h2><div class="sub">Cadastro mestre — um identificador único liga todos os códigos.</div>
  <div class="campo"><label>Nome</label><input id="mp_n" value="${esc(e.nome||'')}"></div>
  <div class="c3"><div class="campo"><label>Categoria</label><input id="mp_c" list="mp_cl" value="${esc(e.categoria||'')}"><datalist id="mp_cl">${categorias().map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>
  <div class="campo"><label>Marca</label><input id="mp_m" value="${esc(e.marca||'')}"></div><div class="campo"><label>Unidade</label><select id="mp_u">${['UN','KG','G','L','ML','CX','PCT','FD','SC'].map(u=>`<option ${e.unidade===u?'selected':''}>${u}</option>`).join('')}</select></div></div>
  <div class="c3"><div class="campo"><label>EAN/GTIN</label><input id="mp_e" value="${esc(e.ean||'')}"></div><div class="campo"><label>NCM</label><input id="mp_ncm" value="${esc(e.ncm||'')}"></div><div class="campo"><label>Estoque mínimo</label><input id="mp_min" value="${e.estoque_minimo??''}" inputmode="decimal"></div></div>
  <div class="c2"><label><input type="checkbox" id="mp_k" ${e.eh_kit?'checked':''}> É kit (composição de outros produtos)</label><label><input type="checkbox" id="mp_a" ${e.ativo===false?'':'checked'}> Ativo</label></div>
  <div class="erro"></div><div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="mp_ok">Salvar</button></div>`);
  $('mp_ok').onclick=()=>rodar($('mp_ok'),async()=>{const d={nome:val('mp_n'),categoria:val('mp_c')||null,marca:val('mp_m')||null,unidade:val('mp_u'),ean:val('mp_e')||null,ncm:val('mp_ncm')||null,estoque_minimo:isNaN(num(val('mp_min')))?null:num(val('mp_min')),eh_kit:$('mp_k').checked,ativo:$('mp_a').checked};
    if(!d.nome)throw new Error('Informe o nome.');
    if(d.ean){const o=REF.produtos.find(x=>x.ean===d.ean&&(!p||x.id!==p.id));if(o)throw new Error('Já existe produto com este EAN: '+o.nome);}
    const r=p?await q(sb.from('pp_produtos').update(d).eq('id',p.id).select().single()):await q(sb.from('pp_produtos').insert(d).select().single());
    if(d.ean&&(!p||p.ean!==d.ean))await rpc('pp_vincular_codigo',{p_origem:'ean',p_escopo:'',p_codigo:d.ean,p_produto:r.id,p_fator:1,p_descricao:d.nome}).catch(()=>{});
    if(depois)await depois(r);
    REF.produtos=await tudo(()=>sb.from('pp_produtos').select('*').order('nome'));REF.codigos=await tudo(()=>sb.from('pp_codigos').select('*'));
    fechar();toast('Produto salvo.');if(p)abrirProduto(r.id);else ir(area);});
}
function modalMesclar(ids){
  const ps=ids.map(produto);
  abrir(`<h2>Mesclar produtos duplicados</h2><div class="sub">Escolha o produto que fica. Os códigos dos outros passam para ele e os outros ficam inativos. Movimentações e vendas já gravadas continuam nos produtos originais (para auditoria) — revise o saldo depois.</div>
  ${ps.map((p,i)=>`<label style="display:block;margin:6px 0"><input type="radio" name="mm" value="${p.id}" ${i===0?'checked':''}> ${esc(p.nome)} ${p.ean?'· '+esc(p.ean):''}</label>`).join('')}
  <div class="erro"></div><div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="mm_ok">Mesclar códigos</button></div>`);
  $('mm_ok').onclick=()=>rodar($('mm_ok'),async()=>{const fica=document.querySelector('input[name=mm]:checked').value;
    for(const p of ps){if(p.id===fica)continue;for(const c of REF.codigos.filter(c=>c.produto_id===p.id))await rpc('pp_vincular_codigo',{p_origem:c.origem,p_escopo:c.escopo,p_codigo:c.codigo,p_produto:fica,p_fator:c.fator,p_descricao:c.descricao});
      await q(sb.from('pp_produtos').update({ativo:false,nome:p.nome+' (mesclado)'}).eq('id',p.id));}
    REF.produtos=await tudo(()=>sb.from('pp_produtos').select('*').order('nome'));REF.codigos=await tudo(()=>sb.from('pp_codigos').select('*'));fechar();toast('Códigos mesclados.');ir('produtos');});
}
async function abrirProduto(pid){
  const p=produto(pid);if(!p)return;
  const [movs,saldos,hist,custoMov,vend,an]=await Promise.all([
    tudo(()=>sb.from('pp_mov').select('*').eq('produto_id',pid).order('data').order('id')),
    q(sb.from('pp_v_saldos').select('*').eq('produto_id',pid)),
    veCusto()?q(sb.from('pp_custo_hist').select('*').eq('produto_id',pid).order('data')):[],
    veCusto()?q(sb.from('pp_mov_custo').select('*,pp_mov!inner(produto_id)').eq('pp_mov.produto_id',pid)):[],
    tem('financeiro','operacao')?q(sb.from('pp_venda_itens').select('qtd,preco_unit,desconto,tarifa,pp_vendas!inner(canal,data_venda,status,duplicada_de)'+(veCusto()?',pp_venda_itens_custo(custo_unit)':'')).eq('produto_id',pid).gte('pp_vendas.data_venda',tsIni(addDias(hojeISO(),-89)))):[],
    q(sb.from('pp_ml_anuncios').select('*'))]);
  const notasIds=[...new Set(hist.map(h=>h.nota_id).filter(Boolean))];
  const notas=notasIds.length&&veCusto()?await q(sb.from('pp_notas').select('id,numero,serie,parceiro_nome,emissao').in('id',notasIds)):[];
  const nota=id=>notas.find(n=>n.id===id);
  // saldo antes/depois por local
  const run={};const linhas=movs.map(m=>{const k=m.local_id;const antes=run[k]||0;run[k]=antes+(+m.qtd);return {...m,antes,depois:run[k]};}).reverse();
  const cods=REF.codigos.filter(c=>c.produto_id===pid&&c.status!=='rejeitado');
  const anuncios=an.filter(a=>cods.some(c=>c.status==='confirmado'&&((c.origem==='ml_variacao'&&c.codigo===a.variacao_id)||(c.origem==='ml_sku'&&c.codigo===a.sku)||(c.origem==='ml_item'&&c.codigo===a.item_id))));
  const fisico=soma(saldos.filter(s=>s.tipo_local!=='espelho'),s=>s.saldo);
  const ini=movs.find(m=>m.tipo==='saldo_inicial');
  const ult=hist.filter(h=>+h.custo_entrada>0);const u=ult[ult.length-1],pen=ult[ult.length-2];const cmAtual=hist.length?+hist[hist.length-1].custo_medio_depois:null;
  const pc=agrupar((vend||[]).filter(v=>v.pp_vendas.status==='concluida'&&!v.pp_vendas.duplicada_de),v=>v.pp_vendas.canal);
  const kit=REF.kits.filter(k=>k.kit_id===pid);
  abrir(`<h2>${esc(p.nome)} ${p.eh_kit?'<span class="tag b">kit</span>':''}</h2><div class="sub">${esc(p.categoria||'Sem categoria')} · ${esc(p.unidade)} ${p.ean?'· EAN '+esc(p.ean):''} · ID <span class="mono">${p.id.slice(0,8)}</span></div>
  <div class="kpis"><div class="kpi"><div class="l">Saldo físico</div><div class="v">${nf(fisico,3)}</div><div class="s">${saldos.map(s=>esc(local(s.local_id).nome)+': '+nf(s.saldo,3)).join(' · ')||'sem movimentação'}</div></div>
   ${veCusto()?`<div class="kpi"><div class="l">Custo médio ponderado</div><div class="v">${cmAtual!=null?brl(cmAtual):'<span style="color:var(--red)">sem custo</span>'}</div><div class="s">valor em estoque ${cmAtual!=null?brl(cmAtual*Math.max(0,fisico)):'—'}</div></div>
   <div class="kpi"><div class="l">Custo da última compra</div><div class="v">${u?brl(u.custo_entrada):'—'}</div><div class="s">${u?fd(u.data)+(u.nota_id&&nota(u.nota_id)?' · NF '+esc(nota(u.nota_id).numero):''):''}${u&&pen?' · variação '+pct(u.custo_entrada/pen.custo_entrada-1):''}</div></div>`:''}
   ${Object.entries(pc).map(([c,a])=>{const qt=soma(a,x=>x.qtd),vv=soma(a,x=>x.qtd*x.preco_unit-(x.desconto||0)),tt=soma(a,x=>x.tarifa);const pm=vv/qt;const mg=cmAtual!=null?((vv-tt)/qt-cmAtual)/pm:null;
     return `<div class="kpi"><div class="l">Preço ${CANAL[c]} (90 dias)</div><div class="v">${brl(pm)}</div><div class="s">${nf(qt)} un.${veCusto()?' · margem est. '+pct(mg):''}</div></div>`;}).join('')}</div>
  ${ini?`<div class="info">Histórico a partir do saldo inicial de ${fd(ini.data)} (${nf(ini.qtd,3)} un., origem ${esc(ini.origem)}). Movimentos anteriores não estão no sistema.</div>`:movs.length?'<div class="aviso">Sem saldo inicial registrado: o saldo considera só os movimentos importados.</div>':''}
  <div class="grade2"><div><h3 style="font-size:14px">Códigos vinculados</h3>${tabela([{t:'Origem',v:c=>ORIGENS_COD[c.origem]+(c.escopo?' · '+c.escopo:'')},{t:'Código',v:c=>c.codigo},{t:'Fator',v:c=>+c.fator,n:1,fmt:x=>nf(x,3)},{t:'Status',v:c=>c.status,h:c=>c.status==='confirmado'?'<span class="tag v">confirmado</span>':'<span class="tag a">'+c.status+'</span>'}],cods,{rolar:false})}
    ${tem('compras','estoque','operacao')?`<button class="sm" onclick="modalNovoCodigo('${pid}')">+ Código</button>`:''}
    ${anuncios.length?`<h3 style="font-size:14px">Anúncios ML</h3>${tabela([{t:'Conta',v:a=>contaML(a.conta_id).apelido},{t:'Anúncio',v:a=>a.item_id},{t:'Preço',v:a=>+a.preco,n:1},{t:'Disp.',v:a=>a.estoque_disponivel,n:1,fmt:nf},{t:'Full',v:a=>a.estoque_full,n:1,fmt:nf}],anuncios,{rolar:false})}`:''}</div>
   <div>${p.eh_kit?`<h3 style="font-size:14px">Composição do kit</h3>${tabela([{t:'Componente',v:k=>nomeProd(k.componente_id)},{t:'Qtd',v:k=>+k.qtd,n:1,fmt:x=>nf(x,3)}],kit,{rolar:false})}${tem('compras','estoque')?`<button class="sm" onclick="modalKit('${pid}')">Editar composição</button>`:''}`:''}
   ${veCusto()?`<h3 style="font-size:14px">Histórico de custos por fornecedor e nota</h3>${tabela([{t:'Data',v:h=>fd(h.data)},{t:'Nota / fornecedor',v:h=>{const n=nota(h.nota_id);return n?'NF '+n.numero+' · '+(n.parceiro_nome||''):(custoMov.find(c=>c.mov_id===h.mov_id)||{}).fonte||'—';}},{t:'Qtd',v:h=>+h.qtd_entrada,n:1,fmt:x=>nf(x,3)},{t:'Custo entrada',v:h=>+h.custo_entrada,n:1},{t:'Médio antes',v:h=>h.custo_medio_antes==null?null:+h.custo_medio_antes,n:1},{t:'Médio depois',v:h=>+h.custo_medio_depois,n:1}],hist.slice().reverse(),{rolar:false,clique:h=>h.nota_id&&abrirNota(h.nota_id)})}`:''}</div></div>
  <h3 style="font-size:14px">Sequência de eventos (saldo antes e depois, por local)</h3>
  ${tabela([{t:'Data',v:m=>fdh(m.data)},{t:'Evento',v:m=>TIPOS_MOV[m.tipo]},{t:'Local',v:m=>local(m.local_id).nome},{t:'Documento',v:m=>m.documento||''},{t:'Qtd',v:m=>+m.qtd,n:1,fmt:x=>(x>0?'+':'')+nf(x,3)},{t:'Antes',v:m=>m.antes,n:1,fmt:x=>nf(x,3)},{t:'Depois',v:m=>m.depois,n:1,fmt:x=>nf(x,3)},{t:'Origem',v:m=>m.origem},{t:'Responsável',v:m=>m.responsavel||''}],linhas)}
  <div class="rodape">${tem('compras','estoque')?`<button onclick='modalProduto(produto("${pid}"))'>Editar</button><button onclick="modalMov('${pid}')">Lançar movimentação</button>`:''}<button onclick="fechar()">Fechar</button></div>`,true);
}
function modalNovoCodigo(pid){
  abrir(`<h2>Adicionar código a ${esc(nomeProd(pid))}</h2><div class="c2"><div class="campo"><label>Origem</label><select id="nc_o">${Object.entries(ORIGENS_COD).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div>
  <div class="campo"><label>Escopo (CNPJ do fornecedor, se for código de fornecedor)</label><input id="nc_e"></div></div>
  <div class="c2"><div class="campo"><label>Código</label><input id="nc_c"></div><div class="campo"><label>Fator</label><input id="nc_f" value="1"></div></div>
  <div class="erro"></div><div class="rodape"><button onclick="abrirProduto('${pid}')">Voltar</button><button class="pri" id="nc_ok">Vincular</button></div>`);
  $('nc_ok').onclick=()=>rodar($('nc_ok'),async()=>{const c=val('nc_c');if(!c)throw new Error('Informe o código.');const ex=REF.codigos.find(x=>x.origem===val('nc_o')&&x.escopo===(val('nc_e').replace(/\D/g,'')||val('nc_e'))&&x.codigo===c&&x.produto_id&&x.produto_id!==pid);
    if(ex&&!confirm('Este código já está vinculado a "'+nomeProd(ex.produto_id)+'". Mover para este produto?'))return;
    await rpc('pp_vincular_codigo',{p_origem:val('nc_o'),p_escopo:val('nc_e').replace(/[.\/-]/g,''),p_codigo:c,p_produto:pid,p_fator:num(val('nc_f'))||1,p_descricao:null});
    REF.codigos=await tudo(()=>sb.from('pp_codigos').select('*'));abrirProduto(pid);});
}
function modalKit(pid){
  const atuais=REF.kits.filter(k=>k.kit_id===pid);
  abrir(`<h2>Composição do kit</h2><div class="sub">${esc(nomeProd(pid))}</div><div id="kl">${atuais.map(k=>`<div class="c2 kr"><input value="${esc(nomeProd(k.componente_id))}" list="kd" class="kp"><input value="${k.qtd}" class="kq" inputmode="decimal"></div>`).join('')}</div>
  <datalist id="kd">${REF.produtos.filter(p=>p.id!==pid).map(p=>`<option value="${esc(p.nome)}">`).join('')}</datalist>
  <button class="sm" onclick="$('kl').insertAdjacentHTML('beforeend','<div class=\\'c2 kr\\'><input list=kd class=kp placeholder=Componente><input class=kq value=1></div>')">+ Componente</button>
  <div class="erro"></div><div class="rodape"><button onclick="abrirProduto('${pid}')">Voltar</button><button class="pri" id="kk">Salvar</button></div>`);
  $('kk').onclick=()=>rodar($('kk'),async()=>{const rows=[...document.querySelectorAll('.kr')].map(r=>({p:REF.produtos.find(p=>norm(p.nome)===norm(r.querySelector('.kp').value)),q:num(r.querySelector('.kq').value)})).filter(r=>r.p||r.q);
    if(rows.some(r=>!r.p||!(r.q>0)))throw new Error('Confira os componentes e quantidades.');
    await q(sb.from('pp_kit_itens').delete().eq('kit_id',pid));if(rows.length)await q(sb.from('pp_kit_itens').insert(rows.map(r=>({kit_id:pid,componente_id:r.p.id,qtd:r.q}))));
    REF.kits=await q(sb.from('pp_kit_itens').select('*'));abrirProduto(pid);});
}

// ---------- ESTOQUE ----------
let abaEst='posicao',filtroMov={tipo:'',origem:'',local:''};
TELAS.estoque=async function(extra){
  if(extra==='semcusto'||extra==='negativo'){abaEst='alertas';}
  const ab=`<div class="abas2">${[['posicao','Posição'],['movs','Movimentações'],['alertas','Alertas']].map(([i,n])=>`<button class="${abaEst===i?'on':''}" onclick="abaEst='${i}';ir('estoque')">${n}</button>`).join('')}
    ${tem('estoque','compras')?'<button onclick="modalMov()">+ Movimentação</button><button onclick="ir(\'integracoes\',\'simplesvet\')">Importar do SimplesVet</button>':''}</div>`;
  const [saldos,cm,anun,receber]=await Promise.all([carregarSaldos(),custosAtuais(),q(sb.from('pp_ml_anuncios').select('conta_id,item_id,variacao_id,sku,estoque_disponivel,estoque_full,logistica')),tem('compras','estoque')?rpc('pp_itens_a_receber'):Promise.resolve([])]);
  const fl=l=>(!F.empresa||l.empresa_id==F.empresa)&&(!filtroMov.local||l.id==filtroMov.local);
  if(abaEst==='posicao'){
    const anPorProd={};anun.forEach(a=>{const c=REF.codigos.find(c=>c.status==='confirmado'&&((c.origem==='ml_variacao'&&c.codigo===a.variacao_id&&a.variacao_id)||(c.origem==='ml_sku'&&a.sku&&c.codigo===a.sku)||(c.origem==='ml_item'&&c.codigo===a.item_id&&!a.variacao_id)));
      if(!c)return;const x=anPorProd[c.produto_id]=anPorProd[c.produto_id]||{ml:0,full:0};x.ml+=(+a.estoque_disponivel||0)*c.fator;if(a.logistica==='fulfillment')x.full+=(+a.estoque_full||0)*c.fator;});
    const temLocalFull=REF.locais.some(l=>l.tipo==='full');
    const transitoNF={};(receber||[]).forEach(r=>{if(r.produto_id)transitoNF[r.produto_id]=(transitoNF[r.produto_id]||0)+(r.qtd_prevista-r.qtd_recebida);});
    const ped=tem('financeiro','operacao')?await tudo(()=>sb.from('pp_venda_itens').select('produto_id,qtd,pp_vendas!inner(status)').eq('pp_vendas.status','pendente').not('produto_id','is',null)):[];
    const reserv={};ped.forEach(i=>reserv[i.produto_id]=(reserv[i.produto_id]||0)+(+i.qtd));
    const P={};saldos.forEach(s=>{const l=local(s.local_id);if(!fl(l))return;const x=P[s.produto_id]=P[s.produto_id]||{fis:0,tr:0,cd:0,esp:0,ini:null};
      if(l.tipo==='espelho')x.esp+=+s.saldo;else if(l.tipo==='transito')x.tr+=+s.saldo;else if(l.tipo==='full')x.cd+=+s.saldo;else x.fis+=+s.saldo;if(s.data_saldo_inicial)x.ini=s.data_saldo_inicial;});
    Object.keys(anPorProd).forEach(k=>P[k]=P[k]||{fis:0,tr:0,cd:0,esp:0});Object.keys(transitoNF).forEach(k=>P[k]=P[k]||{fis:0,tr:0,cd:0,esp:0});
    const linhas=Object.entries(P).map(([pid,x])=>{const a=anPorProd[pid]||{ml:0,full:0};const p=produto(pid)||{nome:'?'};const fullUn=temLocalFull?x.cd:a.full;const res=reserv[pid]||0;const c=cm[pid];
      return {pid,p,fis:x.fis,res,disp:x.fis-res,tr:x.tr+(transitoNF[pid]||0),full:fullUn,ml:a.ml,total:x.fis+fullUn+x.tr,ini:x.ini,custo:c?+c.custo_medio:null};})
      .filter(x=>(!F.categoria||x.p.categoria===F.categoria)&&(!F.produto||x.pid===F.produto)).sort((a,b)=>a.p.nome.localeCompare(b.p.nome));
    const tv=soma(linhas,x=>x.custo!=null&&(x.fis+x.full)>0?(x.fis+x.full)*x.custo:0);
    $('conteudo').innerHTML=barraFiltros(['empresa','categoria','produto'],()=>ir('estoque'))+ab+
    `<div class="filtros"><div><label>Local</label><select onchange="filtroMov.local=this.value;ir('estoque')">${opcoes(REF.locais,filtroMov.local,'Todos os locais')}</select></div></div>
    <div class="info">Físico = lojas e depósitos. Full = centro de distribuição do ML (${temLocalFull?'local Full cadastrado':'lido dos anúncios Full'}). "Anúncios ML" mostra a quantidade disponível nos anúncios não-Full: são as mesmas unidades físicas da loja, por isso <b>não somam</b> no total. Em trânsito inclui notas emitidas ainda não recebidas. Reservado = pedidos pendentes.</div>
    ${veCusto()?`<div class="kpis"><div class="kpi"><div class="l">Investido em estoque (físico + Full)</div><div class="v">${brl(tv)}</div><div class="s">${linhas.filter(x=>x.custo==null&&x.fis+x.full>0).length} produtos com saldo sem custo ficaram fora</div></div></div>`:''}
    <div class="secao">${tabela(window._ce=[{t:'Produto',v:x=>x.p.nome},{t:'Físico',v:x=>x.fis,n:1,fmt:x=>nf(x,3),h:x=>`<span style="color:${x.fis<0?'var(--red)':''}">${nf(x.fis,3)}</span>`},{t:'Reservado',v:x=>x.res,n:1,fmt:nf},{t:'Disponível',v:x=>x.disp,n:1,fmt:x=>nf(x,3)},{t:'Em trânsito',v:x=>x.tr,n:1,fmt:x=>nf(x,3)},{t:'Full (CD)',v:x=>x.full,n:1,fmt:nf},{t:'Anúncios ML (não soma)',v:x=>x.ml,n:1,fmt:nf},
      ...(veCusto()?[{t:'Custo médio',v:x=>x.custo,n:1},{t:'Valor',v:x=>x.custo!=null?Math.max(0,x.fis+x.full)*x.custo:null,n:1,tot:1}]:[]),{t:'Saldo inicial em',v:x=>x.ini?fd(x.ini):'—'}],window._le=linhas,{clique:x=>abrirProduto(x.pid)})}
    <button class="sm" onclick="exportarTabela('estoque',window._ce,window._le)">Exportar CSV</button></div>`;
    return;
  }
  if(abaEst==='movs'){
    const movs=await tudo(()=>{let x=sb.from('pp_mov').select('*').lte('data',tsFim(F.ate)).order('data').order('id');if(F.produto)x=x.eq('produto_id',F.produto);return x;});
    const run={};const todas=movs.map(m=>{const k=m.produto_id+'|'+m.local_id;const a=run[k]||0;run[k]=a+(+m.qtd);return {...m,antes:a,depois:run[k]};});
    const l=todas.filter(m=>diaLocal(m.data)>=F.de&&(!filtroMov.tipo||m.tipo===filtroMov.tipo)&&(!filtroMov.origem||m.origem===filtroMov.origem)&&(!filtroMov.local||m.local_id==filtroMov.local)&&fl(local(m.local_id))&&(!F.categoria||(produto(m.produto_id)||{}).categoria===F.categoria)).reverse();
    $('conteudo').innerHTML=barraFiltros(['periodo','empresa','categoria','produto'],()=>ir('estoque'))+ab+
    `<div class="filtros"><div><label>Unidade/local</label><select onchange="filtroMov.local=this.value;ir('estoque')">${opcoes(REF.locais,filtroMov.local,'Todos')}</select></div>
     <div><label>Tipo de operação</label><select onchange="filtroMov.tipo=this.value;ir('estoque')">${opcoes(Object.entries(TIPOS_MOV).map(([id,nome])=>({id,nome})),filtroMov.tipo,'Todos')}</select></div>
     <div><label>Origem</label><select onchange="filtroMov.origem=this.value;ir('estoque')">${opcoes(['simplesvet','ml','nf','manual','importacao'].map(id=>({id,nome:id})),filtroMov.origem,'Todas')}</select></div></div>
    <div class="secao">${tabela(window._cm=[{t:'Data',v:m=>fdh(m.data)},{t:'Produto',v:m=>nomeProd(m.produto_id)},{t:'Tipo',v:m=>TIPOS_MOV[m.tipo]},{t:'Local',v:m=>local(m.local_id).nome},{t:'Qtd',v:m=>+m.qtd,n:1,fmt:x=>(x>0?'+':'')+nf(x,3)},{t:'Antes',v:m=>m.antes,n:1,fmt:x=>nf(x,3)},{t:'Depois',v:m=>m.depois,n:1,fmt:x=>nf(x,3)},{t:'Documento',v:m=>m.documento||''},{t:'Origem',v:m=>m.origem},{t:'Responsável',v:m=>m.responsavel||''}],window._lm=l,{clique:m=>abrirProduto(m.produto_id)})}
    <button class="sm" onclick="exportarTabela('movimentacoes',window._cm,window._lm)">Exportar CSV</button></div>`;
    return;
  }
  // alertas
  const [vend30,valid,ext]=await Promise.all([tem('financeiro','operacao')?tudo(()=>sb.from('pp_venda_itens').select('produto_id,qtd,pp_vendas!inner(data_venda,status,duplicada_de)').gte('pp_vendas.data_venda',tsIni(addDias(hojeISO(),-29))).not('produto_id','is',null)):Promise.resolve(null),
    rpc('pp_validades'),q(sb.from('pp_saldos_externos').select('*').order('data',{ascending:false}).limit(5000))]);
  const sal={},ult={};saldos.filter(s=>s.tipo_local!=='espelho'&&(!F.empresa||s.empresa_id==F.empresa)).forEach(s=>{sal[s.produto_id]=(sal[s.produto_id]||0)+(+s.saldo);if(!ult[s.produto_id]||s.ultima_mov>ult[s.produto_id])ult[s.produto_id]=s.ultima_mov;});
  const v30={};(vend30||[]).filter(i=>i.pp_vendas.status==='concluida'&&!i.pp_vendas.duplicada_de).forEach(i=>v30[i.produto_id]=(v30[i.produto_id]||0)+(+i.qtd));
  const cob=+REF.config.cobertura_minima_dias||15,semMov=+REF.config.sem_movimento_dias||60,valD=+REF.config.validade_alerta_dias||45;
  const A=[];
  Object.entries(sal).forEach(([pid,q])=>{const p=produto(pid);if(!p)return;
    if(q<0)A.push({t:'Estoque negativo',cls:'r',pid,d:`Saldo ${nf(q,3)}`});
    if(vend30&&v30[pid]){const dias=q/(v30[pid]/30);if(dias<cob)A.push({t:'Baixa cobertura',cls:'a',pid,d:`${nf(q)} un. ≈ ${nf(dias,1)} dias de venda (mín. ${cob})`});}
    else if(p.estoque_minimo!=null&&q<p.estoque_minimo)A.push({t:'Abaixo do mínimo',cls:'a',pid,d:`${nf(q)} < ${nf(p.estoque_minimo)}`});
    if(q>0&&ult[pid]&&diaLocal(ult[pid])<addDias(hojeISO(),-semMov))A.push({t:'Sem movimentação',cls:'',pid,d:`última em ${fd(ult[pid])} (> ${semMov} dias)`});
    if(q>0&&veCusto()&&!cm[pid]&&!p.eh_kit)A.push({t:'Sem custo',cls:'r',pid,d:`${nf(q)} un. sem custo confiável`});});
  (valid||[]).forEach(v=>{if(v.validade<=addDias(hojeISO(),valD)&&(sal[v.produto_id]||0)>0)A.push({t:v.validade<hojeISO()?'Vencido':'Validade próxima',cls:'r',pid:v.produto_id,d:`Lote ${v.lote||'—'} vence ${fd(v.validade)} (NF ${v.nota||''})`});});
  const vistos=new Set();(ext||[]).forEach(e=>{if(!e.produto_id||vistos.has(e.produto_id+'|'+e.local_id))return;vistos.add(e.produto_id+'|'+e.local_id);const s=saldos.find(x=>x.produto_id===e.produto_id&&x.local_id==e.local_id);const calc=s?+s.saldo:0;
    if(Math.abs(calc-e.qtd)>0.001)A.push({t:'Divergência de saldo',cls:'a',pid:e.produto_id,d:`${e.fonte} informa ${nf(e.qtd,3)} em ${fd(e.data)}; sistema calcula ${nf(calc,3)} em ${local(e.local_id).nome}`});});
  const {count:sv}=await sb.from('pp_pendencias').select('id',{count:'exact',head:true}).eq('tipo','sem_vinculo').in('status',['aberta','em_analise']);
  const filtro=extra==='semcusto'?'Sem custo':extra==='negativo'?'Estoque negativo':window._fal||'';
  const vis=A.filter(a=>!filtro||a.t===filtro);
  $('conteudo').innerHTML=barraFiltros(['empresa'],()=>ir('estoque'))+ab+
  `${!vend30?'<div class="aviso">Seu perfil não vê vendas: o alerta de cobertura usa o estoque mínimo do cadastro.</div>':''}
  <div class="kpis">${[...new Set(A.map(a=>a.t)),'Sem vínculo'].map(t=>`<div class="kpi ${filtro===t?'alerta':''}" onclick="${t==='Sem vínculo'?"abaProd='vinculos';ir('produtos')":`window._fal=window._fal==='${t}'?'':'${t}';ir('estoque')`}"><div class="l">${t}</div><div class="v">${t==='Sem vínculo'?nf(sv||0):nf(A.filter(a=>a.t===t).length)}</div></div>`).join('')}</div>
  <div class="secao">${tabela([{t:'Alerta',v:a=>a.t,h:a=>`<span class="tag ${a.cls}">${esc(a.t)}</span>`},{t:'Produto',v:a=>nomeProd(a.pid)},{t:'Detalhe',v:a=>a.d}],vis,{clique:a=>abrirProduto(a.pid),vazio:'Nenhum alerta.'})}</div>`;
};
function modalMov(pid){
  abrir(`<h2>Lançar movimentação manual</h2><div class="sub">Fica registrada com seu nome, data e documento.</div>
  <div class="campo"><label>Produto</label>${buscaProdutoHTML('mv_p')}</div>
  <div class="c3"><div class="campo"><label>Tipo</label><select id="mv_t"><option value="ajuste">Ajuste</option><option value="perda">Perda/avaria</option><option value="consumo_interno">Consumo interno</option><option value="transferencia">Transferência entre locais</option><option value="devolucao_compra">Devolução ao fornecedor</option><option value="devolucao_venda">Devolução de venda</option><option value="saldo_inicial">Saldo inicial</option></select></div>
  <div class="campo"><label>Local</label><select id="mv_l">${opcoes(REF.locais,'',null)}</select></div><div class="campo" id="mv_dw" style="display:none"><label>Para o local</label><select id="mv_d">${opcoes(REF.locais,'',null)}</select></div></div>
  <div class="c3"><div class="campo"><label>Quantidade</label><input id="mv_q" inputmode="decimal" placeholder="ajuste: use − para baixar"></div><div class="campo"><label>Data</label><input id="mv_dt" type="date" value="${hojeISO()}"></div><div class="campo"><label>Documento</label><input id="mv_doc"></div></div>
  ${veCusto()?'<div class="campo" id="mv_cw" style="display:none"><label>Custo unitário (saldo inicial)</label><input id="mv_c" inputmode="decimal" placeholder="deixe vazio se não souber — ficará como pendência"></div>':''}
  <div class="campo"><label>Observação</label><input id="mv_o"></div><div class="erro"></div>
  <div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="mv_ok">Lançar</button></div>`);
  if(pid)$('mv_p').value=nomeProd(pid);
  $('mv_t').onchange=()=>{$('mv_dw').style.display=val('mv_t')==='transferencia'?'':'none';if($('mv_cw'))$('mv_cw').style.display=val('mv_t')==='saldo_inicial'?'':'none';};
  $('mv_ok').onclick=()=>rodar($('mv_ok'),async()=>{const p=lerProduto('mv_p');if(!p)throw new Error('Escolha o produto.');let qd=num(val('mv_q'));if(!qd)throw new Error('Informe a quantidade.');
    const t=val('mv_t'),ref='man:'+crypto.randomUUID(),base={produto_id:p.id,data:val('mv_dt')+'T12:00:00'+offsetFuso(),origem:'manual',documento:val('mv_doc')||null,obs:val('mv_o')||null,responsavel:perfil.nome||perfil.email};
    if(['perda','consumo_interno','devolucao_compra'].includes(t))qd=-Math.abs(qd);if(['devolucao_venda','saldo_inicial'].includes(t))qd=Math.abs(qd);
    if(t==='transferencia'){if(val('mv_l')===val('mv_d'))throw new Error('Escolha locais diferentes.');
      await q(sb.from('pp_mov').insert([{...base,local_id:+val('mv_l'),tipo:'transferencia_saida',qtd:-Math.abs(qd),origem_ref:ref+':s'},{...base,local_id:+val('mv_d'),tipo:'transferencia_entrada',qtd:Math.abs(qd),origem_ref:ref+':e'}]));}
    else{const m=await q(sb.from('pp_mov').insert({...base,local_id:+val('mv_l'),tipo:t,qtd:qd,origem_ref:ref}).select().single());
      if(t==='saldo_inicial'&&$('mv_c')&&val('mv_c')){const c=num(val('mv_c'));if(!(c>=0))throw new Error('Custo inválido.');await q(sb.from('pp_mov_custo').insert({mov_id:m.id,custo_unit:c,confiavel:true,fonte:'saldo inicial manual'}));}}
    fechar();toast('Movimentação lançada.');ir(area);});
}

// ---------- COMPRAS E RECEBIMENTOS ----------
TELAS.compras=async function(){
  const pend=await rpc('pp_itens_a_receber');
  const notas=Object.values(agrupar(pend,r=>r.nota_id)).map(a=>({id:a[0].nota_id,numero:a[0].numero,fornecedor:a[0].fornecedor,emissao:a[0].emissao,itens:a,prev:soma(a,x=>x.qtd_prevista),rec:soma(a,x=>x.qtd_recebida),semVinc:a.filter(x=>!x.produto_id).length}));
  const recs=await q(sb.from('pp_recebimentos').select('*,pp_receb_itens(*)').order('id',{ascending:false}).limit(300));
  let todas=[];if(veCusto())todas=await q(sb.from('pp_notas').select('id,numero,parceiro_nome,emissao,valor_total,status_receb,status_pgto,eh_bonificacao,situacao').eq('tipo','entrada').order('emissao',{ascending:false}).limit(500));
  $('conteudo').innerHTML=`<div class="info">Emissão da nota, recebimento da mercadoria e pagamento são eventos separados: lançar a nota não dá entrada no estoque, e receber não marca como pago.</div>
  <div class="secao"><h2>Notas aguardando recebimento <small>${notas.length}</small></h2>${tabela([{t:'NF',v:n=>n.numero},{t:'Fornecedor',v:n=>n.fornecedor},{t:'Emissão',v:n=>fd(n.emissao)},{t:'Previsto (un.)',v:n=>n.prev,n:1,fmt:nf},{t:'Recebido',v:n=>n.rec,n:1,fmt:nf},{t:'Pendente',v:n=>n.prev-n.rec,n:1,fmt:nf},
    {t:'',v:n=>'',h:n=>n.semVinc?`<span class="tag a">${n.semVinc} sem vínculo</span>`:''}],notas,{clique:n=>modalReceber(n),vazio:'Nenhuma nota pendente de recebimento.'})}</div>
  ${veCusto()?`<div class="secao"><h2>Situação das compras</h2>${tabela([{t:'NF',v:n=>n.numero},{t:'Fornecedor',v:n=>n.parceiro_nome},{t:'Emissão',v:n=>fd(n.emissao)},{t:'Valor',v:n=>+n.valor_total,n:1,tot:1},{t:'Recebimento',v:n=>n.status_receb,h:n=>`<span class="tag ${n.status_receb==='recebida'?'v':n.status_receb==='parcial'?'a':''}">${n.status_receb}</span>`},{t:'Pagamento',v:n=>n.status_pgto,h:n=>`<span class="tag ${n.status_pgto==='pago'?'v':n.status_pgto==='parcial'?'a':''}">${n.status_pgto}</span>`},{t:'',v:n=>n.eh_bonificacao?'bonificação':'',h:n=>n.eh_bonificacao?'<span class="tag b">bonificação</span>':''}],todas,{clique:n=>abrirNota(n.id)})}</div>`:''}
  <div class="secao"><h2>Recebimentos registrados</h2>${tabela([{t:'Data',v:r=>fd(r.data)},{t:'Nota',v:r=>'#'+r.nota_id},{t:'Local',v:r=>local(r.local_id).nome},{t:'Itens',v:r=>r.pp_receb_itens.length,n:1,fmt:nf},{t:'Unidades',v:r=>soma(r.pp_receb_itens,i=>i.qtd_recebida),n:1,fmt:nf},{t:'Avarias',v:r=>soma(r.pp_receb_itens,i=>i.qtd_avariada),n:1,fmt:nf},{t:'Responsável',v:r=>nomeUsuario(r.responsavel)},{t:'Obs.',v:r=>r.obs||''}],recs)}</div>`;
};
function modalReceber(n){
  if(!tem('estoque','compras'))return toast('Seu perfil não registra recebimentos.');
  abrir(`<h2>Receber NF ${esc(n.numero)} · ${esc(n.fornecedor||'')}</h2><div class="sub">Informe o que chegou agora, em unidades do cadastro. Pode receber em partes; o restante continua pendente.</div>
  <div class="c2"><div class="campo"><label>Local de entrada</label><select id="rc_l">${opcoes(REF.locais.filter(l=>l.tipo!=='espelho'),'',null)}</select></div><div class="campo"><label>Data do recebimento</label><input id="rc_d" type="date" value="${hojeISO()}"></div></div>
  <div class="rolarx"><table class="t"><thead><tr><th>Item da nota</th><th>Produto</th><th class="n">Previsto</th><th class="n">Já recebido</th><th class="n">Recebendo agora</th><th class="n">Avaria</th><th>Lote/validade</th></tr></thead><tbody>
  ${n.itens.map(i=>`<tr><td>${esc(i.descricao)} <span class="mut">${esc(i.unidade||'')}</span></td><td>${i.produto_id?esc(i.produto):'<span class="tag r">sem vínculo</span>'}</td><td class="n">${nf(i.qtd_prevista,3)}</td><td class="n">${nf(i.qtd_recebida,3)}</td>
   <td class="n"><input class="rq" data-id="${i.nota_item_id}" style="width:90px;text-align:right" value="${Math.max(0,i.qtd_prevista-i.qtd_recebida)}" ${i.produto_id?'':'disabled'}></td><td class="n"><input class="ra" data-id="${i.nota_item_id}" style="width:70px;text-align:right" value="0"></td><td class="peq">${esc(i.lote||'')} ${i.validade?fd(i.validade):''}</td></tr>`).join('')}</tbody></table></div>
  <div class="campo" style="margin-top:8px"><label>Observação (divergências, avarias)</label><input id="rc_o"></div>
  ${n.semVinc?'<div class="aviso">Itens sem vínculo não podem ser recebidos. Vincule em Produtos e SKUs → Pendências de vínculo.</div>':''}
  <div class="erro"></div><div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="rc_ok">Registrar recebimento</button></div>`,true);
  $('rc_ok').onclick=()=>rodar($('rc_ok'),async()=>{const itens=[...document.querySelectorAll('.rq')].filter(x=>!x.disabled).map(x=>({nota_item_id:+x.dataset.id,qtd:num(x.value)||0,avaria:num(document.querySelector(`.ra[data-id="${x.dataset.id}"]`).value)||0})).filter(x=>x.qtd>0||x.avaria>0);
    if(!itens.length)throw new Error('Nada a receber.');
    const div=itens.filter(x=>{const i=n.itens.find(k=>k.nota_item_id===x.nota_item_id);return x.qtd+i.qtd_recebida>i.qtd_prevista+1e-9;});
    if(div.length&&!confirm('Há itens com quantidade maior que a da nota. Registrar mesmo assim? (será aberta uma divergência)'))return;
    await rpc('pp_receber_nota',{p_nota:n.id,p_local:+val('rc_l'),p_data:val('rc_d'),p_itens:itens,p_obs:val('rc_o')||null});fechar();toast('Recebimento registrado e estoque atualizado.');ir(area);});
}
