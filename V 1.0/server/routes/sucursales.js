/* ===== /api/sucursales (superadmin) y /api/mi-sucursal (dueño) ===== */
const express = require('express');
const { query } = require('../db');
const { permitir } = require('../middleware/auth');
const { ah, HttpError, auditar } = require('../utils');
const { PLANES, LIMITES_PLAN } = require('../constants');
const { saludSucursales } = require('../services/ia');

// ---------- Superadministrador ----------
const admin = express.Router();
admin.use(permitir('superadmin'));

admin.get('/', ah(async (req, res) => {
  const filas = await query(`
    SELECT s.*,
      (SELECT COUNT(*) FROM usuarios u WHERE u.sucursal_id = s.id) AS usuarios,
      (SELECT COUNT(*) FROM productos p WHERE p.sucursal_id = s.id AND p.activo = 1) AS productos,
      (SELECT MAX(u.ultimo_acceso) FROM usuarios u WHERE u.sucursal_id = s.id) AS ultimo_acceso
    FROM sucursales s ORDER BY FIELD(s.estado,'Pendiente','Activa','Suspendida','Rechazada'), s.fecha_alta DESC`);
  res.json(filas);
}));

async function sucursalPorId(id){
  const [s] = await query('SELECT * FROM sucursales WHERE id = ?', [id]);
  if(!s) throw new HttpError(404, 'Sucursal no encontrada.');
  return s;
}

// GET /api/sucursales/:id  → ficha completa: datos, uso, personal e historial
admin.get('/:id', ah(async (req, res) => {
  const s = await sucursalPorId(req.params.id);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) + ' 00:00:00';
  const [uso] = await query(`SELECT
      (SELECT COUNT(*) FROM productos p WHERE p.sucursal_id = ? AND p.activo = 1) AS productos,
      (SELECT COALESCE(SUM(l.cantidad),0) FROM lotes l JOIN productos p ON p.id = l.producto_id WHERE p.sucursal_id = ? AND p.activo = 1) AS unidades,
      (SELECT COUNT(*) FROM movimientos m WHERE m.sucursal_id = ?) AS movimientos,
      (SELECT COUNT(*) FROM movimientos m WHERE m.sucursal_id = ? AND m.fecha >= ?) AS movimientos30,
      (SELECT MAX(m.fecha) FROM movimientos m WHERE m.sucursal_id = ?) AS ultimo_movimiento`, [s.id, s.id, s.id, s.id, hace30, s.id]);
  const usuarios = await query(`SELECT id, nombre, correo, telefono, rol, estado, ultimo_acceso, debe_cambiar_password FROM usuarios
                                WHERE sucursal_id = ? ORDER BY rol = 'dueno' DESC, nombre`, [s.id]);
  const historial = await query('SELECT * FROM auditoria WHERE sucursal_id = ? ORDER BY fecha DESC, id DESC LIMIT 40', [s.id]);
  const salud = (await saludSucursales()).find(x => x.id === s.id) || null;
  res.json({ sucursal: s, uso: { ...uso, unidades: Number(uso.unidades), empleados: usuarios.filter(u => u.rol === 'empleado' && u.estado === 'Activo').length },
             limites: LIMITES_PLAN[s.plan], usuarios, historial, salud });
}));

// PUT /api/sucursales/:id/estado  { estado, motivo }
// Rechazar o suspender exige un motivo, que el responsable verá al intentar iniciar sesión.
admin.put('/:id/estado', ah(async (req, res) => {
  const s = await sucursalPorId(req.params.id);
  const estado = req.body.estado, motivo = String(req.body.motivo || '').trim();
  if(!['Activa', 'Suspendida', 'Rechazada'].includes(estado)) throw new HttpError(400, 'Estado no válido.');
  if(estado === s.estado) throw new HttpError(400, `La sucursal ya está ${estado.toLowerCase()}.`);
  if(estado === 'Rechazada' && s.estado !== 'Pendiente') throw new HttpError(400, 'Solo se puede rechazar una solicitud pendiente.');
  if(estado !== 'Activa' && motivo.length < 10) throw new HttpError(400, 'Escribe el motivo (al menos 10 caracteres): el responsable lo verá al intentar entrar.');
  await query('UPDATE sucursales SET estado = ?, motivo_estado = ? WHERE id = ?', [estado, estado === 'Activa' ? null : motivo.slice(0, 300), s.id]);
  const verbo = estado === 'Rechazada' ? 'Rechazó la solicitud de' : estado === 'Suspendida' ? 'Suspendió a'
              : s.estado === 'Pendiente' ? 'Aprobó a' : 'Reactivó a';
  await auditar(req, 'sucursal.' + (estado === 'Rechazada' ? 'rechazar' : estado === 'Suspendida' ? 'suspender' : s.estado === 'Pendiente' ? 'aprobar' : 'reactivar'),
    `${verbo} ${s.nombre}${motivo && estado !== 'Activa' ? '. Motivo: ' + motivo : ''}`, s.id);
  res.json({ ok: true });
}));

// PUT /api/sucursales/:id/plan  { aprobar: bool }  o  { plan: 'Profesional' } (cambio directo)
admin.put('/:id/plan', ah(async (req, res) => {
  const s = await sucursalPorId(req.params.id);
  if(req.body.plan){
    if(!PLANES.includes(req.body.plan)) throw new HttpError(400, 'Plan no válido.');
    if(req.body.plan === s.plan) throw new HttpError(400, 'Ese ya es su plan actual.');
    await query('UPDATE sucursales SET plan = ?, plan_solicitado = NULL WHERE id = ?', [req.body.plan, s.id]);
    await auditar(req, 'sucursal.plan', `Cambió el plan de ${s.nombre}: ${s.plan} → ${req.body.plan}.`, s.id);
  }else if(req.body.aprobar && s.plan_solicitado){
    await query('UPDATE sucursales SET plan = plan_solicitado, plan_solicitado = NULL WHERE id = ?', [s.id]);
    await auditar(req, 'sucursal.plan', `Aprobó el cambio de plan de ${s.nombre}: ${s.plan} → ${s.plan_solicitado}.`, s.id);
  }else{
    await query('UPDATE sucursales SET plan_solicitado = NULL WHERE id = ?', [s.id]);
    if(s.plan_solicitado) await auditar(req, 'sucursal.plan', `Rechazó el cambio de plan de ${s.nombre} a ${s.plan_solicitado}.`, s.id);
  }
  res.json({ ok: true });
}));

// ---------- Dueño: mi sucursal ----------
const mia = express.Router();
mia.use(permitir('dueno'));

mia.get('/', ah(async (req, res) => {
  const [s] = await query('SELECT * FROM sucursales WHERE id = ?', [req.user.sucursal_id]);
  res.json(s);
}));

mia.put('/', ah(async (req, res) => {
  const b = req.body;
  const [s] = await query('SELECT * FROM sucursales WHERE id = ?', [req.user.sucursal_id]);
  await query('UPDATE sucursales SET nombre = ?, direccion = ?, telefono = ? WHERE id = ?',
    [b.nombre?.trim() || s.nombre, b.direccion?.trim() || s.direccion, b.telefono?.trim() || s.telefono, s.id]);
  res.json({ ok: true });
}));

mia.post('/plan', ah(async (req, res) => {
  if(!PLANES.includes(req.body.plan)) throw new HttpError(400, 'Plan no válido.');
  const [s] = await query('SELECT plan FROM sucursales WHERE id = ?', [req.user.sucursal_id]);
  if(s.plan === req.body.plan) throw new HttpError(400, 'Ese ya es tu plan actual.');
  await query('UPDATE sucursales SET plan_solicitado = ? WHERE id = ?', [req.body.plan, req.user.sucursal_id]);
  await auditar(req, 'sucursal.solicitud-plan', `Solicitó cambiar del plan ${s.plan} al plan ${req.body.plan}.`, req.user.sucursal_id);
  res.json({ ok: true });
}));

module.exports = { admin, mia };
