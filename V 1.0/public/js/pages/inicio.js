/* ===== inicio.js : panel de inicio con notificaciones de alertas ===== */
async function initPage(session){
  const hora = new Date().getHours();
  document.getElementById('saludo').textContent =
    `${hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches'}, ${session.nombre.split(' ')[0]}`;

  const accesos = [
    ['venta.html','🧾 Punto de venta','Cobra un ticket con varios medicamentos', ['dueno','empleado']],
    ['turno.html','☀️ Mi turno','Tus ventas de hoy y lo que toca hacer', ['dueno','empleado']],
    ['buscar.html','🔎 Localizar producto','Encuentra un medicamento en el anaquel', ['dueno','empleado']],
    ['asistente.html','💬 Preguntar al asistente','Ubicaciones, existencias y caducidades en tus palabras', ['dueno','empleado']],
    ['salidas.html','📤 Mermas y retiros','Caducados, traslados y devoluciones', ['dueno','empleado']],
    ['entradas.html','📥 Registrar entrada','Recepción de mercancía', ['dueno']],
    ['compras.html','📦 Compras','Órdenes sugeridas por la IA y proveedores', ['dueno']],
    ['caducidades.html','⏳ Caducidades','Lotes por vencer', ['dueno','empleado']],
    ['reportes.html','📊 Reportes','Indicadores y exportación', ['dueno']],
  ];
  document.getElementById('accesos').innerHTML = accesos.filter(a => a[3].includes(session.role))
    .map(a => `<a class="quick" href="${a[0]}"><b>${a[1]}</b><span>${a[2]}</span></a>`).join('');

  const [alertas, inventario] = await Promise.all([api('/inventario/alertas'), api('/inventario')]);
  const unidades = inventario.reduce((s, p) => s + p.stock, 0);
  document.getElementById('kpis').innerHTML = `
    <div class="stat-card"><div class="num">${inventario.length}</div><div class="lbl">Medicamentos en catálogo</div></div>
    <div class="stat-card"><div class="num">${unidades}</div><div class="lbl">Unidades disponibles</div></div>
    <div class="stat-card"><div class="num" style="color:var(--coral)">${alertas.stockBajo.length}</div><div class="lbl">Con stock bajo</div></div>
    <div class="stat-card"><div class="num" style="color:var(--ambar-texto)">${alertas.porVencer.length + alertas.caducados.length}</div><div class="lbl">Lotes por vencer / caducados</div></div>`;

  let html = '';
  if(alertas.stockBajo.length){
    html += `<div class="alert-box">⚠️ <div><b>Reabastecimiento necesario:</b> ${alertas.stockBajo.length} producto(s) llegaron a su nivel mínimo.<br>
      ${alertas.stockBajo.map(p => `${esc(p.nombre)} (${p.stock}/${p.minimo} u.)`).join(' · ')}
      ${session.role === 'dueno' ? '<br><a href="recomendacion.html">Ver cuánto comprar →</a>' : '<br><a href="inventario.html">Ver existencias →</a>'}</div></div>`;
  }
  if(alertas.caducados.length){
    html += `<div class="alert-box">🚫 <div><b>${alertas.caducados.length} lote(s) caducado(s)</b> con existencia: retíralos como merma.<br>
      ${alertas.caducados.map(l => `${esc(l.producto)} · lote ${esc(l.lote)} (${l.cantidad} u.)`).join(' · ')}<br><a href="salidas.html">Registrar merma →</a></div></div>`;
  }
  if(alertas.porVencer.length){
    html += `<div class="alert-box warn">⏳ <div><b>${alertas.porVencer.length} lote(s) vencen en 15 días o menos:</b> dales salida primero.<br>
      ${alertas.porVencer.map(l => `${esc(l.producto)} · ${esc(l.lote)} (${l.dias} días)`).join(' · ')}<br><a href="caducidades.html">Ver caducidades →</a></div></div>`;
  }
  if(!html) html = `<div class="alert-box info">✅ <div>Todo en orden: no hay productos bajo el mínimo ni lotes por vencer.</div></div>`;
  document.getElementById('notificaciones').innerHTML = html;

  // Avisos de la plataforma (los publica el superadministrador) y hallazgos de los modelos de IA.
  // Son complementarios: si alguno falla o el plan no incluye analítica, el inicio se muestra igual.
  const [avisos, hallazgos] = await Promise.all([
    api('/avisos').catch(() => []),
    session.role === 'dueno' ? api('/ia/hallazgos').catch(() => null) : null,
  ]);
  const extra = document.getElementById('extrasInicio');
  const ico = { alerta: '⚠️', riesgo: '⏳', anomalia: '🔎', oportunidad: '💡', ok: '✅' };
  extra.innerHTML =
    avisos.map(a => `<div class="aviso-plataforma ${esc(a.tipo)}"><span aria-hidden="true">${a.tipo === 'Mantenimiento' ? '🛠️' : a.tipo === 'Importante' ? '❗' : '📣'}</span>
      <div><b>${esc(a.titulo)}</b>${esc(a.mensaje)}<br><small class="muted">Aviso del equipo de SmartStock</small></div></div>`).join('')
    + (hallazgos && hallazgos.length ? `<div class="panel" style="margin-top:14px">
        <div class="panel-tit">Lo que detectó el análisis inteligente <span class="ia-tag">IA</span> <small><a class="enlace" href="ia.html">Ver todo →</a></small></div>
        <div class="card-list">${hallazgos.slice(0, 3).map(h => `<div class="hallazgo ${esc(h.tipo)}"><span aria-hidden="true">${ico[h.tipo] || '💡'}</span>
          <div><b>${esc(h.titulo)}</b><p>${esc(h.texto)}</p></div>${h.enlace ? `<a class="enlace" href="${esc(h.enlace)}">Revisar →</a>` : ''}</div>`).join('')}</div></div>` : '');
}
