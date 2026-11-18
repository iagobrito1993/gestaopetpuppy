// Sincronizador SimplesVet → Gestão Pet Puppy
// Roda dentro da página do SimplesVet (já logada). Lê produtos e vendas da API interna
// do SimplesVet com o login do usuário e envia para a janela do Gestão Pet Puppy,
// que grava no banco com o login dela. Nenhuma senha ou token sai daqui.
(function(){
  var DEST='https://gestaopetpuppy.com.br';
  if(!/simples\.vet$/.test(location.hostname)){alert('Abra o SimplesVet (app.simples.vet) e clique de novo.');return;}
  var w=window.open(DEST+'/#svsync','ppsync');
  var box=document.getElementById('pp-sync-box');
  if(!box){box=document.createElement('div');box.id='pp-sync-box';box.style.cssText='position:fixed;right:16px;bottom:16px;z-index:999999;background:#1d1c19;color:#fff;padding:14px 16px;border-radius:12px;font:14px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.3);border-left:6px solid #FFCC00;max-width:340px';document.body.appendChild(box);}
  function msg(t){box.innerHTML='<b style="color:#FFCC00">Gestão Pet Puppy</b><br>'+t;}
  if(!w){msg('O navegador bloqueou a janela. Permita pop-ups para app.simples.vet e clique de novo.');return;}
  msg('Lendo dados do SimplesVet…');
  function pagina(p,n){return fetch('https://api.simples.vet/app/v3/'+p+'?_porPagina=100&_pagina='+n,{credentials:'include',headers:{Accept:'application/json'}}).then(function(r){if(!r.ok)throw new Error('SimplesVet respondeu '+r.status);return r.json();});}
  async function tudo(p,rot){var out=[],vistos={};for(var n=1;n<500;n++){var x=await pagina(p,n);if(!Array.isArray(x)||!x.length)break;var novos=0;x.forEach(function(i){if(!vistos[i.id]){vistos[i.id]=1;out.push(i);novos++;}});msg(rot+': '+out.length);if(!novos)break;}return out;}
  function num(v){v=Number(v);return isFinite(v)?v:0;}
  (async function(){
    try{
      var vendas=await tudo('comercial/vendas','Vendas lidas');
      var produtos=await tudo('comercial/produtos','Produtos lidos');
      var vendido={},primeira=null;
      var V=vendas.map(function(a){
        var dh=String(a.dataHora||a.data||'').replace(' ','T').slice(0,19);if(dh.length===10)dh+='T12:00:00';
        if(!primeira||dh<primeira)primeira=dh;
        var itens=(a.produtos||[]).map(function(p,k){var serv=p.tipo==='S';var q=num(p.quantidade),pu=num(p.precoUnitario),vl=num(p.valorLiquido);
          if(!serv&&a.status!=='C')vendido[p.id]=(vendido[p.id]||0)+q;
          return {n:k+1,codigo:String(p.id),descricao:p.nome,qtd:q,preco_unit:pu,desconto:Math.max(0,Math.round((q*pu-vl)*100)/100),servico:serv,eh_servico:serv};});
        return {id:String(a.id),data:dh+'-03:00',status:a.status,bruto:num(a.valorBruto),desconto:num(a.valorDesconto),devolvido:num(a.valorDevolucoes),cliente:a.nome||null,itens:itens};});
      var P=produtos.filter(function(p){var est=p.estoque?num(p.estoque.valor):0;var tipo=p.tipo&&p.tipo.valor;return tipo!=='S'&&(est!==0||vendido[p.id]);}).map(function(p){
        var est=p.estoque?num(p.estoque.valor):0;var ean=String(p.codigoBarras||'').replace(/\D/g,'');
        return {id:String(p.id),nome:p.nome,ean:ean.length>=8?ean:'',categoria:p.grupo&&p.grupo.nome||'',unidade:p.unidade||'UN',preco:p.preco?num(p.preco.valor):0,custo:num(p.custo),estoque:est,abertura:est+(vendido[p.id]||0)};});
      var inicio=new Date(new Date(primeira+'-03:00').getTime()-864e5).toISOString().slice(0,10)+'T00:00:00-03:00';
      var dados={tipo:'pp-dados',origem:'simplesvet',inicio:inicio,produtos:P,vendas:V,lidos:{vendas:vendas.length,produtos:produtos.length},em:new Date().toISOString()};
      msg('Lidos '+V.length+' vendas e '+P.length+' produtos com estoque ou venda. Enviando…');
      var enviado=false;
      function enviar(){if(enviado)return;enviado=true;w.postMessage(dados,DEST);msg('Dados enviados. Acompanhe a gravação na janela do Gestão Pet Puppy.');}
      window.addEventListener('message',function(e){if(e.origin!==DEST)return;if(e.data&&e.data.tipo==='pp-pronto')enviar();if(e.data&&e.data.tipo==='pp-fim')msg(e.data.texto||'Sincronização concluída.');});
      var t=0,it=setInterval(function(){if(enviado||t++>120){clearInterval(it);return;}try{w.postMessage({tipo:'pp-ping'},DEST);}catch(e){}},1000);
    }catch(e){msg('Erro: '+e.message);}
  })();
})();
