function mostrar(){chrome.storage.local.get('ultimo',({ultimo:u})=>{const el=document.getElementById('st');if(!u)return;
  el.className=u.ok?'ok':'er';el.innerHTML='<b>'+new Date(u.em).toLocaleString('pt-BR')+'</b><br>'+u.texto.replace(/</g,'&lt;');});}
mostrar();chrome.storage.onChanged.addListener(mostrar);
document.getElementById('bt').onclick=e=>{e.target.disabled=true;e.target.textContent='Sincronizando… (até 3 min)';
  chrome.runtime.sendMessage({tipo:'agora'},()=>{e.target.disabled=false;e.target.textContent='Sincronizar agora';mostrar();});};
