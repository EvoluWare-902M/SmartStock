/* ===== sucursales.js : panel del superadministrador ===== */
function renderStats(){
  const activas = sucursales.filter(s => s.estado === 'Activa').length;
  const pendientes = sucursales.filter(s => s.estado === 'Pendiente').length;
  const suspendidas = sucursales.filter(s => s.estado === 'Suspendida').length;
  document.getElementById('sucStats').innerHTML = `
    <div class="stat-card"><div class="num">${sucursales.length}</div><div class="lbl">Sucursales totales</div></div>
    <div class="stat-card"><div class="num">${activas}</div><div class="lbl">Activas</div></div>
    <div class="stat-card"><div class="num">${pendientes}</div><div class="lbl">Pendientes de aprobación</div></div>
    <div class="stat-card"><div class="num">${suspendidas}</div><div class="lbl">Suspendidas</div></div>
  `;
}

function accionPara(estado){
  if(estado === 'Pendiente') return {label:'Aprobar', next:'Activa'};
  if(estado === 'Activa') return {label:'Suspender', next:'Suspendida'};
  return {label:'Reactivar', next:'Activa'};
}

function renderTabla(){
  const filtro = document.getElementById('sucFiltro').value;
  const lista = sucursales.filter(s => !filtro || s.estado === filtro);

  document.getElementById('sucBody').innerHTML = lista.map(s => {
    const badge = s.estado === 'Activa' ? 'ok' : (s.estado === 'Pendiente' ? 'low' : 'low');
    const accion = accionPara(s.estado);
    return `<tr>
      <td>${s.nombre}</td><td>${s.dueño}</td><td>${s.correo}</td><td>${s.telefono}</td>
      <td>${s.plan}</td>
      <td><span class="badge ${badge}">${s.estado}</span></td>
      <td>${s.fechaAlta}</td>
      <td><button class="btn secondary" data-id="${s.id}">${accion.label}</button></td>
    </tr>`;
  }).join('');

  document.querySelectorAll('#sucBody button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = sucursales.find(x => x.id === btn.dataset.id);
      const accion = accionPara(s.estado);
      s.estado = accion.next;
      toast(`${s.nombre} ahora está "${s.estado}".`);
      renderStats();
      renderTabla();
    });
  });
}

function initPage(){
  renderStats();
  renderTabla();
  document.getElementById('sucFiltro').addEventListener('change', renderTabla);
}
