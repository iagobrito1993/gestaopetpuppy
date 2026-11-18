// =====================================================================
// Integrações (Mercado Livre, SimplesVet, planilhas), configurações, usuários, conciliação
// =====================================================================
const EDGE=SUPABASE_URL+'/functions/v1/pp-ml';
let abaInt=ML_ATIVO?'ml':'simplesvet';
TELAS.integracoes=async function(extra){
  if(extra==='simplesvet')abaInt='simplesvet';
  const ml=new URLSearchParams(location.hash.split('?')[1]||'').get('ml');
  if(ml){history.replaceState(null,'','#integracoes');abaInt='ml';toast(ml==='ok'?'Conta do Mercado Livre conectada.':'Não foi possível conectar: '+ml,6000);REF.contasML=await q(sb.from('pp_ml_contas').select('*').order('id'));}
  const abas=[...(ML_ATIVO?[['ml','Mercado Livre']]:[]),['simplesvet','SimplesVet e planilhas'],['log','Histórico de sincronização'],...(master()?[['config','Configurações'],['usuarios','Usuários e permissões'],['backup','Backup e auditoria']]:[])];
  const ab=`<div class="abas2">${abas.map(([i,n])=>`<button class="${abaInt===i?'on':''}" onclick="abaInt='${i}';ir('integracoes')">${n}</button>`).join('')}</div>`;
  if(abaInt==='ml'&&!ML_ATIVO)abaInt='simplesvet';
  if(abaInt==='ml'){
    const appId=REF.config.ml_app_id;
    $('conteudo').innerHTML=ab+`<div class="info">Integração oficial (API do Mercado Livre e Mercado Pago), somente leitura: pedidos, itens, tarifas, frete, cancelamentos, devoluções, anúncios, SKUs, estoque Full e datas de liberação do dinheiro. A atualização é feita quando você clica em Sincronizar (ou pela rotina agendada, se configurada) — <b>não é em tempo real</b>. Nenhum preço ou estoque é alterado no Mercado Livre.</div>
    ${!appId?'<div class="aviso">Falta o aplicativo do Mercado Livre: crie em developers.mercadolivre.com.br e informe o App ID em Configurações. Até lá, use a importação do relatório de vendas do ML (aba SimplesVet e planilhas).</div>':''}
    <div class="secao"><h2>Contas vinculadas</h2>${tabela([{t:'Conta',v:c=>c.apelido},{t:'Empresa',v:c=>empresa(c.empresa_id).nome},{t:'Usuário ML',v:c=>c.nickname?c.nickname+' ('+c.ml_user_id+')':'—'},
      {t:'Status',v:c=>c.status,h:c=>`<span class="tag ${c.status==='conectada'?'v':c.status==='reconectar'?'r':'a'}">${c.status.replace('_',' ')}</span>`},{t:'Última sincronização',v:c=>fdh(c.ultima_sync)},
      {t:'Baixa de estoque (não-Full)',v:c=>c.baixa_estoque_nao_full==='simplesvet'?'Já lançada no SimplesVet':'Pelo sistema'},
      {t:'',v:()=>'',h:c=>`${master()?`<button class="sm" onclick="conectarML(${c.id})" ${appId?'':'disabled'}>${c.status==='conectada'?'Reconectar':'Conectar'}</button> `:''}${tem('financeiro')&&c.status==='conectada'?`<button class="sm pri" onclick="sincronizarML(${c.id},this)">Sincronizar</button>`:''}`}],REF.contasML,{rolar:false})}
     ${master()?'<button class="sm" onclick="modalContaML()">+ Conta do Mercado Livre</button>':''}</div>
    <div class="secao"><h2>Como fica cada data</h2><div class="mut">Data da venda = criação do pedido. Data do recebimento = aprovação do pagamento. Data de liberação = quando o Mercado Pago libera o dinheiro (money_release_date). Os três aparecem separados em Vendas e no Financeiro.</div></div>`;
    return;
  }
  if(abaInt==='simplesvet'){
    const ult=(await q(sb.from('pp_sync_log').select('*').eq('fonte','simplesvet').order('id',{ascending:false}).limit(1)))[0];
    $('conteudo').innerHTML=ab+`<div class="secao"><h2>Sincronização com o SimplesVet <small>${ult?'última: '+fdh(ult.terminado_em||ult.iniciado_em)+' · '+esc(ult.status):'ainda não sincronizado'}</small></h2>
     <p style="margin-top:0">Traz do SimplesVet as <b>vendas</b> (com itens, descontos e devoluções), os <b>produtos</b> (código, código de barras, categoria, custo) e o <b>estoque</b> da loja. Rodar de novo não duplica nada: só entra o que é novo ou mudou.</p>
     <div class="info" style="margin-bottom:12px"><b>Automático (recomendado):</b> instale a extensão <b>Sincronizar Pet Puppy</b> no Chrome. Ela sincroniza sozinha a cada hora enquanto o Chrome estiver aberto, usando o login do SimplesVet e do Gestão Pet Puppy que já estão no navegador. Não guarda senha.
      <ol style="margin:6px 0 8px 18px;padding:0"><li>Baixe o arquivo e descompacte (clique duas vezes no .zip).</li><li>No Chrome, abra <b>chrome://extensions</b> e ligue o <b>Modo do desenvolvedor</b> (canto superior direito).</li><li>Clique em <b>Carregar sem compactação</b> e escolha a pasta <b>pet-puppy-sync</b>.</li></ol>
      <a class="sm" style="display:inline-block;background:#FFCC00;color:#1b1a17;font-weight:700;padding:8px 14px;border-radius:9px;text-decoration:none;border:1px solid #F2B600" href="extensao/pet-puppy-sync.zip" download>⬇ Baixar extensão</a></div>
     <div class="mut peq" style="margin-bottom:6px"><b>Manual (favorito):</b></div>
     <ol style="margin:0 0 10px 18px;padding:0"><li>Uma vez só: arraste o botão amarelo abaixo para a <b>barra de favoritos</b> do Chrome.</li><li>Abra o <b>SimplesVet</b> (logado) e clique no favorito <b>"Sincronizar Pet Puppy"</b>.</li><li>Abre uma janela do Gestão Pet Puppy e a gravação acontece sozinha. Pronto.</li></ol>
     <a id="sv_bm" class="sm" style="display:inline-block;background:#FFCC00;color:#1b1a17;font-weight:700;padding:9px 16px;border-radius:9px;text-decoration:none;border:1px solid #F2B600" href="#" onclick="if(this.getAttribute('href').startsWith('#')){toast('Arraste este botão para a barra de favoritos.');return false;}">⭐ Sincronizar Pet Puppy</a>
     <div class="mut peq" style="margin-top:8px">Não é em tempo real: os dados ficam atualizados até a última sincronização. A leitura usa o seu login do SimplesVet dentro do próprio SimplesVet; nenhuma senha é guardada aqui.</div></div>
     <div class="info">Alternativa manual: exportar relatórios do SimplesVet (CSV/Excel) e importar aqui, com conferência antes de gravar.</div>
    <div class="kpis">
     ${[['sv_produtos','Produtos, estoque e custos','Comercial → Produtos e serviços → exportar'],['sv_vendas','Vendas (itens)','Vendas → Vendas → Exportar para CSV'],['sv_mov','Movimentações de estoque','Estoque → Movimentações → exportar'],['sv_fin','Contas a pagar e a receber','Financeiro → Contas → exportar'],...(ML_ATIVO?[['ml_vendas','Relatório de vendas do Mercado Livre','Vendas → Exportar (Excel) — alternativa à API']]:[])]
       .map(([k,t,s])=>`<div class="kpi" onclick="modalImportar('${k}')"><div class="l">Importar</div><div class="v" style="font-size:16px">${t}</div><div class="s">${s}</div></div>`).join('')}
     <div class="kpi" onclick="ir('nfe')"><div class="l">Importar</div><div class="v" style="font-size:16px">XML de notas fiscais</div><div class="s">Entrada e saída, em lote</div></div></div>`;
    linkSincronizadorSV().then(h=>{const a=$('sv_bm');if(a&&h!=='#')a.setAttribute('href',h);});
    return;
  }
  if(abaInt==='log'){
    const l=await q(sb.from('pp_sync_log').select('*').order('id',{ascending:false}).limit(300));
    $('conteudo').innerHTML=ab+`<div class="secao">${tabela([{t:'Início',v:x=>fdh(x.iniciado_em)},{t:'Fonte',v:x=>x.fonte},{t:'Conta',v:x=>x.conta||''},{t:'Tipo',v:x=>x.tipo||''},{t:'Resultado',v:x=>x.status,h:x=>`<span class="tag ${x.status==='ok'?'v':x.status==='erro'?'r':'a'}">${x.status}</span>`},
      {t:'Lidos',v:x=>x.lidos,n:1,fmt:nf},{t:'Gravados',v:x=>x.gravados,n:1,fmt:nf},{t:'Sem alteração/duplicados',v:x=>x.duplicados,n:1,fmt:nf},{t:'Erros',v:x=>x.erros,n:1,fmt:nf},{t:'Mensagem',v:x=>x.mensagem||''}],l,{clique:x=>detalhar('Detalhes da sincronização #'+x.id,esc(x.mensagem||''),[{t:'Detalhe',v:d=>d}],x.detalhes||[])})}</div>`;
    return;
  }
  if(abaInt==='config')return telaConfig(ab);
  if(abaInt==='usuarios')return telaUsuarios(ab);
  if(abaInt==='backup')return telaBackup(ab);
};
async function conectarML(id){
  try{const st=await rpc('pp_ml_iniciar_oauth',{p_conta:id});const u=`https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${encodeURIComponent(REF.config.ml_app_id)}&redirect_uri=${encodeURIComponent(EDGE+'?acao=callback')}&state=${encodeURIComponent(st)}`;
    toast('Entre na conta do Mercado Livre de '+contaML(id).apelido+' e autorize.');setTimeout(()=>location.href=u,800);}catch(e){toast(msgErro(e));}
}
async function sincronizarML(id,btn){
  btn.disabled=true;btn.textContent='Sincronizando…';
  try{const {data,error}=await sb.functions.invoke('pp-ml',{body:{acao:'sync',conta_id:id}});if(error)throw error;
    toast(`${contaML(id).apelido}: ${data.status} · ${nf(data.lidos)} lidos · ${nf(data.gravados)} gravados · ${nf(data.duplicados)} sem alteração · ${nf(data.erros)} erros`,8000);
    REF.contasML=await q(sb.from('pp_ml_contas').select('*').order('id'));}catch(e){toast('Falha na sincronização: '+msgErro(e),8000);}
  ir('integracoes');
}
function modalContaML(){abrir(`<h2>Nova conta do Mercado Livre</h2><div class="c2"><div class="campo"><label>Apelido</label><input id="cm_a"></div><div class="campo"><label>Empresa</label><select id="cm_e">${opcoes(REF.empresas,'',null)}</select></div></div>
  <div class="erro"></div><div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="cm_ok">Salvar</button></div>`);
  $('cm_ok').onclick=()=>rodar($('cm_ok'),async()=>{await q(sb.from('pp_ml_contas').insert({apelido:val('cm_a'),empresa_id:+val('cm_e')}));REF.contasML=await q(sb.from('pp_ml_contas').select('*').order('id'));fechar();ir('integracoes');});}

// ---------- importador genérico com conferência ----------
const IMPORT={
  sv_produtos:{t:'Produtos do SimplesVet',campos:{codigo:['codigo','código','cod','id','codigo interno','código interno'],nome:['nome','produto','descricao','descrição','produto/serviço'],categoria:['categoria','grupo','tipo de produto'],
    ean:['ean','codigo de barras','código de barras','gtin','cod barras'],unidade:['unidade','un','und'],preco:['preco','preço','preco de venda','preço de venda','valor de venda','valor'],custo:['custo','preco de custo','preço de custo','custo unitario','custo médio','custo medio'],estoque:['estoque','saldo','quantidade','qtd','estoque atual'],tipo:['tipo']},obrig:['codigo','nome']},
  sv_vendas:{t:'Vendas do SimplesVet',campos:{data:['data','data da venda','data venda','emissao','emissão'],venda:['venda','numero','número','nº','n venda','codigo da venda','código da venda','id venda','pedido'],codigo:['codigo','código','codigo produto','cod produto','código do produto'],
    descricao:['produto','descricao','descrição','item','produto/serviço'],qtd:['quantidade','qtd','qtde'],unit:['valor unitario','valor unitário','preco','preço','unitario','unitário'],total:['total','valor total','valor','subtotal'],desconto:['desconto','desc'],status:['status','situacao','situação'],cliente:['cliente','tutor'],tipo:['tipo','tipo item']},obrig:['data','venda','qtd']},
  sv_mov:{t:'Movimentações de estoque do SimplesVet',campos:{data:['data','data movimentacao','data movimentação'],codigo:['codigo','código','cod produto'],descricao:['produto','descricao','descrição'],tipo:['tipo','operacao','operação','movimentacao','movimentação'],qtd:['quantidade','qtd','qtde'],documento:['documento','doc','nota','venda'],responsavel:['responsavel','responsável','usuario','usuário'],custo:['custo','valor unitario','valor unitário']},obrig:['data','codigo','qtd']},
  sv_fin:{t:'Contas do SimplesVet',campos:{tipo:['tipo','natureza','pagar/receber'],descricao:['descricao','descrição','historico','histórico'],parceiro:['fornecedor','cliente','favorecido','pessoa'],categoria:['categoria','plano de contas','conta'],valor:['valor','valor total'],vencimento:['vencimento','data vencimento'],pagamento:['pagamento','data pagamento','baixa','data baixa'],valor_pago:['valor pago','pago'],status:['status','situacao','situação'],id:['id','codigo','código']},obrig:['descricao','valor','vencimento']},
  ml_vendas:{t:'Relatório de vendas do Mercado Livre',campos:{pedido:['n.º de venda','nº de venda','numero de venda','número de venda','venda','order id','pedido'],data:['data da venda','data'],sku:['sku'],item:['# de anúncio','anuncio','anúncio','id do anuncio'],descricao:['título do anúncio','titulo do anuncio','título','titulo'],
    qtd:['unidades','quantidade','qtd'],unit:['preço unitário de venda do anúncio (brl)','preco unitario','preço unitário'],total:['receita por produtos (brl)','total (brl)','receita por produtos'],tarifa:['tarifa de venda e impostos (brl)','tarifa de venda','tarifas'],frete:['tarifas de envio (brl)','custo de envio','frete'],status:['estado','status'],cancel:['cancelamentos e reembolsos (brl)','reembolsos']},obrig:['pedido','data','qtd']},
};
function lerData(v){if(v==null||v==='')return null;if(v instanceof Date)return v.toISOString();if(typeof v==='number'){const d=new Date(Math.round((v-25569)*864e5));return d.toISOString();}
  const s=String(v).trim();let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m){const a=m[3].length===2?'20'+m[3]:m[3];return `${a}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}T${(m[4]||'12').padStart(2,'0')}:${m[5]||'00'}:${m[6]||'00'}${offsetFuso()}`;}
  m=s.match(/^(\d{1,2}) de (\w+) de (\d{4})(?: (\d{1,2}):(\d{2}))?/i);if(m){const ms=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'].indexOf(norm(m[2]).slice(0,3))+1;if(ms)return `${m[3]}-${String(ms).padStart(2,'0')}-${m[1].padStart(2,'0')}T${(m[4]||'12').padStart(2,'0')}:${m[5]||'00'}:00${offsetFuso()}`;}
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.length===10?s+'T12:00:00'+offsetFuso():s;return null;}
async function hash(s){const b=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,24);}
async function lerPlanilha(f){
  if(/\.csv$|\.txt$/i.test(f.name)){let t=await f.text();if(t.includes('�')){const b=await f.arrayBuffer();t=new TextDecoder('windows-1252').decode(b);}
    const sep=(t.split('\n')[0].match(/;/g)||[]).length>=(t.split('\n')[0].match(/,/g)||[]).length?';':',';
    const linhas=[];let cur=[''],aspas=false;for(let i=0;i<t.length;i++){const c=t[i];if(c==='"'){if(aspas&&t[i+1]==='"'){cur[cur.length-1]+='"';i++;}else aspas=!aspas;}else if(c===sep&&!aspas)cur.push('');else if((c==='\n'||c==='\r')&&!aspas){if(c==='\r'&&t[i+1]==='\n')i++;linhas.push(cur);cur=[''];}else cur[cur.length-1]+=c;}
    if(cur.length>1||cur[0])linhas.push(cur);return linhas.filter(l=>l.some(x=>x.trim()));}
  if(!window.XLSX)throw new Error('Leitor de Excel ainda carregando, tente de novo.');
  const wb=XLSX.read(await f.arrayBuffer(),{cellDates:true});const ws=wb.Sheets[wb.SheetNames[0]];return XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''}).filter(l=>l.some(x=>String(x).trim()));
}
function acharCabecalho(linhas,cfg){let melhor=0,idx=0;linhas.slice(0,30).forEach((l,i)=>{const n=l.filter(c=>Object.values(cfg.campos).some(s=>s.includes(norm(c)))).length;if(n>melhor){melhor=n;idx=i;}});return idx;}
function modalImportar(tipo){
  const cfg=IMPORT[tipo];
  abrir(`<h2>Importar: ${esc(cfg.t)}</h2><div class="sub">CSV ou Excel. 1) escolha o arquivo · 2) confira as colunas · 3) confira a prévia · 4) grave.</div>
  <div class="c3"><div class="campo"><label>Arquivo</label><input type="file" id="im_f" accept=".csv,.txt,.xlsx,.xls"></div>
   ${tipo==='ml_vendas'?`<div class="campo"><label>Conta do Mercado Livre</label><select id="im_c">${opcoes(REF.contasML,'',null,x=>x.id,x=>x.apelido)}</select></div>`:`<div class="campo"><label>Empresa</label><select id="im_e">${opcoes(REF.empresas,REF.empresas[0]&&REF.empresas[0].id,null)}</select></div>`}
   ${['sv_produtos','sv_mov'].includes(tipo)?`<div class="campo"><label>Local de estoque</label><select id="im_l">${opcoes(REF.locais.filter(l=>l.tipo!=='espelho'),'',null)}</select></div>`:''}</div>
  ${tipo==='sv_produtos'?`<div class="c3"><label><input type="checkbox" id="im_si" checked> Registrar o estoque como <b>saldo inicial</b> (só para produtos sem saldo inicial neste local)</label><div class="campo"><label>Data do saldo</label><input type="date" id="im_d" value="${hojeISO()}"></div>
   <label><input type="checkbox" id="im_cu" checked> Usar o custo do SimplesVet como custo inicial (marcado como "sem nota")</label></div>`:''}
  <div id="im_map"></div><div id="im_prev"></div><div class="erro"></div>
  <div class="rodape"><button onclick="fechar()">Cancelar</button><button id="im_pv" disabled>Gerar prévia</button><button class="pri" id="im_ok" disabled>Gravar</button></div>`,true);
  let linhas=[],cab=[],h=0,prep=null;
  $('im_f').onchange=async e=>{try{linhas=await lerPlanilha(e.target.files[0]);h=acharCabecalho(linhas,cfg);cab=linhas[h].map(x=>String(x).trim());
    $('im_map').innerHTML=`<div class="secao"><h2>Colunas <small>${linhas.length-h-1} linhas de dados · cabeçalho na linha ${h+1}</small></h2><div class="c3">${Object.entries(cfg.campos).map(([k,sin])=>{const g=cab.findIndex(c=>sin.includes(norm(c)));
      return `<div class="campo"><label>${k}${cfg.obrig.includes(k)?' *':''}</label><select class="im_c" data-k="${k}"><option value="-1">— não usar —</option>${cab.map((c,i)=>`<option value="${i}" ${i===g?'selected':''}>${esc(c)}</option>`).join('')}</select></div>`;}).join('')}</div></div>`;
    $('im_pv').disabled=false;}catch(er){$('modal').querySelector('.erro').textContent=msgErro(er);}};
  const mapa=()=>{const m={};document.querySelectorAll('.im_c').forEach(s=>{if(+s.value>=0)m[s.dataset.k]=+s.value;});return m;};
  $('im_pv').onclick=()=>rodar($('im_pv'),async()=>{const m=mapa();const falta=cfg.obrig.filter(k=>m[k]==null);if(falta.length)throw new Error('Associe as colunas obrigatórias: '+falta.join(', '));
    const g=(l,k)=>m[k]==null?'':l[m[k]];const dados=linhas.slice(h+1).map(l=>{const o={};Object.keys(cfg.campos).forEach(k=>o[k]=g(l,k));return o;});
    prep=await PREPARAR[tipo](dados);
    $('im_prev').innerHTML=`<div class="secao"><h2>Prévia — nada foi gravado ainda</h2><div class="kpis">${Object.entries(prep.resumo).map(([k,v])=>`<div class="kpi"><div class="l">${esc(k)}</div><div class="v">${nf(v)}</div></div>`).join('')}</div>
      ${prep.erros.length?`<div class="aviso">${prep.erros.length} linhas com problema serão ignoradas:<br>${prep.erros.slice(0,15).map(esc).join('<br>')}${prep.erros.length>15?'<br>…':''}</div>`:''}
      ${tabela(prep.cols,prep.amostra,{limite:30})}</div>`;
    $('im_ok').disabled=!prep.total;});
  $('im_ok').onclick=()=>rodar($('im_ok'),async()=>{const log=await q(sb.from('pp_sync_log').insert({fonte:tipo.startsWith('ml')?'mercado_livre_planilha':'simplesvet',tipo,conta:tipo==='ml_vendas'?contaML(val('im_c')).apelido:empresa(val('im_e')).nome,status:'rodando'}).select().single());
    const r={lidos:prep.total,gravados:0,duplicados:0,erros:0,det:[...prep.erros]};
    try{await GRAVAR[tipo](prep,r);}catch(e){r.erros++;r.det.push(msgErro(e));}
    await sb.from('pp_sync_log').update({status:r.erros?(r.gravados?'parcial':'erro'):'ok',terminado_em:new Date().toISOString(),lidos:r.lidos,gravados:r.gravados,duplicados:r.duplicados,erros:r.erros,detalhes:r.det.slice(0,300),mensagem:'Arquivo '+($('im_f').files[0]||{}).name}).eq('id',log.id);
    await carregarRef();fechar();toast(`Importação concluída: ${nf(r.gravados)} gravados · ${nf(r.duplicados)} já existentes/sem alteração · ${nf(r.erros)} erros.`,8000);ir(area);});
}
const PREPARAR={
  async sv_produtos(d){const erros=[],novos=[],exist=[],sug=[];const loc=+val('im_l');
    d.forEach((x,i)=>{const cod=String(x.codigo).trim(),nome=String(x.nome).trim();if(!cod||!nome){erros.push(`Linha ${i+2}: sem código ou nome`);return;}
      if(norm(x.tipo).startsWith('serv'))return;
      const ean=String(x.ean||'').replace(/\D/g,'')||null;const c=REF.codigos.find(k=>k.origem==='simplesvet'&&k.codigo===cod&&k.produto_id);
      const o={cod,nome,categoria:String(x.categoria||'').trim()||null,ean:ean&&ean.length>=8?ean:null,unidade:String(x.unidade||'UN').toUpperCase().slice(0,4)||'UN',preco:num(x.preco),custo:num(x.custo),estoque:num(x.estoque)};
      if(c){o.produto_id=c.produto_id;exist.push(o);}else{const pe=o.ean&&REF.produtos.find(p=>p.ean===o.ean);if(pe){o.sug=pe.id;sug.push(o);}else novos.push(o);}});
    const todos=[...novos,...exist,...sug];
    return {novos,exist,sug,loc,erros,total:todos.length,amostra:todos,resumo:{'Produtos novos':novos.length,'Já vinculados (atualiza saldo/custo)':exist.length,'EAN igual a produto existente (vai para revisão)':sug.length,'Com custo zero ou vazio':todos.filter(o=>!(o.custo>0)).length},
      cols:[{t:'Código',v:o=>o.cod},{t:'Nome',v:o=>o.nome},{t:'EAN',v:o=>o.ean||''},{t:'Categoria',v:o=>o.categoria||''},{t:'Estoque',v:o=>o.estoque,n:1,fmt:x=>nf(x,3)},{t:'Custo',v:o=>o.custo>0?o.custo:null,n:1},{t:'Situação',v:o=>o.produto_id?'existente':o.sug?'revisar EAN':'novo'}]};},
  async sv_vendas(d){const erros=[],por={};
    d.forEach((x,i)=>{const n=String(x.venda).trim(),dt=lerData(x.data),q_=num(x.qtd);if(!n||!dt||isNaN(q_)){erros.push(`Linha ${i+2}: venda, data ou quantidade inválida`);return;}
      const tot=num(x.total),un_=num(x.unit);const unit=!isNaN(un_)?un_:(!isNaN(tot)&&q_?tot/q_:0);
      const v=por[n]=por[n]||{origem_ref:'sv:'+n,pedido:n,data_venda:dt,status:'concluida',cliente:String(x.cliente||'').trim()||null,itens:[]};
      if(/cancel/i.test(x.status))v.status='cancelada';
      v.itens.push({codigo:String(x.codigo||'').trim()||null,descricao:String(x.descricao||'').trim(),qtd:q_,preco_unit:unit,desconto:num(x.desconto)||0,eh_servico:/serv/i.test(x.tipo)});});
    const vs=Object.values(por);vs.forEach(v=>{v.valor_bruto=soma(v.itens,i=>i.qtd*i.preco_unit);v.desconto=soma(v.itens,i=>i.desconto);v.valor_cancelado=v.status==='cancelada'?v.valor_bruto:0;});
    const ex=await existentes('pp_vendas','simplesvet',vs.map(v=>v.origem_ref));
    return {vs,erros,total:vs.length,amostra:vs,resumo:{'Vendas no arquivo':vs.length,'Novas':vs.filter(v=>!ex.has(v.origem_ref)).length,'Já importadas (serão conferidas, sem duplicar)':vs.filter(v=>ex.has(v.origem_ref)).length,'Itens':soma(vs,v=>v.itens.length)},
      cols:[{t:'Venda',v:v=>v.pedido},{t:'Data',v:v=>fdh(v.data_venda)},{t:'Itens',v:v=>v.itens.length,n:1,fmt:nf},{t:'Bruto',v:v=>v.valor_bruto,n:1,tot:1},{t:'Status',v:v=>v.status},{t:'',v:v=>ex.has(v.origem_ref)?'já existe':'nova'}]};},
  async sv_mov(d){const erros=[],ms=[];const loc=+val('im_l');
    for(const [i,x] of d.entries()){const dt=lerData(x.data),cod=String(x.codigo).trim();let qd=num(x.qtd);if(!dt||!cod||isNaN(qd)){erros.push(`Linha ${i+2}: data, código ou quantidade inválida`);continue;}
      const c=REF.codigos.find(k=>k.origem==='simplesvet'&&k.codigo===cod&&k.produto_id);if(!c){erros.push(`Linha ${i+2}: código ${cod} sem vínculo no cadastro (importe os produtos antes)`);continue;}
      const t=norm(x.tipo);const tipo=/transf/.test(t)?(qd<0||/said|sai/.test(t)?'transferencia_saida':'transferencia_entrada'):/devol/.test(t)?(/compra|fornec/.test(t)?'devolucao_compra':'devolucao_venda'):/venda/.test(t)?'venda':/perda|avaria|quebra|venc/.test(t)?'perda':/consumo|uso/.test(t)?'consumo_interno':/compra|entrada|receb/.test(t)?'compra':'ajuste';
      if(qd>0&&['venda','perda','consumo_interno','devolucao_compra','transferencia_saida'].includes(tipo))qd=-qd;if(tipo==='ajuste'&&/said|sai|baixa|-/.test(t)&&qd>0)qd=-qd;
      ms.push({produto_id:c.produto_id,local_id:loc,data:dt,tipo,qtd:qd*c.fator,origem:'simplesvet',origem_ref:'svm:'+await hash([x.data,cod,x.tipo,x.qtd,x.documento,i>0?'':''].join('|')),documento:String(x.documento||'').trim()||null,responsavel:String(x.responsavel||'').trim()||null,_custo:num(x.custo)});}
    // linhas idênticas no mesmo arquivo recebem sufixo para não se anularem
    const vistos={};ms.forEach(m=>{vistos[m.origem_ref]=(vistos[m.origem_ref]||0)+1;if(vistos[m.origem_ref]>1)m.origem_ref+=':'+vistos[m.origem_ref];});
    const ex=await existentes('pp_mov','simplesvet',ms.map(m=>m.origem_ref));
    return {ms,erros,total:ms.length,amostra:ms,resumo:{'Movimentações':ms.length,'Novas':ms.filter(m=>!ex.has(m.origem_ref)).length,'Já importadas':ms.filter(m=>ex.has(m.origem_ref)).length},
      cols:[{t:'Data',v:m=>fdh(m.data)},{t:'Produto',v:m=>nomeProd(m.produto_id)},{t:'Tipo',v:m=>TIPOS_MOV[m.tipo]},{t:'Qtd',v:m=>m.qtd,n:1,fmt:x=>nf(x,3)},{t:'Documento',v:m=>m.documento||''},{t:'',v:m=>ex.has(m.origem_ref)?'já existe':'nova'}]};},
  async sv_fin(d){const erros=[],ls=[];const emp=+val('im_e');
    for(const [i,x] of d.entries()){const v=num(x.valor),venc=lerData(x.vencimento);if(isNaN(v)||!venc){erros.push(`Linha ${i+2}: valor ou vencimento inválido`);continue;}
      const tipo=/receb|receita|entrada|cr/i.test(x.tipo)?'receber':'pagar';const pg=lerData(x.pagamento);const st=/pago|quitad|baixad|recebid/i.test(x.status)||pg?'pago':/cancel/i.test(x.status)?'cancelado':'aberto';
      ls.push({tipo,natureza:tipo==='receber'?'venda':/fornec|compra|mercad/i.test(x.categoria)?'fornecedor':/imposto|simples|das|icms/i.test(x.categoria)?'imposto':/salar|folha|pro.?labore/i.test(x.categoria)?'folha':/aluguel|energia|agua|água|internet|telefone|contab|sistema/i.test(x.categoria)?'despesa_fixa':'despesa_variavel',
        categoria:String(x.categoria||'').trim()||null,descricao:String(x.descricao).trim()||'(sem descrição)',parceiro:String(x.parceiro||'').trim()||null,valor:Math.abs(v),vencimento:venc.slice(0,10),competencia:venc.slice(0,10),status:st,data_pagamento:pg?pg.slice(0,10):null,
        valor_pago:st==='pago'?(isNaN(num(x.valor_pago))?Math.abs(v):num(x.valor_pago)):null,empresa_id:emp,origem:'simplesvet',origem_ref:'svf:'+(String(x.id||'').trim()||await hash([x.descricao,x.valor,x.vencimento,x.parceiro].join('|')))});}
    const ex=await existentes('pp_lancamentos','simplesvet',ls.map(l=>l.origem_ref));
    return {ls,erros,total:ls.length,amostra:ls,resumo:{'Lançamentos':ls.length,'Novos':ls.filter(l=>!ex.has(l.origem_ref)).length,'Já existentes (atualiza status)':ls.filter(l=>ex.has(l.origem_ref)).length,'Natureza classificada automaticamente (revise)':ls.length},
      cols:[{t:'Tipo',v:l=>l.tipo},{t:'Natureza',v:l=>NATUREZAS[l.natureza]},{t:'Descrição',v:l=>l.descricao},{t:'Valor',v:l=>l.valor,n:1,tot:1},{t:'Vencimento',v:l=>fd(l.vencimento)},{t:'Status',v:l=>l.status}]};},
  async ml_vendas(d){const erros=[],por={};const conta=REF.contasML.find(c=>c.id==val('im_c'));
    d.forEach((x,i)=>{const p=String(x.pedido).trim().replace(/\D/g,''),dt=lerData(x.data),qd=num(x.qtd);if(!p||!dt||isNaN(qd)){if(String(x.pedido).trim())erros.push(`Linha ${i+2}: pedido, data ou unidades inválidos`);return;}
      const v=por[p]=por[p]||{origem_ref:p,pedido:p,data_venda:dt,status:/cancel/i.test(x.status)?'cancelada':/devol|reembols/i.test(x.status)?'devolvida':'concluida',tarifa_venda:0,frete_vendedor:0,valor_devolvido:0,itens:[]};
      const tot=num(x.total),un_=num(x.unit);v.itens.push({sku:String(x.sku||'').trim()||null,item_ml:String(x.item||'').trim()||null,descricao:String(x.descricao||'').trim(),qtd:qd,preco_unit:!isNaN(un_)?un_:(tot/qd||0)});
      v.tarifa_venda+=Math.abs(num(x.tarifa)||0);v.frete_vendedor+=Math.abs(num(x.frete)||0);if(v.status==='devolvida')v.valor_devolvido+=Math.abs(num(x.cancel)||0);});
    const vs=Object.values(por);vs.forEach(v=>{v.valor_bruto=soma(v.itens,i=>i.qtd*i.preco_unit);v.valor_cancelado=v.status==='cancelada'?v.valor_bruto:0;if(v.status==='devolvida'&&!v.valor_devolvido)v.valor_devolvido=v.valor_bruto;});
    const ex=await existentes('pp_vendas','ml',vs.map(v=>v.origem_ref));
    return {vs,conta,erros,total:vs.length,amostra:vs,resumo:{'Pedidos':vs.length,'Novos':vs.filter(v=>!ex.has(v.origem_ref)).length,'Já existentes (API ou import anterior)':vs.filter(v=>ex.has(v.origem_ref)).length},
      cols:[{t:'Pedido',v:v=>v.pedido},{t:'Data',v:v=>fdh(v.data_venda)},{t:'Bruto',v:v=>v.valor_bruto,n:1,tot:1},{t:'Tarifas',v:v=>v.tarifa_venda,n:1,tot:1},{t:'Frete',v:v=>v.frete_vendedor,n:1,tot:1},{t:'Status',v:v=>v.status}]};},
};
async function existentes(tab,origem,refs){const s=new Set();for(let i=0;i<refs.length;i+=200){const r=await q(sb.from(tab).select('origem_ref').eq('origem',origem).in('origem_ref',refs.slice(i,i+200)));r.forEach(x=>s.add(x.origem_ref));}return s;}
const GRAVAR={
  async sv_produtos(p,r){const data=val('im_d')||hojeISO(),si=$('im_si').checked,usaCusto=$('im_cu').checked;
    const iniciais=new Set((await tudo(()=>sb.from('pp_mov').select('produto_id').eq('tipo','saldo_inicial').eq('local_id',p.loc))).map(x=>x.produto_id));
    for(const o of p.novos){try{const pr=await q(sb.from('pp_produtos').insert({nome:o.nome,categoria:o.categoria,ean:o.ean,unidade:o.unidade}).select().single());
      await rpc('pp_vincular_codigo',{p_origem:'simplesvet',p_escopo:'',p_codigo:o.cod,p_produto:pr.id,p_fator:1,p_descricao:o.nome});if(o.ean)await rpc('pp_vincular_codigo',{p_origem:'ean',p_escopo:'',p_codigo:o.ean,p_produto:pr.id,p_fator:1,p_descricao:o.nome}).catch(()=>{});
      o.produto_id=pr.id;r.gravados++;}catch(e){r.erros++;r.det.push(o.cod+': '+msgErro(e));}}
    for(const o of p.sug){await sb.from('pp_codigos').upsert({origem:'simplesvet',escopo:'',codigo:o.cod,produto_id:o.sug,descricao:o.nome,status:'sugerido',motivo_sugestao:'EAN igual ('+o.ean+')'},{onConflict:'origem,escopo,codigo',ignoreDuplicates:true});r.duplicados++;}
    for(const o of [...p.novos,...p.exist]){if(!o.produto_id||isNaN(o.estoque))continue;
      await sb.from('pp_saldos_externos').upsert({fonte:'simplesvet',produto_id:o.produto_id,local_id:p.loc,codigo:o.cod,data:data+'T23:59:00'+offsetFuso(),qtd:o.estoque},{onConflict:'fonte,local_id,codigo,data'});
      if(si&&!iniciais.has(o.produto_id)){const {data:m,error}=await sb.from('pp_mov').upsert({produto_id:o.produto_id,local_id:p.loc,data:data+'T00:00:00'+offsetFuso(),tipo:'saldo_inicial',qtd:o.estoque,origem:'simplesvet',origem_ref:'si:'+p.loc+':'+o.cod,documento:'Saldo SimplesVet '+fd(data),responsavel:perfil.nome||perfil.email},{onConflict:'origem,origem_ref',ignoreDuplicates:true}).select();
        if(error){r.erros++;r.det.push(o.cod+': '+msgErro(error));continue;}
        if(m&&m[0]&&usaCusto&&o.custo>0&&veCusto())await sb.from('pp_mov_custo').insert({mov_id:m[0].id,custo_unit:o.custo,confiavel:false,fonte:'Custo cadastrado no SimplesVet (sem nota)'});}}
    r.duplicados+=p.exist.length;},
  async sv_vendas(p,r){const emp=+val('im_e');const uni=(REF.unidades.find(u=>u.empresa_id==emp)||{}).id||null;
    for(const v of p.vs){try{const res=await rpc('pp_gravar_venda',{p_venda:{...v,itens:undefined,canal:'loja',empresa_id:emp,unidade_id:uni,origem:'simplesvet'},p_itens:v.itens});if(res==='novo'||res==='atualizado')r.gravados++;else r.duplicados++;}catch(e){r.erros++;r.det.push('Venda '+v.pedido+': '+msgErro(e));}}},
  async sv_mov(p,r){const ms=p.ms;for(let i=0;i<ms.length;i+=300){const lote=ms.slice(i,i+300);const {data,error}=await sb.from('pp_mov').upsert(lote.map(({_custo,...m})=>m),{onConflict:'origem,origem_ref',ignoreDuplicates:true}).select('id,origem_ref');
      if(error){r.erros+=lote.length;r.det.push(msgErro(error));continue;}r.gravados+=data.length;r.duplicados+=lote.length-data.length;
      if(veCusto()){const cs=data.map(d=>{const m=lote.find(x=>x.origem_ref===d.origem_ref);return m&&m.qtd>0&&m._custo>0&&['compra','ajuste','devolucao_venda'].includes(m.tipo)?{mov_id:d.id,custo_unit:m._custo,confiavel:false,fonte:'SimplesVet (movimentação)'}:null;}).filter(Boolean);if(cs.length)await sb.from('pp_mov_custo').insert(cs);}}},
  async sv_fin(p,r){for(let i=0;i<p.ls.length;i+=300){const lote=p.ls.slice(i,i+300);const {data,error}=await sb.from('pp_lancamentos').upsert(lote,{onConflict:'origem,origem_ref'}).select('id');if(error){r.erros+=lote.length;r.det.push(msgErro(error));}else r.gravados+=data.length;}},
  async ml_vendas(p,r){for(const v of p.vs){try{const res=await rpc('pp_gravar_venda',{p_venda:{...v,itens:undefined,canal:'mercado_livre',empresa_id:p.conta.empresa_id,ml_conta_id:p.conta.id,origem:'ml'},p_itens:v.itens});if(res==='novo'||res==='atualizado')r.gravados++;else r.duplicados++;}catch(e){r.erros++;r.det.push('Pedido '+v.pedido+': '+msgErro(e));}}},
};

// ---------- configurações ----------
async function telaConfig(ab){
  const c=REF.config;const chk=(k,t)=>`<label style="display:block;margin:4px 0"><input type="checkbox" id="cfg_${k}" ${c[k]===true?'checked':''}> ${t}</label>`;
  $('conteudo').innerHTML=ab+`<div class="grade2"><div class="secao"><h2>Custos</h2>
   <div class="campo"><label>Rateio de frete e despesas extras entre os itens</label><select id="cfg_rateio_frete"><option value="valor" ${c.rateio_frete!=='quantidade'?'selected':''}>Proporcional ao valor do item</option><option value="quantidade" ${c.rateio_frete==='quantidade'?'selected':''}>Proporcional à quantidade</option></select></div>
   ${chk('custo_inclui_frete','Frete compõe o custo')}${chk('custo_inclui_seguro_outras','Seguro e outras despesas compõem o custo')}${chk('custo_inclui_ipi','IPI compõe o custo')}${chk('custo_inclui_st','ICMS-ST compõe o custo')}
   ${chk('tributos_validado_contabilidade','Tratamento dos tributos validado pela contabilidade')}
   <div class="mut peq">ICMS, PIS e COFINS destacados não entram no custo (créditos dependem do regime tributário — confirme com a contabilidade). Mudanças valem para os próximos recebimentos.</div></div>
   <div class="secao"><h2>Geral e alertas</h2><div class="campo"><label>Fuso horário</label><select id="cfg_fuso">${['America/Sao_Paulo','America/Cuiaba','America/Manaus','America/Fortaleza','America/Recife','America/Bahia','America/Rio_Branco','America/Noronha'].map(f=>`<option ${c.fuso===f?'selected':''}>${f}</option>`).join('')}</select></div>
   <div class="c3"><div class="campo"><label>Cobertura mínima (dias)</label><input id="cfg_cobertura_minima_dias" value="${c.cobertura_minima_dias??15}"></div><div class="campo"><label>Sem movimento (dias)</label><input id="cfg_sem_movimento_dias" value="${c.sem_movimento_dias??60}"></div><div class="campo"><label>Alerta de validade (dias)</label><input id="cfg_validade_alerta_dias" value="${c.validade_alerta_dias??45}"></div></div>
   <div class="campo" style="${ML_ATIVO?'':'display:none'}"><label>App ID do Mercado Livre (developers.mercadolivre.com.br)</label><input id="cfg_ml_app_id" value="${esc(c.ml_app_id||'')}"><div class="mut peq">URI de redirecionamento a cadastrar no app: <span class="mono">${EDGE}?acao=callback</span></div></div></div></div>
  <div class="rodape" style="justify-content:flex-start"><button class="pri" id="cfg_ok">Salvar configurações</button></div>
  <div class="grade2"><div class="secao"><h2>Empresas e unidades</h2>${tabela([{t:'Empresa',v:e=>e.nome},{t:'Razão social',v:e=>e.razao_social||''},{t:'CNPJ',v:e=>e.cnpj||'',h:e=>e.cnpj?esc(e.cnpj):'<span class="tag a">informar</span>'}],REF.empresas,{rolar:false,clique:e=>modalEmpresa(e)})}<button class="sm" onclick="modalEmpresa()">+ Empresa</button>
   <div class="mut peq" style="margin-top:6px">O CNPJ identifica automaticamente se uma NF é de entrada ou de saída.</div></div>
   <div class="secao"><h2>Locais de estoque</h2>${tabela([{t:'Local',v:l=>l.nome},{t:'Empresa',v:l=>empresa(l.empresa_id).nome},{t:'Tipo',v:l=>({loja:'Loja',deposito:'Depósito',full:'Full (CD do ML)',transito:'Em trânsito',espelho:'Espelho (não soma)'})[l.tipo]}],REF.locais,{rolar:false,clique:l=>modalLocal(l)})}<button class="sm" onclick="modalLocal()">+ Local</button></div></div>`;
  $('cfg_ok').onclick=async()=>{try{const rows=[['rateio_frete',val('cfg_rateio_frete')],['fuso',val('cfg_fuso')],['ml_app_id',val('cfg_ml_app_id')],...['custo_inclui_frete','custo_inclui_seguro_outras','custo_inclui_ipi','custo_inclui_st','tributos_validado_contabilidade'].map(k=>[k,$('cfg_'+k).checked]),
    ...['cobertura_minima_dias','sem_movimento_dias','validade_alerta_dias'].map(k=>[k,+val('cfg_'+k)||0])].map(([chave,valor])=>({chave,valor,atualizado_em:new Date().toISOString(),atualizado_por:sessao.user.id}));
    await q(sb.from('pp_config').upsert(rows));await carregarRef();toast('Configurações salvas.');}catch(e){toast(msgErro(e));}};
}
function modalEmpresa(e){e=e||{};abrir(`<h2>${e.id?'Editar':'Nova'} empresa</h2><div class="campo"><label>Nome</label><input id="em_n" value="${esc(e.nome||'')}"></div><div class="campo"><label>Razão social</label><input id="em_r" value="${esc(e.razao_social||'')}"></div><div class="campo"><label>CNPJ</label><input id="em_c" value="${esc(e.cnpj||'')}"></div>
  <div class="erro"></div><div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="em_ok">Salvar</button></div>`);
  $('em_ok').onclick=()=>rodar($('em_ok'),async()=>{const d={nome:val('em_n'),razao_social:val('em_r')||null,cnpj:val('em_c').replace(/\D/g,'')||null};if(d.cnpj&&d.cnpj.length!==14)throw new Error('CNPJ deve ter 14 dígitos.');
    if(e.id)await q(sb.from('pp_empresas').update(d).eq('id',e.id));else{const n=await q(sb.from('pp_empresas').insert(d).select().single());await q(sb.from('pp_unidades').insert({empresa_id:n.id,nome:d.nome}));}await carregarRef();fechar();ir('integracoes');});}
function modalLocal(l){l=l||{};abrir(`<h2>${l.id?'Editar':'Novo'} local</h2><div class="c2"><div class="campo"><label>Nome</label><input id="lo_n" value="${esc(l.nome||'')}"></div><div class="campo"><label>Unidade</label><select id="lo_u">${opcoes(REF.unidades,l.unidade_id,null,x=>x.id,x=>x.nome+' · '+empresa(x.empresa_id).nome)}</select></div></div>
  <div class="c2"><div class="campo"><label>Tipo</label><select id="lo_t">${[['loja','Loja'],['deposito','Depósito'],['full','Full (CD do ML)'],['transito','Em trânsito'],['espelho','Espelho — mesmas unidades de outro local (não soma)']].map(([k,n])=>`<option value="${k}" ${l.tipo===k?'selected':''}>${n}</option>`).join('')}</select></div>
  <div class="campo"><label>Conta ML (para Full)</label><select id="lo_ml">${opcoes(REF.contasML,l.ml_conta_id,'—',x=>x.id,x=>x.apelido)}</select></div></div>
  <div class="erro"></div><div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="lo_ok">Salvar</button></div>`);
  $('lo_ok').onclick=()=>rodar($('lo_ok'),async()=>{const u=REF.unidades.find(x=>x.id==val('lo_u'));const d={nome:val('lo_n'),unidade_id:u.id,empresa_id:u.empresa_id,tipo:val('lo_t'),ml_conta_id:val('lo_ml')?+val('lo_ml'):null};
    if(l.id)await q(sb.from('pp_locais').update(d).eq('id',l.id));else await q(sb.from('pp_locais').insert(d));await carregarRef();fechar();ir('integracoes');});}
async function telaUsuarios(ab){
  const ps=await q(sb.from('pp_perfis').select('*').order('criado_em'));
  $('conteudo').innerHTML=ab+`<div class="info">Quem cria acesso no site aparece aqui como pendente. As permissões valem no servidor e no banco de dados, não só na tela.
   <br><b>Financeiro</b>: vendas, custos, margens, caixa e contas. <b>Compras</b>: notas, custos, cadastro e recebimento (sem caixa). <b>Estoque</b>: cadastro, movimentações e recebimento — sem custos, valores de notas ou financeiro. <b>Operação</b>: vendas e estoque, sem custos e sem financeiro.</div>
  <div class="secao">${tabela([{t:'Nome',v:p=>p.nome||''},{t:'E-mail',v:p=>p.email},{t:'Perfil',v:p=>p.papel||'',h:p=>p.user_id===sessao.user.id?'<b>'+PAPEIS[p.papel]+'</b>':`<select data-u="${p.user_id}" class="pu" style="width:auto"><option value="">Pendente / sem acesso</option>${Object.entries(PAPEIS).map(([k,v])=>`<option value="${k}" ${p.papel===k?'selected':''}>${v}</option>`).join('')}</select>`},
    {t:'Ativo',v:p=>p.ativo,h:p=>p.user_id===sessao.user.id?'Sim':`<input type="checkbox" class="pa" data-u="${p.user_id}" ${p.ativo?'checked':''}>`},{t:'Criado',v:p=>fdh(p.criado_em)},{t:'Último acesso',v:p=>fdh(p.ultimo_acesso)}],ps,{rolar:false})}</div>`;
  document.querySelectorAll('.pu').forEach(s=>s.onchange=async()=>{try{await q(sb.from('pp_perfis').update({papel:s.value||null}).eq('user_id',s.dataset.u));toast('Perfil atualizado.');}catch(e){toast(msgErro(e));}});
  document.querySelectorAll('.pa').forEach(s=>s.onchange=async()=>{try{await q(sb.from('pp_perfis').update({ativo:s.checked}).eq('user_id',s.dataset.u));toast(s.checked?'Acesso ativado.':'Acesso bloqueado.');}catch(e){toast(msgErro(e));}});
}
const TABELAS_BACKUP=['pp_perfis','pp_empresas','pp_unidades','pp_locais','pp_config','pp_produtos','pp_kit_itens','pp_codigos','pp_ml_contas','pp_ml_anuncios','pp_notas','pp_nota_itens','pp_anexos','pp_recebimentos','pp_receb_itens',
  'pp_mov','pp_mov_custo','pp_saldos_externos','pp_vendas','pp_venda_itens','pp_venda_itens_custo','pp_contas_fin','pp_lancamentos','pp_pendencias','pp_pendencia_hist','pp_sync_log','pp_auditoria'];
async function telaBackup(ab){
  const au=await q(sb.from('pp_auditoria').select('*').order('id',{ascending:false}).limit(300));
  $('conteudo').innerHTML=ab+`<div class="secao"><h2>Backup</h2><div class="mut">1) Automático: o banco fica no plano Pro do Supabase, com cópia diária mantida por 7 dias (Supabase → Database → Backups).<br>2) Manual: baixe aqui uma cópia completa (JSON) de todas as tabelas do Gestão Pet Puppy. Guarde no Drive com a data no nome. Arquivos (XML, PDF, comprovantes) ficam no Storage, pasta pp-docs.<br>
  3) Recuperação: para voltar o banco inteiro, use a restauração do Supabase (Database → Backups → Restore). Para recuperar registros específicos, envie o JSON e o procedimento do arquivo RECUPERACAO.md do projeto.</div>
  <div class="rodape" style="justify-content:flex-start"><button class="pri" id="bk_ok">Baixar backup completo agora</button></div></div>
  <div class="secao"><h2>Auditoria <small>últimas 300 alterações importantes</small></h2>${tabela([{t:'Quando',v:a=>fdh(a.em)},{t:'Quem',v:a=>nomeUsuario(a.usuario)||a.usuario||'sistema'},{t:'Tabela',v:a=>a.tabela},{t:'Operação',v:a=>a.operacao},{t:'Registro',v:a=>a.registro||''}],au,{clique:a=>detalhar('Alteração #'+a.id,'',[{t:'Campo',v:x=>x.k},{t:'Antes',v:x=>x.a},{t:'Depois',v:x=>x.d}],Object.keys({...(a.antes||{}),...(a.depois||{})}).filter(k=>JSON.stringify((a.antes||{})[k])!==JSON.stringify((a.depois||{})[k])).map(k=>({k,a:JSON.stringify((a.antes||{})[k]??''),d:JSON.stringify((a.depois||{})[k]??'')})))})}</div>`;
  $('bk_ok').onclick=async()=>{const b=$('bk_ok');b.disabled=true;b.textContent='Gerando…';try{const out={gerado_em:new Date().toISOString(),por:perfil.email,tabelas:{}};for(const t of TABELAS_BACKUP){out.tabelas[t]=await tudo(()=>sb.from(t).select('*'));}
    baixarArquivo(`backup-gestaopetpuppy-${hojeISO()}.json`,JSON.stringify(out),'application/json');toast('Backup gerado.');}catch(e){toast(msgErro(e));}b.disabled=false;b.textContent='Baixar backup completo agora';};
}

// ---------- CONCILIAÇÃO E PENDÊNCIAS ----------
const TIPOS_PEND_={venda_sem_nota:'Venda sem nota',nota_sem_mov:'Nota sem movimentação',receb_divergente:'Recebimento diferente do previsto',venda_sem_custo:'Vendido sem custo',sem_vinculo:'Item sem vínculo de SKU',qtd_divergente:'Diferença de quantidade',duplicidade:'Possível duplicidade',cancel_nao_conciliado:'Cancelamento/devolução não conciliado',unidade_divergente:'Unidade de medida divergente',produto_duplicado:'Produto duplicado',custo_revisado:'Custo de venda antiga mudaria',outro:'Outro'};
const TIPOS_PEND=TIPOS_PEND_;let filtroPend={status:'abertas',tipo:''};
TELAS.conciliacao=async function(){
  const ps=await tudo(()=>sb.from('pp_pendencias').select('*').order('id',{ascending:false}));
  const l=ps.filter(p=>(filtroPend.status==='todas'||(filtroPend.status==='abertas'?['aberta','em_analise'].includes(p.status):p.status===filtroPend.status))&&(!filtroPend.tipo||p.tipo===filtroPend.tipo));
  const cont=agrupar(ps.filter(p=>['aberta','em_analise'].includes(p.status)),p=>p.tipo);
  $('conteudo').innerHTML=`<div class="barra-acoes"><button class="pri" id="gp">Atualizar divergências</button><span class="mut peq" style="align-self:center">Cruza vendas, pedidos, notas, recebimentos e estoque. Rodar de novo não duplica pendências.</span></div>
  <div class="kpis">${Object.entries(TIPOS_PEND).filter(([k])=>cont[k]).map(([k,n])=>`<div class="kpi ${filtroPend.tipo===k?'alerta':''}" onclick="filtroPend.tipo=filtroPend.tipo==='${k}'?'':'${k}';ir('conciliacao')"><div class="l">${n}</div><div class="v">${nf(cont[k].length)}</div><div class="s">${brl(soma(cont[k],p=>Math.abs(+p.valor||0)))}</div></div>`).join('')||'<div class="mut">Nenhuma pendência aberta.</div>'}</div>
  <div class="filtros"><div><label>Status</label><select onchange="filtroPend.status=this.value;ir('conciliacao')">${opcoes([{id:'abertas',nome:'Abertas e em análise'},{id:'resolvida',nome:'Resolvidas'},{id:'ignorada',nome:'Ignoradas'},{id:'todas',nome:'Todas'}],filtroPend.status,null)}</select></div>
   <div><label>Tipo</label><select onchange="filtroPend.tipo=this.value;ir('conciliacao')">${opcoes(Object.entries(TIPOS_PEND).map(([id,nome])=>({id,nome})),filtroPend.tipo,'Todos')}</select></div></div>
  <div class="secao">${tabela([{t:'Aberta em',v:p=>fdh(p.criado_em)},{t:'Tipo',v:p=>TIPOS_PEND[p.tipo]||p.tipo},{t:'Descrição',v:p=>p.descricao},{t:'Valor',v:p=>p.valor==null?null:+p.valor,n:1},{t:'Responsável',v:p=>nomeUsuario(p.responsavel)||''},
    {t:'Status',v:p=>p.status,h:p=>`<span class="tag ${p.status==='resolvida'?'v':p.status==='aberta'?'a':''}">${p.status.replace('_',' ')}</span>`}],l,{clique:abrirPendencia})}</div>`;
  $('gp').onclick=async()=>{$('gp').disabled=true;try{const n=await rpc('pp_gerar_pendencias');toast(`Divergências atualizadas (${n} verificadas).`);}catch(e){toast(msgErro(e));}ir('conciliacao');};
};
async function abrirPendencia(p){
  const h=await q(sb.from('pp_pendencia_hist').select('*').eq('pendencia_id',p.id).order('em'));
  const ver={venda:()=>sb.from('pp_vendas').select('*,pp_venda_itens(*'+(veCusto()?',pp_venda_itens_custo(*)':'')+')').eq('id',p.entidade_id).single().then(r=>r.data&&abrirVenda(r.data)),nota:()=>abrirNota(+p.entidade_id),produto:()=>abrirProduto(p.entidade_id),lancamento:()=>sb.from('pp_lancamentos').select('*').eq('id',p.entidade_id).single().then(r=>r.data&&modalLancamento(r.data)),
    venda_item:()=>sb.from('pp_venda_itens').select('venda_id').eq('id',p.entidade_id).single().then(r=>r.data&&sb.from('pp_vendas').select('*,pp_venda_itens(*'+(veCusto()?',pp_venda_itens_custo(*)':'')+')').eq('id',r.data.venda_id).single().then(x=>x.data&&abrirVenda(x.data))),
    nota_item:()=>sb.from('pp_nota_itens').select('nota_id').eq('id',p.entidade_id).single().then(r=>r.data&&abrirNota(r.data.nota_id))};
  const usuarios=master()?REF.perfis.filter(x=>x.papel&&x.ativo):[perfil];
  abrir(`<h2>${esc(TIPOS_PEND[p.tipo]||p.tipo)}</h2><div class="sub">#${p.id} · aberta em ${fdh(p.criado_em)}</div><p>${esc(p.descricao)}</p>${p.valor!=null?`<p>Valor envolvido: <b>${brl(p.valor)}</b></p>`:''}
  ${ver[p.entidade]?`<button class="sm" id="pd_ver">Abrir registro relacionado</button>`:''}${p.tipo==='sem_vinculo'?' <button class="sm" onclick="abaProd=\'vinculos\';fechar();ir(\'produtos\')">Ir para vínculos</button>':''}
  <div class="c2" style="margin-top:10px"><div class="campo"><label>Responsável</label><select id="pd_r">${opcoes(usuarios,p.responsavel,'—',x=>x.user_id,x=>x.nome||x.email)}</select></div>
  <div class="campo"><label>Status</label><select id="pd_s">${['aberta','em_analise','resolvida','ignorada'].map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${s.replace('_',' ')}</option>`).join('')}</select></div></div>
  <div class="campo"><label>Observação</label><textarea id="pd_o">${esc(p.obs||'')}</textarea></div>
  <h3 style="font-size:13px">Histórico de resolução</h3>${tabela([{t:'Quando',v:x=>fdh(x.em)},{t:'Quem',v:x=>nomeUsuario(x.usuario)},{t:'Status',v:x=>x.status},{t:'Obs.',v:x=>x.obs||''}],h,{rolar:false,vazio:'Sem histórico.'})}
  <div class="erro"></div><div class="rodape"><button onclick="fechar()">Fechar</button><button class="pri" id="pd_ok">Salvar</button></div>`);
  if($('pd_ver'))$('pd_ver').onclick=()=>ver[p.entidade]();
  $('pd_ok').onclick=()=>rodar($('pd_ok'),async()=>{const s=val('pd_s');await q(sb.from('pp_pendencias').update({responsavel:val('pd_r')||null,status:s,obs:val('pd_o')||null,resolvido_em:['resolvida','ignorada'].includes(s)?new Date().toISOString():null}).eq('id',p.id));
    await q(sb.from('pp_pendencia_hist').insert({pendencia_id:p.id,status:s,obs:val('pd_o')||null}));fechar();toast('Pendência atualizada.');if(area==='conciliacao')ir('conciliacao');});
}

// ---------- Sincronização com o SimplesVet (recebe dados da aba do SimplesVet) ----------
const SV_ORIGEM='https://app.simples.vet';
let svRodando=false;
window.addEventListener('message',e=>{
  if(e.origin!==SV_ORIGEM||!e.data)return;
  if(e.data.tipo==='pp-ping'){if(perfil&&perfil.papel&&tem('financeiro'))e.source.postMessage({tipo:'pp-pronto'},SV_ORIGEM);return;}
  if(e.data.tipo==='pp-dados'&&!svRodando)sincronizarSV(e.data,e.source);
});
function svProgresso(t,pct){const el=$('sv_prog');if(el)el.innerHTML=`<div style="font-weight:600;margin-bottom:6px">${esc(t)}</div><div style="height:10px;background:#f1ead2;border-radius:99px;overflow:hidden"><div style="height:100%;width:${Math.round(pct||0)}%;background:#FFCC00"></div></div>`;}
async function sincronizarSV(d,fonte){
  svRodando=true;
  const loc=(REF.locais.find(l=>l.tipo==='loja')||REF.locais[0]||{}).id;
  abrir(`<h2>Sincronizando com o SimplesVet</h2><div class="sub">${nf(d.vendas.length)} vendas e ${nf(d.produtos.length)} produtos recebidos. Não feche esta janela.</div><div id="sv_prog"></div><div id="sv_res" style="margin-top:12px"></div>`);
  const log=await q(sb.from('pp_sync_log').insert({fonte:'simplesvet',tipo:'produtos,vendas,estoque',conta:'Loja',status:'rodando',lidos:d.vendas.length+d.produtos.length}).select().single()).catch(()=>null);
  const R={prodNovos:0,prodExist:0,saldosIni:0,vNovas:0,vAtual:0,vIguais:0,ajustes:0,erros:[]};
  const tot=d.produtos.length+d.vendas.length+d.produtos.length;let feito=0;
  const lote=async(arr,n,fn,rot)=>{for(let i=0;i<arr.length;i+=n){const pedaco=arr.slice(i,i+n);
      try{await fn(pedaco);}catch(e){R.erros.push(rot+' '+(i+1)+'–'+(i+pedaco.length)+': '+msgErro(e));}
      feito+=pedaco.length;svProgresso(rot+' ('+nf(Math.min(i+n,arr.length))+' de '+nf(arr.length)+')',feito/tot*100);}};
  try{
    await lote(d.produtos,120,async p=>{const r=await rpc('pp_sv_produtos',{p,p_local:loc,p_inicio:d.inicio});R.prodNovos+=r.novos;R.prodExist+=r.existentes;R.saldosIni+=r.saldos_iniciais;},'Produtos');
    await lote(d.vendas,60,async v=>{const r=await rpc('pp_sv_vendas',{v,p_local:loc});R.vNovas+=r.novas;R.vAtual+=r.atualizadas;R.vIguais+=r.sem_alteracao;},'Vendas');
    const ref=new Date().toISOString().slice(0,16);
    await lote(d.produtos.map(p=>({codigo:p.id,estoque:p.estoque})),250,async a=>{R.ajustes+=await rpc('pp_sv_ajustar',{a,p_local:loc,p_ref:ref});},'Conferindo estoque');
    try{await rpc('pp_gerar_pendencias');}catch(e){}
  }catch(e){R.erros.push(msgErro(e));}
  const texto=`Sincronização concluída: ${nf(R.vNovas)} vendas novas, ${nf(R.vAtual)} atualizadas, ${nf(R.vIguais)} sem alteração · ${nf(R.prodNovos)} produtos novos · ${nf(R.ajustes)} ajustes de estoque${R.erros.length?' · '+R.erros.length+' erros':''}.`;
  if(log)await sb.from('pp_sync_log').update({status:R.erros.length?(R.vNovas+R.vAtual+R.vIguais?'parcial':'erro'):'ok',terminado_em:new Date().toISOString(),gravados:R.vNovas+R.vAtual+R.prodNovos+R.ajustes,duplicados:R.vIguais+R.prodExist,erros:R.erros.length,mensagem:texto,detalhes:R.erros}).eq('id',log.id);
  svProgresso('Concluído',100);
  $('sv_res').innerHTML=`<div class="${R.erros.length?'aviso':'info'}">${esc(texto)}${R.erros.length?'<br>'+R.erros.slice(0,5).map(esc).join('<br>'):''}</div>
   <div class="mut peq">O estoque da loja passa a seguir o SimplesVet: vendas viram saídas e as demais diferenças (compras, perdas) entram como ajuste. Custos vindos do SimplesVet ficam marcados como "sem nota" até a nota fiscal ser lançada.</div>
   <div class="rodape"><button class="pri" onclick="fechar();carregarRef().then(()=>ir('visao'))">Ver painel</button></div>`;
  try{fonte.postMessage({tipo:'pp-fim',texto},SV_ORIGEM);}catch(e){}
  svRodando=false;
}
async function linkSincronizadorSV(){try{const t=await (await fetch('sv-sync.js?'+Date.now())).text();return 'javascript:'+encodeURIComponent(t.replace(/^\s*\/\/.*$/gm,''));}catch(e){return '#';}}
