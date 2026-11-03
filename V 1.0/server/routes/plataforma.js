/* ===== /api/plataforma : herramientas del superadministrador =====
   Panel general, usuarios de toda la plataforma, bitácora de auditoría y avisos.
*/
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { ah, HttpError, requerido, hoyISO, ahoraSQL, EMAIL_RE, auditar } = require('../utils');
const { PLANES, LIMITES_PLAN } = require('../constants');
const { saludSucursales } = require('../services/ia');

// ---------- GET /api/plataforma/resumen : panel ----------
router.get('/resumen', ah(async (req, res) => {
  const sucursales = await query('SELECT id, nombre, plan, plan_solicitado, estado, fecha_alta, dueno_nombre, correo, tipo, municipio, entidad FROM sucursales ORDER BY fecha_alta DESC');
  const porEstado = {}, porPlan = Object.fromEntries(PLANES.map(p => [p, 0]));
  sucursales.forEach(s => { porEstado[s.estado] = (porEstado[s.estado] || 0) + 1; if(s.estado === 'Activa') porPlan[s.plan]++; });

  // registros por mes (últimos 12)
  const hoy = new Date(hoyISO() + 'T00:00:00'), meses = [];
  const NOMBRES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  for(let i = 11; i >= 0; i--){
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    meses.push({ etiqueta: `${NOMBRES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, registros: sucursales.filter(s => s.fecha_alta.startsWith(clave)).length });
  }

  const [u] = await query(`SELECT COUNT(*) AS total, SUM(estado = 'Activo') AS activos FROM usuarios WHERE rol <> 'superadmin'`);
  const salud = await saludSucursales();
  res.json({
    total: sucursales.length, porEstado, porPlan,
    ingresoMensual: sucursales.filter(s => s.estado === 'Activa').reduce((t, s) => t + LIMITES_PLAN[s.plan].precio, 0),
    usuarios: { total: Number(u.total), activos: Number(u.activos || 0) },
    registrosPorMes: meses,
    pendientes: sucursales.filter(s => s.estado === 'Pendiente'),
    cambiosDePlan: sucursales.filter(s => s.plan_solicitado),
    salud,
  });
}));

// ---------- usuarios de toda la plataforma ----------
router.get('/usuarios', ah(async (req, res) => {
  const where = ['1 = 1'], params = [];
  if(req.query.q){ where.push('(u.nombre LIKE ? OR u.correo LIKE ? OR s.nombre LIKE ?)'); const q = `%${req.query.q}%`; params.push(q, q, q); }
  if(req.query.rol){ where.push('u.rol = ?'); params.push(req.query.rol); }
  if(req.query.estado){ where.push('u.estado = ?'); params.push(req.query.estado); }
  const filas = await query(`
    SELECT u.id, u.nombre, u.correo, u.telefono, u.rol, u.estado, u.ultimo_acceso, u.debe_cambiar_password, u.created_at,
           s.id AS sucursal_id, s.nombre AS sucursal, s.estado AS sucursal_estado
    FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id
    WHERE ${where.join(' AND ')} ORDER BY u.rol = 'superadmin' DESC, s.nombre, u.rol, u.nombre LIMIT 300`, params);
  res.json(filas);
}));

async function usuarioPorId(id){
  const [u] = await query('SELECT * FROM usuarios WHERE id = ?', [id]);
  if(!u) throw new HttpError(404, 'Usuario no encontrado.');
  return u;
}

// Crear otro superadministrador
router.post('/usuarios', ah(async (req, res) => {
  const b = req.body;
  requerido(b, ['nombre', 'correo', 'password']);
  const correo = String(b.correo).trim().toLowerCase();
  if(!EMAIL_RE.test(correo)) throw new HttpError(400, 'El correo no tiene un formato válido.');
  if(String(b.password).length < 8) throw new HttpError(400, 'La contraseña temporal debe tener al menos 8 caracteres.');
  const [dup] = await query('SELECT id FROM usuarios WHERE correo = ?', [correo]);
  if(dup) throw new HttpError(409, 'Ya existe una cuenta con ese correo.');
  const r = await query(`INSERT INTO usuarios (nombre,correo,password_hash,rol,debe_cambiar_password) VALUES (?,?,?,'superadmin',1)`,
    [b.nombre.trim(), correo, await bcrypt.hash(String(b.password), 10)]);
  await auditar(req, 'usuario.crear', `Creó al superadministrador ${b.nombre.trim()} (${correo}).`);
  res.status(201).json({ id: r.insertId });
}));

router.put('/usuarios/:id', ah(async (req, res) => {
  const u = await usuarioPorId(req.params.id);
  const estado = req.body.estado;
  if(!['Activo', 'Inactivo'].includes(estado)) throw new HttpError(400, 'Estado no válido.');
  if(u.id === req.user.id) throw new HttpError(400, 'No puedes desactivar tu propia cuenta.');
  await query('UPDATE usuarios SET estado = ? WHERE id = ?', [estado, u.id]);
  await auditar(req, estado === 'Activo' ? 'usuario.activar' : 'usuario.desactivar', `${estado === 'Activo' ? 'Activó' : 'Desactivó'} la cuenta de ${u.nombre} (${u.correo}).`, u.sucursal_id);
  res.json({ ok: true });
}));

router.put('/usuarios/:id/password', ah(async (req, res) => {
  const u = await usuarioPorId(req.params.id);
  if(String(req.body.password || '').length < 8) throw new HttpError(400, 'La contraseña temporal debe tener al menos 8 caracteres.');
  await query('UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 1 WHERE id = ?', [await bcrypt.hash(String(req.body.password), 10), u.id]);
  await auditar(req, 'usuario.password', `Restableció la contraseña de ${u.nombre} (${u.correo}).`, u.sucursal_id);
  res.json({ ok: true });
}));

// ---------- bitácora ----------
router.get('/bitacora', ah(async (req, res) => {
  const where = ['1 = 1'], params = [];
  if(req.query.accion){ where.push('a.accion LIKE ?'); params.push(req.query.accion + '%'); }
  if(req.query.sucursal_id){ where.push('a.sucursal_id = ?'); params.push(req.query.sucursal_id); }
  if(req.query.q){ where.push('(a.detalle LIKE ? OR a.usuario_nombre LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if(req.query.desde){ where.push('a.fecha >= ?'); params.push(req.query.desde + ' 00:00:00'); }
  if(req.query.hasta){ where.push('a.fecha <= ?'); params.push(req.query.hasta + ' 23:59:59'); }
  const limit = Math.min(200, Number(req.query.limit) || 30), offset = Math.max(0, Number(req.query.offset) || 0);
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM auditoria a WHERE ${where.join(' AND ')}`, params);
  const filas = await query(`SELECT a.*, s.nombre AS sucursal FROM auditoria a LEFT JOIN sucursales s ON s.id = a.sucursal_id
                             WHERE ${where.join(' AND ')} ORDER BY a.fecha DESC, a.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  res.json({ total, limit, offset, filas });
}));

// ---------- avisos ----------
const TIPOS_AVISO = ['Novedad', 'Mantenimiento', 'Importante'];
function datosAviso(b){
  requerido(b, ['titulo', 'mensaje']);
  if(b.tipo && !TIPOS_AVISO.includes(b.tipo)) throw new HttpError(400, 'Tipo de aviso no válido.');
  if(b.plan && !PLANES.includes(b.plan)) throw new HttpError(400, 'Plan no válido.');
  if(b.vence_el && b.vence_el < hoyISO()) throw new HttpError(400, 'La fecha de vencimiento ya pasó.');
  return [String(b.titulo).trim().slice(0, 120), String(b.mensaje).trim().slice(0, 600), b.tipo || 'Novedad', b.plan || null, b.vence_el || null];
}
router.get('/avisos', ah(async (req, res) => res.json(await query('SELECT * FROM avisos ORDER BY activo DESC, creado_en DESC'))));
router.post('/avisos', ah(async (req, res) => {
  const d = datosAviso(req.body);
  const r = await query('INSERT INTO avisos (titulo,mensaje,tipo,plan,vence_el,creado_por,creado_en) VALUES (?,?,?,?,?,?,?)', [...d, req.user.nombre, ahoraSQL()]);
  await auditar(req, 'aviso.crear', `Publicó el aviso "${d[0]}"${d[3] ? ' para el plan ' + d[3] : ' para todas las sucursales'}.`);
  res.status(201).json({ id: r.insertId });
}));
router.put('/avisos/:id', ah(async (req, res) => {
  const [a] = await query('SELECT * FROM avisos WHERE id = ?', [req.params.id]);
  if(!a) throw new HttpError(404, 'Aviso no encontrado.');
  if(req.body.activo !== undefined && req.body.titulo === undefined){
    await query('UPDATE avisos SET activo = ? WHERE id = ?', [req.body.activo ? 1 : 0, a.id]);
    await auditar(req, 'aviso.estado', `${req.body.activo ? 'Reactivó' : 'Retiró'} el aviso "${a.titulo}".`);
  }else{
    await query('UPDATE avisos SET titulo = ?, mensaje = ?, tipo = ?, plan = ?, vence_el = ? WHERE id = ?', [...datosAviso(req.body), a.id]);
    await auditar(req, 'aviso.editar', `Editó el aviso "${a.titulo}".`);
  }
  res.json({ ok: true });
}));
router.delete('/avisos/:id', ah(async (req, res) => {
  const [a] = await query('SELECT * FROM avisos WHERE id = ?', [req.params.id]);
  if(!a) throw new HttpError(404, 'Aviso no encontrado.');
  await query('DELETE FROM avisos WHERE id = ?', [a.id]);
  await auditar(req, 'aviso.eliminar', `Eliminó el aviso "${a.titulo}".`);
  res.json({ ok: true });
}));

module.exports = router;
