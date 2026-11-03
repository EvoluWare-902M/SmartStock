/* ===== sucursales.js : listado de sucursales (superadministrador) ===== */
let sucursales = [];
const BADGE_ESTADO = { Activa: 'ok', Pendiente: 'warn', Suspendida: 'low', Rechazada: 'muted' };

// Pide el motivo y cambia el estado. La usan esta página y la ficha.
async function cambiarEstado(s, estado){
  let motivo = '';
  if(estado !== 'Activa'){
    const v = await modal({ titulo: estado === 'Rechazada' ? 'Rechazar solicitud' : 'Suspender sucursal', peligro: true, aceptar: estado === 'Rechazada' ? 'Rechazar' : 'Suspender',
      texto: `Escribe el motivo. <b>${esc(s.dueno_nombre)}</b> lo verá al intentar iniciar sesión.`,
      campos: [{ id: 'm', label: 'Motivo (mínimo 10 caracteres)', placeholder: 'Ej. No fue posible verificar el domicilio.' }] });
    if(!v) return false;
    motivo = v.m;
  }
  await api(`/sucursales/${s.id}/estado`, { method: 'PUT', body: { estado, motivo } });
  toast(`${s.nombre}: ${estado === 'Activa' ? (s.estado === 'Pendiente' ? 'solicitud aprobada' : 'reactivada') : estado.toLowerCase()}.`);
  return true;
}
function accionesDe(s){
  if(s.estado === 'Pendiente') return `<button class="btn sm" data-estado="Activa" data-id="${s.id}">Aprobar</button><button class="btn danger sm" data-estado="Rechazada" data-id="${s.id}">Rechazar</button>`;
  if(s.estado === 'Activa') return `<button class="btn danger sm" data-estado="Suspendida" data-id="${s.id}">Suspender</button>`;
  if(s.estado === 'Suspendida') return `<button class="btn secondary sm" data-estado="Activa" data-id="${s.id}">Reactivar</button>`;
  return '';
}

function render(){
  const q = norm(document.getElementById('sucBuscar').value), est = document.getElementById('sucFiltro').value, plan = document.getElementById('sucPlan').value;
  const lista = sucursales.filter(s => (!est || s.estado === est) && (!plan || s.plan === plan) && (!q || norm(`${s.nombre} ${s.dueno_nombre} ${s.correo} ${s.municipio}`).includes(q)));
  document.getElementById('sucBody').innerHTML = lista.map(s => `<tr>
      <td><a class="enlace" href="sucursal.html?id=${s.id}">${esc(s.nombre)}</a><div class="hint">${esc(s.tipo || '')}${s.municipio ? ' · ' + esc(s.municipio) + ', ' + esc(s.entidad) : ''}</div></td>
      <td>${esc(s.dueno_nombre)}<div class="hint">${esc(s.correo)}</div></td>
      <td>${esc(s.plan)}${s.plan_solicitado ? `<div class="hint">Solicita <b>${esc(s.plan_solicitado)}</b></div>` : ''}</td>
      <td class="muted">${s.usuarios} usuario(s)<br>${s.productos} medicamento(s)</td>
      <td>${s.ultimo_acceso ? fechaCorta(s.ultimo_acceso) : '<span class="muted">Nunca</span>'}</td>
      <td><span class="badge ${BADGE_ESTADO[s.estado]}">${s.estado}</span><div class="hint">Alta ${fechaCorta(s.fecha_alta)}</div></td>
      <td><div class="row-actions"><a class="btn secondary sm" href="sucursal.html?id=${s.id}">Ficha</a>${accionesDe(s)}</div></td>
    </tr>`).join('') || `<tr><td colspan="7" class="empty">Sin sucursales con este filtro.</td></tr>`;
}
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function initPage(){
  const CAT = await catalogos();
  fillSelect(document.getElementById('sucPlan'), CAT.planes, 'Todos los planes');
  const estado = new URLSearchParams(location.search).get('estado');
  if(estado) document.getElementById('sucFiltro').value = estado;
  const cargar = async () => { sucursales = await api('/sucursales'); render(); };
  await cargar();
  ['sucBuscar', 'sucFiltro', 'sucPlan'].forEach(id => document.getElementById(id).addEventListener('input', render));
  document.getElementById('sucBody').addEventListener('click', async e => {
    const { id, estado } = e.target.dataset;
    if(!id || !estado) return;
    try{ if(await cambiarEstado(sucursales.find(x => x.id === Number(id)), estado)) await cargar(); }
    catch(err){ toast(err.message, true); }
  });
}
