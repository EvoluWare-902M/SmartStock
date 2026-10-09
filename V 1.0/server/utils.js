/* ===== utils.js : helpers del servidor ===== */

// Fecha local (America/Mexico_City según el equipo) en formato YYYY-MM-DD.
function hoyISO(d = new Date()){
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
function ahoraSQL(d = new Date()){
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 19).replace('T', ' ');
}
function diasEntre(desdeISO, hastaISO){
  return Math.round((new Date(hastaISO + 'T00:00:00') - new Date(desdeISO + 'T00:00:00')) / 86400000);
}

class HttpError extends Error{
  constructor(status, message){ super(message); this.status = status; }
}

// Envuelve handlers async para enviar los errores al middleware central.
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requerido(obj, campos){
  const faltan = campos.filter(c => obj[c] === undefined || obj[c] === null || String(obj[c]).trim() === '');
  if(faltan.length) throw new HttpError(400, 'Faltan campos obligatorios: ' + faltan.join(', '));
}

function entero(v, nombre, { min = 0 } = {}){
  const n = Number(v);
  if(!Number.isInteger(n) || n < min) throw new HttpError(400, `${nombre} debe ser un número entero mayor o igual a ${min}.`);
  return n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = { hoyISO, ahoraSQL, diasEntre, HttpError, ah, requerido, entero, EMAIL_RE };

// Registra una acción en la bitácora de auditoría. No interrumpe la operación si falla.
async function auditar(req, accion, detalle, sucursalId = null){
  try{
    const { query } = require('./db');
    const u = (req && req.user) || {};
    await query('INSERT INTO auditoria (usuario_id, usuario_nombre, accion, sucursal_id, detalle, fecha) VALUES (?,?,?,?,?,?)',
      [u.id || null, u.nombre || 'Sistema', accion, sucursalId, String(detalle).slice(0, 400), ahoraSQL()]);
  }catch(e){ console.error('No se pudo escribir en la bitácora:', e.message); }
}
module.exports.auditar = auditar;
