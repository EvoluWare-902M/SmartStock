/* ===== prediccion.js : predicción de demanda con el modelo del servidor (HU-10) ===== */
let chart, seasonChart, productos = [];
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const MESES_C = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function pintar(d, nombre){
  const n = d.historico.length;
  const labels = [...d.etiquetas, ...d.pronostico.map(p => p.etiqueta + ' (est.)')];
  const baseOpts = () => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { boxWidth: 12, color: css('--ink'), font: { family: 'IBM Plex Sans' } } } },
    scales: {
      y: { beginAtZero: true, grid: { color: css('--line') }, ticks: { color: css('--muted') } },
      x: { grid: { display: false }, ticks: { color: css('--muted'), maxRotation: 60 } },
    },
  });

  if(chart) chart.destroy();
  chart = new Chart(document.getElementById('demandChart'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Unidades vendidas', data: [...d.historico, ...d.pronostico.map(() => null)], borderColor: '#103A8C',
        backgroundColor: 'rgba(16,58,140,.12)', tension: .35, fill: true, pointRadius: 2 },
      { label: 'Pronóstico', data: [...Array(n - 1).fill(null), d.historico[n - 1], ...d.pronostico.map(p => p.valor)],
        borderColor: '#F5A524', borderDash: [6, 4], pointRadius: 4, pointBackgroundColor: '#F5A524' },
    ]},
    options: baseOpts(),
  });

  if(seasonChart) seasonChart.destroy();
  seasonChart = new Chart(document.getElementById('seasonChart'), {
    type: 'bar',
    data: { labels: MESES_C, datasets: [{ label: 'Índice estacional', data: d.indices,
      backgroundColor: d.indices.map(v => v >= 1.1 ? '#F5A524' : 'rgba(16,58,140,.55)'), borderRadius: 4 }] },
    options: { ...baseOpts(), plugins: { legend: { display: false } } },
  });

  const prox = d.pronostico;
  const tend = d.tendenciaAnual;
  document.getElementById('predStats').innerHTML = `
    <div class="stat-card"><div class="num">${prox[0].valor}</div><div class="lbl">Unidades estimadas · ${prox[0].etiqueta}</div></div>
    <div class="stat-card"><div class="num">${prox[1].valor}</div><div class="lbl">${prox[1].etiqueta}</div></div>
    <div class="stat-card"><div class="num">${prox[2].valor}</div><div class="lbl">${prox[2].etiqueta}</div></div>
    <div class="stat-card"><div class="num">${d.confianza === null ? '—' : d.confianza + '%'}</div><div class="lbl">Precisión en prueba (últimos 3 meses)</div></div>`;

  let txt;
  if(d.metodo === 'sin-datos'){
    txt = `Aún no hay ventas registradas de <b>${esc(nombre)}</b>: el modelo necesita historial para estimar la demanda.`;
  }else if(d.metodo === 'promedio-movil'){
    txt = `<b>${esc(nombre)}</b> tiene menos de 13 meses de historial, así que todavía no se puede calcular su estacionalidad. La estimación usa un promedio móvil ponderado de los últimos 3 meses.`;
  }else{
    txt = `La demanda de <b>${esc(nombre)}</b> alcanza su punto más alto alrededor de <b>${d.mesPico}</b> y el más bajo en <b>${d.mesBajo}</b>.
      La tendencia general es ${tend > 2 ? `<b>al alza (+${tend}% anual)</b>` : tend < -2 ? `<b>a la baja (${tend}% anual)</b>` : '<b>estable</b>'}.
      Para <b>${prox[0].etiqueta}</b> el modelo estima <b>${prox[0].valor} unidades</b>${prox[1].valor > prox[0].valor * 1.1 ? `, y la demanda seguirá subiendo en ${prox[1].etiqueta}: conviene reabastecer con anticipación` : ''}.
      <div class="hint">Método: descomposición estacional (tendencia lineal × índice mensual) sobre ${n} meses de ventas.${d.error !== null ? ` Error medio en la prueba retrospectiva: ${d.error}%.` : ''}</div>`;
  }
  document.getElementById('insightText').innerHTML = txt;
}

async function cargar(){
  const modo = document.getElementById('modoSelect').value;
  const sel = document.getElementById('catSelect');
  if(modo === 'producto'){
    const d = await api('/analitica/prediccion?producto_id=' + sel.value);
    pintar(d, sel.options[sel.selectedIndex].text);
  }else{
    const d = await api('/analitica/prediccion?categoria=' + encodeURIComponent(sel.value));
    pintar(d, d.categoria);
  }
}

async function initPage(){
  let d;
  try{ d = await api('/analitica/prediccion'); }
  catch(e){
    document.getElementById('predContenido').style.display = 'none';
    document.getElementById('predBloqueo').innerHTML = `<div class="alert-box warn">🔒 <div>${esc(e.message)} <a href="mi-sucursal.html">Ir a Mi sucursal →</a></div></div>`;
    return;
  }
  if(d.sinDatos){
    document.getElementById('predContenido').style.display = 'none';
    document.getElementById('predBloqueo').innerHTML = `<div class="alert-box info">📈 <div>Aún no hay ventas registradas. Conforme registres salidas por venta, el modelo empezará a estimar la demanda.</div></div>`;
    return;
  }
  productos = await api('/productos');
  const sel = document.getElementById('catSelect'), modo = document.getElementById('modoSelect');
  const llenar = () => modo.value === 'producto'
    ? fillSelect(sel, productos.map(p => ({ value: p.id, label: p.nombre })))
    : fillSelect(sel, d.categorias);
  llenar();
  modo.addEventListener('change', () => { llenar(); cargar().catch(e => toast(e.message, true)); });
  sel.addEventListener('change', () => cargar().catch(e => toast(e.message, true)));
  pintar(d, d.categoria);

  document.getElementById('resumenBody').innerHTML = d.resumen.map(r => `<tr>
    <td>${esc(r.categoria)}</td><td><b>${r.proximoMes} u.</b></td><td>${r.mesPico}</td>
    <td><span class="badge ${r.tendenciaAnual > 2 ? 'ok' : r.tendenciaAnual < -2 ? 'low' : 'muted'}">${r.tendenciaAnual > 0 ? '+' : ''}${r.tendenciaAnual}%</span></td>
  </tr>`).join('');
}
