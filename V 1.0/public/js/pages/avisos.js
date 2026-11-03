/* ===== avisos.js : avisos del equipo SmartStock a las sucursales ===== */
let avisos = [], editando = null;
const CAMPOS = ['avTitulo', 'avMensaje', 'avVence'];

function modoNuevo(){
  editando = null; limpiar(CAMPOS);
  document.getElementById('avTipo').value = 'Novedad'; document.getElementById('avPlan').value = '';
  document.getElementById('avTituloForm').textContent = 'Nuevo aviso';
  document.getElementById('avGuardar').textContent = 'Publicar aviso';
  document.getElementById('avCancelar').hidden = true;
}

async function cargar(){
  avisos = await api('/plataforma/avisos');
  const hoy = hoyISO();
  document.getElementById('avLista').innerHTML = avisos.map(a => {
    const vencido = a.vence_el && a.vence_el < hoy;
    return `<div class="reco-card">
      <div>
        <div><span class="badge ${a.tipo === 'Importante' ? 'low' : a.tipo === 'Mantenimiento' ? 'warn' : 'info'}">${a.tipo}</span>
          <b>${esc(a.titulo)}</b> ${!a.activo ? '<span class="badge muted">Retirado</span>' : vencido ? '<span class="badge muted">Vencido</span>' : '<span class="badge ok">Visible</span>'}</div>
        <div class="meta" style="color:var(--ink)">${esc(a.mensaje)}</div>
        <div class="meta">Para ${a.plan ? 'el plan ' + esc(a.plan) : 'todas las sucursales'} · publicado el ${fechaCorta(a.creado_en)} por ${esc(a.creado_por)}${a.vence_el ? ' · visible hasta ' + fechaCorta(a.vence_el) : ''}</div>
      </div>
      <div class="side"><div class="row-actions" style="justify-content:flex-end">
        <button class="btn secondary sm" data-id="${a.id}" data-a="editar">Editar</button>
        <button class="btn secondary sm" data-id="${a.id}" data-a="estado">${a.activo ? 'Retirar' : 'Reactivar'}</button>
        <button class="btn danger sm" data-id="${a.id}" data-a="eliminar">Eliminar</button></div></div>
    </div>`;
  }).join('') || `<div class="alert-box info">📣 <div>Aún no has publicado avisos.</div></div>`;
}

async function initPage(){
  const CAT = await catalogos();
  fillSelect(document.getElementById('avPlan'), CAT.planes.map(p => ({ value: p, label: 'Solo plan ' + p })), 'Todas las sucursales');
  document.getElementById('avVence').min = hoyISO();
  await cargar();

  const guardar = document.getElementById('avGuardar');
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    const body = { titulo: document.getElementById('avTitulo').value.trim(), mensaje: document.getElementById('avMensaje').value.trim(),
      tipo: document.getElementById('avTipo').value, plan: document.getElementById('avPlan').value, vence_el: document.getElementById('avVence').value };
    if(!body.titulo || !body.mensaje) return toast('Escribe el título y el mensaje del aviso.', true);
    await api('/plataforma/avisos' + (editando ? '/' + editando : ''), { method: editando ? 'PUT' : 'POST', body });
    toast(editando ? 'Aviso actualizado.' : 'Aviso publicado: las sucursales ya lo ven en su Inicio.');
    modoNuevo(); await cargar();
  }));
  document.getElementById('avCancelar').addEventListener('click', modoNuevo);

  document.getElementById('avLista').addEventListener('click', async e => {
    const { id, a } = e.target.dataset; if(!id) return;
    const av = avisos.find(x => x.id === Number(id));
    try{
      if(a === 'editar'){
        editando = av.id;
        document.getElementById('avTitulo').value = av.titulo; document.getElementById('avMensaje').value = av.mensaje;
        document.getElementById('avTipo').value = av.tipo; document.getElementById('avPlan').value = av.plan || ''; document.getElementById('avVence').value = av.vence_el || '';
        document.getElementById('avTituloForm').textContent = 'Editar aviso'; guardar.textContent = 'Guardar cambios'; document.getElementById('avCancelar').hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' }); return;
      }
      if(a === 'estado'){ await api('/plataforma/avisos/' + av.id, { method: 'PUT', body: { activo: !av.activo } }); toast(av.activo ? 'Aviso retirado.' : 'Aviso visible de nuevo.'); }
      if(a === 'eliminar'){
        if(!await modal({ titulo: 'Eliminar aviso', peligro: true, aceptar: 'Eliminar', texto: `¿Eliminar el aviso <b>${esc(av.titulo)}</b>?` })) return;
        await api('/plataforma/avisos/' + av.id, { method: 'DELETE' }); toast('Aviso eliminado.');
      }
      await cargar();
    }catch(err){ toast(err.message, true); }
  });
}
