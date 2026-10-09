/* ===== salidas.js : venta / retiro de medicamento ===== */
function refrescarLotesSalida(){
  const prod = document.getElementById('saProducto').value;
  const loteSelect = document.getElementById('saLote');
  const info = document.getElementById('saInfo');
  const p = productos.find(x => x.n === prod);

  const disponibles = lotesDe(prod);
  loteSelect.innerHTML = disponibles.map(l =>
    `<option value="${l.lote}">${l.lote} · ${l.cantidad} u. · caduca ${l.caducidad}</option>`
  ).join('') || `<option value="">Sin lotes disponibles</option>`;

  document.getElementById('saRecetaWrap').style.display = (p && p.requiereReceta) ? 'block' : 'none';

  if(p){
    info.style.display = 'block';
    info.innerHTML = `Existencia total: <b>${p.stock} u.</b> en anaquel <b>${p.anaquel}</b>` +
      (p.requiereReceta ? ' · <span class="badge low">Requiere receta</span>' : '');
  } else {
    info.style.display = 'none';
  }
}

function initPage(session){
  fillSelect(document.getElementById('saProducto'), productos.map(p => p.n), 'Selecciona un medicamento');
  fillSelect(document.getElementById('saMotivo'), MOTIVOS_SALIDA, 'Selecciona un motivo');

  document.getElementById('saProducto').addEventListener('change', refrescarLotesSalida);

  document.getElementById('saConfirmar').addEventListener('click', () => {
    const producto = document.getElementById('saProducto').value;
    const loteId = document.getElementById('saLote').value;
    const cantidad = Number(document.getElementById('saCantidad').value);
    const motivo = document.getElementById('saMotivo').value;
    const receta = document.getElementById('saReceta').value.trim();

    const p = productos.find(x => x.n === producto);

    if(!producto || !loteId || !cantidad || !motivo){
      toast('Completa el medicamento, lote, cantidad y motivo.', true);
      return;
    }
    if(p && p.requiereReceta && !receta){
      toast('Este medicamento requiere número de receta.', true);
      return;
    }

    const lote = lotes.find(l => l.producto === producto && l.lote === loteId);
    if(!lote || cantidad > lote.cantidad){
      toast(`Stock insuficiente en el lote: solo hay ${lote ? lote.cantidad : 0} unidades disponibles.`, true);
      return;
    }

    lote.cantidad -= cantidad;
    if(p) p.stock = Math.max(0, p.stock - cantidad);

    movimientos.unshift({
      fecha:"2026-09-22", producto, lote: loteId, tipo:"Salida", cantidad, motivo,
      responsable: session.email
    });

    toast(`Salida confirmada: -${cantidad} u. de ${producto} (lote ${loteId}).`);
    document.getElementById('saCantidad').value = '';
    document.getElementById('saCliente').value = '';
    document.getElementById('saReceta').value = '';
    refrescarLotesSalida();
  });

  refrescarLotesSalida();
}
