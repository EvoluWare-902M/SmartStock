/* ===== cuenta.js : datos de la sesión y cambio de contraseña ===== */
function initPage(session){
  if(session.debeCambiarPassword){
    document.getElementById('avisoTemporal').innerHTML =
      `<div class="alert-box warn">🔑 <div><b>Tienes una contraseña temporal.</b> Cámbiala para continuar usando SmartStock.</div></div>`;
  }
  document.getElementById('datosCuenta').innerHTML = `
    <div class="form-grid">
      <div><label>Nombre</label><b>${esc(session.nombre)}</b></div>
      <div><label>Correo</label><b>${esc(session.email)}</b></div>
      <div><label>Rol</label><b>${ROLE_LABEL[session.role]}</b></div>
      <div><label>Sucursal</label><b>${esc(session.sucursalNombre || 'Plataforma SmartStock')}</b></div>
    </div>`;

  const btn = document.getElementById('cuGuardar');
  btn.addEventListener('click', () => conBoton(btn, async () => {
    const actual = document.getElementById('cuActual').value;
    const nueva = document.getElementById('cuNueva').value;
    const confirma = document.getElementById('cuConfirma').value;
    if(!actual || !nueva) return toast('Escribe tu contraseña actual y la nueva.', true);
    if(nueva !== confirma) return toast('La confirmación no coincide con la nueva contraseña.', true);
    await api('/auth/password', { method: 'PUT', body: { actual, nueva } });
    limpiar(['cuActual','cuNueva','cuConfirma']);
    const eraTemporal = session.debeCambiarPassword;
    session.debeCambiarPassword = false; setSession(session);
    toast('Contraseña actualizada.');
    if(eraTemporal) setTimeout(() => location.href = homeFor(session.role), 900);
  }));
}
