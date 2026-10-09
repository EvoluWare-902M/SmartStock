/* ===== mi-sucursal.js : perfil del negocio para el dueño ===== */
const DESCRIPCION_PLAN = {
  'Gratuito': '1 empleado y hasta 30 medicamentos. Localización, existencias y caducidades.',
  'Básico': 'Hasta 3 empleados y medicamentos ilimitados. Inventario completo y reportes.',
  'Profesional': 'Hasta 15 empleados. Incluye predicción de demanda, recomendación de compras y organización de repisas.',
  'Empresarial': 'Hasta 100 empleados, análisis predictivo y soporte prioritario.',
};

async function cargar(){
  const suc = await api('/mi-sucursal');
  document.getElementById('estadoPanel').innerHTML =
    `Estado de la sucursal: <span class="badge ${suc.estado === 'Activa' ? 'ok' : 'low'}">${suc.estado}</span> · Alta: ${fechaCorta(suc.fecha_alta)}`;
  document.getElementById('msNombre').value = suc.nombre;
  document.getElementById('msDireccion').value = suc.direccion;
  document.getElementById('msTelefono').value = suc.telefono;
  document.getElementById('msCorreo').value = suc.correo;
  document.getElementById('msPlanTxt').innerHTML = `<b>Plan ${esc(suc.plan)}.</b> ${DESCRIPCION_PLAN[suc.plan]}` +
    (suc.plan_solicitado ? `<br><span class="badge warn">Cambio a ${esc(suc.plan_solicitado)} en revisión por el equipo SmartStock</span>` : '');
  fillSelect(document.getElementById('msPlanNuevo'), Object.keys(DESCRIPCION_PLAN).filter(p => p !== suc.plan));
  return suc;
}

async function initPage(session){
  await cargar();

  const guardar = document.getElementById('msGuardar');
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    const body = { nombre: document.getElementById('msNombre').value, direccion: document.getElementById('msDireccion').value, telefono: document.getElementById('msTelefono').value };
    await api('/mi-sucursal', { method: 'PUT', body });
    const suc = await cargar();
    session.sucursalNombre = suc.nombre; setSession(session); renderNav(session);
    toast('Datos de la sucursal actualizados.');
  }));

  const plan = document.getElementById('msCambiarPlan');
  plan.addEventListener('click', () => conBoton(plan, async () => {
    await api('/mi-sucursal/plan', { method: 'POST', body: { plan: document.getElementById('msPlanNuevo').value } });
    await cargar();
    toast('Solicitud de cambio de plan enviada al equipo SmartStock.');
  }));
}
