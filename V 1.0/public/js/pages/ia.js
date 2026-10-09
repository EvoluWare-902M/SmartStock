/* ===== ia.js : análisis inteligente (modelos propios de SmartStock) =====
   Muestra lo que calculan los modelos del servidor (server/services/ia.js):
   - Hallazgos redactados en lenguaje natural.
   - Movimientos inusuales (detección de anomalías con mediana y MAD).
   - Clasificación ABC-XYZ del catálogo.
   - Riesgo de caducidad por lote (simulación de venta FEFO).
   Requiere un plan con analítica; si no, se explica cómo activarlo.
*/
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const ICONO_HALLAZGO = { alerta: '⚠️', riesgo: '⏳', anomalia: '🔎', oportunidad: '💡', ok: '✅' };
const NIVEL = { Alta: 'low', Alto: 'low', Media: 'warn', Medio: 'warn', Baja: 'info', Bajo: 'ok' };

function pintarHallazgos(lista){
  document.getElementById('iaHallazgos').innerHTML = lista.length
    ? lista.map(h => `<div class="hallazgo ${esc(h.tipo)}"><span aria-hidden="true">${ICONO_HALLAZGO[h.tipo] || '💡'}</span>
        <div><b>${esc(h.titulo)}</b><p>${esc(h.texto)}</p></div>${h.enlace ? `<a class="enlace" href="${esc(h.enlace)}">Revisar →</a>` : ''}</div>`).join('')
    : `<div class="hallazgo ok"><span aria-hidden="true">✅</span><div><b>Sin hallazgos por ahora</b><p>Los modelos no encontraron nada fuera de lo normal en tu inventario.</p></div></div>`;
}

function pintarAnomalias(lista){
  document.getElementById('iaAnomalias').innerHTML = lista.map(a => `<tr>
      <td><span class="badge ${NIVEL[a.nivel] || 'info'}">${esc(a.nivel)}</span></td>
      <td>${fechaHora(a.fecha)}</td><td><b>${esc(a.producto)}</b><br><small class="muted">${esc(a.tipo)}</small></td>
      <td>${a.cantidad} u.${a.importe ? `<br><small class="muted">${dinero(a.importe)}</small>` : ''}</td>
      <td>${esc(a.motivo)}</td><td>${esc(a.responsable || '—')}</td></tr>`).join('')
    || `<tr><td colspan="6" class="empty">No se detectaron movimientos inusuales en los últimos 30 días.</td></tr>`;
}

function pintarAbc(d){
  const r = d.resumen;
  document.getElementById('iaAbcResumen').innerHTML = ['A', 'B', 'C'].map(c => `
    <div class="stat-card"><div class="num"><span class="clase ${c}">${c}</span> ${r[c].productos}</div>
      <div class="lbl">producto(s) · ${dinero(r[c].valor)} (${r[c].porcentaje} % de las ventas)</div></div>`).join('');

  const color = { A: '#103A8C', B: '#0CB7F2', C: '#BCEEFF' };
  new Chart(document.getElementById('iaPareto'), {
    data: { labels: d.items.map(i => i.nombre), datasets: [
      { type: 'line', label: '% acumulado', data: d.items.map(i => i.acumulado), yAxisID: 'y2', borderColor: '#F5A524', backgroundColor: '#F5A524', tension: .25, pointRadius: 2 },
      { type: 'bar', label: 'Vendido (6 meses)', data: d.items.map(i => i.valor), backgroundColor: d.items.map(i => color[i.abc]), borderRadius: 3 },
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, ticks: { color: css('--muted'), callback: v => '$' + Number(v).toLocaleString('es-MX') }, grid: { color: css('--line') } },
        y2: { position: 'right', min: 0, max: 100, ticks: { color: css('--muted'), callback: v => v + ' %' }, grid: { display: false } },
        x: { ticks: { color: css('--muted'), maxRotation: 60, minRotation: 40, font: { size: 10 } }, grid: { display: false } } },
      plugins: { legend: { labels: { color: css('--ink') } },
        title: { display: true, text: 'Curva de Pareto: unos cuantos productos concentran la mayor parte de las ventas', color: css('--ink'), font: { family: 'Space Grotesk', size: 14 } } } },
  });

  const xyz = { X: 'Estable', Y: 'Variable', Z: 'Errática' };
  document.getElementById('iaAbc').innerHTML = d.items.map(i => `<tr>
      <td><span class="clase ${i.abc}">${esc(i.clase)}</span></td>
      <td><b>${esc(i.nombre)}</b><br><small class="muted">${esc(i.categoria)}${i.stock_bajo ? ' · <span class="badge low">Stock bajo</span>' : ''}</small></td>
      <td>${dinero(i.valor)}<br><small class="muted">${i.unidades} u.</small></td><td>${i.participacion} %</td>
      <td>${xyz[i.xyz] || i.xyz}</td><td class="muted" style="font-size:.86rem">${esc(i.consejo)}</td></tr>`).join('')
    || `<tr><td colspan="6" class="empty">Aún no hay ventas suficientes para clasificar.</td></tr>`;
}

function pintarCaducidad(lista){
  const perdida = lista.reduce((s, l) => s + l.perdida, 0), unidades = lista.reduce((s, l) => s + l.en_riesgo, 0);
  document.getElementById('iaCadResumen').innerHTML = `
    <div class="stat-card"><div class="num">${lista.length}</div><div class="lbl">Lote(s) con riesgo de caducar con producto</div></div>
    <div class="stat-card"><div class="num" style="color:var(--coral)">${lista.filter(l => l.nivel === 'Alto').length}</div><div class="lbl">De riesgo alto</div></div>
    <div class="stat-card"><div class="num">${unidades}</div><div class="lbl">Unidades que no alcanzarían a venderse</div></div>
    <div class="stat-card"><div class="num" style="color:var(--ambar-texto)">${dinero(perdida)}</div><div class="lbl">Pérdida estimada</div></div>`;
  document.getElementById('iaCaducidad').innerHTML = lista.map(l => `<tr>
      <td><span class="badge ${NIVEL[l.nivel] || 'info'}">${esc(l.nivel)}</span></td><td><b>${esc(l.producto)}</b></td><td>${esc(l.lote)}</td>
      <td>${fechaCorta(l.caducidad)}<br><small class="muted">${l.dias < 0 ? 'Caducó hace ' + (-l.dias) + ' día(s)' : 'En ' + l.dias + ' día(s)'}</small></td>
      <td>${l.cantidad} u.<br><small class="muted">Se venden ~${l.ritmo_diario}/día</small></td>
      <td><b>${l.en_riesgo} u.</b> (${l.porcentaje} %)</td><td>${dinero(l.perdida)}</td><td class="muted" style="font-size:.86rem">${esc(l.accion)}</td></tr>`).join('')
    || `<tr><td colspan="8" class="empty">Con el ritmo de venta actual, todos los lotes se venderían antes de caducar.</td></tr>`;
}

function pintarMinimos(lista){
  const cambios = lista.filter(m => m.relevante);
  document.getElementById('iaMinResumen').textContent = cambios.length
    ? `${cambios.length} de ${lista.length} medicamentos tienen un mínimo que conviene ajustar (${cambios.filter(m => m.cambio > 0).length} subir, ${cambios.filter(m => m.cambio < 0).length} bajar).`
    : `Los mínimos de tus ${lista.length} medicamentos están bien calibrados.`;
  document.getElementById('iaMinimos').innerHTML = cambios.map(m => `<tr>
      <td><input type="checkbox" value="${m.producto_id}" aria-label="Aplicar a ${esc(m.producto)}"></td>
      <td><b>${esc(m.producto)}</b><br><small class="muted">Hay ${m.stock} u.</small></td><td>${m.actual} u.</td>
      <td><b>${m.sugerido} u.</b> <span class="badge ${m.cambio > 0 ? 'warn' : 'info'}">${m.cambio > 0 ? '▲ subir ' + m.cambio : '▼ bajar ' + (-m.cambio)}</span></td>
      <td>${m.demanda_diaria} u.</td><td>${m.proveedor ? `${esc(m.proveedor)}<br><small class="muted">${m.dias_entrega} día(s)</small>` : '<span class="muted">Sin asignar</span>'}</td>
      <td class="muted" style="font-size:.86rem">${esc(m.motivo)}</td></tr>`).join('')
    || `<tr><td colspan="7" class="empty">No hay cambios que sugerir por ahora.</td></tr>`;
  const cuerpo = document.getElementById('iaMinimos'), boton = document.getElementById('iaMinAplicar'), todos = document.getElementById('iaMinTodos');
  const marcados = () => [...cuerpo.querySelectorAll('input:checked')].map(c => Number(c.value));
  const refrescar = () => { const n = marcados().length; boton.disabled = !n; boton.textContent = n ? `Aplicar a ${n} medicamento${n === 1 ? '' : 's'}` : 'Aplicar seleccionados'; };
  todos.checked = false; todos.onchange = () => { cuerpo.querySelectorAll('input').forEach(c => c.checked = todos.checked); refrescar(); };
  cuerpo.onchange = refrescar; refrescar();
  boton.onclick = () => conBoton(boton, async () => {
    const r = await api('/ia/minimos/aplicar', { method: 'POST', body: { producto_ids: marcados() } });
    toast(`Se actualizó el stock mínimo de ${r.aplicados} medicamento(s).`);
    pintarMinimos(await api('/ia/minimos'));
    if(typeof actualizarBadgeAlertas === 'function') actualizarBadgeAlertas();
  });
}

function pintarJuntos(d){
  const pares = new Set(d.reglas.map(r => [r.a_id, r.b_id].sort().join('-'))).size;
  document.getElementById('iaJuntosResumen').innerHTML = `
    <div class="stat-card"><div class="num">${d.tickets.toLocaleString('es-MX')}</div><div class="lbl">Tickets analizados (${d.dias} días)</div></div>
    <div class="stat-card"><div class="num">${pares}</div><div class="lbl">Combinaciones con patrón claro</div></div>
    <div class="stat-card"><div class="num">${d.reglas[0] ? d.reglas[0].confianza + ' %' : '—'}</div><div class="lbl">${d.reglas[0] ? `Regla más fuerte: ${esc(d.reglas[0].a)} → ${esc(d.reglas[0].b)}` : 'Aún sin reglas'}</div></div>`;
  document.getElementById('iaJuntos').innerHTML = d.reglas.map(r => `<tr>
      <td><b>${esc(r.a)}</b></td><td><b>${esc(r.b)}</b></td>
      <td><div class="salud"><i><b style="width:${Math.min(100, r.confianza)}%; background:var(--cielo)"></b></i><span style="width:auto">${r.confianza} %</span></div></td>
      <td>${r.juntos} de ${r.tickets_a}</td><td>${r.lift}×</td></tr>`).join('')
    || `<tr><td colspan="5" class="empty">Todavía no hay suficientes tickets con varios productos. Las reglas aparecen cuando una combinación se repite al menos 5 veces.</td></tr>`;
}

async function initPage(){
  let datos;
  try{
    datos = await Promise.all([api('/ia/hallazgos'), api('/ia/anomalias'), api('/ia/abc'), api('/ia/caducidad'), api('/ia/minimos'), api('/ia/juntos')]);
  }catch(e){
    // Plan sin analítica: se explica en lugar de dejar la pantalla vacía.
    document.getElementById('iaContenido').hidden = true;
    document.getElementById('iaBloqueo').innerHTML = `<div class="alert-box info">🔒 <div><b>El análisis inteligente no está incluido en tu plan.</b><br>${esc(e.message)}<br>
      <a href="mi-sucursal.html">Ver planes y solicitar cambio →</a> · Mientras tanto puedes usar el <a href="asistente.html">asistente</a> y la búsqueda tolerante a errores.</div></div>`;
    return;
  }
  activarTabs();
  pintarHallazgos(datos[0]); pintarAnomalias(datos[1]); pintarAbc(datos[2]); pintarCaducidad(datos[3]); pintarMinimos(datos[4]); pintarJuntos(datos[5]);
}
