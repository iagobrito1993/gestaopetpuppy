// =====================================================================
// Notas fiscais de entrada e saída (XML NF-e/NFC-e, PDF, imagem)
// =====================================================================
const CFOP_BONIF=['1910','2910','5910','6910','1911','2911','5911','6911'];
function tg(el,nome){if(!el)return null;const x=el.getElementsByTagNameNS('*',nome)[0]||el.getElementsByTagName(nome)[0];return x||null;}
function tx(el,nome){const x=tg(el,nome);return x?x.textContent.trim():null;}
function nx(el,nome){const v=tx(el,nome);return v==null?0:parseFloat(v)||0;}
function lerXMLNFe(texto){
  const d=new DOMParser().parseFromString(texto,'application/xml');
  if(d.getElementsByTagName('parsererror').length)throw new Error('XML inválido');
  const inf=tg(d,'infNFe');if(!inf)throw new Error('Não é um XML de NF-e/NFC-e');
  const ide=tg(inf,'ide'),emit=tg(inf,'emit'),dest=tg(inf,'dest'),tot=tg(inf,'ICMSTot'),prot=tg(d,'infProt');
  const chave=(inf.getAttribute('Id')||'').replace(/^NFe/,'')||tx(prot,'chNFe');
  const cstat=tx(prot,'cStat');
  const itens=[...inf.getElementsByTagNameNS('*','det')].map(det=>{const p=tg(det,'prod'),imp=tg(det,'imposto');const r=tg(p,'rastro');
    const cfop=tx(p,'CFOP');const ean=[tx(p,'cEAN'),tx(p,'cEANTrib')].find(e=>e&&/^\d{8,14}$/.test(e))||null;
    return {n_item:+det.getAttribute('nItem'),codigo:tx(p,'cProd'),ean,descricao:tx(p,'xProd'),ncm:tx(p,'NCM'),cfop,unidade:tx(p,'uCom'),qtd:nx(p,'qCom'),valor_unit:nx(p,'vUnCom'),valor_total:nx(p,'vProd'),
      desconto:nx(p,'vDesc'),frete:nx(p,'vFrete'),seguro:nx(p,'vSeg'),outras:nx(p,'vOutro'),ipi:nx(tg(imp,'IPI'),'vIPI'),icms_st:nx(tg(imp,'ICMS'),'vICMSST'),icms:nx(tg(imp,'ICMS'),'vICMS'),
      bonificacao:CFOP_BONIF.includes(cfop),lote:r?tx(r,'nLote'):null,validade:r?tx(r,'dVal'):null};});
  const doc=e=>e?(tx(e,'CNPJ')||tx(e,'CPF')):null;
  return {chave,modelo:tx(ide,'mod'),numero:tx(ide,'nNF'),serie:tx(ide,'serie'),emissao:tx(ide,'dhEmi')||tx(ide,'dEmi'),natureza:tx(ide,'natOp'),tpNF:tx(ide,'tpNF'),
    emit:{doc:doc(emit),nome:tx(emit,'xNome')},dest:{doc:doc(dest),nome:dest?tx(dest,'xNome'):null},
    situacao:!cstat?'desconhecida':['100','150'].includes(cstat)?'autorizada':['101','135','151','155'].includes(cstat)?'cancelada':['110','301','302'].includes(cstat)?'denegada':'desconhecida',
    valor_produtos:nx(tot,'vProd'),desconto:nx(tot,'vDesc'),frete:nx(tot,'vFrete'),seguro:nx(tot,'vSeg'),outras:nx(tot,'vOutro'),ipi:nx(tot,'vIPI'),icms_st:nx(tot,'vST'),icms:nx(tot,'vICMS'),pis:nx(tot,'vPIS'),cofins:nx(tot,'vCOFINS'),valor_total:nx(tot,'vNF'),
    xPed:[...inf.getElementsByTagNameNS('*','xPed')].map(x=>x.textContent.trim()),infCpl:tx(tg(inf,'infAdic'),'infCpl')||'',itens};
}
function classificarNota(n){
  const cnpjs=REF.empresas.filter(e=>e.cnpj).map(e=>e.cnpj);
  const emp=REF.empresas.find(e=>e.cnpj&&e.cnpj===n.emit.doc);
  if(emp)return {tipo:'saida',empresa_id:emp.id,parceiro:n.dest};
  const ed=REF.empresas.find(e=>e.cnpj&&e.cnpj===n.dest.doc);
  if(ed)return {tipo:'entrada',empresa_id:ed.id,parceiro:n.emit};
  return {tipo:n.tpNF==='1'&&cnpjs.length?'entrada':'entrada',empresa_id:null,parceiro:n.emit,naoIdentificada:true};
}
function vincularItemAuto(it,cnpjForn){
  const c=REF.codigos.find(c=>c.status==='confirmado'&&c.produto_id&&c.origem==='fornecedor'&&c.escopo===(cnpjForn||'')&&c.codigo===it.codigo)
       ||(it.ean&&REF.codigos.find(c=>c.status==='confirmado'&&c.produto_id&&c.origem==='ean'&&c.codigo===it.ean));
  return c?{produto_id:c.produto_id,fator:c.origem==='fornecedor'?+c.fator:1}:{produto_id:null,fator:1};
}
function modalImportarXML(tipoTela){
  abrir(`<h2>Importar XML de notas</h2><div class="sub">Selecione um ou vários arquivos .xml (ou um .zip extraído). O sistema identifica entrada/saída pelo CNPJ das empresas cadastradas. Nada é gravado antes da sua conferência.</div>
  <div class="drop" id="dz">Arraste os XML aqui ou <button class="lk" onclick="$('fx').click()">escolha os arquivos</button><input type="file" id="fx" accept=".xml,text/xml" multiple class="oculto"></div>
  <div id="prev" style="margin-top:12px"></div><div class="erro"></div>
  <div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="ix_ok" disabled>Gravar notas conferidas</button></div>`,true);
  const dz=$('dz');['dragover','dragenter'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.add('on');}));['dragleave','drop'].forEach(e=>dz.addEventListener(e,()=>dz.classList.remove('on')));
  dz.addEventListener('drop',ev=>{ev.preventDefault();processar([...ev.dataTransfer.files]);});$('fx').onchange=e=>processar([...e.target.files]);
  let lidas=[];
  async function processar(files){
    lidas=[];const erros=[];
    for(const f of files){try{const t=await f.text();const n=lerXMLNFe(t);n._arquivo=f.name;n._xml=t;n._cls=classificarNota(n);lidas.push(n);}catch(e){erros.push(f.name+': '+e.message);}}
    const chaves=lidas.map(n=>n.chave).filter(Boolean);
    const exist=chaves.length?await q(sb.from('pp_notas').select('chave').in('chave',chaves)):[];
    const ex=new Set(exist.map(e=>e.chave));
    lidas.forEach(n=>{n._dup=ex.has(n.chave);n.itens.forEach(i=>Object.assign(i,vincularItemAuto(i,n._cls.parceiro.doc)));});
    $('prev').innerHTML=(erros.length?`<div class="aviso">${erros.map(esc).join('<br>')}</div>`:'')+
     `<table class="t"><thead><tr><th>Arquivo</th><th>Tipo</th><th>Empresa</th><th>NF</th><th>Emissão</th><th>Parceiro</th><th class="n">Itens</th><th class="n">Vinculados</th><th class="n">Total</th><th>Situação</th></tr></thead><tbody>
     ${lidas.map((n,k)=>`<tr><td class="peq">${esc(n._arquivo)}</td><td>${n._cls.naoIdentificada?`<select data-k="${k}" class="xt"><option value="entrada">Entrada</option><option value="saida">Saída</option></select>`:n._cls.tipo==='entrada'?'Entrada':'Saída'}</td>
      <td>${n._cls.empresa_id?esc(empresa(n._cls.empresa_id).nome):`<select data-k="${k}" class="xe">${opcoes(REF.empresas,'',null)}</select><div class="mut peq">CNPJ não cadastrado</div>`}</td>
      <td>${esc(n.numero)}/${esc(n.serie)} ${n.modelo==='65'?'<span class="tag">NFC-e</span>':''}</td><td>${fd(n.emissao)}</td><td>${esc(n._cls.parceiro.nome||'')}</td><td class="n">${n.itens.length}</td><td class="n">${n.itens.filter(i=>i.produto_id).length}</td><td class="n">${brl(n.valor_total)}</td>
      <td>${n._dup?'<span class="tag">já importada — será ignorada</span>':`<span class="tag ${n.situacao==='autorizada'?'v':'a'}">${n.situacao}</span>`}${n.itens.some(i=>i.bonificacao)?' <span class="tag b">bonificação</span>':''}</td></tr>`).join('')}</tbody></table>
     <div class="mut peq" style="margin-top:6px">${lidas.filter(n=>!n._dup).length} novas · ${lidas.filter(n=>n._dup).length} já existentes. Itens sem vínculo poderão ser vinculados depois (não impedem gravar a nota, mas impedem o recebimento).</div>`;
    $('ix_ok').disabled=!lidas.some(n=>!n._dup);
  }
  $('ix_ok').onclick=()=>rodar($('ix_ok'),async()=>{let ok=0,dup=0;const log=await q(sb.from('pp_sync_log').insert({fonte:'xml_nfe',tipo:'notas',status:'rodando'}).select().single());const det=[];
    document.querySelectorAll('.xt').forEach(s=>lidas[+s.dataset.k]._cls.tipo=s.value);document.querySelectorAll('.xe').forEach(s=>lidas[+s.dataset.k]._cls.empresa_id=+s.value);
    for(const n of lidas){if(n._dup){dup++;continue;}
      try{const c=n._cls;const todosBonif=n.itens.length&&n.itens.every(i=>i.bonificacao);
        const path=`xml/${n.chave||crypto.randomUUID()}.xml`;
        await sb.storage.from('pp-docs').upload(path,new Blob([n._xml],{type:'text/xml'}),{upsert:true});
        const nota=await q(sb.from('pp_notas').insert({tipo:c.tipo,empresa_id:c.empresa_id,unidade_id:(REF.unidades.find(u=>u.empresa_id==c.empresa_id)||{}).id||null,parceiro_nome:c.parceiro.nome,parceiro_doc:c.parceiro.doc,modelo:n.modelo,numero:n.numero,serie:n.serie,chave:n.chave||null,emissao:n.emissao,
          situacao:n.situacao,natureza:n.natureza,eh_bonificacao:todosBonif,valor_produtos:n.valor_produtos,desconto:n.desconto,frete:n.frete,seguro:n.seguro,outras:n.outras,ipi:n.ipi,icms_st:n.icms_st,icms:n.icms,pis:n.pis,cofins:n.cofins,valor_total:n.valor_total,
          origem:'xml',conferida:true,xml_path:path,status_receb:c.tipo==='entrada'?'pendente':'nao_aplica',status_pgto:c.tipo==='entrada'?'pendente':'nao_aplica',obs:n.infCpl?n.infCpl.slice(0,500):null}).select().single());
        await q(sb.from('pp_nota_itens').insert(n.itens.map(i=>({nota_id:nota.id,...i,validade:i.validade||null}))));
        if(c.tipo==='saida'){const peds=[...n.xPed,...(n.infCpl.match(/\b2\d{15}\b/g)||[])];if(peds.length){const v=await q(sb.from('pp_vendas').select('id').in('pedido',peds).is('nota_id',null));if(v.length===1)await q(sb.from('pp_vendas').update({nota_id:nota.id}).eq('id',v[0].id));}}
        ok++;}catch(e){det.push((n.numero||n._arquivo)+': '+msgErro(e));}}
    await sb.from('pp_sync_log').update({status:det.length?(ok?'parcial':'erro'):'ok',terminado_em:new Date().toISOString(),lidos:lidas.length,gravados:ok,duplicados:dup,erros:det.length,detalhes:det,mensagem:'Importação manual de XML'}).eq('id',log.id);
    fechar();toast(`${ok} notas gravadas · ${dup} já existentes ignoradas${det.length?' · '+det.length+' com erro (veja Integrações)':''}.`,6000);ir(area);});
}
// Nota lançada a partir de PDF/imagem: entra como "não conferida" e não movimenta nada até conferência
function modalNotaManual(tipo){
  abrir(`<h2>Nota a partir de PDF ou imagem</h2><div class="sub">Use quando não houver XML. Anexe o arquivo e digite os dados. A nota fica <b>não conferida</b> e não pode ser recebida até que outro passo de conferência seja feito.</div>
  <div class="c3"><div class="campo"><label>Tipo</label><select id="nm_t"><option value="entrada" ${tipo==='entrada'?'selected':''}>Entrada</option><option value="saida" ${tipo==='saida'?'selected':''}>Saída</option></select></div><div class="campo"><label>Empresa</label><select id="nm_e">${opcoes(REF.empresas,'',null)}</select></div><div class="campo"><label>Arquivo (PDF/foto)</label><input type="file" id="nm_f" accept="application/pdf,image/*"></div></div>
  <div class="c3"><div class="campo"><label>Fornecedor/cliente</label><input id="nm_p"></div><div class="campo"><label>CNPJ/CPF</label><input id="nm_d"></div><div class="campo"><label>Chave de acesso (44 dígitos)</label><input id="nm_ch"></div></div>
  <div class="c3"><div class="campo"><label>Número</label><input id="nm_n"></div><div class="campo"><label>Série</label><input id="nm_s"></div><div class="campo"><label>Emissão</label><input type="date" id="nm_em"></div></div>
  <div class="c3"><div class="campo"><label>Valor total</label><input id="nm_v" inputmode="decimal"></div><div class="campo"><label>Frete</label><input id="nm_fr" inputmode="decimal" value="0"></div><div class="campo"><label>Desconto</label><input id="nm_ds" inputmode="decimal" value="0"></div></div>
  <div class="campo"><label>Itens (um por linha: código; descrição; unidade; quantidade; valor unitário)</label><textarea id="nm_i" rows="5" placeholder="123; RACAO X 15KG; UN; 10; 189,90"></textarea></div>
  <div class="erro"></div><div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="nm_ok">Salvar como não conferida</button></div>`,true);
  $('nm_ok').onclick=()=>rodar($('nm_ok'),async()=>{const ch=val('nm_ch').replace(/\D/g,'');if(ch&&ch.length!==44)throw new Error('A chave deve ter 44 dígitos.');
    const itens=val('nm_i').split('\n').map(l=>l.split(';').map(s=>s.trim())).filter(a=>a.length>=5).map((a,k)=>({n_item:k+1,codigo:a[0],descricao:a[1],unidade:a[2],qtd:num(a[3]),valor_unit:num(a[4]),valor_total:num(a[3])*num(a[4])}));
    if(itens.some(i=>isNaN(i.qtd)||isNaN(i.valor_unit)))throw new Error('Confira quantidades e valores dos itens.');
    let path=null;const f=$('nm_f').files[0];if(f){path=`anexos/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]/g,'_')}`;const {error}=await sb.storage.from('pp-docs').upload(path,f);if(error)throw error;}
    const doc=val('nm_d').replace(/\D/g,'');
    const n=await q(sb.from('pp_notas').insert({tipo:val('nm_t'),empresa_id:+val('nm_e'),parceiro_nome:val('nm_p'),parceiro_doc:doc||null,numero:val('nm_n'),serie:val('nm_s'),chave:ch||null,emissao:val('nm_em')||null,valor_total:num(val('nm_v'))||soma(itens,i=>i.valor_total),
      frete:num(val('nm_fr'))||0,desconto:num(val('nm_ds'))||0,origem:'imagem',conferida:false,pdf_path:path,status_receb:val('nm_t')==='entrada'?'pendente':'nao_aplica',status_pgto:val('nm_t')==='entrada'?'pendente':'nao_aplica'}).select().single());
    if(itens.length)await q(sb.from('pp_nota_itens').insert(itens.map(i=>({nota_id:n.id,...i,...vincularItemAuto(i,doc)}))));
    fechar();toast('Nota salva como não conferida.');abrirNota(n.id);});
}
let buscaNota='';
async function telaNotas(tipo){
  const ns=await tudo(()=>sb.from('pp_notas').select('*,pp_nota_itens(id,produto_id)').eq('tipo',tipo).gte('emissao',tsIni(F.de)).lte('emissao',tsFim(F.ate)).order('emissao',{ascending:false}));
  const semData=await q(sb.from('pp_notas').select('*,pp_nota_itens(id,produto_id)').eq('tipo',tipo).is('emissao',null));
  const t=norm(buscaNota);
  const l=[...semData,...ns].filter(n=>(!F.empresa||n.empresa_id==F.empresa)&&(!t||norm([n.numero,n.parceiro_nome,n.parceiro_doc,n.chave].join(' ')).includes(t)));
  const pode=tem('compras','financeiro');
  $('conteudo').innerHTML=barraFiltros(['periodo','empresa'],()=>ir(area))+
  `<div class="barra-acoes"><input type="search" id="bn" placeholder="Número, ${tipo==='entrada'?'fornecedor':'cliente'}, CNPJ ou chave" value="${esc(buscaNota)}" style="flex:1;min-width:220px">
   ${pode?`<button class="pri" onclick="modalImportarXML('${tipo}')">Importar XML</button><button onclick="modalNotaManual('${tipo}')">PDF / imagem</button>`:''}<button onclick="exportarTabela('notas-${tipo}',window._cn,window._ln)">CSV</button></div>
  ${l.some(n=>!n.conferida)?`<div class="aviso">${l.filter(n=>!n.conferida).length} nota(s) lançadas por PDF/imagem aguardam conferência.</div>`:''}
  <div class="secao">${tabela(window._cn=[{t:'Emissão',v:n=>fd(n.emissao)},{t:'NF',v:n=>n.numero+'/'+(n.serie||''),h:n=>esc(n.numero+'/'+(n.serie||''))+(n.modelo==='65'?' <span class="tag">NFC-e</span>':'')},{t:'Empresa',v:n=>empresa(n.empresa_id).nome},{t:tipo==='entrada'?'Fornecedor':'Cliente',v:n=>n.parceiro_nome||''},
    {t:'Total',v:n=>+n.valor_total,n:1,tot:1},{t:'Itens',v:n=>n.pp_nota_itens.length,n:1,fmt:nf},{t:'Sem vínculo',v:n=>n.pp_nota_itens.filter(i=>!i.produto_id).length,n:1,fmt:nf},
    {t:'Situação',v:n=>n.situacao,h:n=>`<span class="tag ${n.situacao==='autorizada'?'v':'r'}">${n.situacao}</span>${n.conferida?'':' <span class="tag a">não conferida</span>'}${n.eh_bonificacao?' <span class="tag b">bonificação</span>':''}`},
    ...(tipo==='entrada'?[{t:'Recebimento',v:n=>n.status_receb},{t:'Pagamento',v:n=>n.status_pgto}]:[])],window._ln=l,{clique:n=>abrirNota(n.id)})}</div>`;
  $('bn').onchange=e=>{buscaNota=e.target.value;ir(area);};
}
TELAS.nfe=()=>telaNotas('entrada');
TELAS.nfs=()=>telaNotas('saida');
async function urlDoc(path){const {data,error}=await sb.storage.from('pp-docs').createSignedUrl(path,300);if(error)throw error;return data.signedUrl;}
async function abrirDoc(path){try{window.open(await urlDoc(path),'_blank');}catch(e){toast(msgErro(e));}}
async function abrirNota(id){
  const n=await q(sb.from('pp_notas').select('*').eq('id',id).single());
  const [itens,anexos,rel,lancs,vendas,recs]=await Promise.all([q(sb.from('pp_nota_itens').select('*').eq('nota_id',id).order('n_item')),q(sb.from('pp_anexos').select('*').eq('entidade','nota').eq('entidade_id',String(id))),
    n.nota_relacionada_id?q(sb.from('pp_notas').select('id,numero,parceiro_nome').eq('id',n.nota_relacionada_id)):[],
    veFin()?q(sb.from('pp_lancamentos').select('*').eq('nota_id',id)):[],tem('financeiro','operacao')?q(sb.from('pp_vendas').select('id,pedido,origem_ref,valor_bruto,data_venda').eq('nota_id',id)):[],
    q(sb.from('pp_recebimentos').select('*,pp_receb_itens(*)').eq('nota_id',id))]);
  const custos=veCusto()?await Promise.all(itens.map(i=>rpc('pp_custo_item_nota',{p_item:i.id}).catch(()=>null))):[];
  const recebido={};recs.forEach(r=>r.pp_receb_itens.forEach(ri=>recebido[ri.nota_item_id]=(recebido[ri.nota_item_id]||0)+(+ri.qtd_recebida)));
  const pode=tem('compras','financeiro');
  window._nota={n,itens};
  abrir(`<h2>NF ${esc(n.numero)}/${esc(n.serie||'')} · ${n.tipo==='entrada'?'Entrada':'Saída'}</h2><div class="sub">${esc(empresa(n.empresa_id).nome)} · ${esc(n.parceiro_nome||'')} ${n.parceiro_doc?'('+esc(n.parceiro_doc)+')':''}<br><span class="mono">${esc(n.chave||'sem chave')}</span></div>
  <div class="c3"><div><div class="mut peq">1. Emissão da nota</div><b>${fdh(n.emissao)}</b> <span class="tag ${n.situacao==='autorizada'?'v':'r'}">${n.situacao}</span></div>
   <div><div class="mut peq">2. Recebimento da mercadoria</div><b>${n.status_receb}</b>${recs.length?' · '+recs.map(r=>fd(r.data)).join(', '):''}</div>
   <div><div class="mut peq">3. Pagamento</div><b>${n.status_pgto}</b>${lancs.length?' · '+lancs.map(l=>brl(l.valor)+' venc. '+fd(l.vencimento)+' ('+l.status+')').join(', '):''}</div></div>
  ${!n.conferida?`<div class="aviso" style="margin-top:10px">Nota lançada por ${n.origem==='imagem'?'PDF/imagem':'digitação'} e ainda <b>não conferida</b>. Confira os itens com o documento antes de liberar.</div>`:''}
  <div style="margin:10px 0">${tabela([{t:'#',v:i=>i.n_item},{t:'Código',v:i=>i.codigo},{t:'Descrição',v:i=>i.descricao,h:i=>esc(i.descricao)+(i.bonificacao?' <span class="tag b">bonif.</span>':'')+(i.lote?`<div class="mut peq">Lote ${esc(i.lote)} · val. ${fd(i.validade)}</div>`:'')},{t:'Un.',v:i=>i.unidade},{t:'Qtd',v:i=>+i.qtd,n:1,fmt:x=>nf(x,3)},{t:'Fator',v:i=>+i.fator,n:1,fmt:x=>nf(x,3)},
    {t:'Valor unit.',v:i=>+i.valor_unit,n:1},{t:'Total',v:i=>+i.valor_total,n:1,tot:1},{t:'Desc.',v:i=>+i.desconto,n:1,tot:1},{t:'Frete',v:i=>+i.frete,n:1,tot:1},{t:'IPI',v:i=>+i.ipi,n:1,tot:1},{t:'ST',v:i=>+i.icms_st,n:1,tot:1},
    ...(n.tipo==='entrada'?[{t:'Recebido (un.)',v:i=>(recebido[i.id]||0),n:1,fmt:x=>nf(x,3),h:i=>{const r=recebido[i.id]||0,p=i.qtd*i.fator;return `<span style="color:${r>p?'var(--red)':r<p?'var(--amb)':'var(--grn)'}">${nf(r,3)} / ${nf(p,3)}</span>`;}}]:[]),
    ...(veCusto()&&n.tipo==='entrada'?[{t:'Custo/un. cadastro',v:(i)=>custos[itens.indexOf(i)],n:1}]:[]),
    {t:'Produto',v:i=>i.produto_id?nomeProd(i.produto_id):'',h:i=>i.produto_id?esc(nomeProd(i.produto_id)):`<button class="sm" onclick='modalVincular({origem:"fornecedor",escopo:${JSON.stringify(n.parceiro_doc||'')},codigo:${JSON.stringify(i.codigo||'')},descricao:${JSON.stringify(i.descricao||'')},extra:{ean:${JSON.stringify(i.ean||'')}}})'>Vincular</button>`}],itens,{rolar:false})}</div>
  <table class="t" style="max-width:520px;margin-left:auto"><tr><td>Produtos</td><td class="n">${brl(n.valor_produtos)}</td></tr><tr><td>Descontos</td><td class="n">${brl(n.desconto)}</td></tr><tr><td>Frete / seguro / outras</td><td class="n">${brl(n.frete)} / ${brl(n.seguro)} / ${brl(n.outras)}</td></tr><tr><td>IPI / ICMS-ST / ICMS</td><td class="n">${brl(n.ipi)} / ${brl(n.icms_st)} / ${brl(n.icms)}</td></tr><tr><td>PIS / COFINS</td><td class="n">${brl(n.pis)} / ${brl(n.cofins)}</td></tr><tr><td><b>Total da nota</b></td><td class="n"><b>${brl(n.valor_total)}</b></td></tr>
   ${n.despesa_extra>0?`<tr><td>Despesa adicional rateada (${esc(n.despesa_extra_desc||'')})</td><td class="n">${brl(n.despesa_extra)}</td></tr>`:''}</table>
  ${vendas.length?`<div class="info">Venda vinculada: ${vendas.map(v=>'#'+v.id+' pedido '+esc(v.pedido||v.origem_ref)+' '+brl(v.valor_bruto)).join(', ')}</div>`:''}
  ${n.obs?`<div class="mut peq">Informações complementares: ${esc(n.obs)}</div>`:''}
  <div class="campo" style="margin-top:10px"><label>Documentos</label>${n.xml_path?`<button class="sm" onclick="abrirDoc('${n.xml_path}')">XML</button> `:''}${n.pdf_path?`<button class="sm" onclick="abrirDoc('${n.pdf_path}')">PDF/imagem</button> `:''}${anexos.map(a=>`<button class="sm" onclick="abrirDoc('${a.caminho}')">${esc(a.nome)}</button>`).join(' ')}
   ${pode?'<input type="file" id="na_f" style="width:auto;margin-left:6px"> <button class="sm" id="na_ok">Anexar</button>':''}</div>
  ${pode?`<details style="margin-top:8px"><summary style="cursor:pointer;font-weight:600">Ajustes da nota</summary><div class="c3" style="margin-top:8px">
   ${n.tipo==='entrada'?`<div class="campo"><label>Bonificação vinculada à compra (NF de compra)</label><select id="na_rel"><option value="">—</option></select><div class="mut peq">Bonificação vinculada dilui o custo da compra.</div></div>
   <div class="campo"><label>Despesa adicional a ratear (ex.: CT-e)</label><input id="na_dx" value="${n.despesa_extra||0}" inputmode="decimal"><input id="na_dxd" placeholder="descrição" value="${esc(n.despesa_extra_desc||'')}" style="margin-top:4px"></div>`:''}
   <div class="campo"><label>Situação</label><select id="na_sit">${['autorizada','cancelada','denegada','em_digitacao','desconhecida'].map(s=>`<option ${n.situacao===s?'selected':''}>${s}</option>`).join('')}</select>
   <label style="margin-top:6px"><input type="checkbox" id="na_bon" ${n.eh_bonificacao?'checked':''}> Nota inteira é bonificação</label>${!n.conferida?'<label><input type="checkbox" id="na_conf"> Conferi com o documento</label>':''}</div></div>
   ${n.tipo==='saida'&&tem('financeiro','operacao')?'<div class="campo"><label>Vincular à venda (nº interno)</label><input id="na_v" placeholder="ex.: 1532"></div>':''}
   <div class="rodape" style="justify-content:flex-start"><button class="pri" id="na_salvar">Salvar ajustes</button>${n.tipo==='entrada'&&veFin()?'<button id="na_pg">Gerar conta a pagar</button>':''}${master()?'<button class="perigo" id="na_del">Excluir nota</button>':''}</div></details>`:''}
  <div class="erro"></div><div class="rodape">${n.tipo==='entrada'&&n.conferida&&tem('estoque','compras')&&n.status_receb!=='recebida'?`<button class="pri" onclick="receberDaNota(${n.id})">Receber mercadoria</button>`:''}<button onclick="fechar()">Fechar</button></div>`,true);
  if($('na_rel')){const cs=await q(sb.from('pp_notas').select('id,numero,emissao').eq('tipo','entrada').eq('parceiro_doc',n.parceiro_doc||'').neq('id',n.id).order('emissao',{ascending:false}).limit(50));$('na_rel').innerHTML='<option value="">—</option>'+cs.map(c=>`<option value="${c.id}" ${c.id===n.nota_relacionada_id?'selected':''}>NF ${esc(c.numero)} · ${fd(c.emissao)}</option>`).join('');}
  if($('na_ok'))$('na_ok').onclick=()=>rodar($('na_ok'),async()=>{const f=$('na_f').files[0];if(!f)throw new Error('Escolha o arquivo.');const path=`anexos/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]/g,'_')}`;const {error}=await sb.storage.from('pp-docs').upload(path,f);if(error)throw error;
    await q(sb.from('pp_anexos').insert({entidade:'nota',entidade_id:String(id),nome:f.name,caminho:path,tipo:f.type}));abrirNota(id);});
  if($('na_salvar'))$('na_salvar').onclick=()=>rodar($('na_salvar'),async()=>{const d={situacao:val('na_sit'),eh_bonificacao:$('na_bon').checked};
    if($('na_rel'))d.nota_relacionada_id=val('na_rel')?+val('na_rel'):null;if($('na_dx')){d.despesa_extra=num(val('na_dx'))||0;d.despesa_extra_desc=val('na_dxd')||null;}
    if($('na_conf')&&$('na_conf').checked)d.conferida=true;
    if(d.eh_bonificacao&&!n.eh_bonificacao)await q(sb.from('pp_nota_itens').update({bonificacao:true}).eq('nota_id',id));
    await q(sb.from('pp_notas').update(d).eq('id',id));
    if($('na_v')&&val('na_v'))await q(sb.from('pp_vendas').update({nota_id:id}).eq('id',+val('na_v')));
    toast('Nota atualizada. Recebimentos futuros usam os novos valores; recebimentos já feitos mantêm o custo registrado.');abrirNota(id);});
  if($('na_pg'))$('na_pg').onclick=()=>modalLancamento(null,{tipo:'pagar',natureza:'fornecedor',empresa_id:n.empresa_id,descricao:'NF '+n.numero+' · '+(n.parceiro_nome||''),parceiro:n.parceiro_nome,valor:n.valor_total,competencia:diaLocal(n.emissao),nota_id:n.id});
  if($('na_del'))$('na_del').onclick=()=>confirmar('Excluir nota','A nota e seus itens serão apagados. Recebimentos e movimentações ligados a ela impedem a exclusão.','Excluir',async()=>{await q(sb.from('pp_notas').delete().eq('id',id));ir(area);});
}
async function receberDaNota(id){const pend=await rpc('pp_itens_a_receber');const a=pend.filter(r=>r.nota_id===id);if(!a.length)return toast('Nada pendente nesta nota.');
  modalReceber({id,numero:a[0].numero,fornecedor:a[0].fornecedor,itens:a,semVinc:a.filter(x=>!x.produto_id).length});}
