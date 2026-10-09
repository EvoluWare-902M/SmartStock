/* ===== historial.js : trazabilidad de entradas y salidas (HU-9) ===== */
const POR_PAGINA = 25;
let offset = 0, total = 0;

async function renderHistorial(){
  const qs = new URLSearchParams({ limit: POR_PAGINA, offset });
  const f = { producto_id: 'histProducto', tipo: 'histTipo', desde: 'histDesde', hasta: 'histHasta' };
  Object.entries(f).forEach(([k, id]) => { const v = document.getElementById(id).value; if(v) qs.set(k, v); });

  const r = await api('/movimientos?' + qs);
  total = r.total;
  document.getElementById('histBody').innerHTML = r.filas.map(m => `
    <tr>
      <td>${fechaHora(m.fecha)}</td><td>${esc(m.producto)}</td><td>${esc(m.lote || '—')}</td>
      <td><span class="badge ${m.tipo === 'Entrada' ? 'ok' : 'low'}">${m.tipo}</span></td>
      <td>${m.tipo === 'Entrada' ? '+' : '−'}${m.cantidad} u.</td>
      <td>${esc(m.motivo || '—')}${m.receta ? `<div class="hint">Receta ${esc(m.receta)}</div>` : ''}</td>
      <td>${esc(m.responsable || '—')}</td>
    </tr>`).join('') || `<tr><td colspan="7" class="empty">Sin movimientos con este filtro.</td></tr>`;

  document.getElementById('histInfo').textContent = total
    ? `${offset + 1}–${Math.min(offset + POR_PAGINA, total)} de ${total.toLocaleString('es-MX')} movimientos` : '';
  document.getElementById('histPrev').disabled = offset === 0;
  document.getElementById('histNext').disabled = offset + POR_PAGINA >= total;
}

async function initPage(){
  const productos = await api('/productos');
  fillSelect(document.getElementById('histProducto'), productos.map(p => ({ value: p.id, label: p.nombre })), 'Todos los productos');
  const recargar = () => { offset = 0; renderHistorial().catch(e => toast(e.message, true)); };
  ['histProducto','histTipo','histDesde','histHasta'].forEach(id => document.getElementById(id).addEventListener('change', recargar));
  document.getElementById('histPrev').addEventListener('click', () => { offset = Math.max(0, offset - POR_PAGINA); renderHistorial(); });
  document.getElementById('histNext').addEventListener('click', () => { offset += POR_PAGINA; renderHistorial(); });
  await renderHistorial();
}
