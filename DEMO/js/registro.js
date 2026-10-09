/* ===== registro.js : alta de medicamentos ===== */
function renderRegistroTable(){
  document.getElementById('rmBody').innerHTML = productos.map(p => {
    const lote = lotesDe(p.n)[0];
    return `<tr>
      <td>${p.codigo}</td><td>${p.n}</td><td>${p.categoria}</td><td>${p.presentacion}</td>
      <td>${lote ? lote.lote : '—'}</td><td>${lote ? lote.caducidad : '—'}</td>
      <td>${p.anaquel}</td><td>${p.stock} u.</td><td>${p.min} u.</td>
      <td>${p.requiereReceta ? '<span class="badge low">Sí</span>' : '<span class="badge ok">No</span>'}</td>
    </tr>`;
  }).join('');
}

function nextCodigo(){
  const n = productos.length + 1;
  return 'MED-' + String(n).padStart(3, '0');
}

function initPage(){
  fillSelect(document.getElementById('rmCategoria'), CATEGORIAS);
  fillSelect(document.getElementById('rmPresentacion'), PRESENTACIONES);
  fillSelect(document.getElementById('rmUbicacion'), UBICACIONES);
  renderRegistroTable();

  document.getElementById('rmGuardar').addEventListener('click', () => {
    const nombre = document.getElementById('rmNombre').value.trim();
    const lote = document.getElementById('rmLote').value.trim();
    const caducidad = document.getElementById('rmCaducidad').value;
    const cantidad = Number(document.getElementById('rmCantidad').value);
    const ubicacion = document.getElementById('rmUbicacion').value;
    const categoria = document.getElementById('rmCategoria').value;
    const presentacion = document.getElementById('rmPresentacion').value;
    const minimo = Number(document.getElementById('rmMinimo').value);

    if(!nombre || !lote || !caducidad || !cantidad || !ubicacion || !categoria || !presentacion || !minimo){
      toast('Completa los campos marcados con * antes de guardar.', true);
      return;
    }

    const codigo = document.getElementById('rmCodigo').value.trim() || nextCodigo();

    productos.push({
      codigo, n:nombre,
      laboratorio: document.getElementById('rmLaboratorio').value.trim() || '—',
      categoria, presentacion,
      concentracion: document.getElementById('rmConcentracion').value.trim() || '—',
      requiereReceta: document.getElementById('rmReceta').checked,
      anaquel: ubicacion, fila:1, col:1,
      stock: cantidad, min: minimo,
      precio: Number(document.getElementById('rmPrecio').value) || 0
    });

    lotes.push({
      producto: nombre, lote, caducidad, cantidad,
      factura: '—', costoUnitario: Number(document.getElementById('rmCosto').value) || 0
    });

    renderRegistroTable();
    toast(`"${nombre}" registrado correctamente con el código ${codigo}.`);

    ['rmNombre','rmCodigo','rmLaboratorio','rmConcentracion','rmLote','rmCaducidad','rmCantidad','rmCosto','rmMinimo','rmPrecio']
      .forEach(id => document.getElementById(id).value = '');
    document.getElementById('rmReceta').checked = false;
  });

  document.getElementById('rmLimpiar').addEventListener('click', () => {
    ['rmNombre','rmCodigo','rmLaboratorio','rmConcentracion','rmLote','rmCaducidad','rmCantidad','rmCosto','rmMinimo','rmPrecio']
      .forEach(id => document.getElementById(id).value = '');
    document.getElementById('rmReceta').checked = false;
  });
}
