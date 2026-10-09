/* ===== auth.js : verificación de token JWT y permisos por rol ===== */
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { HttpError } = require('../utils');

const SECRET = () => process.env.JWT_SECRET || 'smartstock-dev-secret';

function firmarToken(usuario){
  return jwt.sign({ id: usuario.id }, SECRET(), { expiresIn: process.env.JWT_EXPIRES || '8h' });
}

// Valida el token en cada petición y vuelve a consultar al usuario,
// así una suspensión o baja surte efecto de inmediato.
async function autenticar(req, res, next){
  try{
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if(!token) throw new HttpError(401, 'Inicia sesión para continuar.');

    let payload;
    try{ payload = jwt.verify(token, SECRET()); }
    catch{ throw new HttpError(401, 'Tu sesión expiró. Vuelve a iniciar sesión.'); }

    const [u] = await query(`SELECT u.id, u.nombre, u.correo, u.rol, u.sucursal_id, u.estado, u.debe_cambiar_password,
                                    s.estado AS sucursal_estado, s.nombre AS sucursal_nombre
                             FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id
                             WHERE u.id = ?`, [payload.id]);
    if(!u || u.estado !== 'Activo') throw new HttpError(401, 'Tu cuenta no está activa.');
    if(u.rol !== 'superadmin' && u.sucursal_estado !== 'Activa')
      throw new HttpError(401, 'Tu sucursal no está activa. Contacta al administrador de SmartStock.');

    req.user = u;
    next();
  }catch(err){ next(err); }
}

// Restringe una ruta a ciertos roles: permitir('dueno','empleado')
function permitir(...roles){
  return (req, res, next) => {
    if(!req.user || !roles.includes(req.user.rol))
      return next(new HttpError(403, 'No tienes permiso para realizar esta acción.'));
    next();
  };
}

module.exports = { firmarToken, autenticar, permitir };
