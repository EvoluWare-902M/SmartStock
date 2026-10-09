/* ===== recomendacion.js : sugerencias de compra del modelo predictivo (HU-11) ===== */
async function initPage(){
  let recos;
  try{ recos = await api('/analitica/recomendaciones'); }
  catch(e){
    document.getElementById('recoList').innerHTML = `<div class="alert-box warn">🔒 <div>${esc(e.message)} <a href="mi-sucursal.html">Ir a Mi sucursal →</a></div></div>`;
    document.querySelector('.toolbar').style.display = 'none';
    return;
  }
  const total = recos.reduce((s, r) => s + r.costo_estimado, 0);
  document.getElementById('recoResumen').innerHTML = recos.length
    ? `<b>${recos.length}</b> producto(s) por reabastecer · inversión estimada <b>${dinero(total)}</b>` : '';

  const clase = { Alta: 'low', Media: 'warn', Baja: 'ok' };
  document.getElementById('recoList').innerHTML = recos.map(r => `
    <div class="reco-card">
      <div>
        <div><span class="badge ${clase[r.prioridad]}">Prioridad ${r.prioridad}</span> <b>${esc(r.producto)}</b> · ${esc(r.categoria)}</div>
        <div class="meta">${esc(r.motivo)}</div>
        <div class="meta">Stock: ${r.stock} u. · mínimo: ${r.stock_minimo} u. · demanda estimada del mes: ${r.demanda_estimada} u.</div>
      </div>
      <div class="side">
        <div class="qty">${r.cantidad} u.</div>
        <div class="meta">${r.costo_estimado ? '≈ ' + dinero(r.costo_estimado) : ''}</div>
        <a class="btn secondary sm" style="margin-top:8px" href="entradas.html?producto=${r.producto_id}&cantidad=${r.cantidad}">Registrar entrada</a>
      </div>
    </div>`).join('') || `<div class="alert-box info">✅ <div>No hay compras urgentes: el stock actual cubre la demanda estimada del mes.</div></div>`;

  const pdf = document.getElementById('recoPdf'), xls = document.getElementById('recoXlsx');
  pdf.addEventListener('click', () => conBoton(pdf, () => descargar('/reportes/compras?formato=pdf')));
  xls.addEventListener('click', () => conBoton(xls, () => descargar('/reportes/compras?formato=xlsx')));
}
