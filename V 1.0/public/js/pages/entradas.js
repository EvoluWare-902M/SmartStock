/* ===== entradas.js : recepción de mercancía (HU-7) ===== */
const EN_CAMPOS = ['enProveedor','enFactura','enLote','enCaducidad','enCantidad','enCosto','enObs'];
let productos = [];

async function renderRecientes(){
  const { filas } = await api('/movimientos?tipo=Entrada&limit=8');
  document.getElementById('enBody').innerHTML = filas.map(e => `
    <tr><td>${fechaHora(e.fecha)}</td><td>${esc(e.producto)}</td><td>${esc(e.lote || '—')}</td><td>+${e.cantidad} u.</td>
        <td>${esc(e.proveedor || '—')}</td><td>${esc(e.factura || '—')}</td><td>${esc(e.responsable || '—')}</td></tr>
  `).join('') || `<tr><td colspan="7" class="empty">Aún no se han registrado entradas.</td></tr>`;
}

function mostrarInfo(){
  const p = productos.find(x => x.id === Number(document.getElementById('enProducto').value));
  const info = document.getElementById('enInfo');
  if(!p){ info.style.display = 'none'; return; }
  info.style.display = 'block';
  info.innerHTML = `Existencia actual: <b>${p.stock} u.</b> (mínimo ${p.stock_minimo}) · anaquel <b>${esc(p.ubicacion)}</b>` +
    (p.stock_bajo ? ' · <span class="badge low">Stock bajo</span>' : '');
}

async function initPage(){
  productos = await api('/productos');
  fillSelect(document.getElementById('enProducto'), productos.map(p => ({ value: p.id, label: `${p.nombre} (${p.codigo})` })), 'Selecciona un medicamento');
  document.getElementById('enFecha').value = hoyISO();
  document.getElementById('enFecha').max = hoyISO();
  document.getElementById('enProducto').addEventListener('change', mostrarInfo);
  // Proveedores registrados como sugerencias; al elegir un medicamento se propone su proveedor habitual
  api('/proveedores').then(l => document.getElementById('enProveedores').innerHTML = l.map(p => `<option value="${esc(p.nombre)}">`).join('')).catch(() => {});
  document.getElementById('enProducto').addEventListener('change', e => {
    const p = productos.find(x => x.id === Number(e.target.value)), campo = document.getElementById('enProveedor');
    if(p && p.proveedor_nombre && !campo.value.trim()) campo.value = p.proveedor_nombre;
  });

  // Llegar desde "Recomendación de compras": entradas.html?producto=ID&cantidad=N
  const qs = new URLSearchParams(location.search);
  if(qs.get('producto')){ document.getElementById('enProducto').value = qs.get('producto'); mostrarInfo(); }
  if(qs.get('cantidad')) document.getElementById('enCantidad').value = qs.get('cantidad');

  await renderRecientes();

  const btn = document.getElementById('enGuardar');
  btn.addEventListener('click', () => conBoton(btn, async () => {
    const v = valoresDe([...EN_CAMPOS, 'enFecha']);
    const producto_id = document.getElementById('enProducto').value;
    if(!v.enProveedor || !producto_id || !v.enLote || !v.enCaducidad || !v.enCantidad || !v.enFecha)
      return toast('Completa los campos obligatorios de la entrada.', true);

    const r = await api('/movimientos/entradas', { method: 'POST', body: {
      producto_id, proveedor: v.enProveedor, factura: v.enFactura, numero_lote: v.enLote, caducidad: v.enCaducidad,
      cantidad: v.enCantidad, costo_unitario: v.enCosto, fecha: v.enFecha, observaciones: v.enObs,
    }});
    toast(`Entrada registrada: +${v.enCantidad} u. de ${r.producto.nombre}. Existencia actual: ${r.producto.stock} u.`);
    limpiar(EN_CAMPOS);
    productos = await api('/productos');
    mostrarInfo();
    await renderRecientes();
    if(typeof actualizarBadgeAlertas === 'function') actualizarBadgeAlertas();
  }));
}
