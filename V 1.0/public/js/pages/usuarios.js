/* ===== usuarios.js : gestión del personal de la sucursal (HU-14) ===== */
let lista = [];

async function cargar(session){
  const r = await api('/usuarios');
  lista = r.usuarios;
  const activos = lista.filter(u => u.rol === 'empleado' && u.estado === 'Activo').length;
  document.getElementById('usLimite').textContent = `Plan ${r.plan}: ${activos} de ${r.limite} empleados activos.`;

  document.getElementById('usBody').innerHTML = lista.map(u => {
    const soyYo = u.correo === session.email;
    return `<tr>
      <td>${esc(u.nombre)}${soyYo ? ' <span class="hint" style="display:inline">(tú)</span>' : ''}</td>
      <td>${esc(u.correo)}</td><td>${esc(u.telefono || '—')}</td>
      <td><span class="badge ok">${u.rol === 'dueno' ? 'Gerente' : 'Empleado'}</span></td>
      <td><span class="badge ${u.estado === 'Activo' ? 'ok' : 'low'}">${u.estado}</span>${u.debe_cambiar_password ? '<div class="hint">Contraseña temporal</div>' : ''}</td>
      <td>${soyYo ? '—' : `<div class="row-actions">
        <button class="btn secondary sm" data-a="estado" data-id="${u.id}">${u.estado === 'Activo' ? 'Desactivar' : 'Activar'}</button>
        <button class="btn secondary sm" data-a="pass" data-id="${u.id}">Restablecer contraseña</button>
        <button class="btn danger sm" data-a="del" data-id="${u.id}">Eliminar</button></div>`}</td>
    </tr>`;
  }).join('');
}

async function initPage(session){
  await cargar(session);

  const btn = document.getElementById('usGuardar');
  btn.addEventListener('click', () => conBoton(btn, async () => {
    const body = {
      nombre: document.getElementById('usNombre').value.trim(),
      correo: document.getElementById('usCorreo').value.trim().toLowerCase(),
      telefono: document.getElementById('usTelefono').value.trim(),
      password: document.getElementById('usPass').value,
      rol: document.getElementById('usRol').value,
    };
    if(!body.nombre || !body.correo || !body.password) return toast('Nombre, correo y contraseña temporal son obligatorios.', true);
    await api('/usuarios', { method: 'POST', body });
    toast(`${body.nombre} ya puede iniciar sesión con su correo; se le pedirá cambiar la contraseña.`);
    limpiar(['usNombre','usCorreo','usTelefono','usPass']);
    await cargar(session);
  }));

  document.getElementById('usBody').addEventListener('click', async (e) => {
    const { a, id } = e.target.dataset;
    if(!a) return;
    const u = lista.find(x => x.id === Number(id));
    try{
      if(a === 'estado'){
        await api('/usuarios/' + u.id, { method: 'PUT', body: { estado: u.estado === 'Activo' ? 'Inactivo' : 'Activo' } });
        toast(`${u.nombre} ahora está ${u.estado === 'Activo' ? 'inactivo: ya no puede iniciar sesión' : 'activo'}.`);
      }
      if(a === 'pass'){
        const v = await modal({ titulo: 'Restablecer contraseña', texto: `Nueva contraseña temporal para <b>${esc(u.nombre)}</b>. Se le pedirá cambiarla al entrar.`,
          campos: [{ id: 'p', label: 'Contraseña temporal (mín. 6 caracteres)', type: 'password' }], aceptar: 'Restablecer' });
        if(!v) return;
        await api(`/usuarios/${u.id}/password`, { method: 'PUT', body: { password: v.p } });
        toast('Contraseña restablecida.');
      }
      if(a === 'del'){
        const ok = await modal({ titulo: 'Eliminar usuario', peligro: true, aceptar: 'Eliminar',
          texto: `¿Eliminar la cuenta de <b>${esc(u.nombre)}</b>? Sus movimientos registrados se conservan en el historial.` });
        if(!ok) return;
        await api('/usuarios/' + u.id, { method: 'DELETE' });
        toast('Usuario eliminado.');
      }
      await cargar(session);
    }catch(err){ toast(err.message, true); }
  });
}
