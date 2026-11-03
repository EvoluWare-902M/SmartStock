/* ===== bitacora.js : bitácora de auditoría (superadministrador) ===== */
const POR_PAGINA = 25;
let offset = 0, total = 0, timer;
const ETIQUETA = { 'sucursal.registro': 'Registro', 'sucursal.aprobar': 'Aprobación', 'sucursal.rechazar': 'Rechazo', 'sucursal.suspender': 'Suspensión', 'sucursal.reactivar': 'Reactivación',
  'sucursal.plan': 'Cambio de plan', 'sucursal.solicitud-plan': 'Solicitud de plan', 'usuario.crear': 'Alta de usuario', 'usuario.password': 'Contraseña', 'usuario.activar': 'Activación',
  'usuario.desactivar': 'Desactivación', 'aviso.crear': 'Aviso', 'aviso.editar': 'Aviso', 'aviso.estado': 'Aviso', 'aviso.eliminar': 'Aviso' };
const CLASE = a => /rechazar|suspender|desactivar|eliminar/.test(a) ? 'low' : /aprobar|reactivar|activar|crear/.test(a) ? 'ok' : 'info';

async function cargar(){
  const qs = new URLSearchParams({ limit: POR_PAGINA, offset });
  [['q', 'biBuscar'], ['accion', 'biAccion'], ['desde', 'biDesde'], ['hasta', 'biHasta']].forEach(([k, id]) => { const v = document.getElementById(id).value.trim(); if(v) qs.set(k, v); });
  const r = await api('/plataforma/bitacora?' + qs); total = r.total;
  document.getElementById('biBody').innerHTML = r.filas.map(f => `<tr>
    <td style="white-space:nowrap">${fechaHora(f.fecha)}</td><td>${esc(f.usuario_nombre)}</td>
    <td><span class="badge ${CLASE(f.accion)}">${ETIQUETA[f.accion] || esc(f.accion)}</span></td><td>${esc(f.detalle)}</td>
    <td>${f.sucursal ? `<a class="enlace" href="sucursal.html?id=${f.sucursal_id}">${esc(f.sucursal)}</a>` : '<span class="muted">—</span>'}</td></tr>`).join('')
    || `<tr><td colspan="5" class="empty">Sin registros con este filtro.</td></tr>`;
  document.getElementById('biInfo').textContent = total ? `${offset + 1}–${Math.min(offset + POR_PAGINA, total)} de ${total}` : '';
  document.getElementById('biPrev').disabled = offset === 0;
  document.getElementById('biNext').disabled = offset + POR_PAGINA >= total;
}

async function initPage(){
  await cargar();
  const recargar = () => { clearTimeout(timer); timer = setTimeout(() => { offset = 0; cargar().catch(e => toast(e.message, true)); }, 250); };
  ['biBuscar', 'biAccion', 'biDesde', 'biHasta'].forEach(id => document.getElementById(id).addEventListener('input', recargar));
  document.getElementById('biPrev').addEventListener('click', () => { offset = Math.max(0, offset - POR_PAGINA); cargar(); });
  document.getElementById('biNext').addEventListener('click', () => { offset += POR_PAGINA; cargar(); });
}
