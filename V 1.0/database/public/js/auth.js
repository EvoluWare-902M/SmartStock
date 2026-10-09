/* ===== auth.js : sesión y control de acceso por rol =====
   La sesión (token JWT + datos del usuario) vive en sessionStorage, o también en
   localStorage si el usuario marca "Mantener la sesión en este equipo".
   El servidor valida el token y el rol en cada petición; aquí solo se
   decide qué pantallas mostrar.

   Roles del sistema:
   - "superadmin" : equipo EvoluWare, administra la plataforma.
   - "dueno"      : dueño/gerente de una sucursal.
   - "empleado"   : personal operativo de una sucursal.
*/
const CLAVE_SESION = 'smartstock_session';
function getSession(){
  try{ return JSON.parse(sessionStorage.getItem(CLAVE_SESION) || localStorage.getItem(CLAVE_SESION)); }catch{ return null; }
}
// recordar = true guarda la sesión también al cerrar el navegador (hasta que expire el token).
function setSession(data, recordar){
  const enLocal = recordar === undefined ? !!localStorage.getItem(CLAVE_SESION) : recordar;
  sessionStorage.setItem(CLAVE_SESION, JSON.stringify(data));
  if(enLocal) localStorage.setItem(CLAVE_SESION, JSON.stringify(data)); else localStorage.removeItem(CLAVE_SESION);
}
function clearSession(){ sessionStorage.removeItem(CLAVE_SESION); localStorage.removeItem(CLAVE_SESION); }

function homeFor(role){
  return role === 'superadmin' ? 'plataforma.html' : 'inicio.html';
}

// Se ejecuta en cada página interna (dentro de /pages).
function requireSession(allowedRoles){
  const session = getSession();
  if(!session || !session.token){
    window.location.href = '../acceso.html';
    return null;
  }
  // Primer acceso con contraseña temporal: obligar a cambiarla
  if(session.debeCambiarPassword && document.body.dataset.page !== 'cuenta'){
    window.location.href = 'cuenta.html';
    return null;
  }
  if(allowedRoles && !allowedRoles.includes(session.role)){
    window.location.href = homeFor(session.role);
    return null;
  }
  return session;
}

function logout(){
  clearSession();
  window.location.href = '../acceso.html';
}
