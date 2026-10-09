/* ===== recomendacion.js : sugerencias de compra ===== */
function initPage(){
  document.getElementById('recoList').innerHTML = recomendaciones.map(r => `
    <div class="reco-card">
      <div>
        <div><b>${r.producto}</b> · ${r.categoria}</div>
        <div class="meta">${r.motivo}</div>
      </div>
      <div class="qty">${r.cantidad} u.</div>
    </div>`).join('');
}
