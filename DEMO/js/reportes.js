/* ===== reportes.js : resumen general del inventario ===== */
function initPage(){
  const bajos = productos.filter(p => p.stock <= p.min).length;
  const porVencer = lotes.filter(l => colorPorDias(diasRestantes(l.caducidad)) !== 'verde').length;

  document.getElementById('reportStats').innerHTML = `
    <div class="stat-card"><div class="num">${productos.length}</div><div class="lbl">Productos registrados</div></div>
    <div class="stat-card"><div class="num">${productos.reduce((s,p)=>s+p.stock,0)}</div><div class="lbl">Unidades en stock</div></div>
    <div class="stat-card"><div class="num">${bajos}</div><div class="lbl">Alertas de stock bajo</div></div>
    <div class="stat-card"><div class="num">${porVencer}</div><div class="lbl">Lotes por vencer</div></div>
  `;

  document.getElementById('genReporte').addEventListener('click', () => {
    const tipo = document.getElementById('repTipo').value;
    toast(`Reporte de "${tipo}" generado con los datos actuales.`);
  });
  document.getElementById('descReporte').addEventListener('click', () => {
    toast('La exportación a PDF estará disponible en la versión con backend.');
  });
}
