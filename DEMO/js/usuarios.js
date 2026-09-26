/* ===== usuarios.js : alta de empleados, acotada a la sucursal del dueño ===== */
function renderUsuarios(session){
  const propios = usuarios.filter(u => u.sucursalId === session.sucursalId);
  document.getElementById('usBody').innerHTML = propios.map(u => `
    <tr>
      <td>${u.nombre}</td><td>${u.correo}</td><td>${u.telefono || '—'}</td>
      <td><span class="badge ok">${u.rol}</span></td>
      <td><span class="badge ${u.estado === 'Activo' ? 'ok' : 'low'}">${u.estado}</span></td>
    </tr>`).join('') || `<tr><td colspan="5" style="color:var(--muted)">Aún no has dado de alta empleados.</td></tr>`;
}

function initPage(session){
  renderUsuarios(session);

  document.getElementById('usGuardar').addEventListener('click', () => {
    const nombre = document.getElementById('usNombre').value.trim();
    const correo = document.getElementById('usCorreo').value.trim().toLowerCase();
    const telefono = document.getElementById('usTelefono').value.trim();
    const pass = document.getElementById('usPass').value.trim();

    if(!nombre || !correo || !pass){
      toast('Nombre, correo y contraseña temporal son obligatorios.', true);
      return;
    }
    if(cuentas.some(c => c.correo.toLowerCase() === correo)){
      toast('Ya existe una cuenta con ese correo.', true);
      return;
    }

    usuarios.push({nombre, correo, telefono, rol:'Empleado', sucursalId: session.sucursalId, estado:'Activo'});
    cuentas.push({correo, password: pass, rol:'empleado', nombre, sucursalId: session.sucursalId});

    renderUsuarios(session);
    toast(`Empleado ${nombre} creado. Ya puede iniciar sesión con su correo.`);

    ['usNombre','usCorreo','usTelefono','usPass'].forEach(id => document.getElementById(id).value = '');
  });
}
