/* ===== caducidades.js : lotes próximos a vencer con semáforo tipo LED (HU-4, HU-5) ===== */
let lotes = [];

function renderCaducidades(){
  const f = document.getElementById('cadFiltro').value;
  const lista = lotes.filter(l => !f || l.etiqueta === f);
  document.getElementById('cadBody').innerHTML = lista.map(l => `<tr>
      <td><span class="led-dot ${l.color}"></span>${l.etiqueta}</td>
      <td>${esc(l.producto)}</td><td>${esc(l.numero_lote)}</td><td>${esc(l.ubicacion)}</td><td>${esc(l.factura || '—')}</td>
      <td>${fechaCorta(l.caducidad)}</td><td>${l.dias < 0 ? `venció hace ${-l.dias} día(s)` : l.dias + ' días'}</td><td>${l.cantidad} u.</td>
    </tr>`).join('') || `<tr><td colspan="8" class="empty">Sin lotes con este filtro.</td></tr>`;
}

async function initPage(){
  lotes = await api('/inventario/caducidades');
  const caducados = lotes.filter(l => l.etiqueta === 'Caducado');
  const urgentes = lotes.filter(l => l.etiqueta === 'Urgente');
  let html = '';
  if(caducados.length) html += `<div class="alert-box">🚫 <div><b>${caducados.length} lote(s) caducado(s)</b> aún con existencia. Regístralos como merma en <a href="salidas.html">Salidas</a>.</div></div>`;
  if(urgentes.length) html += `<div class="alert-box warn">⏳ <div><b>${urgentes.length} lote(s) vencen en 15 días o menos.</b> El LED de su anaquel se muestra en rojo: dales salida primero.</div></div>`;
  document.getElementById('cadAlert').innerHTML = html;
  document.getElementById('cadFiltro').addEventListener('change', renderCaducidades);
  renderCaducidades();
}
