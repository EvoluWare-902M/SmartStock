/* ===== prediccion.js : estimación de demanda por categoría ===== */
let chart;

function forecastNext(arr){
  const last3 = arr.slice(-3);
  return Math.round(last3[0]*0.2 + last3[1]*0.3 + last3[2]*0.5);
}

function renderChart(cat){
  const data = historicos[cat];
  const next = forecastNext(data);
  const ctx = document.getElementById('demandChart').getContext('2d');
  if(chart) chart.destroy();

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [...meses, 'Ene (est.)'],
      datasets: [
        { label:'Unidades vendidas', data:[...data, null], borderColor:'#10645A',
          backgroundColor:'rgba(16,100,90,.12)', tension:.35, fill:true, pointRadius:3 },
        { label:'Predicción', data:[...Array(11).fill(null), data[11], next],
          borderColor:'#E2A73A', borderDash:[6,4], pointRadius:4, pointBackgroundColor:'#E2A73A' }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ boxWidth:12, font:{ family:'IBM Plex Sans' } } } },
      scales:{ y:{ beginAtZero:true, grid:{ color:'#DCE6E1' } }, x:{ grid:{ display:false } } }
    }
  });

  const peakMonth = meses[data.indexOf(Math.max(...data))];
  document.getElementById('insightText').innerHTML =
    `La demanda de <b>${cat}</b> tiende a subir alrededor de <b>${peakMonth}</b>. El modelo sugiere unas <b>${next} unidades</b> para el próximo mes: conviene reabastecer con anticipación en esa temporada.`;
}

function initPage(){
  const catSelect = document.getElementById('catSelect');
  fillSelect(catSelect, Object.keys(historicos));
  catSelect.addEventListener('change', () => renderChart(catSelect.value));
  renderChart(Object.keys(historicos)[0]);
}
