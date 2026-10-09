/* ===== venta.js : punto de venta =====
   - Búsqueda por nombre, sustancia, código o código de barras (el lector escribe y manda Enter).
   - Ticket con varios productos; el servidor descuenta por FEFO y devuelve de qué lote y casilla tomar.
   - IA: "ofrece también" (productos que se llevan juntos), alternativas si algo está agotado
     y búsqueda tolerante a faltas de ortografía.
*/
let ticket = [];          // [{id, nombre, precio, ubicacion, stock, requiere_receta, cantidad}]
let resultados = [], temporizador, pedido = 0, sesion;

const $ = id => document.getElementById(id);

function pintarTicket(){
  const total = ticket.reduce((s, l) => s + l.cantidad * l.precio, 0), piezas = ticket.reduce((s, l) => s + l.cantidad, 0);
  $('pvLineas').innerHTML = ticket.map(l => `
    <div class="pv-linea" data-id="${l.id}">
      <div class="pv-linea-txt"><b>${esc(l.nombre)}</b>
        <small>Casilla ${esc(l.ubicacion)} · ${dinero(l.precio)} c/u${l.requiere_receta ? ' · <span class="badge low">Receta</span>' : ''}${l.cantidad >= l.stock ? ` · <span class="badge warn">Son las últimas ${l.stock}</span>` : ''}</small></div>
      <div class="cant"><button type="button" data-d="-1" aria-label="Quitar una pieza">−</button><input type="number" min="1" max="${l.stock}" value="${l.cantidad}" aria-label="Piezas de ${esc(l.nombre)}"><button type="button" data-d="1" aria-label="Agregar una pieza">+</button></div>
      <div class="pv-importe">${dinero(l.cantidad * l.precio)}</div>
      <button type="button" class="pv-quitar" aria-label="Quitar ${esc(l.nombre)} del ticket">×</button>
    </div>`).join('') || `<div class="empty">Busca un medicamento o escanea su código para empezar.</div>`;
  $('pvTotal').textContent = dinero(total);
  $('pvCuenta').textContent = piezas ? `· ${piezas} pieza${piezas === 1 ? '' : 's'}` : '';
  $('pvCobrar').disabled = !ticket.length;
  $('pvRecetaWrap').hidden = !ticket.some(l => l.requiere_receta);
}

async function pintarSugerencias(){
  const cont = $('pvSugerencias');
  if(!ticket.length){ cont.innerHTML = ''; return; }
  const mio = ++pedido;
  try{
    const sug = await api('/ventas/sugerencias?ids=' + ticket.map(l => l.id).join(','));
    if(mio !== pedido) return;
    cont.innerHTML = sug.length ? `<div class="pv-sug"><div><b>Ofrece también</b> <span class="ia-tag">IA</span></div>
      ${sug.map(s => `<button type="button" data-id="${s.id}" title="${esc(s.motivo)}"><b>${esc(s.nombre)}</b><small>${esc(s.motivo)} Casilla ${esc(s.ubicacion)} · ${dinero(s.precio)}</small></button>`).join('')}</div>` : '';
    cont.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const s = sug.find(x => x.id === Number(b.dataset.id)); agregar({ ...s, stock: s.stock });
    }));
  }catch{ cont.innerHTML = ''; }
}

function agregar(p){
  if(p.stock <= 0) return toast(`${p.nombre} está agotado.`, true);
  const l = ticket.find(x => x.id === p.id);
  if(l){
    if(l.cantidad >= l.stock) return toast(`Solo hay ${l.stock} u. vigentes de ${l.nombre}.`, true);
    l.cantidad++;
  }else ticket.push({ id: p.id, nombre: p.nombre, precio: Number(p.precio), ubicacion: p.ubicacion, stock: p.stock, requiere_receta: !!p.requiere_receta, cantidad: 1 });
  $('pvBuscar').value = ''; $('pvResultados').innerHTML = ''; $('pvAlternativas').innerHTML = ''; resultados = [];
  pintarTicket(); pintarSugerencias(); $('pvBuscar').focus();
}

async function verAlternativas(p){
  const alts = await api('/ia/alternativas/' + p.id);
  $('pvAlternativas').innerHTML = `<div class="hallazgo oportunidad" style="margin-top:12px"><span aria-hidden="true">💡</span><div>
    <strong>${esc(p.nombre)} está agotado.</strong> <span class="ia-tag">IA</span>
    ${alts.length ? `<p>Alternativas con existencia:</p>${alts.map(a => `<button class="btn secondary sm alt" data-id="${a.id}" style="margin:6px 6px 0 0">${esc(a.nombre)} · ${esc(a.ubicacion)} · ${a.stock} u.</button>`).join('')}
      <p style="margin-top:8px">${esc([...new Set(alts.map(a => a.afinidad))].join(' · '))}. La sustitución la decide el responsable de la farmacia.</p>` : '<p>No hay otro medicamento con existencia que lo sustituya.</p>'}
    <button class="btn secondary sm" id="pvAnotarAgotado" style="margin-top:8px">Anotar que lo pidieron y no había</button></div></div>`;
  $('pvAlternativas').querySelectorAll('.alt').forEach(b => b.addEventListener('click', async () => agregar(await api('/productos/' + b.dataset.id))));
  $('pvAnotarAgotado').addEventListener('click', () => anotarFaltante(p.nombre, p.id));
}

async function buscar(alEnter){
  const q = $('pvBuscar').value.trim(), cont = $('pvResultados');
  if(q.length < 2){ cont.innerHTML = ''; resultados = []; return; }
  const mio = ++pedido;
  const lista = await api('/productos?q=' + encodeURIComponent(q));
  if(mio !== pedido) return;
  resultados = lista.slice(0, 7);
  // Código de barras (solo dígitos) con un único resultado, o Enter: se agrega directo
  const esCodigo = /^\d{8,14}$/.test(q);
  if(resultados.length && (alEnter || (esCodigo && resultados.length === 1))){
    if(resultados[0].stock > 0 && resultados[0].coincidencia !== 'aproximada') return agregar(resultados[0]);
  }
  const aprox = resultados[0] && resultados[0].coincidencia === 'aproximada';
  cont.innerHTML = !resultados.length ? `<div class="found-card" style="margin-top:0">Sin coincidencias para "${esc(q)}". Si el cliente lo pidió, anótalo abajo como "no hay".</div>`
    : (aprox ? `<div class="hint" style="margin:0 0 2px"><b>¿Quisiste decir…?</b> <span class="ia-tag">IA</span></div>` : '') + resultados.map(p => `
      <button type="button" class="search-item${p.stock <= 0 ? ' agotado' : ''}" data-id="${p.id}">
        <span><b>${esc(p.nombre)}</b> <small>· ${esc(p.sustancia || '')}${p.requiere_receta ? ' · receta' : ''}</small></span>
        <small>${p.stock > 0 ? `${esc(p.ubicacion)} · ${p.stock} u. · ${dinero(p.precio)}` : 'Agotado · ver alternativas'}</small>
      </button>`).join('');
  cont.querySelectorAll('.search-item').forEach(b => b.addEventListener('click', () => {
    const p = resultados.find(x => x.id === Number(b.dataset.id));
    (p.stock > 0 ? Promise.resolve(agregar(p)) : verAlternativas(p)).catch(e => toast(e.message, true));
  }));
}

async function anotarFaltante(textoInicial, productoId){
  const v = await modal({ titulo: 'Lo pidieron y no había', aceptar: 'Anotar',
    texto: 'Escríbelo como lo pidió el cliente. El gerente lo verá agrupado con solicitudes parecidas.',
    campos: [{ id: 'texto', label: 'Qué pidió', value: textoInicial || $('pvBuscar').value.trim(), placeholder: 'Ej. metformina 850' }, { id: 'cantidad', label: 'Cuántas piezas', type: 'number', value: '1' }] });
  if(!v) return;
  try{
    await api('/faltantes', { method: 'POST', body: { texto: v.texto, cantidad: v.cantidad, producto_id: productoId || null } });
    toast('Anotado. Gracias: así se sabe qué hace falta.');
    $('pvBuscar').value = ''; $('pvResultados').innerHTML = ''; $('pvAlternativas').innerHTML = '';
  }catch(e){ toast(e.message, true); }
}

function pintarRecibo(v){
  $('pvCaja').hidden = true;
  $('pvRecibo').innerHTML = `<div class="panel pv-recibo">
    <div class="pv-recibo-ok">✓</div>
    <h3>Venta ${esc(v.folio)} registrada</h3>
    <p class="muted">${fechaHora(v.fecha)} · ${esc(v.vendedor || '')}${v.receta ? ' · receta ' + esc(v.receta) : ''}${v.cliente ? ' · ' + esc(v.cliente) : ''}</p>
    <table><thead><tr><th>Toma de la casilla</th><th>Medicamento</th><th>Lote</th><th>Piezas</th><th>Importe</th></tr></thead>
      <tbody>${v.partidas.map(p => `<tr><td><span class="clase A">${esc(p.ubicacion)}</span></td><td>${esc(p.producto)}</td><td>${esc(p.lote || '—')}</td><td>${p.cantidad}</td><td>${dinero(p.importe)}</td></tr>`).join('')}</tbody></table>
    <div class="pv-total"><span>Total</span><b>${dinero(v.total)}</b></div>
    ${(v.alertas || []).length ? `<div class="alert-box warn" style="margin:14px 0 0">⚠️ <div><b>Quedaron en el mínimo:</b> ${v.alertas.map(esc).join(' ')}</div></div>` : ''}
    <div class="form-actions" style="justify-content:center"><button class="btn" id="pvNueva">Nueva venta</button></div></div>`;
  $('pvNueva').addEventListener('click', () => { $('pvRecibo').innerHTML = ''; $('pvCaja').hidden = false; $('pvBuscar').focus(); });
  $('pvNueva').focus();
}

async function pintarHoy(){
  const filas = await api('/ventas');
  const total = filas.filter(f => f.estado === 'Completada').reduce((s, f) => s + Number(f.total), 0);
  $('pvHoyTit').innerHTML = `${sesion.role === 'dueno' ? 'Ventas de hoy' : 'Mis ventas de hoy'} <small>${filas.length} ticket(s) · ${dinero(total)}</small>`;
  $('pvHoy').innerHTML = filas.map(f => `<tr class="${f.estado === 'Cancelada' ? 'muted' : ''}">
      <td><b>${esc(f.folio)}</b></td><td>${f.fecha.slice(11, 16)}</td><td>${esc(f.productos || '—')}</td><td>${f.unidades}</td><td>${dinero(f.total)}</td><td>${esc(f.vendedor || '—')}</td>
      <td>${f.estado === 'Cancelada' ? '<span class="badge muted">Cancelada</span>' : sesion.role === 'dueno' ? `<button class="btn danger sm" data-cancelar="${f.id}" data-folio="${esc(f.folio)}">Cancelar</button>` : ''}</td></tr>`).join('')
    || `<tr><td colspan="7" class="empty">Aún no hay ventas hoy.</td></tr>`;
}

async function initPage(session){
  sesion = session;
  pintarTicket();
  await pintarHoy();
  const input = $('pvBuscar');
  input.addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(() => buscar(false).catch(e => toast(e.message, true)), 220); });
  input.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); clearTimeout(temporizador); buscar(true).catch(err => toast(err.message, true)); } });
  $('pvNoHay').addEventListener('click', () => anotarFaltante());

  $('pvLineas').addEventListener('click', e => {
    const fila = e.target.closest('.pv-linea'); if(!fila) return;
    const l = ticket.find(x => x.id === Number(fila.dataset.id));
    if(e.target.classList.contains('pv-quitar')) ticket = ticket.filter(x => x !== l);
    else if(e.target.dataset.d) l.cantidad = Math.max(1, Math.min(l.stock, l.cantidad + Number(e.target.dataset.d)));
    else return;
    pintarTicket(); pintarSugerencias();
  });
  $('pvLineas').addEventListener('change', e => {
    const fila = e.target.closest('.pv-linea'); if(!fila || e.target.tagName !== 'INPUT') return;
    const l = ticket.find(x => x.id === Number(fila.dataset.id));
    const n = Math.round(Number(e.target.value)) || 1;
    if(n > l.stock) toast(`Solo hay ${l.stock} u. vigentes de ${l.nombre}.`, true);
    l.cantidad = Math.max(1, Math.min(l.stock, n)); pintarTicket();
  });

  const cobrar = $('pvCobrar');
  cobrar.addEventListener('click', () => conBoton(cobrar, async () => {
    const receta = $('pvReceta').value.trim();
    if(ticket.some(l => l.requiere_receta) && !receta){ $('pvReceta').focus(); return toast('Captura el número de receta para continuar.', true); }
    const v = await api('/ventas', { method: 'POST', body: { partidas: ticket.map(l => ({ producto_id: l.id, cantidad: l.cantidad })), receta, cliente: $('pvCliente').value.trim() } });
    ticket = []; limpiar(['pvReceta', 'pvCliente']); pintarTicket(); pintarSugerencias();
    pintarRecibo(v); await pintarHoy();
    if(typeof actualizarBadgeAlertas === 'function') actualizarBadgeAlertas();
  }));

  $('pvHoy').addEventListener('click', async e => {
    const id = e.target.dataset.cancelar; if(!id) return;
    const ok = await modal({ titulo: 'Cancelar venta ' + e.target.dataset.folio, peligro: true, aceptar: 'Cancelar venta', texto: 'Las piezas regresan a sus lotes y el ticket deja de contar como venta. Queda registrado en la bitácora.' });
    if(!ok) return;
    try{ await api(`/ventas/${id}/cancelar`, { method: 'POST' }); toast('Venta cancelada: las piezas regresaron al inventario.'); await pintarHoy(); }
    catch(err){ toast(err.message, true); }
  });
}
