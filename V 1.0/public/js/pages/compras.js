/* ===== compras.js : órdenes de compra, proveedores y demanda no atendida ===== */
const ESTADO_ORDEN = { Borrador: 'warn', Enviada: 'info', Recibida: 'ok', Cancelada: 'muted' };
let proveedores = [], editandoProv = null;
const $ = id => document.getElementById(id);

/* ---------- órdenes ---------- */
async function pintarOrdenes(){
  const filas = await api('/ordenes');
  $('coOrdenes').innerHTML = filas.map(o => `<tr>
      <td><a class="enlace" href="orden.html?id=${o.id}">${esc(o.folio)}</a>${o.origen === 'IA' ? ' <span class="ia-tag">IA</span>' : ''}</td>
      <td>${esc(o.proveedor || 'Sin asignar')}</td>
      <td><span class="badge ${ESTADO_ORDEN[o.estado]}">${o.estado}</span>${o.retraso ? ` <span class="badge low">${o.retraso} día(s) de retraso</span>` : ''}</td>
      <td>${o.productos} · ${o.unidades} u.</td><td>${dinero(o.total)}</td>
      <td>${fechaCorta(o.estado === 'Recibida' ? o.fecha_recepcion : o.estado === 'Enviada' ? o.fecha_envio : o.fecha)}<br><small class="muted">${o.estado === 'Recibida' ? 'recibida' : o.estado === 'Enviada' ? 'enviada' : 'creada'}</small></td>
      <td><a class="btn secondary sm" href="orden.html?id=${o.id}">${o.estado === 'Borrador' ? 'Revisar' : o.estado === 'Enviada' ? 'Recibir' : 'Ver'}</a></td></tr>`).join('')
    || `<tr><td colspan="7" class="empty">Aún no hay órdenes de compra. Genera las primeras con IA o crea una a mano.</td></tr>`;
}

/* ---------- proveedores ---------- */
function formularioProveedor(p){
  editandoProv = p ? p.id : null;
  $('prTitulo').textContent = p ? 'Editar: ' + p.nombre : 'Nuevo proveedor';
  $('prCancelar').hidden = !p;
  $('prNombre').value = p ? p.nombre : ''; $('prContacto').value = p ? p.contacto || '' : ''; $('prTelefono').value = p ? p.telefono || '' : '';
  $('prCorreo').value = p ? p.correo || '' : ''; $('prDias').value = p ? p.dias_entrega : 3; $('prNotas').value = p ? p.notas || '' : '';
}
async function pintarProveedores(){
  proveedores = await api('/proveedores');
  $('prBody').innerHTML = proveedores.map(p => `<tr>
      <td><b>${esc(p.nombre)}</b>${p.notas ? `<br><small class="muted">${esc(p.notas)}</small>` : ''}</td>
      <td>${esc(p.contacto || '—')}<br><small class="muted">${esc([p.telefono, p.correo].filter(Boolean).join(' · '))}</small></td>
      <td>${p.productos}</td>
      <td>${p.dias_entrega} día(s) acordados${p.entrega_real !== null ? `<br><small class="muted">${p.entrega_real} reales en ${p.ordenes_recibidas} orden(es)</small>` : ''}
          ${p.aviso ? `<br><span class="badge warn" title="${esc(p.aviso)}">Tarda distinto</span>` : ''}</td>
      <td>${p.cumplimiento === null ? '<span class="muted">Sin historial</span>' : `<span class="badge ${p.cumplimiento >= 95 ? 'ok' : p.cumplimiento >= 80 ? 'warn' : 'low'}">${p.cumplimiento} %</span>`}</td>
      <td><div class="row-actions"><button class="btn secondary sm" data-editar="${p.id}">Editar</button><button class="btn danger sm" data-quitar="${p.id}">Quitar</button></div></td></tr>`).join('')
    || `<tr><td colspan="6" class="empty">Aún no registras proveedores.</td></tr>`;
}

/* ---------- demanda no atendida ---------- */
async function pintarDemanda(){
  const d = await api('/faltantes');
  $('coDemanda').innerHTML = d.map((x, i) => `
    <div class="reco-card">
      <div>
        <b>${esc(x.nombre)}</b> ${x.en_catalogo ? `<span class="badge ${x.stock > 0 ? 'warn' : 'low'}">En catálogo · ${x.stock} u.</span>` : '<span class="badge info">No está en tu catálogo</span>'}
        <div class="meta">Lo pidieron <b>${x.veces}</b> ${x.veces === 1 ? 'vez' : 'veces'} (${x.unidades} pieza${x.unidades === 1 ? '' : 's'}) · última: ${fechaCorta(x.ultima)}${x.categoria_sugerida ? ` · categoría probable: ${esc(x.categoria_sugerida)}` : ''}</div>
        ${x.variantes.length ? `<div class="meta">También lo escribieron como: ${x.variantes.map(v => `"${esc(v)}"`).join(', ')}</div>` : ''}
        <div class="meta" style="color:var(--ink)">💡 ${esc(x.consejo)}</div>
      </div>
      <div class="side row-actions" style="flex-direction:column; align-items:stretch">
        ${x.en_catalogo ? '' : `<a class="btn secondary sm" href="registro.html?nombre=${encodeURIComponent(x.nombre)}">Dar de alta</a>`}
        <button class="btn secondary sm" data-atender="${i}">Ya lo atendí</button>
      </div>
    </div>`).join('') || `<div class="hallazgo ok"><span aria-hidden="true">✅</span><div><b>Sin solicitudes pendientes</b><p>Cuando alguien anote en el mostrador algo que pidieron y no había, aparecerá aquí.</p></div></div>`;
  $('coDemanda').querySelectorAll('[data-atender]').forEach(b => b.addEventListener('click', async () => {
    try{ await api('/faltantes/atender', { method: 'PUT', body: { ids: d[Number(b.dataset.atender)].ids } }); toast('Marcado como atendido.'); await pintarDemanda(); }
    catch(e){ toast(e.message, true); }
  }));
}

async function initPage(){
  activarTabs();
  await Promise.all([pintarOrdenes(), pintarProveedores(), pintarDemanda()]);
  formularioProveedor(null);

  const sugerir = $('coSugerir');
  sugerir.addEventListener('click', () => conBoton(sugerir, async () => {
    const r = await api('/ordenes/sugerir', { method: 'POST' });
    $('coAviso').innerHTML = r.creadas.length
      ? `<div class="alert-box info">✨ <div><b>Se ${r.creadas.length === 1 ? 'creó 1 borrador' : `crearon ${r.creadas.length} borradores`}</b>, uno por proveedor, ${r.conModelo ? 'con las cantidades del modelo de predicción de demanda' : 'con la regla de reposición por stock mínimo (tu plan no incluye el modelo de demanda)'}.
          ${r.sinProveedor ? ` ${r.sinProveedor} producto(s) no tienen proveedor asignado y quedaron en una orden aparte.` : ''}${r.omitidos ? ` Se omitieron ${r.omitidos} que ya vienen en otra orden.` : ''} Revísalos antes de enviar.</div></div>`
      : `<div class="alert-box info">✅ <div>${esc(r.mensaje)}</div></div>`;
    await pintarOrdenes();
  }));

  const guardar = $('prGuardar');
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    const body = { nombre: $('prNombre').value.trim(), contacto: $('prContacto').value.trim(), telefono: $('prTelefono').value.trim(), correo: $('prCorreo').value.trim(), dias_entrega: $('prDias').value, notas: $('prNotas').value.trim() };
    if(!body.nombre) return toast('Escribe el nombre del proveedor.', true);
    await api(editandoProv ? '/proveedores/' + editandoProv : '/proveedores', { method: editandoProv ? 'PUT' : 'POST', body });
    toast(editandoProv ? 'Proveedor actualizado.' : 'Proveedor registrado.');
    formularioProveedor(null); await pintarProveedores();
  }));
  $('prCancelar').addEventListener('click', () => formularioProveedor(null));
  $('prBody').addEventListener('click', async e => {
    const ed = e.target.dataset.editar, qu = e.target.dataset.quitar;
    if(ed){ formularioProveedor(proveedores.find(p => p.id === Number(ed))); $('prNombre').focus(); }
    if(qu){
      const p = proveedores.find(x => x.id === Number(qu));
      if(!(await modal({ titulo: 'Quitar proveedor', peligro: true, aceptar: 'Quitar', texto: `¿Quitar a <b>${esc(p.nombre)}</b>? Sus ${p.productos} producto(s) quedarán sin proveedor asignado.` }))) return;
      try{ await api('/proveedores/' + p.id, { method: 'DELETE' }); toast('Proveedor quitado.'); await pintarProveedores(); }catch(err){ toast(err.message, true); }
    }
  });
}
