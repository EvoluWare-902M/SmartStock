/* ===== mi-sucursal.js : perfil del negocio para el dueño ===== */
function initPage(session){
  const suc = sucursalDeSesion(session);
  if(!suc) return;

  const estadoBadge = suc.estado === 'Activa' ? 'ok' : 'low';
  document.getElementById('estadoPanel').innerHTML =
    `Estado de la sucursal: <span class="badge ${estadoBadge}">${suc.estado}</span> · Alta: ${suc.fechaAlta}`;

  document.getElementById('msNombre').value = suc.nombre;
  document.getElementById('msDireccion').value = suc.direccion;
  document.getElementById('msTelefono').value = suc.telefono;
  document.getElementById('msCorreo').value = suc.correo;
  document.getElementById('msPlanTxt').textContent = `Plan ${suc.plan}.`;

  document.getElementById('msGuardar').addEventListener('click', () => {
    suc.nombre = document.getElementById('msNombre').value.trim() || suc.nombre;
    suc.direccion = document.getElementById('msDireccion').value.trim() || suc.direccion;
    suc.telefono = document.getElementById('msTelefono').value.trim() || suc.telefono;
    toast('Datos de la sucursal actualizados.');
    renderNav(session);
  });

  document.getElementById('msCambiarPlan').addEventListener('click', () => {
    toast('Solicitud de cambio de plan enviada al equipo SmartStock.');
  });
}
