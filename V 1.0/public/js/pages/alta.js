/* ===== alta.js : asistente de registro de farmacia, por pasos =====
   Cada paso cabe en una pantalla (sin desplazarse). "Siguiente" valida solo
   los campos de ese paso; la línea superior muestra el avance.
   Lo capturado se guarda en sessionStorage para no perderlo si se recarga
   la página. Las contraseñas nunca se guardan ahí.
*/
const CLAVE_ALTA = 'smartstock_alta';
const soloDigitos = v => v.replace(/\D/g, '');

/* ---------- validaciones reutilizables ---------- */
const V = {
  tel:    v => soloDigitos(v).length === 10 || 'Escribe los 10 dígitos, sin lada internacional.',
  cp:     v => /^\d{5}$/.test(v) || 'El código postal tiene 5 dígitos.',
  rfc:    v => !v || /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(v) || 'El RFC tiene 12 caracteres (empresa) o 13 (persona).',
  cedula: v => !v || /^\d{7,8}$/.test(v) || 'La cédula profesional tiene 7 u 8 dígitos.',
  correo: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Escribe un correo válido, por ejemplo nombre@negocio.mx',
  pass:   v => v.length >= 8 || 'Usa al menos 8 caracteres.',
  igual:  (v, d) => v === d.password || 'Las contraseñas no coinciden.',
};

const ICO = {
  tienda:  'M4 10v10h16V10M3 10l2-6h14l2 6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M10 20v-5h4v5',
  mapa:    'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  persona: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  llave:   'M15 8a4 4 0 1 1-3.9 5H8v3H5v3H2v-3l7.1-7.1A4 4 0 0 1 15 8zM16 8h.01',
  estrella:'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
};
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

/* ---------- definición de los pasos ----------
   ancho: columnas que ocupa el campo en una rejilla de 6.                     */
let CAT = { tiposNegocio: [], cargos: [], estados: [] };
const PASOS = () => [
  { id: 'negocio', corto: 'Negocio', icono: 'tienda', titulo: 'Cuéntanos de tu farmacia',
    texto: 'Estos datos identifican tu negocio dentro de SmartStock y aparecen en tus reportes.',
    tip: 'El RFC y la razón social son opcionales: puedes agregarlos después si vas a facturar.',
    campos: [
      { id: 'nombre', label: 'Nombre comercial', req: true, ancho: 6, ph: 'Ej. Farmacia La Esperanza', max: 120, auto: 'organization' },
      { id: 'tipo', label: 'Tipo de establecimiento', req: true, ancho: 3, opciones: CAT.tiposNegocio },
      { id: 'telefono', label: 'Teléfono del negocio', req: true, ancho: 3, ph: '10 dígitos', tipo: 'tel', modo: 'numeric', max: 10, val: V.tel, auto: 'tel-national' },
      { id: 'razon_social', label: 'Razón social', ancho: 3, ph: 'Como aparece ante el SAT', max: 160 },
      { id: 'rfc', label: 'RFC', ancho: 3, ph: 'Ej. FES200115AB1', max: 13, val: V.rfc, mayus: true },
      { id: 'licencia_sanitaria', label: 'Aviso de funcionamiento o licencia sanitaria', ancho: 6, ph: 'Número de aviso ante COFEPRIS (opcional)', max: 40 },
    ] },
  { id: 'domicilio', corto: 'Domicilio', icono: 'mapa', titulo: '¿Dónde está tu farmacia?',
    texto: 'El domicilio del establecimiento, tal como lo usarías en una factura o un envío.',
    tip: 'Si tu local está dentro de una plaza o mercado, anótalo en "Número interior" o en las referencias.',
    campos: [
      { id: 'calle', label: 'Calle', req: true, ancho: 3, ph: 'Ej. Av. Central', max: 120, auto: 'address-line1' },
      { id: 'num_exterior', label: 'Núm. exterior', req: true, ancho: 1.5, ph: 'Ej. 45', max: 15 },
      { id: 'num_interior', label: 'Núm. interior', ancho: 1.5, ph: 'Local, depto.', max: 15 },
      { id: 'colonia', label: 'Colonia', req: true, ancho: 4, ph: 'Ej. Centro', max: 100 },
      { id: 'codigo_postal', label: 'Código postal', req: true, ancho: 2, ph: '5 dígitos', modo: 'numeric', max: 5, val: V.cp, auto: 'postal-code' },
      { id: 'municipio', label: 'Municipio o alcaldía', req: true, ancho: 3, ph: 'Ej. Nezahualcóyotl', max: 100, auto: 'address-level2' },
      { id: 'entidad', label: 'Estado', req: true, ancho: 3, opciones: CAT.estados, auto: 'address-level1' },
      { id: 'referencias', label: 'Referencias', ancho: 6, ph: 'Entre qué calles, frente a qué lugar… (opcional)', max: 200 },
    ] },
  { id: 'responsable', corto: 'Responsable', icono: 'persona', titulo: '¿Quién administra la cuenta?',
    texto: 'La persona responsable será el gerente de la sucursal en SmartStock y podrá dar de alta a sus empleados.',
    tip: 'La cédula profesional solo aplica si eres el responsable sanitario de la farmacia.',
    campos: [
      { id: 'nombres', label: 'Nombre(s)', req: true, ancho: 6, ph: 'Ej. María Fernanda', max: 60, auto: 'given-name' },
      { id: 'apellido_paterno', label: 'Apellido paterno', req: true, ancho: 3, max: 40, auto: 'family-name' },
      { id: 'apellido_materno', label: 'Apellido materno', ancho: 3, max: 40 },
      { id: 'cargo', label: 'Cargo', req: true, ancho: 3, opciones: CAT.cargos },
      { id: 'celular', label: 'Celular', req: true, ancho: 3, ph: '10 dígitos', tipo: 'tel', modo: 'numeric', max: 10, val: V.tel, auto: 'tel-national' },
      { id: 'cedula', label: 'Cédula profesional', ancho: 6, ph: '7 u 8 dígitos (opcional)', modo: 'numeric', max: 8, val: V.cedula },
    ] },
  { id: 'cuenta', corto: 'Cuenta', icono: 'llave', titulo: 'Crea tu acceso',
    texto: 'Con este correo y contraseña entrarás a SmartStock. El correo no se puede repetir entre cuentas.',
    tip: 'Una frase de tres palabras que recuerdes suele ser más segura y fácil que una clave corta con símbolos.',
    campos: [
      { id: 'correo', label: 'Correo', req: true, ancho: 6, tipo: 'email', ph: 'nombre@negocio.mx', max: 120, val: V.correo, auto: 'email' },
      { id: 'password', label: 'Contraseña', req: true, ancho: 3, tipo: 'password', ph: 'Mínimo 8 caracteres', val: V.pass, auto: 'new-password', noGuardar: true, medidor: true },
      { id: 'password2', label: 'Confirmar contraseña', req: true, ancho: 3, tipo: 'password', ph: 'Escríbela otra vez', val: V.igual, auto: 'new-password', noGuardar: true },
    ] },
  { id: 'plan', corto: 'Plan', icono: 'estrella', titulo: 'Elige tu plan',
    texto: 'Puedes empezar gratis y cambiar de plan cuando quieras desde "Mi sucursal".',
    tip: 'El plan Gratuito se activa al instante. Los planes de pago los revisa primero el equipo SmartStock.',
    campos: [] },
];

/* ---------- estado ---------- */
let datos = {};
try{ datos = JSON.parse(sessionStorage.getItem(CLAVE_ALTA)) || {}; }catch{}
const secretos = {};                       // contraseñas: solo en memoria
let pasos = [], actual = 0, enviando = false;
const $ = id => document.getElementById(id);
const guardar = () => sessionStorage.setItem(CLAVE_ALTA, JSON.stringify(datos));
const valorDe = c => (c.noGuardar ? secretos[c.id] : datos[c.id]) || '';

/* ---------- pintado ---------- */
function pintarProgreso(){
  $('progresoPasos').innerHTML = pasos.map((p, i) => `
    <li class="${i < actual ? 'hecho' : i === actual ? 'actual' : ''}">
      <button type="button" data-paso="${i}" ${i < actual ? '' : 'disabled'} aria-label="Paso ${i + 1}: ${p.corto}${i < actual ? ' (completado)' : ''}">${i < actual ? '✓' : i + 1}</button>
      <span>${p.corto}</span>
    </li>`).join('');
  $('progresoRelleno').style.width = (actual / (pasos.length - 1) * 100) + '%';
  $('progreso').setAttribute('aria-valuenow', actual + 1);
  $('progresoTxt').textContent = `Paso ${actual + 1} de ${pasos.length}`;
}

function campoHTML(c){
  const v = esc(valorDe(c));
  const comun = `id="f_${c.id}" name="${c.id}" ${c.req ? 'required aria-required="true"' : ''} aria-describedby="e_${c.id}"`;
  const control = c.opciones
    ? `<select ${comun} ${c.auto ? `autocomplete="${c.auto}"` : ''}><option value="">Selecciona…</option>${c.opciones.map(o => `<option${o === valorDe(c) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`
    : `<input ${comun} type="${c.tipo || 'text'}" value="${v}" placeholder="${esc(c.ph || '')}" ${c.max ? `maxlength="${c.max}"` : ''} ${c.modo ? `inputmode="${c.modo}"` : ''} ${c.auto ? `autocomplete="${c.auto}"` : ''}>`;
  return `<div class="campo" style="--ancho:${c.ancho}" data-campo="${c.id}">
    <label for="f_${c.id}">${c.label}${c.req ? ' <b>*</b>' : ' <i>opcional</i>'}</label>
    ${c.tipo === 'password' ? `<div class="con-ojo">${control}<button type="button" class="ojo" data-ojo="f_${c.id}" aria-label="Mostrar contraseña">Ver</button></div>` : control}
    ${c.medidor ? '<div class="medidor" id="medidor"><i></i><i></i><i></i><i></i><span></span></div>' : ''}
    <p class="campo-error" id="e_${c.id}"></p>
  </div>`;
}

function planHTML(){
  const elegido = PLANES_INFO.some(p => p.nombre === datos.plan) ? datos.plan : 'Gratuito';
  datos.plan = elegido;
  const dom = [datos.calle, datos.num_exterior].filter(Boolean).join(' ');
  return `
    <div class="planes-opciones" role="radiogroup" aria-label="Plan">
      ${PLANES_INFO.map(p => `
        <label class="plan-op${p.nombre === elegido ? ' sel' : ''}">
          <input type="radio" name="plan" value="${p.nombre}" ${p.nombre === elegido ? 'checked' : ''}>
          ${p.aviso ? `<em>${p.aviso}</em>` : ''}
          <b>${p.nombre}</b>
          <strong>${precioPlan(p)}${p.precio ? '<small> MXN/mes</small>' : ''}</strong>
          <ul>${p.incluye.slice(0, 3).map(i => `<li>${i}</li>`).join('')}</ul>
        </label>`).join('')}
    </div>
    <div class="resumen">
      <div><span>Negocio</span><b>${esc(datos.nombre || '—')}</b></div>
      <div><span>Domicilio</span><b>${esc(dom)}, ${esc(datos.municipio || '')}</b></div>
      <div><span>Responsable</span><b>${esc([datos.nombres, datos.apellido_paterno].filter(Boolean).join(' '))}</b></div>
      <div><span>Correo</span><b>${esc(datos.correo || '')}</b></div>
    </div>
    <label class="terminos"><input type="checkbox" id="f_terminos" ${datos.acepta ? 'checked' : ''}>
      <span>Confirmo que los datos son correctos y acepto los términos de uso y el aviso de privacidad de SmartStock.</span></label>
    <p class="campo-error" id="e_terminos"></p>`;
}

function pintarPaso(direccion = 1){
  const p = pasos[actual];
  pintarProgreso();
  $('lado').innerHTML = `
    <span class="lado-deco a"></span><span class="lado-deco b"></span><span class="lado-deco c"></span>
    <div class="lado-ico">${svg(ICO[p.icono])}</div>
    <p class="lado-paso">Paso ${actual + 1}</p>
    <h1>${p.titulo}</h1>
    <p class="lado-txt">${p.texto}</p>
    <p class="lado-tip"><b>Dato útil</b>${p.tip}</p>`;
  const campos = $('campos');
  campos.className = 'alta-campos ' + (direccion > 0 ? 'entra-der' : 'entra-izq') + (p.id === 'plan' ? ' de-plan' : '');
  campos.innerHTML = p.id === 'plan' ? planHTML() : p.campos.map(campoHTML).join('');
  void campos.offsetWidth; campos.classList.add('listo');

  $('btnAtras').style.visibility = actual === 0 ? 'hidden' : 'visible';
  const ultimo = actual === pasos.length - 1;
  $('btnSiguiente').textContent = ultimo ? (datos.plan === 'Gratuito' ? 'Crear mi cuenta' : 'Enviar solicitud') : 'Siguiente →';
  $('notaPie').textContent = ultimo ? '' : 'Los campos con * son obligatorios';
  $('errorGeneral').textContent = '';
  setTimeout(() => campos.querySelector('input:not([type=radio]):not([type=checkbox]), select')?.focus({ preventScroll: true }), 60);
}

/* ---------- captura y validación ---------- */
function leerPaso(){
  const p = pasos[actual];
  p.campos.forEach(c => {
    let v = $('f_' + c.id).value.trim();
    if(c.mayus) v = v.toUpperCase();
    if(c.val === V.tel) v = soloDigitos(v);
    if(c.noGuardar) secretos[c.id] = $('f_' + c.id).value; else datos[c.id] = v;
  });
  if(p.id === 'plan'){
    datos.plan = document.querySelector('input[name=plan]:checked').value;
    datos.acepta = $('f_terminos').checked;
  }
  guardar();
}

function marcar(id, msg){
  const cont = document.querySelector(`[data-campo="${id}"]`), e = $('e_' + id);
  if(cont) cont.classList.toggle('mal', !!msg);
  if(e) e.textContent = msg || '';
}

function validarPaso(){
  const p = pasos[actual];
  let primero = null;
  const todo = { ...datos, ...secretos };
  p.campos.forEach(c => {
    const v = valorDe(c);
    let msg = '';
    if(c.req && !v) msg = 'Este dato es obligatorio.';
    else if(c.val){ const r = c.val(v, todo); if(r !== true) msg = r; }
    marcar(c.id, msg);
    if(msg && !primero) primero = c.id;
  });
  if(p.id === 'plan'){
    const ok = datos.acepta;
    $('e_terminos').textContent = ok ? '' : 'Marca la casilla para continuar.';
    if(!ok){ $('f_terminos').focus(); return false; }
  }
  if(primero){ $('f_' + primero).focus(); return false; }
  return true;
}

function fuerza(v){
  let n = 0;
  if(v.length >= 8) n++; if(v.length >= 12) n++;
  if(/[a-z]/.test(v) && /[A-Z]/.test(v)) n++;
  if(/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) n++;
  return v ? Math.max(1, n) : 0;
}

/* ---------- navegación ---------- */
async function siguiente(){
  if(enviando) return;
  leerPaso();
  if(!validarPaso()) return;
  const p = pasos[actual];

  if(p.id === 'cuenta'){                              // el correo no puede estar repetido
    const btn = $('btnSiguiente'); btn.disabled = true;
    try{
      const r = await api('/auth/correo-disponible?correo=' + encodeURIComponent(datos.correo));
      if(!r.disponible){ marcar('correo', 'Ya existe una cuenta con ese correo.'); $('f_correo').focus(); return; }
    }catch(e){ $('errorGeneral').textContent = e.message; return; }
    finally{ btn.disabled = false; }
  }

  if(actual < pasos.length - 1){ actual++; pintarPaso(1); return; }
  enviar();
}

async function enviar(){
  const btn = $('btnSiguiente');
  enviando = true; btn.disabled = true; btn.textContent = 'Enviando…';
  try{
    const r = await api('/auth/registro-sucursal', { method: 'POST',
      body: { ...datos, password: secretos.password, acepta_terminos: datos.acepta } });
    sessionStorage.removeItem(CLAVE_ALTA);
    mostrarFin(r);
  }catch(e){
    $('errorGeneral').textContent = e.message;
    btn.textContent = datos.plan === 'Gratuito' ? 'Crear mi cuenta' : 'Enviar solicitud';
  }finally{ enviando = false; btn.disabled = false; }
}

function mostrarFin(r){
  $('cuerpo').hidden = true;
  document.querySelector('.alta-volver').hidden = true;
  $('progresoRelleno').style.width = '100%';
  $('progresoPasos').querySelectorAll('li').forEach(li => { li.className = 'hecho'; li.querySelector('button').textContent = '✓'; li.querySelector('button').disabled = true; });
  $('progresoTxt').textContent = 'Completado';
  const fin = $('fin'); fin.hidden = false;
  if(r.activa){
    setSession({ token: r.token, role: r.usuario.rol, nombre: r.usuario.nombre, email: r.usuario.correo,
      sucursalId: r.usuario.sucursalId, sucursalNombre: r.usuario.sucursalNombre, debeCambiarPassword: false });
    fin.innerHTML = `<div class="fin-ico ok">✓</div>
      <h1>¡Tu farmacia ya está activa!</h1>
      <p><b>${esc(datos.nombre)}</b> quedó registrada con el plan Gratuito. Ya puedes entrar y dar de alta tus primeros medicamentos.</p>
      <a class="alta-btn" href="pages/inicio.html">Entrar a SmartStock →</a>`;
  }else{
    fin.innerHTML = `<div class="fin-ico">⏳</div>
      <h1>Solicitud enviada</h1>
      <p>Recibimos los datos de <b>${esc(datos.nombre)}</b> con el plan <b>${esc(datos.plan)}</b>. En cuanto el equipo SmartStock apruebe tu sucursal podrás iniciar sesión con <b>${esc(datos.correo)}</b>.</p>
      <a class="alta-btn" href="acceso.html#login">Ir a iniciar sesión</a>`;
  }
  fin.querySelector('a').focus();
}

/* ---------- eventos ---------- */
$('form').addEventListener('submit', e => { e.preventDefault(); siguiente(); });
$('btnAtras').addEventListener('click', () => { leerPaso(); if(actual > 0){ actual--; pintarPaso(-1); } });
$('progresoPasos').addEventListener('click', e => {
  const b = e.target.closest('button[data-paso]');
  if(b && !b.disabled){ leerPaso(); actual = Number(b.dataset.paso); pintarPaso(-1); }
});
$('campos').addEventListener('input', e => {
  const cont = e.target.closest('[data-campo]');
  if(cont && cont.classList.contains('mal')) marcar(cont.dataset.campo, '');
  if(e.target.inputMode === 'numeric') e.target.value = soloDigitos(e.target.value);
  if(e.target.id === 'f_password'){
    const n = fuerza(e.target.value), m = $('medidor');
    m.dataset.n = n; m.querySelector('span').textContent = ['', 'Débil', 'Aceptable', 'Buena', 'Fuerte'][n];
  }
});
$('campos').addEventListener('change', e => {
  if(e.target.name === 'plan'){
    document.querySelectorAll('.plan-op').forEach(l => l.classList.toggle('sel', l.contains(e.target)));
    $('btnSiguiente').textContent = e.target.value === 'Gratuito' ? 'Crear mi cuenta' : 'Enviar solicitud';
  }
});
$('campos').addEventListener('click', e => {
  const ojo = e.target.closest('[data-ojo]');
  if(!ojo) return;
  const inp = $(ojo.dataset.ojo), ver = inp.type === 'password';
  inp.type = ver ? 'text' : 'password'; ojo.textContent = ver ? 'Ocultar' : 'Ver';
  ojo.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

/* ---------- inicio ---------- */
(async function(){
  const s = getSession();
  if(s && s.token){ window.location.href = 'pages/' + homeFor(s.role); return; }
  try{ CAT = await catalogos(); }
  catch{ $('errorGeneral').textContent = 'No hay conexión con el servidor de SmartStock.'; }
  pasos = PASOS();
  pintarPaso(1);
})();
