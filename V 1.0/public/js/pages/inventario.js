/* ===== inventario.js : existencias y alertas de stock mínimo (HU-6) ===== */
let inventario = [];

function renderInventario(){
  const cat = document.getElementById('invCategoria').value;
  const estado = document.getElementById('invEstado').value;
  const lista = inventario.filter(p => (!cat || p.categoria === cat) && (!estado || p.stock_bajo));

  const bajos = inventario.filter(p => p.stock_bajo);
  const vencidos = inventario.filter(p => p.stock_vencido > 0);
  let alertas = '';
  if(bajos.length) alertas += `<div class="alert-box">⚠️ <div><b>${bajos.length} producto(s) en o por debajo del mínimo:</b> ${bajos.map(p => esc(p.nombre)).join(', ')}. Se recomienda reabastecer.</div></div>`;
  if(vencidos.length) alertas += `<div class="alert-box">🚫 <div><b>Existencia caducada:</b> ${vencidos.map(p => `${esc(p.nombre)} (${p.stock_vencido} u.)`).join(', ')}. No se cuenta como disponible.</div></div>`;
  document.getElementById('alertsArea').innerHTML = alertas;

  document.getElementById('invBody').innerHTML = lista.map(p => {
    const pct = Math.min(100, Math.round((p.stock / Math.max(1, p.stock_minimo * 2)) * 100));
    return `<tr>
      <td>${esc(p.nombre)}<div class="hint">${esc(p.codigo)}</div></td><td>${esc(p.categoria)}</td><td>${esc(p.ubicacion)}</td>
      <td style="min-width:120px">${p.stock} u.${p.stock_vencido ? ` <span class="badge low">+${p.stock_vencido} caducadas</span>` : ''}
        <div class="stock-bar"><i class="${p.stock_bajo ? 'low' : ''}" style="width:${pct}%"></i></div>
      </td>
      <td>${p.stock_minimo} u.</td>
      <td>${p.proxima_caducidad ? fechaCorta(p.proxima_caducidad) : '—'}</td>
      <td><span class="badge ${p.stock_bajo ? 'low' : 'ok'}">${p.stock === 0 ? 'Agotado' : p.stock_bajo ? 'Stock bajo' : 'Suficiente'}</span></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="empty">Sin productos con este filtro.</td></tr>`;
}

async function initPage(){
  const CAT = await catalogos();
  fillSelect(document.getElementById('invCategoria'), CAT.categorias, 'Todas las categorías');
  inventario = await api('/inventario');
  document.getElementById('invCategoria').addEventListener('change', renderInventario);
  document.getElementById('invEstado').addEventListener('change', renderInventario);
  renderInventario();
}
