/* ===== registro.js : alta, edición y baja de medicamentos (HU-1) ===== */
const CAMPOS = ['rmBarras','rmNombre','rmCodigo','rmSustancia','rmLaboratorio','rmConcentracion','rmLote','rmCaducidad','rmCantidad','rmCosto','rmMinimo','rmPrecio','rmReceta'];
let productos = [], editando = null, CAT;

function opcionesUbicacion(){
  const ocupadas = {};
  productos.forEach(p => { if(!editando || p.id !== editando) (ocupadas[p.ubicacion] = ocupadas[p.ubicacion] || []).push(p.nombre); });
  return CAT.ubicaciones.map(u => ({ value: u, label: ocupadas[u] ? `${u} — ocupado: ${ocupadas[u].join(', ')}` : `${u} — libre` }));
}

function renderTabla(){
  document.getElementById('rmBody').innerHTML = productos.map(p => `<tr>
      <td>${esc(p.codigo)}</td><td>${esc(p.nombre)}</td><td>${esc(p.categoria)}</td><td>${esc(p.presentacion)}</td>
      <td>${p.proxima_caducidad ? fechaCorta(p.proxima_caducidad) : '—'}</td>
      <td>${esc(p.ubicacion)}</td><td>${p.stock} u.</td><td>${p.stock_minimo} u.</td>
      <td>${p.requiere_receta ? '<span class="badge low">Sí</span>' : '<span class="badge ok">No</span>'}</td>
      <td><div class="row-actions">
        <button class="btn secondary sm" data-edit="${p.id}">Editar</button>
        <button class="btn danger sm" data-del="${p.id}">Eliminar</button>
      </div></td>
    </tr>`).join('') || `<tr><td colspan="10" class="empty">Aún no hay medicamentos registrados.</td></tr>`;
}

/* ---------- IA: autocompletar al escribir el nombre ----------
   El servidor deduce sustancia, categoría, presentación, concentración, receta y una casilla libre.
   Solo se llenan los campos que la persona no ha tocado, y siempre se puede corregir. */
const tocados = new Set();
let temporizadorIA, pedidoIA = 0;
async function sugerirConIA(){
  const nombre = document.getElementById('rmNombre').value.trim(), caja = document.getElementById('rmIA');
  if(editando || nombre.length < 4){ caja.innerHTML = ''; return; }
  const mio = ++pedidoIA;
  let s; try{ s = await api('/ia/clasificar', { method: 'POST', body: { nombre } }); }catch{ return; }
  if(mio !== pedidoIA || !s) return;
  const puestos = [];
  const poner = (id, valor, etiqueta) => {
    const el = document.getElementById(id);
    if(valor === null || valor === undefined || valor === '' || tocados.has(id)) return;
    if(el.type === 'checkbox'){ if(el.checked !== !!valor){ el.checked = !!valor; } if(valor) puestos.push(etiqueta); }
    else if(el.value !== String(valor)){ el.value = valor; puestos.push(`${etiqueta}: ${valor}`); }
  };
  poner('rmSustancia', s.sustancia, 'sustancia'); poner('rmCategoria', s.categoria, 'categoría'); poner('rmPresentacion', s.presentacion, 'presentación');
  poner('rmConcentracion', s.concentracion, 'concentración'); poner('rmReceta', s.requiere_receta, 'requiere receta'); poner('rmUbicacion', s.ubicacion, 'casilla libre');
  const dup = s.parecido && s.parecido.posible_duplicado;
  caja.innerHTML = (dup ? `<div class="alert-box warn" style="margin:0 0 10px">⚠️ <div><b>Posible duplicado:</b> ya tienes "${esc(s.parecido.nombre)}" en la casilla ${esc(s.parecido.ubicacion)}. Si es el mismo, registra una <a href="entradas.html">entrada</a> en lugar de darlo de alta otra vez.</div></div>` : '')
    + (puestos.length || (s.explicacion || []).length ? `<div class="hallazgo oportunidad"><span aria-hidden="true">✨</span><div><b>Sugerencia de la IA <span class="badge ${s.confianza === 'alta' ? 'ok' : s.confianza === 'media' ? 'info' : 'warn'}">confianza ${esc(s.confianza || 'baja')}</span></b>
        <p>${esc((s.explicacion || []).join(' '))}${puestos.length ? ` Llené: ${esc(puestos.join(', '))}.` : ''} Revisa y corrige lo que haga falta${s.requiere_receta ? '; la receta debe confirmarla el responsable sanitario' : ''}.</p></div></div>` : '');
}

function modoAlta(){
  editando = null;
  tocados.clear(); document.getElementById('rmIA').innerHTML = '';
  document.getElementById('rmProveedor').value = '';
  limpiar(CAMPOS);
  document.getElementById('rmTitulo').textContent = 'Registrar medicamento';
  document.getElementById('rmGuardar').textContent = 'Guardar medicamento';
  document.getElementById('rmLimpiar').textContent = 'Limpiar';
  document.getElementById('rmLoteSeccion').style.display = '';
  document.getElementById('rmCodigo').disabled = false;
  fillSelect(document.getElementById('rmUbicacion'), opcionesUbicacion());
}

function modoEdicion(p){
  editando = p.id;
  document.getElementById('rmTitulo').textContent = 'Editar: ' + p.nombre;
  document.getElementById('rmGuardar').textContent = 'Guardar cambios';
  document.getElementById('rmLimpiar').textContent = 'Cancelar edición';
  document.getElementById('rmLoteSeccion').style.display = 'none';   // los lotes se agregan desde Entradas
  document.getElementById('rmNombre').value = p.nombre;
  document.getElementById('rmCodigo').value = p.codigo;
  document.getElementById('rmCodigo').disabled = true;
  document.getElementById('rmSustancia').value = p.sustancia || '';
  document.getElementById('rmLaboratorio').value = p.laboratorio || '';
  document.getElementById('rmCategoria').value = p.categoria;
  document.getElementById('rmPresentacion').value = p.presentacion;
  document.getElementById('rmConcentracion').value = p.concentracion || '';
  document.getElementById('rmReceta').checked = p.requiere_receta;
  document.getElementById('rmBarras').value = p.codigo_barras || '';
  document.getElementById('rmProveedor').value = p.proveedor_id || '';
  document.getElementById('rmIA').innerHTML = '';
  fillSelect(document.getElementById('rmUbicacion'), opcionesUbicacion());
  document.getElementById('rmUbicacion').value = p.ubicacion;
  document.getElementById('rmMinimo').value = p.stock_minimo;
  document.getElementById('rmPrecio').value = p.precio;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function recargar(){
  productos = await api('/productos');
  renderTabla();
}

async function initPage(){
  CAT = await catalogos();
  fillSelect(document.getElementById('rmCategoria'), CAT.categorias);
  fillSelect(document.getElementById('rmPresentacion'), CAT.presentaciones);
  document.getElementById('rmCaducidad').min = hoyISO();
  fillSelect(document.getElementById('rmProveedor'), (await api('/proveedores')).map(p => ({ value: p.id, label: p.nombre })), 'Sin proveedor asignado');
  ['rmSustancia','rmCategoria','rmPresentacion','rmConcentracion','rmReceta','rmUbicacion'].forEach(id =>
    document.getElementById(id).addEventListener('change', e => { if(e.isTrusted) tocados.add(id); }));
  document.getElementById('rmNombre').addEventListener('input', () => { clearTimeout(temporizadorIA); temporizadorIA = setTimeout(sugerirConIA, 450); });
  await recargar();
  modoAlta();

  const btn = document.getElementById('rmGuardar');
  btn.addEventListener('click', () => conBoton(btn, async () => {
    const v = valoresDe(CAMPOS);
    const body = {
      nombre: v.rmNombre, codigo: v.rmCodigo, sustancia: v.rmSustancia, laboratorio: v.rmLaboratorio,
      categoria: document.getElementById('rmCategoria').value,
      presentacion: document.getElementById('rmPresentacion').value,
      concentracion: v.rmConcentracion, requiere_receta: v.rmReceta,
      ubicacion: document.getElementById('rmUbicacion').value,
      stock_minimo: v.rmMinimo, precio: v.rmPrecio,
      codigo_barras: v.rmBarras, proveedor_id: document.getElementById('rmProveedor').value || null,
    };
    if(!body.nombre || v.rmMinimo === '') return toast('Completa los campos marcados con * antes de guardar.', true);

    if(editando){
      await api('/productos/' + editando, { method: 'PUT', body });
      toast(`"${body.nombre}" actualizado.`);
    }else{
      if(!v.rmLote || !v.rmCaducidad || !v.rmCantidad) return toast('Completa los datos del lote inicial (lote, caducidad y cantidad).', true);
      Object.assign(body, { numero_lote: v.rmLote, caducidad: v.rmCaducidad, cantidad: v.rmCantidad, costo_unitario: v.rmCosto });
      const p = await api('/productos', { method: 'POST', body });
      toast(`"${p.nombre}" registrado correctamente con el código ${p.codigo}.`);
    }
    await recargar();
    modoAlta();
  }));

  document.getElementById('rmLimpiar').addEventListener('click', modoAlta);

  // Llegar desde "Lo que piden y no hay": registro.html?nombre=Metformina 850mg
  const nombre0 = new URLSearchParams(location.search).get('nombre');
  if(nombre0){ document.getElementById('rmNombre').value = nombre0; sugerirConIA(); }

  document.getElementById('rmBody').addEventListener('click', async (e) => {
    const idEdit = e.target.dataset.edit, idDel = e.target.dataset.del;
    if(idEdit) modoEdicion(productos.find(p => p.id === Number(idEdit)));
    if(idDel){
      const p = productos.find(x => x.id === Number(idDel));
      const ok = await modal({ titulo: 'Eliminar medicamento', peligro: true, aceptar: 'Eliminar',
        texto: `¿Dar de baja <b>${esc(p.nombre)}</b> del catálogo? Su historial de movimientos se conserva.` });
      if(!ok) return;
      try{
        await api('/productos/' + p.id, { method: 'DELETE' });
        toast(`"${p.nombre}" se dio de baja.`);
        await recargar(); modoAlta();
      }catch(err){ toast(err.message, true); }
    }
  });
}
