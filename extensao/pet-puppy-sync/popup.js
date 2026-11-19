function mostrar(){chrome.storage.local.get('ultimo',({ultimo:u})=>{const el=document.getElementById('st');if(!u)return;
  el.className=u.ok?'ok':'er';el.innerHTML='<b>'+(u.ok?'✓ ':'⚠ ')+new Date(u.em).toLocaleString('pt-BR')+'</b><br>'+String(u.texto||'').replace(/</g,'&lt;');});
  chrome.alarms.getAll(as=>{const t=as.filter(a=>a.name==='pp-sync'||a.name==='pp-repetir').map(a=>a.scheduledTime).sort()[0];
    document.getElementById('prox').textContent=t?'Próxima sincronização: '+new Date(t).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';});}
mostrar();chrome.storage.onChanged.addListener(mostrar);
document.getElementById('bt').onclick=e=>{e.target.disabled=true;e.target.textContent='Sincronizando… (até 3 min)';
  chrome.runtime.sendMessage({tipo:'agora'},()=>{e.target.disabled=false;e.target.textContent='Sincronizar agora';mostrar();});};
document.getElementById('sv').onclick=()=>{chrome.runtime.sendMessage({tipo:'abrirSV'});window.close();};
