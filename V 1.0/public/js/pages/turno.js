/* ===== turno.js : Mi turno =====
   Resumen del día y pendientes generados y ordenados por el servidor (server/services/turno.js).
*/
const ICONO_TAREA = { caducado: '🚫', conteo: '🧮', 'por-vencer': '⏳', orden: '📦', stock: '📉', demanda: '🙋', anomalia: '🔎' };
const NIVEL_TAREA = { Urgente: 'low', Hoy: 'warn', 'Cuando puedas': 'info' };

async function cargar(session){
  const t = await api('/turno');
  const gerente = session.role === 'dueno';
  document.getElementById('tuTitulo').textContent = gerente ? 'Turno de hoy' : 'Mi turno';
  document.getElementById('tuFecha').textContent = `${fechaCorta(t.fecha)} · ${gerente ? 'Cómo va la sucursal y qué conviene atender primero.' : 'Lo que llevas hoy y lo que toca hacer, ordenado por urgencia.'}`;
  document.getElementById('tuResumen').innerHTML = `<span aria-hidden="true">👋</span><div><b>${esc((session.nombre || '').split(' ')[0])}, este es tu resumen <span class="ia-tag">IA</span></b><p>${esc(t.resumen)}</p></div>`;

  const v = gerente ? t.sucursal : t.mias;
  const contra = t.promedio_diario > 0 ? Math.round((v.tickets / t.promedio_diario - 1) * 100) : null;
  document.getElementById('tuStats').innerHTML = `
    <div class="stat-card"><div class="num">${v.tickets}</div><div class="lbl">${gerente ? 'Ventas de la sucursal hoy' : 'Ventas que llevas hoy'}</div></div>
    <div class="stat-card"><div class="num">${v.unidades}</div><div class="lbl">Piezas vendidas</div></div>
    <div class="stat-card"><div class="num">${dinero(v.importe)}</div><div class="lbl">Importe</div></div>
    <div class="stat-card"><div class="num">${t.promedio_diario}</div><div class="lbl">Promedio diario de ventas (4 semanas)${contra !== null && v.tickets ? ` · hoy vas ${contra >= 0 ? '+' : ''}${contra} %` : ''}</div></div>`;

  document.getElementById('tuTareas').innerHTML = t.tareas.map(x => `
    <div class="tarea ${NIVEL_TAREA[x.nivel]}">
      <span class="tarea-ico" aria-hidden="true">${ICONO_TAREA[x.tipo] || '•'}</span>
      <div class="tarea-txt"><span class="badge ${NIVEL_TAREA[x.nivel]}">${esc(x.nivel)}</span><b>${esc(x.titulo)}</b><p>${esc(x.detalle)}</p></div>
      <a class="btn secondary sm" href="${esc(x.href)}">${esc(x.accion)}</a>
    </div>`).join('') || `<div class="hallazgo ok"><span aria-hidden="true">✅</span><div><b>Sin pendientes</b><p>No hay lotes por retirar, conteos ni avisos por atender.</p></div></div>`;

  document.getElementById('tuEquipoPanel').hidden = !gerente;
  if(gerente) document.getElementById('tuEquipo').innerHTML = t.equipo.map(e => `<tr><td><b>${esc(e.nombre)}</b></td><td>${e.tickets}</td><td>${e.unidades}</td><td>${dinero(e.importe)}</td></tr>`).join('')
    || `<tr><td colspan="4" class="empty">Aún no hay ventas hoy.</td></tr>`;
}

async function initPage(session){
  await cargar(session);
  document.getElementById('tuFaltante').addEventListener('submit', async e => {
    e.preventDefault();
    const texto = document.getElementById('tuTexto').value.trim();
    if(texto.length < 3) return toast('Escribe qué pidió el cliente.', true);
    try{
      await api('/faltantes', { method: 'POST', body: { texto, cantidad: document.getElementById('tuCant').value } });
      document.getElementById('tuTexto').value = ''; document.getElementById('tuCant').value = 1;
      toast('Anotado. El gerente lo verá agrupado con solicitudes parecidas.');
      if(session.role === 'dueno') await cargar(session);
    }catch(err){ toast(err.message, true); }
  });
}
