function getSession(){
  const raw = sessionStorage.getItem('smartstock_session');
  return raw ? JSON.parse(raw) : null;
}

function setSession(data){
  sessionStorage.setItem('smartstock_session', JSON.stringify(data));
}

function clearSession(){
  sessionStorage.removeItem('smartstock_session');
}

function homeFor(role){
  return role === 'superadmin' ? 'sucursales.html' : 'buscar.html';
}

function requireSession(allowedRoles){
  const session = getSession();
  if(!session){
    window.location.href = '../login.html';
    return null;
  }
  if(allowedRoles && !allowedRoles.includes(session.role)){
    window.location.href = homeFor(session.role);
    return null;
  }
  return session;
}

function sucursalDeSesion(session){
  return sucursales.find(s => s.id === session.sucursalId) || null;
}

function logout(){
  clearSession();
  window.location.href = '../login.html';
}