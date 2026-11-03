/* ===== plataforma.js : panel del superadministrador ===== */
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const colorSalud = n => n >= 65 ? '#2BB673' : n >= 35 ? '#F5A524' : '#D9564A';

async function initPage(){
  const r = await api('/plataforma/resumen');
  const e = r.porEstado;
  document.getElementById('plStats').innerHTML = `
    <div class="stat-card"><div class="num">${r.total}</div><div class="lbl">Sucursales registradas</div></div>
    <div class="stat-card"><div class="num">${e.Activa || 0}</div><div class="lbl">Activas</div></div>
    <div class="stat-card"><div class="num" style="color:var(--ambar-texto)">${e.Pendiente || 0}</div><div class="lbl">Solicitudes por revisar</div></div>
    <div class="stat-card"><div class="num" style="color:var(--coral)">${(e.Suspendida || 0) + (e.Rechazada || 0)}</div><div class="lbl">Suspendidas o rechazadas</div></div>
    <div class="stat-card"><div class="num">${dinero(r.ingresoMensual)}</div><div class="lbl">Ingreso mensual estimado (planes activos)</div></div>
    <div class="stat-card"><div class="num">${r.usuarios.activos}</div><div class="lbl">Usuarios activos de ${r.usuarios.total}</div></div>
    <div class="stat-card"><div class="num" style="color:var(--coral)">${r.salud.filter(s => s.nivel !== 'Saludable').length}</div><div class="lbl">Sucursales en riesgo o inactivas</div></div>`;

  let html = '';
  if(r.pendientes.length) html += `<div class="alert-box warn">📝 <div><b>${r.pendientes.length} solicitud(es) de registro por revisar:</b><br>
    ${r.pendientes.map(s => `<a class="enlace" href="sucursal.html?id=${s.id}">${esc(s.nombre)}</a> · plan ${esc(s.plan)} · ${esc(s.municipio || '')} (${fechaCorta(s.fecha_alta)})`).join('<br>')}</div></div>`;
  if(r.cambiosDePlan.length) html += `<div class="alert-box info">🔁 <div><b>${r.cambiosDePlan.length} solicitud(es) de cambio de plan:</b><br>
    ${r.cambiosDePlan.map(s => `<a class="enlace" href="sucursal.html?id=${s.id}">${esc(s.nombre)}</a>: ${esc(s.plan)} → ${esc(s.plan_solicitado)}`).join('<br>')}</div></div>`;
  document.getElementById('plPendientes').innerHTML = html;

  const ejes = { y: { beginAtZero: true, ticks: { precision: 0, color: css('--muted') }, grid: { color: css('--line') } }, x: { grid: { display: false }, ticks: { color: css('--muted') } } };
  const titulo = t => ({ display: true, text: t, color: css('--ink'), font: { family: 'Space Grotesk', size: 14 } });
  new Chart(document.getElementById('plRegistros'), { type: 'bar',
    data: { labels: r.registrosPorMes.map(m => m.etiqueta), datasets: [{ label: 'Registros', data: r.registrosPorMes.map(m => m.registros), backgroundColor: '#103A8C', borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, scales: ejes, plugins: { legend: { display: false }, title: titulo('Sucursales registradas por mes') } } });
  const planes = Object.keys(r.porPlan);
  new Chart(document.getElementById('plPlanes'), { type: 'bar',
    data: { labels: planes, datasets: [{ label: 'Sucursales activas', data: planes.map(p => r.porPlan[p]), backgroundColor: ['#BCEEFF', '#53D4FF', '#0CB7F2', '#103A8C'], borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: ejes.y, y: ejes.x }, plugins: { legend: { display: false }, title: titulo('Sucursales activas por plan') } } });

  const badge = { Saludable: 'ok', 'En riesgo': 'warn', Inactiva: 'low' };
  document.getElementById('plSalud').innerHTML = r.salud.map(s => `<tr>
    <td><b>${esc(s.nombre)}</b></td><td>${esc(s.plan)}</td>
    <td><div class="salud"><i><b style="width:${s.salud}%; background:${colorSalud(s.salud)}"></b></i><span>${s.salud}</span></div>
        <span class="badge ${badge[s.nivel]}">${s.nivel}</span></td>
    <td>${s.ultimo_acceso ? fechaCorta(s.ultimo_acceso) : 'Nunca'}</td><td>${s.mov30}</td>
    <td class="muted" style="font-size:.84rem">${s.motivos.length ? esc(s.motivos.join(' · ')) : 'Uso constante'}</td>
    <td><a class="btn secondary sm" href="sucursal.html?id=${s.id}">Ver ficha</a></td></tr>`).join('')
    || `<tr><td colspan="7" class="empty">Aún no hay sucursales activas.</td></tr>`;
}
