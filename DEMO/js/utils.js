function toast(msg, isError){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>{ t.className = ''; }, 2600);
}

function fillSelect(select, values, placeholder){
  if(!select) return;
  select.innerHTML = (placeholder ? `<option value="">${placeholder}</option>` : '') +
    values.map(v => `<option value="${v}">${v}</option>`).join('');
}

function diasRestantes(fecha){
  return Math.round((new Date(fecha) - HOY) / 86400000);
}
function colorPorDias(d){
  if(d <= 15) return 'rojo';
  if(d <= 45) return 'amarillo';
  return 'verde';
}

function lotesDe(nombreProducto){
  return lotes.filter(l => l.producto === nombreProducto)
    .sort((a,b)=> new Date(a.caducidad) - new Date(b.caducidad));
}
