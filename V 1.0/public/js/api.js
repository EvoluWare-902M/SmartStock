/* ===== api.js : cliente de la API REST de SmartStock =====
   Todas las páginas usan api('/ruta', {method, body}) en lugar de datos
   simulados. El token JWT se guarda en sessionStorage al iniciar sesión.
*/
const API_BASE = '/api';

async function api(path, { method = 'GET', body } = {}){
  const headers = { 'Accept': 'application/json' };
  const s = typeof getSession === 'function' ? getSession() : null;
  if(s && s.token) headers['Authorization'] = 'Bearer ' + s.token;
  if(body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try{
    res = await fetch(API_BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  }catch{
    throw new Error('No hay conexión con el servidor de SmartStock.');
  }
  const data = await res.json().catch(() => ({}));
  if(res.status === 401 && s){
    clearSession();
    sessionStorage.setItem('smartstock_msg', data.error || 'Tu sesión terminó.');
    window.location.href = (location.pathname.includes('/pages/') ? '../' : '') + 'acceso.html';
    throw new Error(data.error || 'Sesión expirada');
  }
  if(!res.ok) throw new Error(data.error || 'Ocurrió un error inesperado.');
  return data;
}

// Descarga un archivo (PDF/Excel) que requiere el token de sesión.
async function descargar(path){
  const s = getSession();
  const res = await fetch(API_BASE + path, { headers: { 'Authorization': 'Bearer ' + s.token } });
  if(!res.ok){
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo generar el archivo.');
  }
  const blob = await res.blob();
  const nombre = (res.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1] || 'reporte';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Catálogos (categorías, presentaciones, ubicaciones...) con caché en memoria.
let __catalogos = null;
async function catalogos(){
  if(!__catalogos) __catalogos = await api('/catalogos');
  return __catalogos;
}
