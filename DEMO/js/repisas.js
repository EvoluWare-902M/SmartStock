/* ===== repisas.js : reubicación sugerida por rotación ===== */
function initPage(){
  document.getElementById('repisasList').innerHTML = reubicaciones.map(r => `
    <div class="reco-card">
      <div>
        <div><b>${r.producto}</b></div>
        <div class="meta">${r.motivo}</div>
      </div>
      <div class="qty">${r.actual} → ${r.sugerida}</div>
    </div>`).join('');
}
