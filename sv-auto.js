// Sincronização automática SimplesVet → Gestão Pet Puppy (sem janela do Gestão).
// Roda na aba do SimplesVet já logada. Grava direto no banco com a chave de sincronização
// guardada no localStorage do SimplesVet ('pp-sync-chave'). Resultado em window.__ppAuto.
(async function(){
  var URL_SB='https://rxqlkfzsvoqydqqzffih.supabase.co/rest/v1/rpc/pp_sv_auto', KEY='sb_publishable__IZIszN0QheZChaDwqVA8A_vlQnP9tw';
  var S=window.__ppAuto={status:'rodando',etapa:'iniciando',inicio:new Date().toISOString()};
  function fim(st,txt,extra){S.status=st;S.texto=txt;S.fim=new Date().toISOString();Object.assign(S,extra||{});}
  try{
    if(!/simples\.vet$/.test(location.hostname)) return fim('erro','Abra o SimplesVet.');
    if(/\/login\//.test(location.pathname)) return fim('sem_login','O SimplesVet está sem login neste Chrome.');
    var chave=localStorage.getItem('pp-sync-chave'); if(!chave) return fim('erro','Chave de sincronização não encontrada neste Chrome.');
    async function rpc(tipo,dados,extra){var r=await fetch(URL_SB,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(Object.assign({p_chave:chave,p_tipo:tipo,p_dados:dados},extra||{}))});
      var j=await r.json().catch(function(){return null;}); if(!r.ok) throw new Error((j&&j.message)||('banco respondeu '+r.status)); return j;}
    var pagina=function(p,n){return fetch('https://api.simples.vet/app/v3/'+p+'?_porPagina=100&_pagina='+n,{credentials:'include',headers:{Accept:'application/json'}}).then(function(r){if(r.status===401||r.status===403)throw new Error('SIMPLESVET_LOGIN');if(!r.ok)throw new Error('SimplesVet respondeu '+r.status);return r.json();});};
    async function tudo(p,rot){var out=[],v={};for(var n=1;n<500;n++){var x=await pagina(p,n);if(!Array.isArray(x)||!x.length)break;var k=0;x.forEach(function(i){if(!v[i.id]){v[i.id]=1;out.push(i);k++;}});S.etapa=rot+': '+out.length;if(!k)break;}return out;}
    function num(v){v=Number(v);return isFinite(v)?v:0;}
    var vendas=await tudo('comercial/vendas','Lendo vendas'), produtos=await tudo('comercial/produtos','Lendo produtos');
    var vendido={},primeira=null;
    var V=vendas.map(function(a){var dh=String(a.dataHora||a.data||'').replace(' ','T').slice(0,19);if(dh.length===10)dh+='T12:00:00';if(!primeira||dh<primeira)primeira=dh;
      var itens=(a.produtos||[]).map(function(p,k){var serv=p.tipo==='S';var q=num(p.quantidade),pu=num(p.precoUnitario),vl=num(p.valorLiquido);if(!serv&&a.status!=='C')vendido[p.id]=(vendido[p.id]||0)+q;
        return {n:k+1,codigo:String(p.id),descricao:p.nome,qtd:q,preco_unit:pu,desconto:Math.max(0,Math.round((q*pu-vl)*100)/100),servico:serv,eh_servico:serv};});
      return {id:String(a.id),data:dh+'-03:00',status:a.status,bruto:num(a.valorBruto),desconto:num(a.valorDesconto),devolvido:num(a.valorDevolucoes),cliente:a.nome||null,itens:itens};});
    var P=produtos.filter(function(p){var est=p.estoque?num(p.estoque.valor):0;var t=p.tipo&&p.tipo.valor;return t!=='S'&&(est!==0||vendido[p.id]);}).map(function(p){var est=p.estoque?num(p.estoque.valor):0;var ean=String(p.codigoBarras||'').replace(/\D/g,'');
      return {id:String(p.id),nome:p.nome,ean:ean.length>=8?ean:'',categoria:p.grupo&&p.grupo.nome||'',unidade:p.unidade||'UN',preco:p.preco?num(p.preco.valor):0,custo:num(p.custo),estoque:est,abertura:est+(vendido[p.id]||0)};});
    var inicio=new Date(new Date(primeira+'-03:00').getTime()-864e5).toISOString().slice(0,10)+'T00:00:00-03:00';
    var log=(await rpc('inicio',{lidos:V.length+P.length})).log;
    var R={prodNovos:0,prodExist:0,vNovas:0,vAtual:0,vIguais:0,ajustes:0,erros:[]};
    async function lote(arr,n,fn,rot){for(var i=0;i<arr.length;i+=n){var pd=arr.slice(i,i+n);S.etapa=rot+' '+Math.min(i+n,arr.length)+'/'+arr.length;try{await fn(pd);}catch(e){R.erros.push(rot+' '+(i+1)+': '+e.message);}}}
    await lote(P,120,async function(p){var r=await rpc('produtos',p,{p_inicio:inicio});R.prodNovos+=r.novos||0;R.prodExist+=r.existentes||0;},'Gravando produtos');
    await lote(V,60,async function(v){var r=await rpc('vendas',v);R.vNovas+=r.novas||0;R.vAtual+=r.atualizadas||0;R.vIguais+=r.sem_alteracao||0;},'Gravando vendas');
    var ref=new Date().toISOString().slice(0,16);
    await lote(P.map(function(p){return {codigo:p.id,estoque:p.estoque};}),250,async function(a){var r=await rpc('ajustar',a,{p_ref:ref});R.ajustes+=r.ajustes||0;},'Conferindo estoque');
    var txt='Sincronização automática: '+R.vNovas+' vendas novas, '+R.vAtual+' atualizadas, '+R.vIguais+' sem alteração · '+R.prodNovos+' produtos novos · '+R.ajustes+' ajustes de estoque'+(R.erros.length?' · '+R.erros.length+' erros':'')+'.';
    var st=R.erros.length?((R.vNovas+R.vAtual+R.vIguais)?'parcial':'erro'):'ok';
    await rpc('fim',{status:st,gravados:R.vNovas+R.vAtual+R.prodNovos+R.ajustes,duplicados:R.vIguais+R.prodExist,erros:R.erros.length,mensagem:txt,detalhes:R.erros},{p_log:log});
    fim(st,txt,{resumo:R});
  }catch(e){ if(e.message==='SIMPLESVET_LOGIN') fim('sem_login','O login do SimplesVet expirou neste Chrome.'); else fim('erro','Erro: '+e.message); }
})();
