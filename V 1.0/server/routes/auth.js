/* ===== /api/auth : inicio de sesión, registro de sucursal y contraseña ===== */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query, transaction } = require('../db');
const { firmarToken, autenticar } = require('../middleware/auth');
const { ah, HttpError, requerido, hoyISO, ahoraSQL, EMAIL_RE, auditar } = require('../utils');
const { PLANES, TIPOS_NEGOCIO, CARGOS, ESTADOS_MX } = require('../constants');

function perfil(u){
  return {
    id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol,
    sucursalId: u.sucursal_id, sucursalNombre: u.sucursal_nombre || null,
    debeCambiarPassword: !!u.debe_cambiar_password,
  };
}

// POST /api/auth/login
router.post('/login', ah(async (req, res) => {
  const correo = String(req.body.correo || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if(!correo || !password) throw new HttpError(400, 'Ingresa correo y contraseña para continuar.');

  const [u] = await query(`SELECT u.*, s.estado AS sucursal_estado, s.nombre AS sucursal_nombre, s.motivo_estado AS sucursal_motivo
                           FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id
                           WHERE u.correo = ?`, [correo]);
  if(!u || !(await bcrypt.compare(password, u.password_hash)))
    throw new HttpError(401, 'Correo o contraseña incorrectos.');
  if(u.estado !== 'Activo') throw new HttpError(403, 'Tu cuenta está inactiva. Consulta con el gerente de tu sucursal.');

  if(u.rol !== 'superadmin'){
    if(u.sucursal_estado === 'Pendiente') throw new HttpError(403, 'Tu sucursal aún está pendiente de aprobación por el administrador de SmartStock.');
    if(u.sucursal_estado === 'Suspendida') throw new HttpError(403, 'Tu sucursal está suspendida' + (u.sucursal_motivo ? ': ' + u.sucursal_motivo : '. Contacta al administrador de SmartStock.'));
    if(u.sucursal_estado === 'Rechazada') throw new HttpError(403, 'Tu solicitud de registro no fue aprobada' + (u.sucursal_motivo ? ': ' + u.sucursal_motivo : '.'));
  }
  await query('UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?', [ahoraSQL(), u.id]);

  res.json({ token: firmarToken(u), usuario: perfil(u) });
}));

// GET /api/auth/correo-disponible?correo=  (público: lo usa el primer paso del registro)
router.get('/correo-disponible', ah(async (req, res) => {
  const correo = String(req.query.correo || '').trim().toLowerCase();
  if(!EMAIL_RE.test(correo)) throw new HttpError(400, 'El correo no tiene un formato válido.');
  const [existe] = await query('SELECT id FROM usuarios WHERE correo = ?', [correo]);
  res.json({ disponible: !existe });
}));

// Limpia y valida los datos del asistente de registro. Devuelve los valores listos para guardar.
function validarRegistro(b){
  const t = v => String(v ?? '').trim();
  const d = {
    nombre: t(b.nombre), razon_social: t(b.razon_social), rfc: t(b.rfc).toUpperCase(), tipo: t(b.tipo),
    licencia_sanitaria: t(b.licencia_sanitaria), telefono: t(b.telefono).replace(/\D/g, ''),
    calle: t(b.calle), num_exterior: t(b.num_exterior), num_interior: t(b.num_interior), colonia: t(b.colonia),
    codigo_postal: t(b.codigo_postal), municipio: t(b.municipio), entidad: t(b.entidad), referencias: t(b.referencias),
    nombres: t(b.nombres), apellido_paterno: t(b.apellido_paterno), apellido_materno: t(b.apellido_materno),
    cargo: t(b.cargo), celular: t(b.celular).replace(/\D/g, ''), cedula: t(b.cedula),
    correo: t(b.correo).toLowerCase(), password: String(b.password ?? ''), plan: t(b.plan),
  };
  requerido(d, ['nombre','tipo','telefono','calle','num_exterior','colonia','codigo_postal','municipio','entidad',
                'nombres','apellido_paterno','cargo','celular','correo','password','plan']);
  if(!TIPOS_NEGOCIO.includes(d.tipo)) throw new HttpError(400, 'Tipo de establecimiento no válido.');
  if(!ESTADOS_MX.includes(d.entidad)) throw new HttpError(400, 'Selecciona un estado de la república válido.');
  if(!CARGOS.includes(d.cargo)) throw new HttpError(400, 'Cargo no válido.');
  if(!PLANES.includes(d.plan)) throw new HttpError(400, 'Plan no válido.');
  if(!/^\d{5}$/.test(d.codigo_postal)) throw new HttpError(400, 'El código postal debe tener 5 dígitos.');
  if(d.telefono.length !== 10) throw new HttpError(400, 'El teléfono del negocio debe tener 10 dígitos.');
  if(d.celular.length !== 10) throw new HttpError(400, 'El celular del responsable debe tener 10 dígitos.');
  if(d.rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(d.rfc)) throw new HttpError(400, 'El RFC no tiene un formato válido (12 o 13 caracteres).');
  if(d.cedula && !/^\d{7,8}$/.test(d.cedula)) throw new HttpError(400, 'La cédula profesional debe tener 7 u 8 dígitos.');
  if(!EMAIL_RE.test(d.correo)) throw new HttpError(400, 'El correo no tiene un formato válido.');
  if(d.password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres.');
  if(!b.acepta_terminos) throw new HttpError(400, 'Debes aceptar los términos y el aviso de privacidad.');
  d.responsable = [d.nombres, d.apellido_paterno, d.apellido_materno].filter(Boolean).join(' ');
  const interior = d.num_interior ? ', ' + (/^\d/.test(d.num_interior) ? 'Int. ' : '') + d.num_interior : '';
  d.direccion = `${d.calle} ${d.num_exterior}${interior}, Col. ${d.colonia}, ${d.municipio}, ${d.entidad}, CP ${d.codigo_postal}`;
  return d;
}

// POST /api/auth/registro-sucursal  (público)
// Plan Gratuito → la sucursal queda Activa y se devuelve la sesión para entrar de inmediato.
// Planes de pago → queda Pendiente hasta que el equipo SmartStock la apruebe.
router.post('/registro-sucursal', ah(async (req, res) => {
  const d = validarRegistro(req.body);
  const [existe] = await query('SELECT id FROM usuarios WHERE correo = ?', [d.correo]);
  if(existe) throw new HttpError(409, 'Ya existe una cuenta registrada con ese correo.');

  const inmediata = d.plan === 'Gratuito';
  const hash = await bcrypt.hash(d.password, 10);
  const nul = v => v || null;
  const { usuarioId, sucursalId } = await transaction(async conn => {
    const [r] = await conn.query(`INSERT INTO sucursales
      (nombre,razon_social,rfc,tipo,licencia_sanitaria,telefono,calle,num_exterior,num_interior,colonia,codigo_postal,municipio,entidad,referencias,
       direccion,dueno_nombre,responsable_cargo,responsable_cedula,correo,plan,estado,fecha_alta)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [d.nombre, nul(d.razon_social), nul(d.rfc), d.tipo, nul(d.licencia_sanitaria), d.telefono, d.calle, d.num_exterior, nul(d.num_interior), d.colonia,
       d.codigo_postal, d.municipio, d.entidad, nul(d.referencias), d.direccion, d.responsable, d.cargo, nul(d.cedula), d.correo, d.plan,
       inmediata ? 'Activa' : 'Pendiente', hoyISO()]);
    const [u] = await conn.query(`INSERT INTO usuarios (nombre,correo,telefono,password_hash,rol,sucursal_id) VALUES (?,?,?,?, 'dueno', ?)`,
      [d.responsable, d.correo, d.celular, hash, r.insertId]);
    return { usuarioId: u.insertId, sucursalId: r.insertId };
  });
  await auditar({ user: { id: usuarioId, nombre: d.responsable } }, 'sucursal.registro', `${d.nombre} se registró con el plan ${d.plan}${inmediata ? ' (activación inmediata)' : ' (pendiente de aprobación)'}.`, sucursalId);

  if(!inmediata) return res.status(201).json({ ok: true, activa: false, mensaje: 'Solicitud enviada. Tu sucursal quedó pendiente de aprobación.' });
  const [u] = await query(`SELECT u.*, s.nombre AS sucursal_nombre FROM usuarios u JOIN sucursales s ON s.id = u.sucursal_id WHERE u.id = ?`, [usuarioId]);
  res.status(201).json({ ok: true, activa: true, token: firmarToken(u), usuario: perfil(u) });
}));

// GET /api/auth/me
router.get('/me', autenticar, (req, res) => res.json(perfil(req.user)));

// PUT /api/auth/password  (cambio de contraseña propio)
router.put('/password', autenticar, ah(async (req, res) => {
  const { actual, nueva } = req.body;
  if(!actual || !nueva) throw new HttpError(400, 'Escribe tu contraseña actual y la nueva.');
  if(String(nueva).length < 6) throw new HttpError(400, 'La nueva contraseña debe tener al menos 6 caracteres.');
  const [u] = await query('SELECT password_hash FROM usuarios WHERE id = ?', [req.user.id]);
  if(!(await bcrypt.compare(String(actual), u.password_hash))) throw new HttpError(400, 'La contraseña actual no es correcta.');
  await query('UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 0 WHERE id = ?', [await bcrypt.hash(String(nueva), 10), req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;
