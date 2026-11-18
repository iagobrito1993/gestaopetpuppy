// =====================================================================
// Financeiro: contas, lançamentos, liquidez, fluxo realizado e projeções
// =====================================================================
const NATUREZAS={venda:'Receita de venda',fornecedor:'Fornecedor (mercadoria)',despesa_fixa:'Despesa fixa',despesa_variavel:'Despesa variável',imposto:'Imposto',folha:'Folha/pró-labore',tarifa:'Tarifa bancária/cartão',
  aporte_socio:'Aporte de sócio',emprestimo_recebido:'Empréstimo recebido',emprestimo_pago:'Pagamento de empréstimo',retirada_socio:'Retirada de sócio',transferencia_interna:'Transferência interna',outro:'Outro'};
const NAO_OPERACIONAL=['aporte_socio','emprestimo_recebido','emprestimo_pago','retirada_socio','transferencia_interna'];
const COLS_LANC=[{t:'Vencimento',v:l=>fd(l.vencimento)},{t:'Tipo',v:l=>l.tipo==='pagar'?'A pagar':l.tipo==='receber'?'A receber':'Transferência'},{t:'Natureza',v:l=>NATUREZAS[l.natureza]},{t:'Descrição',v:l=>l.descricao},{t:'Empresa',v:l=>empresa(l.empresa_id).nome},
  {t:'Valor',v:l=>+l.valor,n:1,tot:1},{t:'Status',v:l=>l.status,h:l=>`<span class="tag ${l.status==='pago'?'v':l.status==='cancelado'?'':vencido(l)?'r':'a'}">${vencido(l)?'vencido':l.status}</span>${l.retido?' <span class="tag a">retido</span>':''}`},
  {t:'Pago em',v:l=>fd(l.data_pagamento)},{t:'Conta',v:l=>(REF.contasFin.find(c=>c.id===l.conta_id)||{}).nome||''}];
function vencido(l){return (l.status==='aberto'||l.status==='parcial')&&l.vencimento&&l.vencimento<hojeISO();}
function emAberto(l){return l.status==='aberto'||l.status==='parcial';}
function restante(l){return l.status==='parcial'?l.valor-(l.valor_pago||0):+l.valor;}

async function dadosFinanceiros(){
  const [lancs,vml,ml]=await Promise.all([tudo(()=>sb.from('pp_lancamentos').select('*').neq('status','cancelado')),
    tudo(()=>sb.from('pp_vendas').select('id,ml_conta_id,empresa_id,status,valor_bruto,valor_cancelado,valor_devolvido,desconto,tarifa_venda,frete_vendedor,valor_liquido_previsto,data_pagamento,data_liberacao,liberado,duplicada_de,pedido').eq('canal','mercado_livre').gte('data_venda',tsIni(addDias(hojeISO(),-180)))),
    q(sb.from('pp_ml_contas').select('*'))]);
  return {lancs,vml:vml.filter(v=>!v.duplicada_de&&(v.status==='concluida'||v.status==='devolvida_parcial')),ml};
}
function liquidoML(v){return v.valor_liquido_previsto!=null?+v.valor_liquido_previsto:v.valor_bruto-v.valor_devolvido-v.desconto-v.tarifa_venda-v.frete_vendedor;}
function saldoConta(c,lancs){
  if(c.saldo_inicial==null)return null;
  let s=+c.saldo_inicial;const d0=c.data_saldo_inicial||'0000-01-01';
  lancs.forEach(l=>{if(!l.data_pagamento||l.data_pagamento<d0||(l.status!=='pago'&&l.status!=='parcial'))return;const v=+(l.valor_pago??l.valor);
    if(l.tipo==='receber'&&l.conta_id===c.id)s+=v;if(l.tipo==='pagar'&&l.conta_id===c.id)s-=v;
    if(l.tipo==='transferencia'){if(l.conta_id===c.id)s-=v;if(l.conta_destino_id===c.id)s+=v;}});
  return s;
}
async function resumoFinanceiro(){
  const D=await dadosFinanceiros();const hoje=hojeISO();
  const empOk=x=>!F.empresa||x.empresa_id==F.empresa;
  const contas=REF.contasFin.filter(c=>c.ativa&&empOk(c));
  const incompleto=[];let incompletoSaldo=false;
  let disponivel=0;const linhasContas=contas.map(c=>{const mlc=c.ml_conta_id&&D.ml.find(m=>m.id===c.ml_conta_id);
    let s,fonte;if(mlc&&mlc.saldo_disponivel!=null){s=+mlc.saldo_disponivel;fonte='Mercado Pago (API) em '+fdh(mlc.saldo_em);}else{s=saldoConta(c,D.lancs);fonte=s==null?'saldo inicial não informado':'saldo inicial '+fd(c.data_saldo_inicial)+' + movimentos';}
    if(s==null)incompletoSaldo=true;else disponivel+=s;return {c,s,fonte};});
  // contas ML sem conta financeira vinculada: usa saldo da API
  D.ml.filter(m=>m.saldo_disponivel!=null&&!REF.contasFin.some(c=>c.ml_conta_id===m.id)&&(!F.empresa||m.empresa_id==F.empresa)).forEach(m=>{disponivel+=+m.saldo_disponivel;linhasContas.push({c:{nome:'Mercado Pago · '+m.apelido},s:+m.saldo_disponivel,fonte:'API em '+fdh(m.saldo_em)});});
  if(!contas.length)incompleto.push('nenhuma conta bancária/caixa cadastrada');
  if(incompletoSaldo)incompleto.push('há conta sem saldo inicial');
  const lancs=D.lancs.filter(empOk);
  const aLiberar=D.vml.filter(v=>empOk(v)&&v.liberado!==true&&!(v.data_liberacao&&v.data_liberacao<=hoje&&v.liberado==null));
  const semDataLib=aLiberar.filter(v=>!v.data_liberacao);
  if(semDataLib.length)incompleto.push(`${semDataLib.length} vendas do ML sem data de liberação`);
  const lancVenda=new Set(lancs.filter(l=>l.venda_id).map(l=>l.venda_id));
  const mlFut=aLiberar.filter(v=>!lancVenda.has(v.id));
  const mlALiberar=soma(mlFut,liquidoML);
  const receber=lancs.filter(l=>l.tipo==='receber'&&emAberto(l));
  const receberAberto=soma(receber.filter(l=>!l.retido),restante);
  const pagar=lancs.filter(l=>l.tipo==='pagar'&&emAberto(l));
  if(!pagar.length)incompleto.push('nenhuma conta a pagar em aberto cadastrada');
  if(pagar.some(l=>!l.vencimento)||receber.some(l=>!l.vencimento))incompleto.push('há lançamentos sem vencimento');
  const retido=soma(receber.filter(l=>l.retido),restante)+soma(D.ml.filter(m=>empOk(m)),m=>+m.saldo_bloqueado||0);
  const listaVencidas=pagar.filter(vencido),lista7=pagar.filter(l=>l.vencimento>=hoje&&l.vencimento<=addDias(hoje,7));
  const proj={};[7,15,30,60,90].forEach(d=>{const lim=addDias(hoje,d);
    const ent=soma(receber.filter(l=>!l.retido&&l.vencimento&&l.vencimento<=lim),restante)+soma(mlFut.filter(v=>v.data_liberacao&&v.data_liberacao<=lim),liquidoML);
    const sai=soma(pagar.filter(l=>l.vencimento&&l.vencimento<=lim),restante);
    const fixas=lancs.filter(l=>l.tipo==='pagar'&&l.natureza==='despesa_fixa'&&l.vencimento>lim);
    const inc=incompletoSaldo||!contas.length||semDataLib.length>0||(d>=30&&!lancs.some(l=>l.natureza==='despesa_fixa'&&l.vencimento>addDias(hoje,d-31)));
    proj[d]={entradas:ent,saidas:sai,saldo:disponivel+ent-sai,incompleto:inc};});
  const vence7=soma(lista7,restante),vencido_=soma(listaVencidas,restante);
  const cobre=disponivel+mlALiberar-vence7-vencido_;
  const leitura=`Leitura: com ${brl(disponivel)} disponíveis e ${brl(vence7+vencido_)} vencendo até 7 dias (inclui vencidas), ${cobre>=0?'o caixa cobre as obrigações imediatas':'o caixa NÃO cobre as obrigações imediatas'}${mlALiberar?' considerando '+brl(mlALiberar)+' a liberar no ML':''}. Projeção 30 dias: ${brl(proj[30].saldo)}${proj[30].incompleto?' (incompleta)':''}.`;
  return {disponivel,aReceber:mlALiberar+receberAberto,mlALiberar,receberAberto,retido,vence7,vencido:vencido_,lista7,listaVencidas,proj,incompleto,incompletoSaldo,linhasContas,D,lancs,mlFut,receber,pagar,leitura};
}
function detalharAReceber(){const f=window._fin;detalhar('A receber','Vendas do ML ainda não liberadas (pela data de liberação do Mercado Pago) e contas a receber em aberto.',
  [{t:'Origem',v:x=>x.pedido?'Venda ML':'Lançamento'},{t:'Referência',v:x=>x.pedido||x.descricao},{t:'Previsão',v:x=>fd(x.data_liberacao||x.vencimento)},{t:'Valor',v:x=>x.pedido?liquidoML(x):restante(x),n:1,tot:1},{t:'Retido',v:x=>x.retido?'Sim':''}],[...f.mlFut,...f.receber]);}
function detalharVencimentos(d){const f=window._fin;detalhar(d?'Contas a pagar nos próximos 7 dias':'Contas vencidas','',COLS_LANC,d?f.lista7:f.listaVencidas,{clique:l=>modalLancamento(l)});}

let abaFin='visao',filtroLanc={tipo:'',status:'aberto',natureza:''};
TELAS.financeiro=async function(){
  const f=await resumoFinanceiro();window._fin=f;
  const ab=`<div class="abas2">${[['visao','Liquidez e projeções'],['lanc','Contas a pagar e receber'],['fluxo','Fluxo realizado'],['contas','Contas bancárias e caixa']].map(([i,n])=>`<button class="${abaFin===i?'on':''}" onclick="abaFin='${i}';ir('financeiro')">${n}</button>`).join('')}
   <button class="pri" onclick="modalLancamento()">+ Lançamento</button></div>`;
  const filt=barraFiltros(['empresa'],()=>ir('financeiro'));
  if(abaFin==='visao'){
    $('conteudo').innerHTML=filt+ab+(f.incompleto.length?`<div class="aviso">Projeções incompletas: ${f.incompleto.join('; ')}.</div>`:'')+
    `<div class="kpis"><div class="kpi" onclick="abaFin='contas';ir('financeiro')"><div class="l">Disponível</div><div class="v">${brl(f.disponivel)}</div></div>
     <div class="kpi" onclick="detalharAReceber()"><div class="l">A receber</div><div class="v">${brl(f.aReceber)}</div><div class="s">ML a liberar ${brl(f.mlALiberar)}</div></div>
     <div class="kpi"><div class="l">Retido/bloqueado</div><div class="v">${brl(f.retido)}</div></div>
     <div class="kpi ${f.vencido?'ruim':''}" onclick="detalharVencimentos(0)"><div class="l">Vencidas</div><div class="v">${brl(f.vencido)}</div></div>
     <div class="kpi" onclick="detalharVencimentos(7)"><div class="l">A pagar em 7 dias</div><div class="v">${brl(f.vence7)}</div></div></div>
    <div class="secao"><h2>Projeção de caixa</h2>${tabela([{t:'Horizonte',v:x=>x.d+' dias'},{t:'Até',v:x=>fd(addDias(hojeISO(),x.d))},{t:'Saldo hoje',v:()=>f.disponivel,n:1},{t:'(+) Entradas previstas',v:x=>x.entradas,n:1},{t:'(−) Saídas previstas',v:x=>x.saidas,n:1},{t:'Saldo projetado',v:x=>x.saldo,n:1,h:x=>`<b style="color:${x.saldo<0?'var(--red)':''}">${brl(x.saldo)}</b>`},{t:'',v:x=>x.incompleto?'incompleta':'',h:x=>x.incompleto?'<span class="tag a">incompleta</span>':'<span class="tag v">completa</span>'}],
      [7,15,30,60,90].map(d=>({d,...f.proj[d]})),{rolar:false})}<div class="mut peq">${f.leitura} Saídas incluem contas já vencidas. Entradas do ML usam a data de liberação informada pelo Mercado Pago.</div></div>
    <div class="grade2"><div class="secao"><h2>Saldos por conta</h2>${tabela([{t:'Conta',v:x=>x.c.nome},{t:'Saldo',v:x=>x.s,n:1,tot:1,h:x=>x.s==null?'<span class="tag a">sem saldo inicial</span>':brl(x.s)},{t:'Fonte',v:x=>x.fonte}],f.linhasContas,{rolar:false})}</div>
     ${ML_ATIVO?'':'<!--'}<div class="secao"><h2>Mercado Pago (contas ML)</h2>${tabela([{t:'Conta',v:m=>m.apelido},{t:'Disponível',v:m=>m.saldo_disponivel==null?null:+m.saldo_disponivel,n:1},{t:'A liberar',v:m=>m.saldo_a_liberar==null?null:+m.saldo_a_liberar,n:1},{t:'Bloqueado',v:m=>m.saldo_bloqueado==null?null:+m.saldo_bloqueado,n:1},{t:'Atualizado',v:m=>fdh(m.saldo_em)}],f.D.ml,{rolar:false})}</div>${ML_ATIVO?'':'-->'}</div>`;
    return;
  }
  if(abaFin==='lanc'){
    const l=f.D.lancs.concat(filtroLanc.status==='cancelado'||filtroLanc.status==='todos'?await q(sb.from('pp_lancamentos').select('*').eq('status','cancelado')):[])
      .filter(x=>(!F.empresa||x.empresa_id==F.empresa)&&(!filtroLanc.tipo||x.tipo===filtroLanc.tipo)&&(!filtroLanc.natureza||x.natureza===filtroLanc.natureza)
      &&(filtroLanc.status==='todos'||(filtroLanc.status==='aberto'?emAberto(x):filtroLanc.status==='vencido'?vencido(x):x.status===filtroLanc.status)))
      .sort((a,b)=>(a.vencimento||'9').localeCompare(b.vencimento||'9'));
    $('conteudo').innerHTML=filt+ab+`<div class="filtros"><div><label>Tipo</label><select onchange="filtroLanc.tipo=this.value;ir('financeiro')">${opcoes([{id:'pagar',nome:'A pagar'},{id:'receber',nome:'A receber'},{id:'transferencia',nome:'Transferência'}],filtroLanc.tipo,'Todos')}</select></div>
     <div><label>Status</label><select onchange="filtroLanc.status=this.value;ir('financeiro')">${opcoes([{id:'aberto',nome:'Em aberto'},{id:'vencido',nome:'Vencidos'},{id:'pago',nome:'Pagos/recebidos'},{id:'cancelado',nome:'Cancelados'},{id:'todos',nome:'Todos'}],filtroLanc.status,null)}</select></div>
     <div><label>Natureza</label><select onchange="filtroLanc.natureza=this.value;ir('financeiro')">${opcoes(Object.entries(NATUREZAS).map(([id,nome])=>({id,nome})),filtroLanc.natureza,'Todas')}</select></div></div>
     <div class="secao">${tabela(window._cl=COLS_LANC,window._ll=l,{clique:x=>modalLancamento(x)})}<button class="sm" onclick="exportarTabela('lancamentos',window._cl,window._ll)">Exportar CSV</button></div>`;
    return;
  }
  if(abaFin==='fluxo'){
    const pagos=f.D.lancs.filter(l=>(l.status==='pago'||l.status==='parcial')&&l.data_pagamento&&(!F.empresa||l.empresa_id==F.empresa));
    const lib=f.D.vml.filter(v=>v.liberado===true&&v.data_liberacao&&(!F.empresa||v.empresa_id==F.empresa)&&!pagos.some(l=>l.venda_id===v.id));
    const meses=[...new Set([...pagos.map(l=>l.data_pagamento.slice(0,7)),...lib.map(v=>v.data_liberacao.slice(0,7))])].sort().reverse();
    const lin=meses.map(ym=>{const P=pagos.filter(l=>l.data_pagamento.slice(0,7)===ym),V=lib.filter(v=>v.data_liberacao.slice(0,7)===ym);const s=(fn)=>soma(P.filter(fn),l=>+(l.valor_pago??l.valor));
      return {ym,vendas:s(l=>l.tipo==='receber'&&l.natureza==='venda')+soma(V,liquidoML),outrasRec:s(l=>l.tipo==='receber'&&!['venda',...NAO_OPERACIONAL].includes(l.natureza)),
        forn:s(l=>l.tipo==='pagar'&&l.natureza==='fornecedor'),fixas:s(l=>l.tipo==='pagar'&&l.natureza==='despesa_fixa'),variaveis:s(l=>l.tipo==='pagar'&&['despesa_variavel','imposto','folha','tarifa','outro'].includes(l.natureza)),
        aportes:s(l=>l.natureza==='aporte_socio'),emprest:s(l=>l.natureza==='emprestimo_recebido')-s(l=>l.natureza==='emprestimo_pago'),retiradas:s(l=>l.natureza==='retirada_socio'),transf:s(l=>l.natureza==='transferencia_interna')};});
    lin.forEach(x=>{x.operacional=x.vendas+x.outrasRec-x.forn-x.fixas-x.variaveis;x.total=x.operacional+x.aportes+x.emprest-x.retiradas;});
    $('conteudo').innerHTML=filt+ab+`<div class="info">Caixa realizado pela data do pagamento/liberação. Aportes de sócios, empréstimos, retiradas e transferências internas ficam separados das receitas de vendas.</div>
    <div class="secao">${tabela([{t:'Mês',v:x=>mesNome(x.ym)},{t:'Vendas recebidas',v:x=>x.vendas,n:1,tot:1},{t:'Outras receitas',v:x=>x.outrasRec,n:1,tot:1},{t:'Fornecedores',v:x=>x.forn,n:1,tot:1},{t:'Despesas fixas',v:x=>x.fixas,n:1,tot:1},{t:'Variáveis/impostos/folha',v:x=>x.variaveis,n:1,tot:1},
      {t:'= Geração operacional',v:x=>x.operacional,n:1,tot:1,h:x=>`<b style="color:${x.operacional<0?'var(--red)':''}">${brl(x.operacional)}</b>`},{t:'Aportes',v:x=>x.aportes,n:1,tot:1},{t:'Empréstimos (líq.)',v:x=>x.emprest,n:1,tot:1},{t:'Retiradas',v:x=>x.retiradas,n:1,tot:1},{t:'Transf. internas',v:x=>x.transf,n:1,tot:1},{t:'Variação de caixa',v:x=>x.total,n:1,tot:1}],lin,{rolar:false})}</div>`;
    return;
  }
  $('conteudo').innerHTML=filt+ab+`<div class="barra-acoes"><button onclick="modalContaFin()">+ Conta bancária/caixa</button></div><div class="secao">${tabela([{t:'Conta',v:x=>x.c.nome},{t:'Tipo',v:x=>x.c.tipo||''},{t:'Empresa',v:x=>empresa(x.c.empresa_id).nome},{t:'Saldo inicial',v:x=>x.c.saldo_inicial==null?null:+x.c.saldo_inicial,n:1},{t:'Data saldo inicial',v:x=>fd(x.c.data_saldo_inicial)},{t:'Saldo atual',v:x=>x.s,n:1,tot:1},{t:'Fonte',v:x=>x.fonte}],f.linhasContas,{clique:x=>x.c.id&&modalContaFin(x.c)})}</div>`;
};
function modalContaFin(c){
  const e=c||{};
  abrir(`<h2>${c?'Editar':'Nova'} conta</h2><div class="c2"><div class="campo"><label>Nome</label><input id="cf_n" value="${esc(e.nome||'')}" placeholder="Itaú PJ, Caixa loja, Mercado Pago Pet…"></div><div class="campo"><label>Tipo</label><select id="cf_t">${['banco','caixa','mercado_pago','cartao','outro'].map(t=>`<option ${e.tipo===t?'selected':''}>${t}</option>`).join('')}</select></div></div>
  <div class="c3"><div class="campo"><label>Empresa</label><select id="cf_e">${opcoes(REF.empresas,e.empresa_id,null)}</select></div><div class="campo"><label>Saldo inicial</label><input id="cf_s" value="${e.saldo_inicial??''}" inputmode="decimal"></div><div class="campo"><label>Data do saldo inicial</label><input id="cf_d" type="date" value="${e.data_saldo_inicial||hojeISO()}"></div></div>
  <div class="campo"><label>Conta Mercado Livre ligada (usa o saldo da API)</label><select id="cf_ml">${opcoes(REF.contasML,e.ml_conta_id,'Nenhuma',x=>x.id,x=>x.apelido)}</select></div>
  <div class="erro"></div><div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="cf_ok2">Salvar</button></div>`);
  $('cf_ok2').onclick=()=>rodar($('cf_ok2'),async()=>{const d={nome:val('cf_n'),tipo:val('cf_t'),empresa_id:+val('cf_e'),saldo_inicial:isNaN(num(val('cf_s')))?null:num(val('cf_s')),data_saldo_inicial:val('cf_d')||null,ml_conta_id:val('cf_ml')?+val('cf_ml'):null};if(!d.nome)throw new Error('Informe o nome.');
    if(c)await q(sb.from('pp_contas_fin').update(d).eq('id',c.id));else await q(sb.from('pp_contas_fin').insert(d));REF.contasFin=await q(sb.from('pp_contas_fin').select('*').order('nome'));fechar();ir('financeiro');});
}
async function modalLancamento(l,pre){
  if(!veFin())return toast('Seu perfil não acessa o financeiro.');
  const e=l||pre||{tipo:'pagar',natureza:'despesa_fixa',status:'aberto'};
  const anex=l?await q(sb.from('pp_anexos').select('*').eq('entidade','lancamento').eq('entidade_id',String(l.id))):[];
  abrir(`<h2>${l?'Lançamento #'+l.id:'Novo lançamento'}</h2><div class="sub">${l?'Criado em '+fdh(l.criado_em)+' por '+esc(nomeUsuario(l.criado_por)||'—'):''}</div>
  <div class="c3"><div class="campo"><label>Tipo</label><select id="lc_t">${opcoes([{id:'pagar',nome:'A pagar'},{id:'receber',nome:'A receber'},{id:'transferencia',nome:'Transferência entre contas'}],e.tipo,null)}</select></div>
   <div class="campo"><label>Natureza</label><select id="lc_n">${opcoes(Object.entries(NATUREZAS).map(([id,nome])=>({id,nome})),e.natureza,null)}</select></div><div class="campo"><label>Categoria</label><input id="lc_c" value="${esc(e.categoria||'')}" placeholder="aluguel, energia, ração…"></div></div>
  <div class="c2"><div class="campo"><label>Descrição</label><input id="lc_d" value="${esc(e.descricao||'')}"></div><div class="campo"><label>Fornecedor/cliente</label><input id="lc_p" value="${esc(e.parceiro||'')}"></div></div>
  <div class="c3"><div class="campo"><label>Valor</label><input id="lc_v" value="${e.valor??''}" inputmode="decimal"></div><div class="campo"><label>Competência</label><input id="lc_cp" type="date" value="${e.competencia||''}"></div><div class="campo"><label>Vencimento</label><input id="lc_vc" type="date" value="${e.vencimento||''}"></div></div>
  <div class="c3"><div class="campo"><label>Empresa da obrigação</label><select id="lc_e">${opcoes(REF.empresas,e.empresa_id,null)}</select></div><div class="campo"><label>Empresa que assumiu</label><select id="lc_ea">${opcoes(REF.empresas,e.empresa_assumiu_id,'A mesma')}</select></div>
   <div class="campo"><label><input type="checkbox" id="lc_r" ${e.retido?'checked':''}> Valor retido/bloqueado</label>${!l?'<label style="margin-top:6px">Repetir mensalmente por <input id="lc_rep" type="number" min="1" max="36" value="1" style="width:60px"> meses</label>':''}</div></div>
  <fieldset style="border:1px solid var(--line);border-radius:10px;padding:10px"><legend class="peq mut">Pagamento / recebimento</legend>
  <div class="c3"><div class="campo"><label>Status</label><select id="lc_s">${opcoes([{id:'aberto',nome:'Em aberto'},{id:'parcial',nome:'Parcial'},{id:'pago',nome:'Pago/recebido'},{id:'cancelado',nome:'Cancelado'}],e.status||'aberto',null)}</select></div>
   <div class="campo"><label>Data</label><input id="lc_dp" type="date" value="${e.data_pagamento||''}"></div><div class="campo"><label>Valor pago/recebido</label><input id="lc_vp" value="${e.valor_pago??''}" inputmode="decimal"></div></div>
  <div class="c3"><div class="campo"><label>Conta de saída/entrada</label><select id="lc_ct">${opcoes(REF.contasFin,e.conta_id,'—')}</select></div><div class="campo" id="lc_cdw"><label>Conta de destino (transferência)</label><select id="lc_cd">${opcoes(REF.contasFin,e.conta_destino_id,'—')}</select></div><div class="campo"><label>Quem pagou</label><input id="lc_pp" value="${esc(e.pago_por||'')}"></div></div>
  <div class="campo"><label>Comprovante</label>${anex.map(a=>`<button class="sm" onclick="abrirDoc('${a.caminho}')">${esc(a.nome)}</button>`).join(' ')} <input type="file" id="lc_f" style="width:auto"></div></fieldset>
  <div class="campo" style="margin-top:8px"><label>Observação</label><input id="lc_o" value="${esc(e.obs||'')}"></div>
  ${e.nota_id?`<div class="mut peq">Vinculado à nota #${e.nota_id}</div>`:''}${e.venda_id?`<div class="mut peq">Vinculado à venda #${e.venda_id}</div>`:''}
  <div class="erro"></div><div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="lc_ok">Salvar</button></div>`,true);
  const ajTipo=()=>{$('lc_cdw').style.display=val('lc_t')==='transferencia'?'':'none';if(val('lc_t')==='transferencia')$('lc_n').value='transferencia_interna';};$('lc_t').onchange=ajTipo;ajTipo();
  $('lc_ok').onclick=()=>rodar($('lc_ok'),async()=>{const v=num(val('lc_v'));if(!(v>=0))throw new Error('Informe o valor.');if(!val('lc_d'))throw new Error('Informe a descrição.');
    const st=val('lc_s');if((st==='pago'||st==='parcial')&&!val('lc_dp'))throw new Error('Informe a data do pagamento.');
    if(val('lc_t')==='transferencia'&&(!val('lc_ct')||!val('lc_cd')))throw new Error('Informe as duas contas da transferência.');
    const d={tipo:val('lc_t'),natureza:val('lc_n'),categoria:val('lc_c')||null,descricao:val('lc_d'),parceiro:val('lc_p')||null,valor:v,competencia:val('lc_cp')||null,vencimento:val('lc_vc')||null,empresa_id:+val('lc_e'),
      empresa_assumiu_id:val('lc_ea')?+val('lc_ea'):null,retido:$('lc_r').checked,status:st,data_pagamento:val('lc_dp')||null,valor_pago:isNaN(num(val('lc_vp')))?(st==='pago'?v:null):num(val('lc_vp')),
      conta_id:val('lc_ct')?+val('lc_ct'):null,conta_destino_id:val('lc_cd')?+val('lc_cd'):null,pago_por:val('lc_pp')||null,obs:val('lc_o')||null,nota_id:e.nota_id||null,venda_id:e.venda_id||null};
    let ids=[];
    if(l){await q(sb.from('pp_lancamentos').update(d).eq('id',l.id));ids=[l.id];}
    else{const rep=Math.max(1,+(val('lc_rep')||1));const rows=[];for(let k=0;k<rep;k++){const mv=x=>x?addMes(x,k):x;rows.push({...d,competencia:mv(d.competencia),vencimento:mv(d.vencimento),status:k?'aberto':d.status,data_pagamento:k?null:d.data_pagamento,valor_pago:k?null:d.valor_pago,descricao:rep>1?d.descricao+` (${k+1}/${rep})`:d.descricao});}
      ids=(await q(sb.from('pp_lancamentos').insert(rows).select('id'))).map(x=>x.id);}
    const f=$('lc_f').files[0];if(f){const path=`comprovantes/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]/g,'_')}`;const {error}=await sb.storage.from('pp-docs').upload(path,f);if(error)throw error;await q(sb.from('pp_anexos').insert({entidade:'lancamento',entidade_id:String(ids[0]),nome:f.name,caminho:path,tipo:f.type}));}
    fechar();toast('Lançamento salvo.');if(area==='financeiro'||area==='visao')ir(area);});
}
function addMes(iso,k){const [a,m,d]=iso.split('-').map(Number);const dt=new Date(Date.UTC(a,m-1+k,1));const ult=new Date(Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth()+1,0)).getUTCDate();dt.setUTCDate(Math.min(d,ult));return dt.toISOString().slice(0,10);}
