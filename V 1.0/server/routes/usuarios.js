/* ===== /api/usuarios : gestión de personal de la sucursal (HU-14) ===== */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { ah, HttpError, requerido, EMAIL_RE } = require('../utils');

const { LIMITES_PLAN } = require('../constants');
const LIMITE_EMPLEADOS = Object.fromEntries(Object.entries(LIMITES_PLAN).map(([p, l]) => [p, l.empleados]));
const ROLES_ASIGNABLES = ['empleado', 'dueno'];

async function usuarioDeSucursal(id, sucursalId){
  const [u] = await query('SELECT * FROM usuarios WHERE id = ? AND sucursal_id = ?', [id, sucursalId]);
  if(!u) throw new HttpError(404, 'El usuario no pertenece a tu sucursal.');
  return u;
}

// GET /api/usuarios  → personal de la sucursal (incluye al dueño)
router.get('/', ah(async (req, res) => {
  const filas = await query(`SELECT id, nombre, correo, telefono, rol, estado, debe_cambiar_password, created_at
                             FROM usuarios WHERE sucursal_id = ? ORDER BY rol = 'dueno' DESC, nombre`, [req.user.sucursal_id]);
  const [s] = await query('SELECT plan FROM sucursales WHERE id = ?', [req.user.sucursal_id]);
  res.json({ usuarios: filas, limite: LIMITE_EMPLEADOS[s.plan], plan: s.plan });
}));

// POST /api/usuarios  → alta de personal
router.post('/', ah(async (req, res) => {
  const b = req.body;
  requerido(b, ['nombre','correo','password']);
  const correo = String(b.correo).trim().toLowerCase();
  if(!EMAIL_RE.test(correo)) throw new HttpError(400, 'El correo no tiene un formato válido.');
  if(String(b.password).length < 6) throw new HttpError(400, 'La contraseña temporal debe tener al menos 6 caracteres.');
  const rol = ROLES_ASIGNABLES.includes(b.rol) ? b.rol : 'empleado';

  const [s] = await query('SELECT plan FROM sucursales WHERE id = ?', [req.user.sucursal_id]);
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM usuarios WHERE sucursal_id = ? AND rol = 'empleado' AND estado = 'Activo'`, [req.user.sucursal_id]);
  if(rol === 'empleado' && n >= LIMITE_EMPLEADOS[s.plan])
    throw new HttpError(403, `Tu plan ${s.plan} permite hasta ${LIMITE_EMPLEADOS[s.plan]} empleado(s) activo(s). Solicita un cambio de plan en "Mi sucursal".`);

  const [dup] = await query('SELECT id FROM usuarios WHERE correo = ?', [correo]);
  if(dup) throw new HttpError(409, 'Ya existe una cuenta con ese correo.');

  const hash = await bcrypt.hash(String(b.password), 10);
  const r = await query(`INSERT INTO usuarios (nombre,correo,telefono,password_hash,rol,sucursal_id,debe_cambiar_password)
                         VALUES (?,?,?,?,?,?,1)`, [b.nombre.trim(), correo, b.telefono || null, hash, rol, req.user.sucursal_id]);
  res.status(201).json({ id: r.insertId });
}));

// PUT /api/usuarios/:id  → editar nombre, teléfono, rol o estado
router.put('/:id', ah(async (req, res) => {
  const u = await usuarioDeSucursal(req.params.id, req.user.sucursal_id);
  const b = req.body;
  if(u.id === req.user.id && (b.estado === 'Inactivo' || (b.rol && b.rol !== u.rol)))
    throw new HttpError(400, 'No puedes desactivarte ni cambiar tu propio rol.');
  const estado = ['Activo','Inactivo'].includes(b.estado) ? b.estado : u.estado;
  const rol = ROLES_ASIGNABLES.includes(b.rol) ? b.rol : u.rol;
  await query('UPDATE usuarios SET nombre = ?, telefono = ?, estado = ?, rol = ? WHERE id = ?',
    [b.nombre?.trim() || u.nombre, b.telefono ?? u.telefono, estado, rol, u.id]);
  res.json({ ok: true });
}));

// PUT /api/usuarios/:id/password  → restablecer contraseña temporal
router.put('/:id/password', ah(async (req, res) => {
  const u = await usuarioDeSucursal(req.params.id, req.user.sucursal_id);
  if(String(req.body.password || '').length < 6) throw new HttpError(400, 'La contraseña temporal debe tener al menos 6 caracteres.');
  await query('UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 1 WHERE id = ?', [await bcrypt.hash(String(req.body.password), 10), u.id]);
  res.json({ ok: true });
}));

// DELETE /api/usuarios/:id
router.delete('/:id', ah(async (req, res) => {
  const u = await usuarioDeSucursal(req.params.id, req.user.sucursal_id);
  if(u.id === req.user.id) throw new HttpError(400, 'No puedes eliminar tu propia cuenta.');
  await query('DELETE FROM usuarios WHERE id = ?', [u.id]);
  res.json({ ok: true });
}));

module.exports = router;
