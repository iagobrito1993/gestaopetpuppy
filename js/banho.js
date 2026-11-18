// =====================================================================
// Banho e Tosa: agenda, pets e tutores, retornos automáticos, pacotes, preços
// =====================================================================
const BT_STATUS={sugerido:['Retorno sugerido','b'],agendado:['Agendado',''],confirmado:['Confirmado','v'],em_atendimento:['Em atendimento','a'],pronto:['Pronto p/ buscar','v'],entregue:['Entregue','v'],faltou:['Faltou','r'],cancelado:['Cancelado','']};
const PORTES={mini:'Mini',pequeno:'Pequeno',medio:'Médio',grande:'Grande',gigante:'Gigante'};
const PELAGENS={curta:'Curta',media:'Média',longa:'Longa'};
const BT={tutores:[],pets:[],servicos:[],precos:[],prof:[],pacotes:[]};
let abaBT='agenda',diaBT=null,buscaBT='';
function podeBT(){return tem('operacao','banho_tosa');}
function tagBT(s){const x=BT_STATUS[s]||[s,''];return `<span class="tag ${x[1]}">${x[0]}</span>`;}
function horaLocal(ts){return new Date(ts).toLocaleTimeString('pt-BR',{timeZone:fuso(),hour:'2-digit',minute:'2-digit'});}
function pet(id){return BT.pets.find(p=>p.id==id)||{nome:'?'};}
function tutor(id){return BT.tutores.find(t=>t.id==id)||{nome:'?'};}
function tutorDoPet(pid){return tutor(pet(pid).tutor_id);}
function servico(id){return BT.servicos.find(s=>s.id==id)||{nome:'?'};}
function precoServico(sid,p){const l=BT.precos.filter(x=>x.servico_id==sid&&x.porte===p.porte);const e=l.find(x=>x.pelagem===p.pelagem)||l.find(x=>x.pelagem==='todas');return e?+e.preco:null;}
function foneWA(f){let d=String(f||'').replace(/\D/g,'');if(!d)return null;if(d.length<=11)d='55'+d;return d;}
function msgBT(chave,ag,extra={}){const p=pet(ag.pet_id),t=tutor(p.tutor_id);let m=String(REF.config[chave]||'');
  const dt=ag.data_hora?{data:fd(ag.data_hora),hora:horaLocal(ag.data_hora)}:{data:'',hora:''};
  return m.replace(/\{tutor\}/g,(t.nome||'').split(' ')[0]).replace(/\{pet\}/g,p.nome).replace(/\{data\}/g,dt.data).replace(/\{hora\}/g,dt.hora).replace(/\{dias\}/g,extra.dias??'');}
function linkWA(pid,texto){const f=foneWA(tutor(pet(pid).tutor_id).telefone);return f?`https://wa.me/${f}?text=${encodeURIComponent(texto)}`:null;}
async function carregarBT(){
  const [t,p,s,pr,pf,pc]=await Promise.all([tudo(()=>sb.from('pp_tutores').select('*').order('nome')),tudo(()=>sb.from('pp_pets').select('*').order('nome')),
    q(sb.from('pp_bt_servicos').select('*').order('id')),q(sb.from('pp_bt_precos').select('*')),q(sb.from('pp_bt_profissionais').select('*').order('nome')),q(sb.from('pp_bt_pacotes').select('*').order('id',{ascending:false}))]);
  Object.assign(BT,{tutores:t,pets:p,servicos:s,precos:pr,prof:pf,pacotes:pc});
}
async function agsPeriodo(de,ate){return tudo(()=>sb.from('pp_bt_agendamentos').select('*,pp_bt_ag_servicos(*)').gte('data_hora',tsIni(de)).lte('data_hora',tsFim(ate)).order('data_hora'));}

TELAS.banho=async function(){
  await carregarBT();diaBT=diaBT||hojeISO();
  const abas=[['agenda','Agenda'],['pets','Pets e tutores'],['retornos','Retornos'],['pacotes','Pacotes'],['resumo','Resultados'],...(master()?[['precos','Serviços, preços e equipe']]:[])];
  const ab=`<div class="abas2">${abas.map(([i,n])=>`<button class="${abaBT===i?'on':''}" onclick="abaBT='${i}';ir('banho')">${n}</button>`).join('')}
    ${podeBT()?'<button class="pri" onclick="modalAgendamento()">+ Agendar</button>':''}</div>`;
  if(!BT.precos.length&&master())$('conteudo').insertAdjacentHTML('afterbegin','');
  if(abaBT==='agenda')return telaAgenda(ab);
  if(abaBT==='pets')return telaPets(ab);
  if(abaBT==='retornos')return telaRetornos(ab);
  if(abaBT==='pacotes')return telaPacotes(ab);
  if(abaBT==='resumo')return telaResumoBT(ab);
  if(abaBT==='precos')return telaPrecosBT(ab);
};
async function telaAgenda(ab){
  const fim=addDias(diaBT,6);const ags=await agsPeriodo(diaBT,fim);
  const doDia=ags.filter(a=>diaLocal(a.data_hora)===diaBT);
  const cont=s=>doDia.filter(a=>a.status===s).length;
  const fat=soma(doDia.filter(a=>a.status==='entregue'),a=>a.valor_servicos-a.desconto+(+a.taxa_extra));
  const sug=ags.filter(a=>a.status==='sugerido');
  const card=a=>{const p=pet(a.pet_id),t=tutor(p.tutor_id),sv=(a.pp_bt_ag_servicos||[]).map(x=>servico(x.servico_id).nome+(x.pelo_pacote?' (pacote)':'')).join(', ');
    const pac=a.pacote_id&&BT.pacotes.find(x=>x.id===a.pacote_id);
    return `<div class="secao" style="margin-bottom:8px;padding:10px 12px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
     <div><b style="font-size:15px">${horaLocal(a.data_hora)}</b> · <b>${esc(p.nome)}</b> <span class="mut">(${esc(p.raca||p.especie)}, ${PORTES[p.porte]||''}, pelo ${PELAGENS[p.pelagem]||''})</span> ${tagBT(a.status)} ${a.leva_traz?'<span class="tag b">leva e traz</span>':''}
      <div class="mut peq">Tutor: ${esc(t.nome)} ${t.telefone?'· '+esc(t.telefone):''} · ${esc(sv||'sem serviço')} · <b>${brl(a.valor_servicos-a.desconto+(+a.taxa_extra))}</b>${pac?` · pacote ${pac.qtd_usada}/${pac.qtd_total}`:''}${a.profissional_id?' · '+esc((BT.prof.find(x=>x.id===a.profissional_id)||{}).nome||''):''}</div>
      ${p.cuidados||p.temperamento?`<div class="peq" style="color:var(--amb)">⚠ ${esc([p.temperamento,p.cuidados].filter(Boolean).join(' · '))}</div>`:''}${a.obs?`<div class="peq">${esc(a.obs)}</div>`:''}</div>
     <div class="barra-acoes" style="margin:0">${acoesAg(a)}</div></div></div>`;};
  $('conteudo').innerHTML=ab+`<div class="filtros"><div><label>Dia</label><input type="date" value="${diaBT}" onchange="diaBT=this.value;ir('banho')"></div>
    <div class="btn"><label>&nbsp;</label><button onclick="diaBT=addDias(diaBT,-1);ir('banho')">◀</button></div><div class="btn"><label>&nbsp;</label><button onclick="diaBT=hojeISO();ir('banho')">Hoje</button></div><div class="btn"><label>&nbsp;</label><button onclick="diaBT=addDias(diaBT,1);ir('banho')">▶</button></div></div>
  <div class="kpis"><div class="kpi"><div class="l">Atendimentos do dia</div><div class="v">${doDia.filter(a=>!['cancelado','sugerido'].includes(a.status)).length}</div><div class="s">${cont('confirmado')} confirmados · ${cont('agendado')} a confirmar</div></div>
   <div class="kpi"><div class="l">Em atendimento / prontos</div><div class="v">${cont('em_atendimento')} / ${cont('pronto')}</div></div>
   <div class="kpi"><div class="l">Entregues</div><div class="v">${cont('entregue')}</div><div class="s">${brl(fat)} faturados${doDia.some(a=>a.status==='entregue'&&!a.pago)?' · há entregue sem pagamento':''}</div></div>
   <div class="kpi ${sug.length?'alerta':''}" onclick="abaBT='retornos';ir('banho')"><div class="l">Retornos sugeridos (7 dias)</div><div class="v">${sug.length}</div><div class="s">criados automaticamente — confirme com o tutor</div></div></div>
  <div class="secao"><h2>${fd(diaBT)} <small>${new Date(diaBT+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long'})}</small></h2>${doDia.length?doDia.map(card).join(''):'<div class="vazio">Nenhum atendimento neste dia.</div>'}</div>
  <div class="secao"><h2>Próximos 6 dias</h2>${tabela([{t:'Data',v:a=>fd(a.data_hora)+' '+horaLocal(a.data_hora)},{t:'Pet',v:a=>pet(a.pet_id).nome},{t:'Tutor',v:a=>tutorDoPet(a.pet_id).nome},{t:'Serviços',v:a=>(a.pp_bt_ag_servicos||[]).map(x=>servico(x.servico_id).nome).join(', ')},{t:'Status',v:a=>a.status,h:a=>tagBT(a.status)},{t:'Valor',v:a=>a.valor_servicos-a.desconto+(+a.taxa_extra),n:1}],ags.filter(a=>diaLocal(a.data_hora)>diaBT),{rolar:false,clique:a=>modalAgendamento(a),vazio:'Nada agendado.'})}</div>`;
}
function acoesAg(a){if(!podeBT())return '';const b=(t,fn,cls='')=>`<button class="sm ${cls}" onclick="${fn}">${t}</button>`;const o=[];
  const wa=(chave,marca)=>{const l=linkWA(a.pet_id,msgBT(chave,a));return l?`<a class="sm" style="text-decoration:none" href="${l}" target="_blank" onclick="marcarBT(${a.id},'${marca}')"><button class="sm">WhatsApp</button></a>`:'';};
  if(a.status==='sugerido')o.push(b('Confirmar retorno',`statusBT(${a.id},'agendado')`,'pri'),wa('bt_msg_lembrete','lembrete_enviado_em'));
  if(a.status==='agendado')o.push(b('Confirmado',`statusBT(${a.id},'confirmado')`),wa('bt_msg_lembrete','lembrete_enviado_em'));
  if(['agendado','confirmado'].includes(a.status))o.push(b('Chegou',`statusBT(${a.id},'em_atendimento')`,'pri'),b('Faltou',`statusBT(${a.id},'faltou')`));
  if(a.status==='em_atendimento')o.push(b('Pronto',`statusBT(${a.id},'pronto')`,'pri'));
  if(a.status==='pronto')o.push(wa('bt_msg_pronto','aviso_pronto_em'),b('Entregar e receber',`modalEntregaBT(${a.id})`,'pri'));
  if(a.status==='entregue'&&!a.pago)o.push(b('Receber pagamento',`modalEntregaBT(${a.id})`,'pri'));
  if(!['entregue','cancelado','faltou'].includes(a.status))o.push(b('Editar',`abrirAgBT(${a.id})`),b('Cancelar',`statusBT(${a.id},'cancelado')`,'perigo'));
  return o.join('');}
async function statusBT(id,s){try{await q(sb.from('pp_bt_agendamentos').update({status:s}).eq('id',id));toast(BT_STATUS[s][0]+'.');ir('banho');}catch(e){toast(msgErro(e));}}
async function marcarBT(id,campo){try{await sb.from('pp_bt_agendamentos').update({[campo]:new Date().toISOString()}).eq('id',id);}catch(e){}}
async function abrirAgBT(id){const a=await q(sb.from('pp_bt_agendamentos').select('*,pp_bt_ag_servicos(*)').eq('id',id).single());modalAgendamento(a);}
function modalEntregaBT(id){
  sb.from('pp_bt_agendamentos').select('*,pp_bt_ag_servicos(*)').eq('id',id).single().then(({data:a})=>{
    abrir(`<h2>Entregar ${esc(pet(a.pet_id).nome)}</h2><div class="sub">Serviços: ${brl(a.valor_servicos)}${a.pacote_id?' (já descontado o que é do pacote)':''}</div>
    <div class="c3"><div class="campo"><label>Desconto</label><input id="be_d" value="${a.desconto||0}" inputmode="decimal"></div><div class="campo"><label>Taxa extra (leva e traz, nó no pelo…)</label><input id="be_t" value="${a.taxa_extra||0}" inputmode="decimal"></div>
    <div class="campo"><label>Forma de pagamento</label><select id="be_f">${['pix','dinheiro','debito','credito','pacote','a_prazo'].map(f=>`<option ${a.forma_pagto===f?'selected':''}>${f}</option>`).join('')}</select></div></div>
    <label><input type="checkbox" id="be_p" ${a.pago||a.valor_servicos==0?'checked':''}> Pagamento recebido</label>
    <div class="campo" style="margin-top:8px"><label>Observações do atendimento (fica no histórico do pet)</label><textarea id="be_o">${esc(a.obs_atendimento||'')}</textarea></div>
    <div class="info peq">Ao entregar: o pacote é baixado, o próximo retorno é agendado automaticamente${REF.config.bt_gera_venda!==false?' e, se pago, a venda entra no painel':''}.</div>
    <div class="erro"></div><div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="be_ok">Confirmar entrega</button></div>`);
    $('be_ok').onclick=()=>rodar($('be_ok'),async()=>{const d={desconto:num(val('be_d'))||0,taxa_extra:num(val('be_t'))||0,forma_pagto:val('be_f'),obs_atendimento:val('be_o')||null};
      await q(sb.from('pp_bt_agendamentos').update(d).eq('id',id));
      await q(sb.from('pp_bt_agendamentos').update({status:'entregue',pago:$('be_p').checked}).eq('id',id));
      fechar();toast('Entregue. Próximo retorno agendado automaticamente.');ir('banho');});});
}
function modalAgendamento(a){
  if(!podeBT())return toast('Seu perfil não agenda.');
  a=a||{};const p0=a.pet_id?pet(a.pet_id):null;
  const dt=a.data_hora?diaLocal(a.data_hora):diaBT||hojeISO(),hr=a.data_hora?horaLocal(a.data_hora):'09:00';
  const sel=new Set((a.pp_bt_ag_servicos||[]).map(x=>x.servico_id));
  abrir(`<h2>${a.id?'Editar atendimento #'+a.id:'Novo agendamento'}</h2><div class="sub">${a.origem==='recorrencia'?'Retorno criado automaticamente pela frequência do pet.':''}</div>
  <div class="campo"><label>Pet</label><input id="ag_p" list="ag_pl" value="${p0?esc(p0.nome+' · '+tutor(p0.tutor_id).nome):''}" placeholder="Nome do pet ou do tutor"><datalist id="ag_pl">${BT.pets.filter(p=>p.ativo).map(p=>`<option value="${esc(p.nome+' · '+tutor(p.tutor_id).nome)}">`).join('')}</datalist>
   <button class="lk peq" onclick="modalPet(null,true)">+ cadastrar pet e tutor</button></div>
  <div class="c3"><div class="campo"><label>Data</label><input type="date" id="ag_d" value="${dt}"></div><div class="campo"><label>Hora</label><input type="time" id="ag_h" value="${hr}"></div>
   <div class="campo"><label>Profissional</label><select id="ag_pr">${opcoes(BT.prof.filter(x=>x.ativo),a.profissional_id,'—')}</select></div></div>
  <div class="campo"><label>Serviços</label><div id="ag_sv"></div></div>
  <div id="ag_pac"></div>
  <div class="c2"><label><input type="checkbox" id="ag_lt" ${a.leva_traz?'checked':''}> Leva e traz</label><div class="campo"><label>Observação</label><input id="ag_o" value="${esc(a.obs||'')}"></div></div>
  <div class="total" id="ag_tot"></div><div class="erro"></div>
  <div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="ag_ok">${a.id?'Salvar':'Agendar'}</button></div>`);
  const achar=()=>{const t=norm(val('ag_p'));return BT.pets.find(p=>norm(p.nome+' · '+tutor(p.tutor_id).nome)===t);};
  const desenhar=()=>{const p=achar();
    $('ag_sv').innerHTML=BT.servicos.filter(s=>s.ativo).map(s=>{const pr=p?precoServico(s.id,p):null;const ant=(a.pp_bt_ag_servicos||[]).find(x=>x.servico_id===s.id);
      return `<label style="display:inline-flex;gap:6px;margin:0 14px 6px 0"><input type="checkbox" class="ag_s" value="${s.id}" ${sel.has(s.id)?'checked':''}> ${esc(s.nome)} <span class="mut">${ant?brl(ant.preco):pr!=null?brl(pr):p?'sem preço p/ '+PORTES[p.porte]:''}</span></label>`;}).join('');
    const pacs=p?BT.pacotes.filter(x=>x.pet_id===p.id&&x.qtd_usada<x.qtd_total&&(!x.validade||x.validade>=val('ag_d'))):[];
    $('ag_pac').innerHTML=pacs.length?`<div class="campo"><label>Pacote</label><select id="ag_pk"><option value="">Não usar pacote</option>${pacs.map(x=>`<option value="${x.id}" ${a.pacote_id===x.id||(!a.id&&pacs.length===1&&x.id===pacs[0].id)?'selected':''}>${esc(x.descricao||servico(x.servico_id).nome)} — usados ${x.qtd_usada}/${x.qtd_total}</option>`).join('')}</select></div>`:'';
    document.querySelectorAll('.ag_s').forEach(c=>c.onchange=()=>{c.checked?sel.add(+c.value):sel.delete(+c.value);total();});if($('ag_pk'))$('ag_pk').onchange=total;total();};
  const linhas=()=>{const p=achar();const pk=$('ag_pk')&&val('ag_pk')?BT.pacotes.find(x=>x.id==val('ag_pk')):null;
    return [...sel].map(sid=>{const ant=(a.pp_bt_ag_servicos||[]).find(x=>x.servico_id===sid);const pr=ant?+ant.preco:(p?precoServico(sid,p):null);return {servico_id:sid,preco:pr,pelo_pacote:!!(pk&&pk.servico_id===sid)};});};
  const total=()=>{const l=linhas();$('ag_tot').innerHTML=`Total previsto: <b>${brl(soma(l,x=>x.pelo_pacote?0:(x.preco||0)))}</b>${l.some(x=>x.preco==null)?' <span class="tag a">serviço sem preço para este porte</span>':''}`;};
  $('ag_p').onchange=desenhar;$('ag_d').onchange=desenhar;desenhar();
  $('ag_ok').onclick=()=>rodar($('ag_ok'),async()=>{const p=achar();if(!p)throw new Error('Escolha o pet da lista (ou cadastre).');const l=linhas();if(!l.length)throw new Error('Marque ao menos um serviço.');
    if(l.some(x=>x.preco==null))throw new Error('Há serviço sem preço para o porte do pet. Cadastre em Serviços e preços.');
    const dur=soma(l,x=>servico(x.servico_id).duracao_min)||60;
    const d={pet_id:p.id,data_hora:val('ag_d')+'T'+val('ag_h')+':00'+offsetFuso(),duracao_min:dur,profissional_id:val('ag_pr')?+val('ag_pr'):null,leva_traz:$('ag_lt').checked,obs:val('ag_o')||null,pacote_id:$('ag_pk')&&val('ag_pk')?+val('ag_pk'):null};
    if(a.status==='sugerido')d.status='agendado';
    // conflito de horário do mesmo profissional
    if(d.profissional_id){const c=await q(sb.from('pp_bt_agendamentos').select('id,data_hora,duracao_min').eq('profissional_id',d.profissional_id).gte('data_hora',tsIni(val('ag_d'))).lte('data_hora',tsFim(val('ag_d'))).not('status','in','(cancelado,faltou,sugerido)'));
      const ini=new Date(d.data_hora).getTime(),fim=ini+dur*6e4;const x=c.find(o=>o.id!==a.id&&new Date(o.data_hora).getTime()<fim&&new Date(o.data_hora).getTime()+o.duracao_min*6e4>ini);
      if(x&&!confirm('Este profissional já tem atendimento às '+horaLocal(x.data_hora)+'. Agendar mesmo assim?'))return;}
    let id=a.id;if(id)await q(sb.from('pp_bt_agendamentos').update(d).eq('id',id));else id=(await q(sb.from('pp_bt_agendamentos').insert(d).select('id').single())).id;
    await q(sb.from('pp_bt_ag_servicos').delete().eq('agendamento_id',id));await q(sb.from('pp_bt_ag_servicos').insert(l.map(x=>({agendamento_id:id,...x}))));
    diaBT=val('ag_d');fechar();toast('Agendado para '+fd(val('ag_d'))+' às '+val('ag_h')+'.');ir('banho');});
}
async function telaPets(ab){
  const ult=await tudo(()=>sb.from('pp_bt_agendamentos').select('pet_id,data_hora,status').in('status',['entregue','agendado','confirmado','sugerido']).order('data_hora'));
  const uE={},prox={};const agora=new Date().toISOString();ult.forEach(a=>{if(a.status==='entregue')uE[a.pet_id]=a.data_hora;else if(a.data_hora>=agora&&!prox[a.pet_id])prox[a.pet_id]=a.data_hora;});
  const t=norm(buscaBT);const l=BT.pets.filter(p=>!t||norm(p.nome+' '+tutor(p.tutor_id).nome+' '+(tutor(p.tutor_id).telefone||'')+' '+(p.raca||'')).includes(t));
  $('conteudo').innerHTML=ab+`<div class="barra-acoes"><input type="search" id="bbt" placeholder="Pet, tutor, telefone ou raça" value="${esc(buscaBT)}" style="flex:1;min-width:220px">${podeBT()?'<button class="pri" onclick="modalPet()">+ Pet e tutor</button>':''}</div>
  <div class="secao">${tabela([{t:'Pet',v:p=>p.nome,h:p=>esc(p.nome)+(p.ativo?'':' <span class="tag">inativo</span>')},{t:'Tutor',v:p=>tutor(p.tutor_id).nome},{t:'Telefone',v:p=>tutor(p.tutor_id).telefone||''},{t:'Raça',v:p=>p.raca||''},{t:'Porte',v:p=>PORTES[p.porte]},{t:'Pelo',v:p=>PELAGENS[p.pelagem]},
    {t:'Frequência',v:p=>p.frequencia_dias?p.frequencia_dias+' dias':'padrão'},{t:'Último banho',v:p=>uE[p.id]?fd(uE[p.id]):'—'},{t:'Próximo',v:p=>prox[p.id]?fd(prox[p.id]):'—'}],l,{clique:p=>abrirPet(p.id)})}</div>`;
  $('bbt').onchange=e=>{buscaBT=e.target.value;ir('banho');};
}
function modalPet(p,voltarAg){
  const e=p||{},t=p?tutor(p.tutor_id):{};
  abrir(`<h2>${p?'Editar pet':'Cadastrar pet e tutor'}</h2>
  <div class="c2"><div class="campo"><label>Tutor</label><input id="mp_t" list="mp_tl" value="${esc(t.nome||'')}" placeholder="Nome do tutor (novo ou existente)"><datalist id="mp_tl">${BT.tutores.map(x=>`<option value="${esc(x.nome)}">`).join('')}</datalist></div>
   <div class="campo"><label>WhatsApp do tutor</label><input id="mp_f" value="${esc(t.telefone||'')}" placeholder="(11) 99999-0000"></div></div>
  <div class="c3"><div class="campo"><label>Nome do pet</label><input id="mp_n" value="${esc(e.nome||'')}"></div><div class="campo"><label>Espécie</label><select id="mp_e">${opcoes([{id:'cao',nome:'Cão'},{id:'gato',nome:'Gato'},{id:'outro',nome:'Outro'}],e.especie||'cao',null)}</select></div><div class="campo"><label>Raça</label><input id="mp_r" value="${esc(e.raca||'')}"></div></div>
  <div class="c3"><div class="campo"><label>Porte</label><select id="mp_po">${opcoes(Object.entries(PORTES).map(([id,nome])=>({id,nome})),e.porte||'pequeno',null)}</select></div><div class="campo"><label>Pelagem</label><select id="mp_pe">${opcoes(Object.entries(PELAGENS).map(([id,nome])=>({id,nome})),e.pelagem||'curta',null)}</select></div>
   <div class="campo"><label>Banho a cada (dias)</label><input id="mp_fr" value="${e.frequencia_dias??''}" placeholder="padrão ${REF.config.bt_frequencia_padrao||15}" inputmode="numeric"></div></div>
  <div class="c2"><div class="campo"><label>Temperamento</label><input id="mp_tp" value="${esc(e.temperamento||'')}" placeholder="dócil, morde, ansioso…"></div><div class="campo"><label>Cuidados (shampoo, alergias, pele)</label><input id="mp_cu" value="${esc(e.cuidados||'')}"></div></div>
  ${p?`<label><input type="checkbox" id="mp_a" ${e.ativo?'checked':''}> Ativo</label>`:''}
  <div class="erro"></div><div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="mp_ok">Salvar</button></div>`);
  $('mp_ok').onclick=()=>rodar($('mp_ok'),async()=>{const nt=val('mp_t'),np=val('mp_n');if(!nt||!np)throw new Error('Informe tutor e pet.');
    let tu=BT.tutores.find(x=>norm(x.nome)===norm(nt));const fone=val('mp_f');
    if(!tu)tu=await q(sb.from('pp_tutores').insert({nome:nt,telefone:fone||null}).select().single());else if(fone&&fone!==tu.telefone)await q(sb.from('pp_tutores').update({telefone:fone}).eq('id',tu.id));
    const d={tutor_id:tu.id,nome:np,especie:val('mp_e'),raca:val('mp_r')||null,porte:val('mp_po'),pelagem:val('mp_pe'),frequencia_dias:parseInt(val('mp_fr'))||null,temperamento:val('mp_tp')||null,cuidados:val('mp_cu')||null};
    if($('mp_a'))d.ativo=$('mp_a').checked;
    if(p)await q(sb.from('pp_pets').update(d).eq('id',p.id));else await q(sb.from('pp_pets').insert(d));
    await carregarBT();fechar();toast('Pet salvo.');if(voltarAg)modalAgendamento();else ir('banho');});
}
async function abrirPet(id){
  const p=pet(id),t=tutor(p.tutor_id);const h=await q(sb.from('pp_bt_agendamentos').select('*,pp_bt_ag_servicos(*)').eq('pet_id',id).order('data_hora',{ascending:false}));
  const ent=h.filter(a=>a.status==='entregue');
  abrir(`<h2>${esc(p.nome)}</h2><div class="sub">${esc(p.raca||'')} · ${PORTES[p.porte]} · pelo ${PELAGENS[p.pelagem]} · banho a cada ${p.frequencia_dias||REF.config.bt_frequencia_padrao||15} dias<br>Tutor: ${esc(t.nome)} ${t.telefone?'· '+esc(t.telefone):''}</div>
  ${p.temperamento||p.cuidados?`<div class="aviso">${esc([p.temperamento,p.cuidados].filter(Boolean).join(' · '))}</div>`:''}
  <div class="kpis"><div class="kpi"><div class="l">Atendimentos</div><div class="v">${ent.length}</div></div><div class="kpi"><div class="l">Gasto total</div><div class="v">${brl(soma(ent,a=>a.valor_servicos-a.desconto+(+a.taxa_extra)))}</div></div><div class="kpi"><div class="l">Faltas</div><div class="v">${h.filter(a=>a.status==='faltou').length}</div></div></div>
  ${tabela([{t:'Data',v:a=>fd(a.data_hora)+' '+horaLocal(a.data_hora)},{t:'Serviços',v:a=>(a.pp_bt_ag_servicos||[]).map(x=>servico(x.servico_id).nome).join(', ')},{t:'Status',v:a=>a.status,h:a=>tagBT(a.status)},{t:'Valor',v:a=>a.valor_servicos-a.desconto+(+a.taxa_extra),n:1},{t:'Observações',v:a=>a.obs_atendimento||a.obs||''}],h,{rolar:false})}
  <div class="rodape">${podeBT()?`<button onclick='modalPet(pet(${id}))'>Editar</button><button onclick="modalPacote(${id})">+ Pacote</button><button class="pri" onclick="modalAgendamento({pet_id:${id}})">Agendar</button>`:''}<button onclick="fechar()">Fechar</button></div>`,true);
}
async function telaRetornos(ab){
  const ags=await tudo(()=>sb.from('pp_bt_agendamentos').select('id,pet_id,data_hora,status').not('status','in','(cancelado,faltou)').order('data_hora'));
  const agora=new Date().toISOString(),hoje=hojeISO(),pad=+REF.config.bt_frequencia_padrao||15;
  const porPet=agrupar(ags,a=>a.pet_id);
  const atras=[],sug=ags.filter(a=>a.status==='sugerido'&&a.data_hora>=tsIni(hoje));
  BT.pets.filter(p=>p.ativo).forEach(p=>{const l=porPet[p.id]||[];const ue=l.filter(a=>a.status==='entregue').pop();const fut=l.find(a=>a.data_hora>=agora&&a.status!=='entregue');
    if(ue&&!fut){const dias=Math.floor((Date.now()-new Date(ue.data_hora))/864e5);const f=p.frequencia_dias||pad;if(dias>=f)atras.push({p,ue,dias,f});}});
  window._sugBT=sug;
  $('conteudo').innerHTML=ab+`<div class="info">Automático: ao entregar um pet, o sistema já cria o próximo retorno como <b>sugerido</b>, pela frequência do pet (ou ${pad} dias). Aqui você confirma com o tutor pelo WhatsApp. "Gerar retornos" cria sugestões para quem ficou sem próximo agendamento.</div>
  <div class="barra-acoes">${podeBT()?'<button class="pri" id="gr">Gerar retornos agora</button>':''}</div>
  <div class="secao"><h2>Retornos sugeridos a confirmar <small>${sug.length}</small></h2>${tabela([{t:'Data sugerida',v:a=>fd(a.data_hora)+' '+horaLocal(a.data_hora)},{t:'Pet',v:a=>pet(a.pet_id).nome},{t:'Tutor',v:a=>tutorDoPet(a.pet_id).nome},{t:'Telefone',v:a=>tutorDoPet(a.pet_id).telefone||''},
    {t:'',v:()=>'',h:a=>{const l=linkWA(a.pet_id,msgBT('bt_msg_lembrete',a));return (l?`<a href="${l}" target="_blank" onclick="marcarBT(${a.id},'lembrete_enviado_em')"><button class="sm">WhatsApp</button></a> `:'')+(podeBT()?`<button class="sm pri" onclick="statusBT(${a.id},'agendado')">Confirmar</button> <button class="sm" onclick="abrirAgBT(${a.id})">Mudar horário</button>`:'');}}],sug,{rolar:false,vazio:'Nenhum retorno pendente.'})}</div>
  <div class="secao"><h2>Pets atrasados sem agendamento <small>${atras.length}</small></h2>${tabela([{t:'Pet',v:x=>x.p.nome},{t:'Tutor',v:x=>tutor(x.p.tutor_id).nome},{t:'Último banho',v:x=>fd(x.ue.data_hora)},{t:'Dias',v:x=>x.dias,n:1,fmt:nf},{t:'Frequência',v:x=>x.f+' dias'},
    {t:'',v:()=>'',h:x=>{const l=linkWA(x.p.id,msgBT('bt_msg_retorno',{pet_id:x.p.id,data_hora:addDias(hojeISO(),1)+'T12:00:00'+offsetFuso()},{dias:x.dias}));return (l?`<a href="${l}" target="_blank"><button class="sm">WhatsApp</button></a> `:'')+(podeBT()?`<button class="sm pri" onclick="modalAgendamento({pet_id:${x.p.id}})">Agendar</button>`:'');}}],atras.sort((a,b)=>b.dias-a.dias),{rolar:false,vazio:'Nenhum pet atrasado.'})}</div>`;
  if($('gr'))$('gr').onclick=async()=>{try{const n=await rpc('pp_bt_gerar_retornos');toast(n+' retornos sugeridos criados.');}catch(e){toast(msgErro(e));}ir('banho');};
}
function telaPacotes(ab){
  $('conteudo').innerHTML=ab+`<div class="secao"><h2>Pacotes</h2>${tabela([{t:'Pet',v:x=>pet(x.pet_id).nome},{t:'Tutor',v:x=>tutorDoPet(x.pet_id).nome},{t:'Pacote',v:x=>x.descricao||servico(x.servico_id).nome},{t:'Usados',v:x=>x.qtd_usada+' de '+x.qtd_total,h:x=>`<b>${x.qtd_usada}</b> de ${x.qtd_total}${x.qtd_usada>=x.qtd_total?' <span class="tag">encerrado</span>':''}`},
    {t:'Valor',v:x=>+x.valor,n:1,tot:1},{t:'Pago',v:x=>x.pago?'Sim':'Não',h:x=>x.pago?'<span class="tag v">pago</span>':'<span class="tag r">a receber</span>'},{t:'Validade',v:x=>fd(x.validade)}],BT.pacotes,{rolar:false,vazio:'Nenhum pacote. Crie pela ficha do pet.'})}</div>`;
}
function modalPacote(pid){
  abrir(`<h2>Novo pacote · ${esc(pet(pid).nome)}</h2><div class="c2"><div class="campo"><label>Serviço coberto</label><select id="pk_s">${opcoes(BT.servicos.filter(s=>s.ativo),'',null)}</select></div><div class="campo"><label>Descrição</label><input id="pk_d" placeholder="Pacote 4 banhos/mês"></div></div>
  <div class="c3"><div class="campo"><label>Quantidade</label><input id="pk_q" value="4" inputmode="numeric"></div><div class="campo"><label>Valor total</label><input id="pk_v" inputmode="decimal"></div><div class="campo"><label>Validade</label><input type="date" id="pk_val" value="${addDias(hojeISO(),35)}"></div></div>
  <label><input type="checkbox" id="pk_p" checked> Pago</label><div class="erro"></div><div class="rodape"><button onclick="abrirPet(${pid})">Voltar</button><button class="pri" id="pk_ok">Criar</button></div>`);
  $('pk_ok').onclick=()=>rodar($('pk_ok'),async()=>{const qd=parseInt(val('pk_q')),v=num(val('pk_v'));if(!(qd>0)||!(v>=0))throw new Error('Confira quantidade e valor.');
    await q(sb.from('pp_bt_pacotes').insert({pet_id:pid,servico_id:+val('pk_s'),descricao:val('pk_d')||null,qtd_total:qd,valor:v,validade:val('pk_val')||null,pago:$('pk_p').checked}));
    await carregarBT();fechar();toast('Pacote criado. Os próximos agendamentos usam o pacote automaticamente.');ir('banho');});
}
async function telaResumoBT(ab){
  const ags=await agsPeriodo(F.de,F.ate);const ent=ags.filter(a=>a.status==='entregue');const fat=soma(ent,a=>a.valor_servicos-a.desconto+(+a.taxa_extra));
  const porS={};ent.forEach(a=>(a.pp_bt_ag_servicos||[]).forEach(x=>{const k=servico(x.servico_id).nome;const o=porS[k]=porS[k]||{n:0,v:0};o.n++;o.v+=x.pelo_pacote?0:+x.preco;}));
  const porP={};ent.forEach(a=>{const pr=BT.prof.find(x=>x.id===a.profissional_id)||{nome:'Sem profissional',comissao_pct:0};const o=porP[pr.nome]=porP[pr.nome]||{n:0,v:0,c:+pr.comissao_pct||0};o.n++;o.v+=a.valor_servicos-a.desconto;});
  const faltas=ags.filter(a=>a.status==='faltou').length,validos=ags.filter(a=>!['cancelado','sugerido'].includes(a.status)).length;
  const aberto=ent.filter(a=>!a.pago);
  $('conteudo').innerHTML=barraFiltros(['periodo'],()=>ir('banho'))+ab+`<div class="kpis"><div class="kpi"><div class="l">Atendimentos entregues</div><div class="v">${ent.length}</div></div><div class="kpi"><div class="l">Faturamento banho e tosa</div><div class="v">${brl(fat)}</div><div class="s">ticket ${brl(ent.length?fat/ent.length:null)}</div></div>
   <div class="kpi ${faltas?'alerta':''}"><div class="l">Faltas</div><div class="v">${faltas}</div><div class="s">${pct(validos?faltas/validos:null)} dos agendados</div></div><div class="kpi ${aberto.length?'ruim':''}"><div class="l">Entregues sem pagamento</div><div class="v">${brl(soma(aberto,a=>a.valor_servicos-a.desconto+(+a.taxa_extra)))}</div><div class="s">${aberto.length} atendimentos</div></div></div>
  <div class="grade2"><div class="secao"><h2>Por serviço</h2>${tabela([{t:'Serviço',v:x=>x[0]},{t:'Qtd',v:x=>x[1].n,n:1,fmt:nf},{t:'Valor',v:x=>x[1].v,n:1,tot:1}],Object.entries(porS),{rolar:false})}</div>
  <div class="secao"><h2>Por profissional</h2>${tabela([{t:'Profissional',v:x=>x[0]},{t:'Atend.',v:x=>x[1].n,n:1,fmt:nf},{t:'Valor',v:x=>x[1].v,n:1,tot:1},{t:'Comissão',v:x=>x[1].v*x[1].c/100,n:1,tot:1}],Object.entries(porP),{rolar:false})}</div></div>`;
}
function telaPrecosBT(ab){
  const portes=Object.keys(PORTES);
  $('conteudo').innerHTML=ab+`<div class="secao"><h2>Tabela de preços por porte <small>vale para todas as pelagens</small></h2><div class="rolarx"><table class="t"><thead><tr><th>Serviço</th><th>Duração (min)</th>${portes.map(p=>`<th class="n">${PORTES[p]}</th>`).join('')}<th>Ativo</th></tr></thead><tbody>
   ${BT.servicos.map(s=>`<tr><td><input class="ps_n" data-s="${s.id}" value="${esc(s.nome)}"></td><td><input class="ps_d" data-s="${s.id}" value="${s.duracao_min}" style="width:70px"></td>${portes.map(p=>{const x=BT.precos.find(r=>r.servico_id===s.id&&r.porte===p&&r.pelagem==='todas');return `<td class="n"><input class="ps_p" data-s="${s.id}" data-p="${p}" value="${x?String(x.preco).replace('.',','):''}" style="width:80px;text-align:right"></td>`;}).join('')}<td><input type="checkbox" class="ps_a" data-s="${s.id}" ${s.ativo?'checked':''}></td></tr>`).join('')}</tbody></table></div>
   <div class="barra-acoes" style="margin-top:8px"><button onclick="novoServicoBT()">+ Serviço</button><button class="pri" id="ps_ok">Salvar preços</button></div></div>
  <div class="secao"><h2>Equipe</h2>${tabela([{t:'Profissional',v:x=>x.nome},{t:'Comissão %',v:x=>+x.comissao_pct,n:1,fmt:x=>nf(x,1)+'%'},{t:'Ativo',v:x=>x.ativo?'Sim':'Não'}],BT.prof,{rolar:false,clique:x=>modalProfBT(x)})}<button class="sm" onclick="modalProfBT()">+ Profissional</button></div>
  <div class="secao"><h2>Mensagens de WhatsApp</h2><div class="mut peq">Use {tutor}, {pet}, {data}, {hora}, {dias}.</div>
   ${[['bt_msg_lembrete','Lembrete / confirmação'],['bt_msg_pronto','Pet pronto'],['bt_msg_retorno','Retorno (pet atrasado)']].map(([k,n])=>`<div class="campo"><label>${n}</label><textarea id="m_${k}">${esc(REF.config[k]||'')}</textarea></div>`).join('')}
   <div class="c2"><div class="campo"><label>Frequência padrão (dias)</label><input id="m_freq" value="${REF.config.bt_frequencia_padrao||15}"></div><label style="align-self:end"><input type="checkbox" id="m_venda" ${REF.config.bt_gera_venda!==false?'checked':''}> Atendimento entregue e pago entra como venda no painel</label></div>
   <div class="mut peq">Se as vendas de banho e tosa também forem lançadas no SimplesVet e importadas, desmarque a opção acima para não contar duas vezes.</div>
   <button class="pri" id="m_ok">Salvar mensagens</button></div>`;
  $('ps_ok').onclick=async()=>{try{for(const s of BT.servicos){const nome=document.querySelector(`.ps_n[data-s="${s.id}"]`).value.trim(),dur=parseInt(document.querySelector(`.ps_d[data-s="${s.id}"]`).value)||60,at=document.querySelector(`.ps_a[data-s="${s.id}"]`).checked;
      if(nome!==s.nome||dur!==s.duracao_min||at!==s.ativo)await q(sb.from('pp_bt_servicos').update({nome,duracao_min:dur,ativo:at}).eq('id',s.id));}
    const ups=[],dels=[];document.querySelectorAll('.ps_p').forEach(i=>{const v=num(i.value);const k={servico_id:+i.dataset.s,porte:i.dataset.p,pelagem:'todas'};if(i.value.trim()===''||isNaN(v))dels.push(k);else ups.push({...k,preco:v});});
    if(ups.length)await q(sb.from('pp_bt_precos').upsert(ups));for(const k of dels)await sb.from('pp_bt_precos').delete().match(k);
    await carregarBT();toast('Preços salvos.');}catch(e){toast(msgErro(e));}};
  $('m_ok').onclick=async()=>{try{await q(sb.from('pp_config').upsert([['bt_msg_lembrete'],['bt_msg_pronto'],['bt_msg_retorno']].map(([k])=>({chave:k,valor:val('m_'+k)})).concat([{chave:'bt_frequencia_padrao',valor:parseInt(val('m_freq'))||15},{chave:'bt_gera_venda',valor:$('m_venda').checked}])));await carregarRef();toast('Salvo.');}catch(e){toast(msgErro(e));}};
}
function novoServicoBT(){const n=prompt('Nome do serviço');if(!n)return;sb.from('pp_bt_servicos').insert({nome:n,tipo:'adicional',duracao_min:30}).then(async({error})=>{if(error)return toast(msgErro(error));await carregarBT();ir('banho');});}
function modalProfBT(x){x=x||{};abrir(`<h2>${x.id?'Editar':'Novo'} profissional</h2><div class="c2"><div class="campo"><label>Nome</label><input id="pf_n" value="${esc(x.nome||'')}"></div><div class="campo"><label>Comissão (%)</label><input id="pf_c" value="${x.comissao_pct??0}"></div></div>
  ${x.id?`<label><input type="checkbox" id="pf_a" ${x.ativo?'checked':''}> Ativo</label>`:''}<div class="erro"></div><div class="rodape"><button onclick="fechar()">Cancelar</button><button class="pri" id="pf_ok">Salvar</button></div>`);
  $('pf_ok').onclick=()=>rodar($('pf_ok'),async()=>{const d={nome:val('pf_n'),comissao_pct:num(val('pf_c'))||0};if($('pf_a'))d.ativo=$('pf_a').checked;if(!d.nome)throw new Error('Informe o nome.');
    if(x.id)await q(sb.from('pp_bt_profissionais').update(d).eq('id',x.id));else await q(sb.from('pp_bt_profissionais').insert(d));await carregarBT();fechar();ir('banho');});}
