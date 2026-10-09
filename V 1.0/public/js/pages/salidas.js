/* ===== salidas.js : venta / retiro de medicamento (HU-8) ===== */
let productos = [], actual = null;

async function refrescarLotes(){
  const id = Number(document.getElementById('saProducto').value);
  const loteSelect = document.getElementById('saLote');
  const info = document.getElementById('saInfo');
  if(!id){ actual = null; loteSelect.innerHTML = '<option value="">Selecciona un medicamento</option>'; info.style.display = 'none';
    document.getElementById('saRecetaWrap').style.display = 'none'; return; }

  actual = await api('/productos/' + id);
  loteSelect.innerHTML = actual.lotes.map(l =>
    `<option value="${l.id}">${esc(l.numero_lote)} · ${l.cantidad} u. · ${l.dias < 0 ? 'CADUCADO' : 'caduca ' + fechaCorta(l.caducidad)}</option>`
  ).join('') || `<option value="">Sin lotes disponibles</option>`;
  // FEFO: preseleccionar el primer lote vigente
  const vigente = actual.lotes.find(l => l.dias >= 0);
  if(vigente) loteSelect.value = vigente.id;

  actualizarReceta();
  info.style.display = 'block';
  info.innerHTML = `Existencia disponible: <b>${actual.stock} u.</b> en anaquel <b>${esc(actual.ubicacion)}</b> · mínimo ${actual.stock_minimo} u.` +
    (actual.stock_bajo ? ' · <span class="badge low">Stock bajo</span>' : '') +
    (actual.requiere_receta ? ' · <span class="badge low">Requiere receta</span>' : '') +
    (actual.stock_vencido ? `<br><span class="badge low">${actual.stock_vencido} u. caducadas</span> — retíralas con el motivo "Merma / caducado".` : '');
}

function actualizarReceta(){
  const esVenta = document.getElementById('saMotivo').value === 'Venta';
  document.getElementById('saRecetaWrap').style.display = (actual && actual.requiere_receta && esVenta) ? 'block' : 'none';
}

async function renderRecientes(){
  const { filas } = await api('/movimientos?tipo=Salida&limit=8');
  document.getElementById('saBody').innerHTML = filas.map(m => `
    <tr><td>${fechaHora(m.fecha)}</td><td>${esc(m.producto)}</td><td>${esc(m.lote || '—')}</td><td>−${m.cantidad} u.</td>
        <td>${esc(m.motivo)}</td><td>${esc(m.responsable || '—')}</td></tr>`).join('')
    || `<tr><td colspan="6" class="empty">Aún no hay salidas registradas.</td></tr>`;
}

async function initPage(){
  const CAT = await catalogos();
  productos = await api('/productos');
  fillSelect(document.getElementById('saProducto'), productos.map(p => ({ value: p.id, label: `${p.nombre} — ${p.stock} u.` })), 'Selecciona un medicamento');
  fillSelect(document.getElementById('saMotivo'), CAT.motivosSalida);
  document.getElementById('saProducto').addEventListener('change', () => refrescarLotes().catch(e => toast(e.message, true)));
  document.getElementById('saMotivo').addEventListener('change', actualizarReceta);
  await refrescarLotes();
  await renderRecientes();

  const btn = document.getElementById('saConfirmar');
  btn.addEventListener('click', () => conBoton(btn, async () => {
    const body = {
      producto_id: document.getElementById('saProducto').value,
      lote_id: document.getElementById('saLote').value,
      cantidad: document.getElementById('saCantidad').value,
      motivo: document.getElementById('saMotivo').value,
      receta: document.getElementById('saReceta').value.trim(),
      cliente: document.getElementById('saCliente').value.trim(),
    };
    if(!body.producto_id || !body.lote_id || !body.cantidad || !body.motivo)
      return toast('Completa el medicamento, lote, cantidad y motivo.', true);

    const r = await api('/movimientos/salidas', { method: 'POST', body });
    toast(r.alerta || `Salida confirmada: −${body.cantidad} u. de ${r.producto.nombre}. Quedan ${r.producto.stock} u.`, !!r.alerta);
    limpiar(['saCantidad','saCliente','saReceta']);
    await refrescarLotes();
    await renderRecientes();
    if(typeof actualizarBadgeAlertas === 'function') actualizarBadgeAlertas();
  }));
}
