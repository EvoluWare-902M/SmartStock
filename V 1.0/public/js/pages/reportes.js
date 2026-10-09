/* ===== reportes.js : dashboard de indicadores y exportación PDF / Excel (HU-13) ===== */
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function paramsReporte(formato){
  const qs = new URLSearchParams({ formato });
  const d = document.getElementById('repDesde').value, h = document.getElementById('repHasta').value;
  if(d) qs.set('desde', d); if(h) qs.set('hasta', h);
  return `/reportes/${document.getElementById('repTipo').value}?${qs}`;
}

async function initPage(){
  const r = await api('/reportes/resumen');
  document.getElementById('reportStats').innerHTML = `
    <div class="stat-card"><div class="num">${r.productos}</div><div class="lbl">Productos registrados</div></div>
    <div class="stat-card"><div class="num">${r.unidades.toLocaleString('es-MX')}</div><div class="lbl">Unidades en stock</div></div>
    <div class="stat-card"><div class="num">${dinero(r.valorInventario)}</div><div class="lbl">Valor del inventario (precio venta)</div></div>
    <div class="stat-card"><div class="num">${r.ventas30.unidades.toLocaleString('es-MX')}</div><div class="lbl">Unidades vendidas (30 días) · ${dinero(r.ventas30.importe)}</div></div>
    <div class="stat-card"><div class="num" style="color:var(--coral)">${r.stockBajo}</div><div class="lbl">Alertas de stock bajo</div></div>
    <div class="stat-card"><div class="num" style="color:var(--ambar-texto)">${r.lotesPorVencer}</div><div class="lbl">Lotes por vencer (≤45 días)</div></div>
    <div class="stat-card"><div class="num" style="color:var(--coral)">${r.lotesCaducados}</div><div class="lbl">Lotes caducados</div></div>`;

  const ejes = {
    y: { beginAtZero: true, grid: { color: css('--line') }, ticks: { color: css('--muted') } },
    x: { grid: { display: false }, ticks: { color: css('--muted') } },
  };
  const titulo = t => ({ display: true, text: t, color: css('--ink'), font: { family: 'Space Grotesk', size: 14 } });
  new Chart(document.getElementById('ventasChart'), {
    type: 'bar',
    data: { labels: r.ventasMensuales.etiquetas, datasets: [{ label: 'Unidades vendidas', data: r.ventasMensuales.valores, backgroundColor: '#103A8C', borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, scales: ejes, plugins: { legend: { display: false }, title: titulo('Ventas por mes (últimos 12 meses)') } },
  });
  new Chart(document.getElementById('topChart'), {
    type: 'bar',
    data: { labels: r.topProductos.map(t => t.nombre), datasets: [{ label: 'Unidades', data: r.topProductos.map(t => t.unidades), backgroundColor: '#0CB7F2', borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: { x: ejes.y, y: { grid: { display: false }, ticks: { color: css('--muted') } } },
      plugins: { legend: { display: false }, title: titulo('Más vendidos (30 días)') } },
  });

  const gen = document.getElementById('genReporte'), pdf = document.getElementById('descPdf'), xls = document.getElementById('descXlsx');
  gen.addEventListener('click', () => conBoton(gen, async () => {
    const d = await api(paramsReporte('json'));
    document.getElementById('preview').innerHTML = d.secciones.map(s => `
      <div class="panel table-wrap" style="padding:0; overflow:hidden;">
        <div style="padding:14px 16px; font-weight:600; color:var(--primario)">${esc(s.titulo)} <span class="muted" style="font-weight:400">· ${s.filas.length} registro(s)</span></div>
        <table><thead><tr>${s.columnas.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${s.filas.slice(0, 100).map((f, i) => `<tr${s.resaltar && s.resaltar[i] ? ' style="color:var(--coral)"' : ''}>${f.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')
          || `<tr><td colspan="${s.columnas.length}" class="empty">Sin registros.</td></tr>`}</tbody></table>
        ${s.filas.length > 100 ? `<div class="pager">Mostrando 100 de ${s.filas.length}. Descarga el archivo para ver todo.</div>` : ''}
      </div>`).join('');
    toast('Reporte generado con los datos actuales.');
    document.getElementById('preview').scrollIntoView({ behavior: 'smooth' });
  }));
  pdf.addEventListener('click', () => conBoton(pdf, async () => { await descargar(paramsReporte('pdf')); toast('PDF descargado.'); }));
  xls.addEventListener('click', () => conBoton(xls, async () => { await descargar(paramsReporte('xlsx')); toast('Excel descargado.'); }));
}
