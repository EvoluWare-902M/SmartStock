/* ===== orden.js : detalle de una orden de compra =====
   Borrador → se editan cantidades, costos y proveedor.   Enviada → se captura la recepción (lote y caducidad).
   Recibida / Cancelada → solo lectura.
*/
const $ = id => document.getElementById(id);
const idOrden = new URLSearchParams(location.search).get('id');
let orden = null, catalogo = [], proveedores = [];
const ESTADO = { Borrador: 'warn', Enviada: 'info', Recibida: 'ok', Cancelada: 'muted' };

function total(){ return orden.partidas.reduce((s, p) => s + Number(p.cantidad) * Number(p.costo_unitario), 0); }

function pintar(){
  const e = orden.estado, borrador = e === 'Borrador', enviada = e === 'Enviada';
  $('orTitulo').innerHTML = `${esc(orden.folio || 'Nueva orden de compra')} <span class="badge ${ESTADO[e]}">${e}</span>${orden.origen === 'IA' ? ' <span class="ia-tag">IA</span>' : ''}`;
  $('orSub').textContent = orden.id ? `Creada el ${fechaHora(orden.fecha)} por ${orden.creador || '—'}` +
    (orden.fecha_envio ? ` · enviada el ${fechaCorta(orden.fecha_envio)}` : '') + (orden.fecha_recepcion ? ` · recibida el ${fechaCorta(orden.fecha_recepcion)}` : '') : 'Elige el proveedor y agrega los medicamentos.';

  $('orAviso').innerHTML =
    (borrador && orden.origen === 'IA' ? `<div class="alert-box info">✨ <div><b>Borrador generado por la IA.</b> ${esc(orden.notas || '')} Las cantidades son una propuesta: ajústalas con lo que sabes de tu farmacia.</div></div>` : '') +
    (enviada && orden.espera ? `<div class="alert-box ${orden.espera.retraso ? 'warn' : 'info'}">📦 <div>${orden.espera.retraso
        ? `<b>Lleva ${orden.espera.retraso} día(s) de retraso.</b> Se envió hace ${orden.espera.dias} días y ${esc(orden.proveedor)} suele tardar ${orden.dias_entrega}.`
        : `Se envió ${orden.espera.dias === 0 ? 'hoy' : orden.espera.dias === 1 ? 'ayer' : `hace ${orden.espera.dias} días`}; ${esc(orden.proveedor)} suele tardar ${orden.dias_entrega} día(s).`}
        Cuando llegue, captura el lote y la caducidad de cada caja: con eso se crean las entradas.</div></div>` : '');

  $('orCabecera').innerHTML = borrador ? `
      <div><label for="orProveedor">Proveedor *</label><select id="orProveedor"></select></div>
      <div><label for="orNotas">Notas para el proveedor</label><input type="text" id="orNotas" maxlength="255" value="${esc(orden.origen === 'IA' ? '' : orden.notas || '')}" placeholder="Ej. Entregar antes de las 12:00"></div>`
    : `<div><label>Proveedor</label><b>${esc(orden.proveedor || 'Sin asignar')}</b><div class="hint">${esc([orden.contacto, orden.proveedor_telefono, orden.proveedor_correo].filter(Boolean).join(' · '))}</div></div>
       ${enviada ? `<div><label for="orFactura">Factura o remisión del proveedor</label><input type="text" id="orFactura" maxlength="40" placeholder="Ej. F-20418"></div>` : `<div><label>Notas</label>${esc(orden.notas || '—')}</div>`}`;
  if(borrador){
    fillSelect($('orProveedor'), proveedores.map(p => ({ value: p.id, label: `${p.nombre} · surte en ${p.dias_entrega} día(s)` })), 'Elige un proveedor');
    $('orProveedor').value = orden.proveedor_id || '';
  }

  $('orHead').innerHTML = borrador ? '<tr><th>Medicamento</th><th style="width:110px">Cantidad</th><th style="width:120px">Costo unitario</th><th>Importe</th><th></th></tr>'
    : enviada ? '<tr><th>Medicamento</th><th>Pedido</th><th style="width:100px">Llegó</th><th style="width:130px">Lote</th><th style="width:150px">Caducidad</th><th style="width:110px">Costo</th></tr>'
    : '<tr><th>Medicamento</th><th>Pedido</th><th>Recibido</th><th>Costo unitario</th><th>Importe</th></tr>';
  $('orBody').innerHTML = orden.partidas.map((p, i) => borrador ? `<tr data-i="${i}">
        <td><b>${esc(p.producto)}</b>${p.motivo ? `<br><small class="muted">${esc(p.motivo)}</small>` : ''}</td>
        <td><input type="number" min="1" data-c="cantidad" value="${p.cantidad}" aria-label="Cantidad de ${esc(p.producto)}"></td>
        <td><input type="number" min="0" step="0.01" data-c="costo_unitario" value="${p.costo_unitario}" aria-label="Costo de ${esc(p.producto)}"></td>
        <td class="imp">${dinero(p.cantidad * p.costo_unitario)}</td>
        <td><button class="btn danger sm" data-quitar="${i}" aria-label="Quitar ${esc(p.producto)}">Quitar</button></td></tr>`
      : enviada ? `<tr data-i="${i}">
        <td><b>${esc(p.producto)}</b>${p.requiere_receta ? ' <span class="badge low">Receta</span>' : ''}</td><td>${p.cantidad} u.</td>
        <td><input type="number" min="0" data-r="cantidad" value="${p.cantidad}" aria-label="Piezas que llegaron de ${esc(p.producto)}"></td>
        <td><input type="text" data-r="numero_lote" placeholder="Ej. L-3050" aria-label="Lote de ${esc(p.producto)}"></td>
        <td><input type="date" data-r="caducidad" min="${hoyISO()}" aria-label="Caducidad de ${esc(p.producto)}"></td>
        <td><input type="number" min="0" step="0.01" data-r="costo_unitario" value="${p.costo_unitario}" aria-label="Costo de ${esc(p.producto)}"></td></tr>`
      : `<tr><td><b>${esc(p.producto)}</b></td><td>${p.cantidad} u.</td>
        <td>${p.cantidad_recibida === null ? '—' : `${p.cantidad_recibida} u. ${p.cantidad_recibida < p.cantidad ? `<span class="badge warn">Faltaron ${p.cantidad - p.cantidad_recibida}</span>` : ''}`}</td>
        <td>${dinero(p.costo_unitario)}</td><td>${dinero(p.importe)}</td></tr>`).join('')
    || `<tr><td colspan="6" class="empty">La orden aún no tiene medicamentos. Agrégalos abajo.</td></tr>`;
  $('orTotal').textContent = dinero(total());

  $('orAgregarPanel').hidden = !borrador;
  if(borrador){
    const usados = new Set(orden.partidas.map(p => p.producto_id));
    fillSelect($('orProducto'), catalogo.filter(p => !usados.has(p.id)).map(p => ({ value: p.id, label: `${p.nombre} — hay ${p.stock} u. (mínimo ${p.stock_minimo})${p.stock_bajo ? ' ⚠' : ''}` })), 'Agregar medicamento…');
  }

  $('orAcciones').innerHTML = (borrador ? `<button class="btn secondary" id="orGuardar">Guardar borrador</button>${orden.id ? '<button class="btn" id="orEnviar">Marcar como enviada</button>' : ''}` : '')
    + (enviada ? '<button class="btn" id="orRecibir">Registrar recepción</button>' : '')
    + (orden.id ? '<button class="btn secondary" id="orPdf">PDF</button>' : '')
    + (orden.id && (borrador || enviada) ? '<button class="btn danger" id="orCancelar">Cancelar orden</button>' : '');
  const on = (id, fn) => { const b = $(id); if(b) b.addEventListener('click', () => conBoton(b, fn)); };
  on('orGuardar', async () => { await guardar(); toast('Borrador guardado.'); });
  on('orEnviar', async () => {
    await guardar();
    await api(`/ordenes/${orden.id}/enviar`, { method: 'POST' }); toast('Orden marcada como enviada. Descarga el PDF para mandarlo al proveedor.'); await cargar();
  });
  on('orPdf', () => descargar(`/ordenes/${orden.id}/pdf`));
  on('orCancelar', async () => {
    if(!(await modal({ titulo: 'Cancelar orden ' + orden.folio, peligro: true, aceptar: 'Cancelar orden', texto: 'La orden se cierra sin generar entradas. No se puede reabrir.' }))) return;
    await api(`/ordenes/${orden.id}/cancelar`, { method: 'POST' }); toast('Orden cancelada.'); await cargar();
  });
  on('orRecibir', async () => {
    const partidas = [...$('orBody').querySelectorAll('tr')].map(tr => {
      const p = orden.partidas[Number(tr.dataset.i)], v = c => tr.querySelector(`[data-r="${c}"]`).value.trim();
      return { producto_id: p.producto_id, cantidad: v('cantidad') === '' ? 0 : v('cantidad'), numero_lote: v('numero_lote'), caducidad: v('caducidad'), costo_unitario: v('costo_unitario') };
    });
    const r = await api(`/ordenes/${orden.id}/recibir`, { method: 'POST', body: { factura: $('orFactura').value.trim(), partidas } });
    toast(`Recepción registrada: entraron ${r.unidades} unidades al inventario.`); await cargar();
    if(typeof actualizarBadgeAlertas === 'function') actualizarBadgeAlertas();
  });
}

// Lee lo que hay en pantalla y lo guarda (crea la orden si es nueva).
async function guardar(){
  const body = { proveedor_id: $('orProveedor').value || null, notas: $('orNotas').value.trim(),
    partidas: orden.partidas.map(p => ({ producto_id: p.producto_id, cantidad: p.cantidad, costo_unitario: p.costo_unitario, motivo: p.motivo })) };
  if(!body.partidas.length) throw new Error('Agrega al menos un medicamento a la orden.');
  if(orden.id) await api('/ordenes/' + orden.id, { method: 'PUT', body });
  else{ const r = await api('/ordenes', { method: 'POST', body }); history.replaceState(null, '', 'orden.html?id=' + r.id); orden.id = r.id; }
  await cargar();
}

async function cargar(){
  orden = await api('/ordenes/' + (orden && orden.id ? orden.id : idOrden));
  pintar();
}

async function initPage(){
  [catalogo, proveedores] = await Promise.all([api('/productos'), api('/proveedores')]);
  if(idOrden) await cargar();
  else{ orden = { id: null, estado: 'Borrador', origen: 'Manual', partidas: [], notas: '' }; pintar(); }

  // Edición en línea del borrador: se recalculan importes sin perder el foco
  $('orBody').addEventListener('input', e => {
    const tr = e.target.closest('tr'), campo = e.target.dataset.c; if(!tr || !campo) return;
    const p = orden.partidas[Number(tr.dataset.i)];
    p[campo] = Math.max(campo === 'cantidad' ? 1 : 0, Number(e.target.value) || 0);
    tr.querySelector('.imp').textContent = dinero(p.cantidad * p.costo_unitario); $('orTotal').textContent = dinero(total());
  });
  $('orBody').addEventListener('click', e => {
    if(e.target.dataset.quitar === undefined) return;
    conservarCabecera(); orden.partidas.splice(Number(e.target.dataset.quitar), 1); pintar();
  });
  $('orAgregar').addEventListener('click', () => {
    const p = catalogo.find(x => x.id === Number($('orProducto').value));
    if(!p) return toast('Elige un medicamento.', true);
    const cantidad = Math.round(Number($('orCantidad').value)) || Math.max(1, p.stock_minimo * 2 - p.stock);
    conservarCabecera();
    orden.partidas.push({ producto_id: p.id, producto: p.nombre, cantidad, costo_unitario: 0, motivo: null });
    $('orCantidad').value = ''; pintar();
  });
}
// Al volver a pintar no se debe perder el proveedor ni las notas que aún no se guardan.
function conservarCabecera(){
  if($('orProveedor')){ orden.proveedor_id = Number($('orProveedor').value) || null; if(orden.origen !== 'IA') orden.notas = $('orNotas').value; }
}
