// =====================================================================
// Visão geral, Vendas e Mercado Livre, Custos e margens, Relatórios
// =====================================================================

// ---------- métricas de vendas (definições exibidas na tela) ----------
const DEF={
  bruto:'Soma do valor dos itens vendidos (preço × quantidade), antes de qualquer dedução. Inclui pedidos cancelados/devolvidos, que são deduzidos à parte.',
  liquido:'Faturamento bruto − cancelamentos − devoluções − descontos.',
  cmv:'Quantidade vendida × custo médio ponderado congelado na data de cada venda. Itens sem custo confiável ficam de fora e são sinalizados.',
  lucro:'Faturamento líquido − CMV.',
  mc:'Lucro bruto − despesas variáveis identificadas (tarifas e comissões do ML, frete pago pelo vendedor e outros custos variáveis do pedido).',
  despop:'Contas a pagar de natureza despesa fixa, variável, folha, tarifa, imposto e outras, pela competência (ou vencimento) no período. Compras de mercadoria não entram (já estão no CMV); aportes, empréstimos, retiradas e transferências também não.',
  resultado:'Margem de contribuição − despesas operacionais.',
};
function metricas(vendas,lancs){
  const vs=filtrarVendas(vendas).filter(v=>!v.duplicada_de&&v.status!=='pendente');
  const parcial=!!(F.produto||F.categoria);
  const M={vendas:vs,bruto:0,cancel:0,devol:0,desc:0,pedidos:0,cmv:0,semCusto:0,qtdSemCusto:0,itensSemCusto:[],tarifas:0,frete:0,outros:0,semVinculo:0,itensSemVinculo:[]};
  vs.forEach(v=>{
    const its=parcial?itensFiltrados(v):(v.pp_venda_itens||[]);
    const bItens=soma(its,i=>i.qtd*i.preco_unit-(i.desconto||0));
    const totItens=soma(v.pp_venda_itens||[],i=>i.qtd*i.preco_unit-(i.desconto||0))||v.valor_bruto||1;
    const f=parcial?bItens/totItens:1;   // proporção do pedido que pertence ao filtro
    const bruto=parcial?bItens:+v.valor_bruto;
    M.bruto+=bruto;M.cancel+=v.valor_cancelado*f;M.devol+=v.valor_devolvido*f;M.desc+=v.desconto*f;
    if(v.status!=='cancelada')M.pedidos++;
    if(v.status!=='cancelada'&&v.status!=='devolvida'){
      M.tarifas+=v.tarifa_venda*f;M.frete+=v.frete_vendedor*f;M.outros+=v.outros_custos_var*f;
      its.forEach(i=>{if(i.eh_servico)return;const c=custoItem(i);
        if(!i.produto_id){M.semVinculo+=i.qtd*i.preco_unit;M.itensSemVinculo.push({...i,venda:v});}
        if(c&&c.custo_unit!=null&&c.status!=='ausente')M.cmv+=i.qtd*c.custo_unit;
        else{M.semCusto+=i.qtd*i.preco_unit;M.qtdSemCusto+=i.qtd;M.itensSemCusto.push({...i,venda:v});}});
    }
  });
  M.liquido=M.bruto-M.cancel-M.devol-M.desc;
  M.ticket=M.pedidos?M.liquido/M.pedidos:null;
  M.lucro=M.liquido-M.cmv;M.despVar=M.tarifas+M.frete+M.outros;M.mc=M.lucro-M.despVar;
  M.lancOp=(lancs||[]).filter(l=>despOperacional(l)&&(!F.empresa||l.empresa_id==F.empresa));
  M.despOp=soma(M.lancOp,l=>l.status==='pago'?(l.valor_pago??l.valor):l.valor);
  M.resultado=M.mc-M.despOp;
  return M;
}
function despOperacional(l){return l.tipo==='pagar'&&l.status!=='cancelado'&&['despesa_fixa','despesa_variavel','folha','tarifa','imposto','outro'].includes(l.natureza);}
function diasPeriodo(de,ate){const fim=ate>hojeISO()?hojeISO():ate;return Math.max(1,Math.round((new Date(fim)-new Date(de))/864e5)+1);}
const COLS_VENDA=[{t:'Data',v:v=>fd(v.data_venda)},{t:'Canal',v:v=>CANAL[v.canal]},{t:'Conta/unidade',v:v=>v.ml_conta_id?contaML(v.ml_conta_id).apelido:empresa(v.empresa_id).nome},
  {t:'Pedido',v:v=>v.pedido||v.origem_ref},{t:'Status',v:v=>v.status,h:v=>tagStatus(v.status)},{t:'Bruto',v:v=>+v.valor_bruto,n:1,tot:1},{t:'Desconto',v:v=>+v.desconto,n:1,tot:1},
  {t:'Cancelado',v:v=>+v.valor_cancelado,n:1,tot:1},{t:'Devolvido',v:v=>+v.valor_devolvido,n:1,tot:1},{t:'Origem',v:v=>v.origem}];
const COLS_ITEM=[{t:'Data',v:i=>fd(i.venda.data_venda)},{t:'Pedido',v:i=>i.venda.pedido||i.venda.origem_ref},{t:'Produto',v:i=>i.produto_id?nomeProd(i.produto_id):i.descricao},
  {t:'Código',v:i=>i.sku||i.codigo||i.item_ml||''},{t:'Qtd',v:i=>+i.qtd,n:1,fmt:nf},{t:'Valor',v:i=>i.qtd*i.preco_unit,n:1,tot:1}];

// ---------- VISÃO GERAL ----------
TELAS.visao=async function(){
  const ini12=inicioMes(addDias(inicioMes(hojeISO()),-334));
  const deCarga=F.de<ini12?F.de:ini12;
  const [vendas,lancs,fin,est]=await Promise.all([
    carregarVendas(deCarga,hojeISO()>F.ate?hojeISO():F.ate,true),
    veFin()?tudo(()=>sb.from('pp_lancamentos').select('*').or(`and(competencia.gte.${deCarga},competencia.lte.${hojeISO()>F.ate?hojeISO():F.ate}),and(competencia.is.null,vencimento.gte.${deCarga})`)):Promise.resolve([]),
    veFin()?resumoFinanceiro():Promise.resolve(null),
    veCusto()?resumoEstoque():Promise.resolve(null)]);
  const noPer=vendas.filter(v=>{const d=diaLocal(v.data_venda);return d>=F.de&&d<=F.ate;});
  const lancPer=lancs.filter(l=>{const d=l.competencia||l.vencimento;return d>=F.de&&d<=F.ate;});
  const M=metricas(noPer,lancPer);
  const hoje=hojeISO();const Mh=metricas(vendas.filter(v=>diaLocal(v.data_venda)===hoje),[]);
  const Mm=metricas(vendas.filter(v=>diaLocal(v.data_venda)>=inicioMes(hoje)),[]);
  // por mês (12 meses)
  const meses=[];for(let d=inicioMes(addDias(inicioMes(hoje),-334));d<=hoje;d=inicioMes(addDias(d,32)))meses.push(d.slice(0,7));
  const porMes=meses.map(ym=>{const m=metricas(vendas.filter(v=>diaLocal(v.data_venda).slice(0,7)===ym),lancs.filter(l=>(l.competencia||l.vencimento||'').slice(0,7)===ym));return {ym,...m,andamento:ym===hoje.slice(0,7)};});
  const completos=porMes.filter(x=>!x.andamento&&x.pedidos>0);
  const mediaMensal=completos.length?soma(completos,x=>x.liquido)/completos.length:null;
  const dias=diasPeriodo(F.de,F.ate);
  const avisos=[];
  if(M.semCusto>0)avisos.push(`${brl(M.semCusto)} em vendas (${nf(M.qtdSemCusto)} un.) estão sem custo confiável: CMV, lucro e margem estão <b>superestimados</b> nesse valor. <button class="lk" onclick="detalharSemCusto()">Ver itens</button>`);
  if(M.semVinculo>0)avisos.push(`${brl(M.semVinculo)} em itens vendidos sem vínculo com o cadastro mestre. <button class="lk" onclick="ir('produtos','vinculos')">Vincular</button>`);
  if(!vendas.length)avisos.push('Ainda não há vendas importadas. Conecte o Mercado Livre e importe as vendas do SimplesVet em <button class="lk" onclick="ir(\'integracoes\')">Integrações</button>.');
  if(fin&&fin.incompleto.length)avisos.push('Caixa e projeções incompletos: '+fin.incompleto.join('; ')+'.');
  if(REF.config.tributos_validado_contabilidade!==true)avisos.push('O tratamento de tributos no custo ainda não foi validado pela contabilidade (Integrações → Configurações).');
  window._M=M;window._porMes=porMes;window._fin=fin;window._est=est;
  const k=(l,v,s,fn,cls='',aviso='')=>`<div class="kpi ${cls}" onclick="${fn}">${aviso?`<span class="aviso" title="Dado incompleto">⚠ ${aviso}</span>`:''}<div class="l">${l}</div><div class="v">${v}</div><div class="s">${s||''}</div></div>`;
  $('conteudo').innerHTML=barraFiltros(['periodo','empresa','unidade','canal','conta','categoria','produto'],()=>ir('visao'))+
  avisos.map(a=>`<div class="aviso">${a}</div>`).join('')+
  `<div class="kpis">
   ${k('Vendido hoje',brl(Mh.liquido),nf(Mh.pedidos)+' pedidos','detalharVendas(\'hoje\')')}
   ${k('Vendido neste mês',brl(Mm.liquido),nf(Mm.pedidos)+' pedidos · mês em andamento','detalharVendas(\'mes\')')}
   ${k('Média mensal',brl(mediaMensal),completos.length?`${completos.length} meses completos (${mesNome(completos[0].ym)} a ${mesNome(completos[completos.length-1].ym)})`:'sem meses completos','detalharMeses()')}
   ${k('Média diária no período',brl(M.liquido/dias),`${dias} dias corridos (${fd(F.de)} a ${fd(F.ate>hoje?hoje:F.ate)})`,'detalharVendas(\'periodo\')')}
  </div>
  <div class="secao"><h2>Resultado do período <small>${fd(F.de)} a ${fd(F.ate)} · clique em um valor para ver os registros</small></h2><div class="kpis">
   ${k('Faturamento bruto',brl(M.bruto),nf(M.vendas.length)+' registros','detalharVendas(\'periodo\')')}
   ${k('Cancel. + devol. + descontos',brl(M.cancel+M.devol+M.desc),`Canc. ${brlc(M.cancel)} · Dev. ${brlc(M.devol)} · Desc. ${brlc(M.desc)}`,'detalharDeducoes()')}
   ${k('Faturamento líquido',brl(M.liquido),DEF.liquido,'detalharVendas(\'periodo\')')}
   ${k('Pedidos / ticket médio',nf(M.pedidos)+' · '+brl(M.ticket),'Ticket = líquido ÷ pedidos não cancelados','detalharVendas(\'periodo\')')}
   ${veCusto()?k('CMV',brl(M.cmv),'Custo das mercadorias vendidas','detalharCMV()','',M.semCusto>0?'incompleto':'')+
   k('Lucro bruto',brl(M.lucro),'Margem '+pct(M.liquido?M.lucro/M.liquido:null),'detalharCMV()',M.lucro<0?'ruim':'',M.semCusto>0?'incompleto':'')+
   k('Margem de contribuição',brl(M.mc),`Tarifas ${brlc(M.tarifas)} · frete ${brlc(M.frete)} · ${pct(M.liquido?M.mc/M.liquido:null)}`,'detalharVariaveis()',M.mc<0?'ruim':'',M.semCusto>0?'incompleto':''):''}
   ${veFin()?k('Despesas operacionais',brl(M.despOp),nf(M.lancOp.length)+' lançamentos','detalharDespOp()')+
   k('Resultado estimado',brl(M.resultado),'MC − despesas operacionais','explicarResultado()',M.resultado<0?'ruim':'bom',M.semCusto>0?'incompleto':''):''}
  </div></div>
  ${fin?`<div class="secao"><h2>Dinheiro e obrigações <small>faturamento, lucro, estoque e caixa são números diferentes</small></h2><div class="kpis">
   ${k('Disponível agora',brl(fin.disponivel),fin.incompletoSaldo?'saldo de alguma conta não informado':'contas + caixa + Mercado Pago','ir(\'financeiro\')',fin.disponivel<0?'ruim':'',fin.incompletoSaldo?'incompleto':'')}
   ${k('A receber',brl(fin.aReceber),`ML a liberar ${brlc(fin.mlALiberar)} · outros ${brlc(fin.receberAberto)}`,'detalharAReceber()')}
   ${k('Retido/bloqueado',brl(fin.retido),'Mercado Pago e lançamentos retidos','detalharAReceber()')}
   ${k('Vence em 7 dias',brl(fin.vence7),nf(fin.lista7.length)+' contas a pagar','detalharVencimentos(7)',fin.vence7>fin.disponivel?'alerta':'')}
   ${k('Vencidas',brl(fin.vencido),nf(fin.listaVencidas.length)+' contas','detalharVencimentos(0)',fin.vencido>0?'ruim':'')}
   ${k('Projeção 30 dias',brl(fin.proj[30].saldo),fin.proj[30].incompleto?'projeção incompleta':'disponível + a receber − a pagar','ir(\'financeiro\')',fin.proj[30].saldo<0?'ruim':'',fin.proj[30].incompleto?'incompleto':'')}
  </div><div class="mut peq">${fin.leitura}</div></div>`:''}
  ${est?`<div class="secao"><h2>Estoque</h2><div class="kpis">
   ${k('Investido em estoque',brl(est.valor),`${nf(est.unidades)} un. em ${nf(est.produtos)} produtos`,'ir(\'estoque\')','',est.semCusto?'incompleto':'')}
   ${k('Produtos sem custo',nf(est.semCusto),'com saldo e sem custo confiável','ir(\'estoque\',\'semcusto\')',est.semCusto?'alerta':'')}
   ${k('Estoque negativo',nf(est.negativos),'produtos','ir(\'estoque\',\'negativo\')',est.negativos?'ruim':'')}
  </div></div>`:''}
  <div class="secao"><h2>Evolução mensal <small>faturamento líquido${veCusto()?' e lucro bruto':''} · mês atual em andamento (barra clara)</small></h2>${grafMeses(porMes)}
   ${tabela([{t:'Mês',v:x=>mesNome(x.ym)+(x.andamento?' (em andamento)':'')},{t:'Pedidos',v:x=>x.pedidos,n:1,fmt:nf},{t:'Líquido',v:x=>x.liquido,n:1},
     {t:'Var. mês ant.',v:(x)=>{const i=porMes.indexOf(x);const a=porMes[i-1];return a&&a.liquido?(x.liquido/a.liquido-1):null;},n:1,fmt:pct},
     ...(veCusto()?[{t:'CMV',v:x=>x.cmv,n:1},{t:'Lucro bruto',v:x=>x.lucro,n:1},{t:'Margem contrib.',v:x=>x.mc,n:1},{t:'Sem custo',v:x=>x.semCusto,n:1}]:[]),
     ...(veFin()?[{t:'Desp. oper.',v:x=>x.despOp,n:1},{t:'Resultado',v:x=>x.resultado,n:1}]:[])],porMes.slice().reverse(),{rolar:false})}
  </div>
  <div class="grade2"><div class="secao"><h2>Produtos por faturamento</h2>${rankingProdutos(M,'fat')}</div>
  ${veCusto()?`<div class="secao"><h2>Produtos por contribuição ao resultado</h2>${rankingProdutos(M,'contrib')}</div>`:''}</div>`;
};
function grafMeses(pm){
  const W=900,H=200,pad=34,max=Math.max(1,...pm.map(x=>Math.max(x.liquido,veCusto()?x.lucro:0)));
  const bw=(W-pad*2)/pm.length;
  const bars=pm.map((x,i)=>{const h=(x.liquido/max)*(H-40),hl=veCusto()?Math.max(0,(x.lucro/max)*(H-40)):0,X=pad+i*bw;
    return `<g><title>${mesNome(x.ym)}: líquido ${brl(x.liquido)}${veCusto()?' · lucro bruto '+brl(x.lucro):''}</title>
    <rect x="${X+bw*.12}" y="${H-20-h}" width="${bw*.4}" height="${Math.max(0,h)}" rx="3" fill="${x.andamento?'#9cc9bd':'#0f5c4d'}"/>
    ${veCusto()?`<rect x="${X+bw*.52}" y="${H-20-hl}" width="${bw*.32}" height="${hl}" rx="3" fill="${x.andamento?'#f3d19c':'#d98a1f'}"/>`:''}
    <text x="${X+bw/2}" y="${H-5}" font-size="11" text-anchor="middle" fill="#66706b">${mesNome(x.ym)}</text></g>`;}).join('');
  return `<svg class="graf" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}<line x1="${pad}" x2="${W-pad}" y1="${H-20}" y2="${H-20}" stroke="#e2e5e1"/></svg>
  <div class="legenda"><span><i style="background:#0f5c4d"></i>Faturamento líquido</span>${veCusto()?'<span><i style="background:#d98a1f"></i>Lucro bruto</span>':''}<span><i style="background:#9cc9bd"></i>Mês em andamento</span></div>`;
}
function rankingProdutos(M,modo){
  const m={};M.vendas.forEach(v=>{if(v.status==='cancelada')return;const f=v.status==='devolvida'?0:1;(F.produto||F.categoria?itensFiltrados(v):(v.pp_venda_itens||[])).forEach(i=>{
    const k=i.produto_id||('?'+(i.sku||i.codigo||i.descricao));const c=custoItem(i);
    const x=m[k]=m[k]||{nome:i.produto_id?nomeProd(i.produto_id):(i.descricao+' (sem vínculo)'),qtd:0,fat:0,cmv:0,tar:0,semCusto:false,pid:i.produto_id};
    x.qtd+=i.qtd*f;x.fat+=(i.qtd*i.preco_unit-(i.desconto||0))*f;x.tar+=(i.tarifa||0)*f;
    if(c&&c.custo_unit!=null)x.cmv+=i.qtd*c.custo_unit*f;else if(!i.eh_servico)x.semCusto=true;});});
  const l=Object.values(m).map(x=>({...x,contrib:x.fat-x.cmv-x.tar}));
  l.sort((a,b)=>b[modo]-a[modo]);
  return tabela([{t:'Produto',v:x=>x.nome,h:x=>esc(x.nome)+(x.semCusto&&modo==='contrib'?' <span class="tag a">sem custo</span>':'')},{t:'Qtd',v:x=>x.qtd,n:1,fmt:nf},{t:'Faturamento',v:x=>x.fat,n:1},
    ...(modo==='contrib'?[{t:'CMV',v:x=>x.cmv,n:1},{t:'Tarifas',v:x=>x.tar,n:1},{t:'Contribuição',v:x=>x.contrib,n:1},{t:'Margem',v:x=>x.fat?x.contrib/x.fat:null,n:1,fmt:pct}]:[])],
    l.slice(0,15),{rolar:false,clique:x=>x.pid&&abrirProduto(x.pid)});
}
function detalharVendas(qual){
  const M=window._M;let vs=M.vendas,t='Vendas do período';
  if(qual==='hoje'){t='Vendas de hoje';vs=null;}if(qual==='mes'){t='Vendas do mês';vs=null;}
  const carregar=async()=>{if(vs)return vs;const de=qual==='hoje'?hojeISO():inicioMes(hojeISO());return filtrarVendas(await carregarVendas(de,hojeISO(),true)).filter(v=>!v.duplicada_de);};
  carregar().then(l=>detalhar(t,'Cada linha é um pedido/venda. Pedidos marcados como duplicados de outro sistema não aparecem nem somam.',COLS_VENDA,l,{clique:abrirVenda}));
}
function detalharDeducoes(){detalhar('Cancelamentos, devoluções e descontos',DEF.liquido,COLS_VENDA,window._M.vendas.filter(v=>v.valor_cancelado||v.valor_devolvido||v.desconto),{clique:abrirVenda});}
function detalharSemCusto(){detalhar('Itens vendidos sem custo confiável','Esses itens ficaram fora do CMV. Resolva lançando a nota de compra ou o saldo inicial com custo e depois use "Reprocessar custos" em Custos e margens.',COLS_ITEM,window._M.itensSemCusto);}
function detalharCMV(){const l=[];window._M.vendas.forEach(v=>{if(v.status==='cancelada'||v.status==='devolvida')return;(v.pp_venda_itens||[]).forEach(i=>{const c=custoItem(i);if(c&&c.custo_unit!=null)l.push({...i,venda:v,cu:+c.custo_unit});});});
  detalhar('Composição do CMV',DEF.cmv,[...COLS_ITEM,{t:'Custo unit.',v:i=>i.cu,n:1},{t:'CMV',v:i=>i.qtd*i.cu,n:1,tot:1},{t:'Margem',v:i=>(i.qtd*i.preco_unit-i.qtd*i.cu)/(i.qtd*i.preco_unit||1),n:1,fmt:pct}],l);}
function detalharVariaveis(){detalhar('Despesas variáveis das vendas',DEF.mc,[...COLS_VENDA.slice(0,5),{t:'Bruto',v:v=>+v.valor_bruto,n:1,tot:1},{t:'Tarifa/comissão',v:v=>+v.tarifa_venda,n:1,tot:1},{t:'Frete vendedor',v:v=>+v.frete_vendedor,n:1,tot:1},{t:'Outros',v:v=>+v.outros_custos_var,n:1,tot:1}],window._M.vendas.filter(v=>v.tarifa_venda||v.frete_vendedor||v.outros_custos_var),{clique:abrirVenda});}
function detalharDespOp(){detalhar('Despesas operacionais',DEF.despop,COLS_LANC,window._M.lancOp,{clique:l=>modalLancamento(l)});}
function explicarResultado(){const M=window._M;abrir(`<h2>Como o resultado foi calculado</h2><div class="sub">${fd(F.de)} a ${fd(F.ate)}</div>
  <table class="t"><tr><td>Faturamento bruto</td><td class="n">${brl(M.bruto)}</td></tr><tr><td>(−) Cancelamentos</td><td class="n">${brl(M.cancel)}</td></tr><tr><td>(−) Devoluções</td><td class="n">${brl(M.devol)}</td></tr><tr><td>(−) Descontos</td><td class="n">${brl(M.desc)}</td></tr>
  <tr><td><b>Faturamento líquido</b></td><td class="n"><b>${brl(M.liquido)}</b></td></tr><tr><td>(−) CMV</td><td class="n">${brl(M.cmv)}</td></tr><tr><td><b>Lucro bruto</b></td><td class="n"><b>${brl(M.lucro)}</b></td></tr>
  <tr><td>(−) Tarifas e comissões</td><td class="n">${brl(M.tarifas)}</td></tr><tr><td>(−) Frete pago pelo vendedor</td><td class="n">${brl(M.frete)}</td></tr><tr><td>(−) Outros variáveis</td><td class="n">${brl(M.outros)}</td></tr>
  <tr><td><b>Margem de contribuição</b></td><td class="n"><b>${brl(M.mc)}</b></td></tr><tr><td>(−) Despesas operacionais</td><td class="n">${brl(M.despOp)}</td></tr><tr><td><b>Resultado estimado</b></td><td class="n"><b>${brl(M.resultado)}</b></td></tr></table>
  ${M.semCusto?`<div class="aviso" style="margin-top:10px">${brl(M.semCusto)} vendidos sem custo: o resultado real é menor do que o mostrado.</div>`:''}
  <div class="mut peq" style="margin-top:8px">Impostos sobre a venda só entram quando lançados como despesa (natureza imposto). Despesas sem competência usam o vencimento.</div><div class="rodape"><button onclick="fechar()">Fechar</button></div>`);}
function detalharMeses(){detalhar('Faturamento por mês','A média mensal usa somente meses completos com vendas; o mês atual (em andamento) fica fora.',[{t:'Mês',v:x=>mesNome(x.ym)+(x.andamento?' (em andamento)':'')},{t:'Pedidos',v:x=>x.pedidos,n:1,fmt:nf},{t:'Líquido',v:x=>x.liquido,n:1,tot:1},{t:'Entra na média',v:x=>!x.andamento&&x.pedidos?'Sim':'Não'}],window._porMes.slice().reverse());}

// ---------- VENDAS E MERCADO LIVRE ----------
let abaVendas='pedidos';
TELAS.vendas=async function(){
  const vs=await carregarVendas(F.de,F.ate,true);
  const lst=filtrarVendas(vs);
  const M=metricas(vs,[]);
  const porCanal=Object.entries(agrupar(M.vendas,v=>v.ml_conta_id?'ML · '+contaML(v.ml_conta_id).apelido:'Loja · '+empresa(v.empresa_id).nome)).map(([k,a])=>{const m=metricas(a,[]);return {k,...m};});
  const filtroSt=window._fst||'';
  const vis=lst.filter(v=>!filtroSt||(filtroSt==='dup'?v.duplicada_de:v.status===filtroSt));
  const colsPed=[...COLS_VENDA.slice(0,5),{t:'Líquido',v:v=>v.valor_bruto-v.valor_cancelado-v.valor_devolvido-v.desconto,n:1,tot:1},
    {t:'Tarifas',v:v=>+v.tarifa_venda,n:1,tot:1},{t:'Frete vend.',v:v=>+v.frete_vendedor,n:1,tot:1},
    ...(veCusto()?[{t:'CMV',v:v=>cmvVenda(v),n:1,tot:1},{t:'Resultado',v:v=>resultadoVenda(v),n:1,tot:1,h:v=>{const r=resultadoVenda(v);return `<span style="color:${r<0?'var(--red)':''}">${brl(r)}</span>${semCustoVenda(v)?' <span class="tag a" title="Algum item sem custo">!</span>':''}`;}}]:[]),
    {t:'Recebido em',v:v=>fd(v.data_pagamento)},{t:'Liberação',v:v=>v.data_liberacao?fd(v.data_liberacao)+(v.liberado?' ✓':''):'—'},
    {t:'NF',v:v=>v.nota_id?'Sim':'',h:v=>v.nota_id?'<span class="tag v">NF</span>':(v.canal==='mercado_livre'?'<span class="tag a">sem NF</span>':'')},
    {t:'',v:v=>'',h:v=>v.duplicada_de?'<span class="tag">duplicada</span>':''}];
  $('conteudo').innerHTML=barraFiltros(['periodo','empresa','canal','conta','categoria','produto'],()=>ir('vendas'))+
  `<div class="kpis">${porCanal.map(c=>`<div class="kpi"><div class="l">${esc(c.k)}</div><div class="v">${brl(c.liquido)}</div><div class="s">${nf(c.pedidos)} pedidos · ticket ${brl(c.ticket)}${veCusto()?` · MC ${pct(c.liquido?c.mc/c.liquido:null)}`:''}</div></div>`).join('')||'<div class="mut">Sem vendas no período.</div>'}</div>
  <div class="abas2">${[['pedidos','Por pedido'],['produtos','Por produto'],['anuncios','Anúncios ML']].map(([i,n])=>`<button class="${abaVendas===i?'on':''}" onclick="abaVendas='${i}';ir('vendas')">${n}</button>`).join('')}</div>
  <div class="secao">${abaVendas==='pedidos'?`<h2>Pedidos <small>Data da venda ≠ data do recebimento ≠ data de liberação do dinheiro</small>
    <span><select id="fst" style="width:auto" onchange="window._fst=this.value;ir('vendas')"><option value="">Todos os status</option>${Object.entries(STATUS_V).map(([k,v])=>`<option value="${k}" ${filtroSt===k?'selected':''}>${v[0]}</option>`).join('')}<option value="dup" ${filtroSt==='dup'?'selected':''}>Marcadas como duplicadas</option></select>
    <button class="sm" onclick="exportarTabela('vendas',window._cv,window._lv)">CSV</button>${tem('financeiro','operacao')?' <button class="sm pri" onclick="ir(\'integracoes\')">Importar / sincronizar</button>':''}</span></h2>
    ${tabela(colsPed,vis,{clique:abrirVenda})}`:abaVendas==='produtos'?`<h2>Resultado por produto</h2>${rankingProdutos(M,veCusto()?'contrib':'fat').replace('rolar"','"')}`:''}
    ${abaVendas==='anuncios'?'<div id="anuncios">Carregando…</div>':''}</div>`;
  window._cv=colsPed;window._lv=vis;
  if(abaVendas==='anuncios')telaAnuncios();
};
function cmvVenda(v){if(v.status==='cancelada'||v.status==='devolvida')return 0;return soma(v.pp_venda_itens||[],i=>{const c=custoItem(i);return c&&c.custo_unit!=null?i.qtd*c.custo_unit:0;});}
function semCustoVenda(v){return v.status!=='cancelada'&&(v.pp_venda_itens||[]).some(i=>{const c=custoItem(i);return !i.eh_servico&&(!c||c.custo_unit==null);});}
function resultadoVenda(v){if(v.status==='cancelada')return 0;return v.valor_bruto-v.valor_cancelado-v.valor_devolvido-v.desconto-cmvVenda(v)-v.tarifa_venda-v.frete_vendedor-v.outros_custos_var;}
async function abrirVenda(v){
  const its=v.pp_venda_itens||[];
  let nota=null;if(v.nota_id){const r=await sb.from('pp_notas').select('id,numero,serie,chave,emissao').eq('id',v.nota_id).maybeSingle();nota=r.data;}
  abrir(`<h2>${CANAL[v.canal]} · pedido ${esc(v.pedido||v.origem_ref)}</h2><div class="sub">${v.ml_conta_id?'Conta '+esc(contaML(v.ml_conta_id).apelido):esc(empresa(v.empresa_id).nome)} · origem ${esc(v.origem)} · importado ${fdh(v.importado_em)}</div>
  <div class="c3"><div><div class="mut peq">Data da venda</div><b>${fdh(v.data_venda)}</b></div><div><div class="mut peq">Data do recebimento (pagamento aprovado)</div><b>${fd(v.data_pagamento)}</b></div><div><div class="mut peq">Liberação do dinheiro</div><b>${fd(v.data_liberacao)}</b> ${v.liberado===true?'<span class="tag v">liberado</span>':v.liberado===false?'<span class="tag a">a liberar</span>':''}</div></div>
  <div style="margin:10px 0">${tagStatus(v.status)} ${v.duplicada_de?'<span class="tag">duplicada de #'+v.duplicada_de+' (não soma)</span>':''} ${v.logistica?'<span class="tag b">'+esc(v.logistica)+'</span>':''}</div>
  ${tabela([{t:'Item',v:i=>i.produto_id?nomeProd(i.produto_id):i.descricao,h:i=>i.produto_id?esc(nomeProd(i.produto_id)):esc(i.descricao)+' <span class="tag a">sem vínculo</span>'},{t:'Código/SKU',v:i=>i.sku||i.codigo||i.item_ml||''},{t:'Qtd',v:i=>+i.qtd,n:1,fmt:nf},{t:'Preço',v:i=>+i.preco_unit,n:1},{t:'Total',v:i=>i.qtd*i.preco_unit,n:1,tot:1},{t:'Tarifa',v:i=>+i.tarifa,n:1,tot:1},
    ...(veCusto()?[{t:'Custo unit.',v:i=>{const c=custoItem(i);return c?c.custo_unit:null;},n:1,h:i=>{const c=custoItem(i);return c&&c.custo_unit!=null?brl(c.custo_unit)+(c.revisao_sugerida!=null?` <span class="tag a" title="Revisão sugerida">→ ${brl(c.revisao_sugerida)}</span>`:''):i.eh_servico?'<span class="tag">serviço</span>':'<span class="tag r">sem custo</span>';}}]:[])],its,{rolar:false})}
  <table class="t" style="max-width:420px;margin-left:auto"><tr><td>Bruto</td><td class="n">${brl(v.valor_bruto)}</td></tr><tr><td>(−) Desconto</td><td class="n">${brl(v.desconto)}</td></tr><tr><td>(−) Cancelado</td><td class="n">${brl(v.valor_cancelado)}</td></tr><tr><td>(−) Devolvido</td><td class="n">${brl(v.valor_devolvido)}</td></tr>
   <tr><td>(−) Tarifas/comissão</td><td class="n">${brl(v.tarifa_venda)}</td></tr><tr><td>(−) Frete pago pelo vendedor</td><td class="n">${brl(v.frete_vendedor)}</td></tr>${veCusto()?`<tr><td>(−) CMV</td><td class="n">${brl(cmvVenda(v))}</td></tr><tr><td><b>Resultado do pedido</b></td><td class="n"><b>${brl(resultadoVenda(v))}</b></td></tr>`:''}
   ${v.valor_liquido_previsto!=null?`<tr><td>Líquido informado pelo Mercado Pago</td><td class="n">${brl(v.valor_liquido_previsto)}</td></tr>`:''}</table>
  <div class="campo" style="margin-top:10px"><label>Nota fiscal vinculada</label>${nota?`NF ${esc(nota.numero)}/${esc(nota.serie||'')} · ${fd(nota.emissao)} <span class="mono">${esc(nota.chave||'')}</span>`:'<span class="mut">Nenhuma</span>'}</div>
  ${tem('financeiro','operacao')?`<div class="c2"><div class="campo"><label>Marcar como duplicada de (nº interno da venda principal)</label><input id="v_dup" value="${v.duplicada_de||''}" placeholder="ex.: 1532"></div>
   <div class="campo"><label>Conciliada (cancelamento/devolução conferidos)</label><select id="v_conc"><option value="false">Não</option><option value="true" ${v.conciliada?'selected':''}>Sim</option></select></div></div>
   <div class="campo"><label>Observação</label><input id="v_obs" value="${esc(v.obs||'')}"></div>`:''}
  <div class="mut peq">Nº interno #${v.id}</div><div class="erro"></div>
  <div class="rodape"><button onclick="fechar()">Fechar</button>${tem('financeiro','operacao')?'<button class="pri" id="v_ok">Salvar</button>':''}</div>`,true);
  if($('v_ok'))$('v_ok').onclick=()=>rodar($('v_ok'),async()=>{const d=val('v_dup');
    if(d&&+d===v.id)throw new Error('Uma venda não pode ser duplicada dela mesma.');
    await q(sb.from('pp_vendas').update({duplicada_de:d?+d:null,conciliada:val('v_conc')==='true',obs:val('v_obs')||null}).eq('id',v.id));fechar();toast('Venda atualizada.');ir('vendas');});
}
async function telaAnuncios(){
  const an=await tudo(()=>sb.from('pp_ml_anuncios').select('*').order('titulo'));
  const cod=c=>REF.codigos.find(x=>x.status==='confirmado'&&((x.origem==='ml_variacao'&&x.codigo===c.variacao_id&&c.variacao_id)||(x.origem==='ml_sku'&&c.sku&&x.codigo===c.sku)||(x.origem==='ml_item'&&x.codigo===c.item_id)));
  const l=an.filter(a=>!F.conta||a.conta_id==F.conta);
  $('anuncios').innerHTML=`<h2>Anúncios do Mercado Livre <small>${nf(l.length)} anúncios/variações · estoque do ML (Full separado)</small></h2>`+
  tabela([{t:'Conta',v:a=>contaML(a.conta_id).apelido},{t:'Anúncio',v:a=>a.item_id+(a.variacao_id?' / '+a.variacao_id:'')},{t:'Título',v:a=>a.titulo},{t:'SKU',v:a=>a.sku||''},{t:'Status',v:a=>a.status},{t:'Logística',v:a=>a.logistica==='fulfillment'?'Full':a.logistica||''},
    {t:'Preço',v:a=>+a.preco,n:1},{t:'Disponível ML',v:a=>a.estoque_disponivel,n:1,fmt:nf},{t:'Full',v:a=>a.estoque_full,n:1,fmt:nf},
    {t:'Produto mestre',v:a=>{const c=cod(a);return c?nomeProd(c.produto_id):'';},h:a=>{const c=cod(a);return c?esc(nomeProd(c.produto_id))+(c.fator!=1?` ×${nf(c.fator,3)}`:''):'<span class="tag a">sem vínculo</span>';}}],l,
    {clique:a=>modalVincular({origem:a.variacao_id?'ml_variacao':(a.sku?'ml_sku':'ml_item'),escopo:'',codigo:a.variacao_id||a.sku||a.item_id,descricao:a.titulo,extra:a})});
}

// ---------- CUSTOS E MARGENS ----------
TELAS.custos=async function(){
  const [ca,hist,vend]=await Promise.all([tudo(()=>sb.from('pp_v_custo_atual').select('*')),tudo(()=>sb.from('pp_custo_hist').select('produto_id,data,custo_entrada,qtd_entrada,custo_medio_depois,nota_id').order('data')),
    carregarVendas(addDias(hojeISO(),-89),hojeISO(),true)]);
  const cm={};ca.forEach(c=>cm[c.produto_id]=c);
  const compras=agrupar(hist.filter(h=>+h.custo_entrada>0),h=>h.produto_id);
  const preco={};vend.filter(v=>v.status==='concluida'&&!v.duplicada_de).forEach(v=>(v.pp_venda_itens||[]).forEach(i=>{if(!i.produto_id)return;const k=i.produto_id+'|'+v.canal;const x=preco[k]=preco[k]||{q:0,v:0,t:0};x.q+=+i.qtd;x.v+=i.qtd*i.preco_unit-(i.desconto||0);x.t+=+i.tarifa;}));
  const linhas=REF.produtos.filter(p=>p.ativo&&(!F.categoria||p.categoria===F.categoria)).map(p=>{const c=cm[p.id],cs=compras[p.id]||[];const u=cs[cs.length-1],pen=cs[cs.length-2];
    const pl=preco[p.id+'|loja'],pm=preco[p.id+'|mercado_livre'];const custo=c?+c.custo_medio:(p.eh_kit?null:null);
    const mg=(x)=>x&&custo!=null?((x.v-x.t)/x.q-custo)/(x.v/x.q):null;
    return {p,custo,ult:u?+u.custo_entrada:null,var:u&&pen?(u.custo_entrada/pen.custo_entrada-1):null,pl:pl?pl.v/pl.q:null,pm:pm?pm.v/pm.q:null,ml:mg(pl),mm:mg(pm),tarML:pm?pm.t/pm.q:null};});
  const sem=linhas.filter(x=>x.custo==null).length;
  $('conteudo').innerHTML=barraFiltros(['categoria'],()=>ir('custos'))+
  `<div class="info">Custo médio ponderado = (saldo anterior × custo médio anterior + unidades recebidas × custo de aquisição) ÷ saldo novo. Custo de aquisição = valor dos produtos − descontos ${REF.config.custo_inclui_frete?'+ frete':''} ${REF.config.custo_inclui_seguro_outras?'+ seguro e outras despesas':''} ${REF.config.custo_inclui_ipi?'+ IPI':''} ${REF.config.custo_inclui_st?'+ ICMS-ST':''}; rateio de despesas extras por <b>${REF.config.rateio_frete==='quantidade'?'quantidade':'valor'}</b>. Bonificações vinculadas entram a custo zero e diluem o custo da compra. Preços de venda: média dos últimos 90 dias.</div>
  ${sem?`<div class="aviso">${sem} produtos ativos sem custo confiável — aparecem como "sem custo" e não entram como custo zero.</div>`:''}
  <div class="barra-acoes"><button onclick="rodarReprocessar(this)">Reprocessar custos das vendas sem custo</button><button onclick="exportarTabela('custos',window._cc,window._lc)">Exportar CSV</button></div>
  <div class="secao">${tabela(window._cc=[{t:'Produto',v:x=>x.p.nome},{t:'Categoria',v:x=>x.p.categoria||''},{t:'Última compra',v:x=>x.ult,n:1},{t:'Var. últ. compra',v:x=>x.var,n:1,fmt:pct,h:x=>x.var==null?'—':`<span style="color:${x.var>0?'var(--red)':'var(--grn)'}">${pct(x.var)}</span>`},
    {t:'Custo médio',v:x=>x.custo,n:1,h:x=>x.custo==null?'<span class="tag r">sem custo</span>':brl(x.custo)},{t:'Preço loja',v:x=>x.pl,n:1},{t:'Margem loja',v:x=>x.ml,n:1,fmt:pct},{t:'Preço ML',v:x=>x.pm,n:1},{t:'Tarifa ML/un',v:x=>x.tarML,n:1},{t:'Margem ML',v:x=>x.mm,n:1,fmt:pct}],
    window._lc=linhas.sort((a,b)=>(a.custo==null)-(b.custo==null)||a.p.nome.localeCompare(b.p.nome)),{clique:x=>abrirProduto(x.p.id)})}</div>`;
};
async function rodarReprocessar(b){b.disabled=true;try{const n=await rpc('pp_reprocessar_custos_vendas',{p_produto:null});toast(`${nf(n)} itens conferidos. Vendas antigas com custo calculado não foram alteradas.`);}catch(e){toast(msgErro(e));}b.disabled=false;}

// ---------- RELATÓRIOS ----------
TELAS.relatorios=async function(){
  $('conteudo').innerHTML=barraFiltros(['periodo','empresa','canal','conta'],()=>ir('relatorios'))+'<div class="vazio">Calculando…</div>';
  const [vs,lancs]=await Promise.all([carregarVendas(F.de,F.ate,true),veFin()?tudo(()=>sb.from('pp_lancamentos').select('*').gte('vencimento',addDias(F.de,-400))):[]]);
  const meses=[...new Set(vs.map(v=>diaLocal(v.data_venda).slice(0,7)))].sort();
  const linhas=meses.map(ym=>({ym,...metricas(vs.filter(v=>diaLocal(v.data_venda).slice(0,7)===ym),lancs.filter(l=>(l.competencia||l.vencimento||'').slice(0,7)===ym))}));
  const tot=metricas(vs,lancs.filter(l=>{const d=l.competencia||l.vencimento;return d>=F.de&&d<=F.ate;}));
  const L=[['Faturamento bruto','bruto'],['(−) Cancelamentos','cancel'],['(−) Devoluções','devol'],['(−) Descontos','desc'],['= Faturamento líquido','liquido'],['Pedidos','pedidos'],['Ticket médio','ticket'],
    ...(veCusto()?[['(−) CMV','cmv'],['= Lucro bruto','lucro'],['(−) Tarifas e comissões','tarifas'],['(−) Frete vendedor','frete'],['(−) Outros variáveis','outros'],['= Margem de contribuição','mc'],['Vendas sem custo (fora do CMV)','semCusto']]:[]),
    ...(veFin()?[['(−) Despesas operacionais','despOp'],['= Resultado estimado','resultado']]:[])];
  const f=(k,v)=>k==='pedidos'?nf(v):brl(v);
  window._dre={L,linhas,tot};
  $('conteudo').innerHTML=barraFiltros(['periodo','empresa','canal','conta'],()=>ir('relatorios'))+
  `<div class="secao"><h2>Demonstrativo de resultado gerencial (DRE) <span><button class="sm" onclick="exportarDRE()">Exportar CSV</button> <button class="sm" onclick="window.print()">Imprimir</button></span></h2>
   <div class="rolarx"><table class="t"><thead><tr><th></th>${linhas.map(x=>`<th class="n">${mesNome(x.ym)}${x.ym===hojeISO().slice(0,7)?'*':''}</th>`).join('')}<th class="n">Período</th></tr></thead>
   <tbody>${L.map(([n,k])=>`<tr><td style="${n.startsWith('=')?'font-weight:700':''}">${n}</td>${linhas.map(x=>`<td class="n">${f(k,x[k])}</td>`).join('')}<td class="n"><b>${f(k,tot[k])}</b></td></tr>`).join('')}</tbody></table></div>
   <div class="mut peq">* mês em andamento. Definições: líquido = ${DEF.liquido} CMV = ${DEF.cmv}</div></div>
  <div class="secao"><h2>Outros relatórios</h2><div class="barra-acoes">
   <button onclick="ir('vendas')">Vendas por pedido (CSV na tela de vendas)</button><button onclick="ir('custos')">Custos e margens por produto</button><button onclick="ir('estoque')">Posição de estoque</button>${veFin()?'<button onclick="ir(\'financeiro\')">Fluxo de caixa e projeções</button>':''}<button onclick="ir('conciliacao')">Pendências</button></div></div>`;
};
function exportarDRE(){const {L,linhas,tot}=window._dre;const cols=[{t:'Linha',v:r=>r[0]},...linhas.map(x=>({t:x.ym,v:r=>x[r[1]]})),{t:'Período',v:r=>tot[r[1]]}];exportarTabela('dre',cols,L);}
