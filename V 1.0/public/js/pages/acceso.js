/* ===== acceso.js : inicio de sesión y registro en una sola pantalla =====
   El botón central desliza el panel de color al otro lado, gira la flecha
   y deja a la vista el otro formulario:
     modo "login"    → panel a la izquierda, formulario de acceso a la derecha
     modo "registro" → panel a la derecha, formulario de registro a la izquierda
   Se puede llegar directo con acceso.html#login o acceso.html#registro
   (y acceso.html?plan=Profesional#registro preselecciona el plan).
*/
const acc = document.getElementById('acc');
const formLogin = document.getElementById('formLogin'), formRegistro = document.getElementById('formRegistro');

function modo(m, { foco = true } = {}){
  const reg = m === 'registro';
  acc.classList.toggle('modo-registro', reg);
  formLogin.inert = reg; formRegistro.inert = !reg;
  document.getElementById('accCambio').setAttribute('aria-label', reg ? 'Cambiar a iniciar sesión' : 'Cambiar a crear una cuenta');
  document.getElementById('accCambioTxt').textContent = reg ? 'Iniciar sesión' : 'Crear cuenta';
  document.title = 'SmartStock — ' + (reg ? 'Registro' : 'Iniciar sesión');
  if(location.hash !== '#' + m) history.replaceState(null, '', location.pathname + location.search + '#' + m);
  if(foco) setTimeout(() => document.getElementById(reg ? 'rsNombre' : 'loginEmail')?.focus({ preventScroll: true }), 450);
}
const modoActual = () => acc.classList.contains('modo-registro') ? 'registro' : 'login';

document.getElementById('accCambio').addEventListener('click', () => modo(modoActual() === 'login' ? 'registro' : 'login'));
document.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => modo(b.dataset.modo)));
window.addEventListener('hashchange', () => modo(location.hash === '#registro' ? 'registro' : 'login'));

function error(id, msg){
  const el = document.getElementById(id);
  el.textContent = msg || ''; el.style.display = msg ? 'block' : 'none';
}

/* ---------- inicio de sesión ---------- */
(function(){
  const s = getSession();
  if(s && s.token){ window.location.href = 'pages/' + homeFor(s.role); return; }
  const msg = sessionStorage.getItem('smartstock_msg');
  if(msg){ error('loginError', msg); sessionStorage.removeItem('smartstock_msg'); }
})();

async function iniciarSesion(){
  const btn = document.getElementById('loginBtn');
  const correo = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPass').value;
  error('loginError');
  if(!correo || !password) return error('loginError', 'Ingresa correo y contraseña para continuar.');

  btn.disabled = true; btn.textContent = 'Verificando…';
  try{
    const { token, usuario } = await api('/auth/login', { method: 'POST', body: { correo, password } });
    setSession({
      token, role: usuario.rol, nombre: usuario.nombre, email: usuario.correo,
      sucursalId: usuario.sucursalId, sucursalNombre: usuario.sucursalNombre,
      debeCambiarPassword: usuario.debeCambiarPassword,
    }, document.getElementById('loginRecordar').checked);
    window.location.href = 'pages/' + (usuario.debeCambiarPassword ? 'cuenta.html' : homeFor(usuario.rol));
  }catch(e){
    error('loginError', e.message);
    btn.disabled = false; btn.textContent = 'Iniciar sesión';
  }
}
document.getElementById('loginBtn').addEventListener('click', iniciarSesion);
['loginEmail', 'loginPass'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if(e.key === 'Enter') iniciarSesion(); }));
document.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => {
  const [c, p] = b.dataset.demo.split('|');
  document.getElementById('loginEmail').value = c; document.getElementById('loginPass').value = p;
  document.getElementById('loginBtn').focus();
}));

/* ---------- registro: datos básicos y continuar al asistente ---------- */
// Aquí solo se piden tres datos; el resto se captura por pasos en alta.html.
// Lo capturado viaja en sessionStorage (nunca la contraseña).
const CLAVE_ALTA = 'smartstock_alta';
(function(){
  let previo = {};
  try{ previo = JSON.parse(sessionStorage.getItem(CLAVE_ALTA)) || {}; }catch{}
  if(previo.nombre) document.getElementById('rsNombre').value = previo.nombre;
  if(previo.nombres) document.getElementById('rsDueno').value = previo.nombres;
  if(previo.correo) document.getElementById('rsCorreo').value = previo.correo;
})();

async function continuarRegistro(){
  const btn = document.getElementById('rsGuardar');
  error('rsError');
  const v = id => document.getElementById(id).value.trim();
  const nombre = v('rsNombre'), nombres = v('rsDueno'), correo = v('rsCorreo').toLowerCase();
  if(!nombre || !nombres || !correo) return error('rsError', 'Completa los tres campos para continuar.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return error('rsError', 'Escribe un correo válido, por ejemplo nombre@negocio.mx');

  btn.disabled = true; btn.textContent = 'Verificando…';
  try{
    const r = await api('/auth/correo-disponible?correo=' + encodeURIComponent(correo));
    if(!r.disponible){ error('rsError', 'Ya existe una cuenta con ese correo. Inicia sesión o usa otro.'); return; }
    let previo = {};
    try{ previo = JSON.parse(sessionStorage.getItem(CLAVE_ALTA)) || {}; }catch{}
    const plan = new URLSearchParams(location.search).get('plan');
    sessionStorage.setItem(CLAVE_ALTA, JSON.stringify({ ...previo, nombre, nombres, correo, ...(plan ? { plan } : {}) }));
    window.location.href = 'alta.html';
  }catch(e){ error('rsError', e.message); }
  finally{ btn.disabled = false; btn.textContent = 'Continuar →'; }
}
document.getElementById('rsGuardar').addEventListener('click', continuarRegistro);
['rsNombre', 'rsDueno', 'rsCorreo'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if(e.key === 'Enter') continuarRegistro(); }));

modo(location.hash === '#registro' ? 'registro' : 'login', { foco: false });
requestAnimationFrame(() => acc.classList.add('lista'));      // activa las animaciones tras el primer pintado
