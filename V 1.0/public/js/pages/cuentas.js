/* ===== cuentas.js : usuarios de toda la plataforma (superadministrador) ===== */
let usuarios = [], timer;

async function cargar(){
  const qs = new URLSearchParams();
  [['q', 'cuBuscar'], ['rol', 'cuRol'], ['estado', 'cuEstado']].forEach(([k, id]) => { const v = document.getElementById(id).value.trim(); if(v) qs.set(k, v); });
  usuarios = await api('/plataforma/usuarios?' + qs);
  const s = getSession();
  document.getElementById('cuBody').innerHTML = usuarios.map(u => `<tr>
    <td>${esc(u.nombre)}${u.correo === s.email ? ' <span class="hint" style="display:inline">(tú)</span>' : ''}</td><td>${esc(u.correo)}</td>
    <td><span class="badge ${u.rol === 'superadmin' ? 'info' : 'ok'}">${ROLE_LABEL[u.rol]}</span></td>
    <td>${u.sucursal ? `<a class="enlace" href="sucursal.html?id=${u.sucursal_id}">${esc(u.sucursal)}</a><div class="hint">${u.sucursal_estado}</div>` : '<span class="muted">Plataforma</span>'}</td>
    <td>${u.ultimo_acceso ? fechaHora(u.ultimo_acceso) : '<span class="muted">Nunca</span>'}</td>
    <td><span class="badge ${u.estado === 'Activo' ? 'ok' : 'low'}">${u.estado}</span>${u.debe_cambiar_password ? '<div class="hint">Contraseña temporal</div>' : ''}</td>
    <td>${u.correo === s.email ? '—' : `<div class="row-actions"><button class="btn secondary sm" data-id="${u.id}" data-a="pass">Restablecer contraseña</button>
      <button class="btn ${u.estado === 'Activo' ? 'danger' : 'secondary'} sm" data-id="${u.id}" data-a="estado">${u.estado === 'Activo' ? 'Desactivar' : 'Activar'}</button></div>`}</td></tr>`).join('')
    || `<tr><td colspan="7" class="empty">Sin usuarios con este filtro.</td></tr>`;
}

async function initPage(){
  await cargar();
  const recargar = () => { clearTimeout(timer); timer = setTimeout(() => cargar().catch(e => toast(e.message, true)), 250); };
  ['cuBuscar', 'cuRol', 'cuEstado'].forEach(id => document.getElementById(id).addEventListener('input', recargar));

  const crear = document.getElementById('cuCrear');
  crear.addEventListener('click', () => conBoton(crear, async () => {
    const body = { nombre: document.getElementById('cuNombre').value.trim(), correo: document.getElementById('cuCorreo').value.trim(), password: document.getElementById('cuPass').value };
    if(!body.nombre || !body.correo || !body.password) return toast('Nombre, correo y contraseña temporal son obligatorios.', true);
    await api('/plataforma/usuarios', { method: 'POST', body });
    limpiar(['cuNombre', 'cuCorreo', 'cuPass']); toast(`${body.nombre} ya puede entrar como superadministrador.`); await cargar();
  }));

  document.getElementById('cuBody').addEventListener('click', async e => {
    const { id, a } = e.target.dataset; if(!id) return;
    const u = usuarios.find(x => x.id === Number(id));
    try{
      if(a === 'pass'){
        const v = await modal({ titulo: 'Restablecer contraseña', texto: `Contraseña temporal para <b>${esc(u.nombre)}</b>. Se le pedirá cambiarla al entrar.`, campos: [{ id: 'p', label: 'Contraseña temporal (mín. 8 caracteres)', type: 'password' }], aceptar: 'Restablecer' });
        if(!v) return;
        await api(`/plataforma/usuarios/${u.id}/password`, { method: 'PUT', body: { password: v.p } }); toast('Contraseña restablecida.');
      }else{
        const estado = u.estado === 'Activo' ? 'Inactivo' : 'Activo';
        await api(`/plataforma/usuarios/${u.id}`, { method: 'PUT', body: { estado } }); toast(`${u.nombre} ahora está ${estado.toLowerCase()}.`);
      }
      await cargar();
    }catch(err){ toast(err.message, true); }
  });
}
