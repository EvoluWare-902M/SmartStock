/* ===== /api/movimientos : entradas (HU-7), salidas (HU-8) e historial (HU-9) ===== */
const router = require('express').Router();
const { query, transaction } = require('../db');
const { permitir } = require('../middleware/auth');
const { ah, HttpError, requerido, entero, hoyISO, ahoraSQL } = require('../utils');
const { MOTIVOS_SALIDA } = require('../constants');
const { productosConStock, registrarEntrada } = require('../services/inventario');
const { productoDeSucursal } = require('./productos');

// POST /api/movimientos/entradas  → recepción de mercancía (solo dueño)
// Si el lote ya existe para ese medicamento se suma la cantidad; si no, se crea.
router.post('/entradas', permitir('dueno'), ah(async (req, res) => {
  const b = req.body;
  requerido(b, ['producto_id','proveedor','numero_lote','caducidad','cantidad']);
  const sid = req.user.sucursal_id;
  const prod = await productoDeSucursal(b.producto_id, sid);
  const cantidad = entero(b.cantidad, 'La cantidad', { min: 1 });
  const fecha = b.fecha || hoyISO();
  if(fecha > hoyISO()) throw new HttpError(400, 'La fecha de entrada no puede ser futura.');
  if(b.caducidad <= fecha) throw new HttpError(400, 'La caducidad del lote debe ser posterior a la fecha de entrada.');
  const resultado = await transaction(conn => registrarEntrada(conn, { sucursalId: sid, productoId: prod.id, numeroLote: b.numero_lote, caducidad: b.caducidad,
    cantidad, costo: b.costo_unitario, factura: b.factura || null, proveedor: b.proveedor.trim(), fecha, usuarioId: req.user.id, observaciones: b.observaciones || null }));

  const [p] = await productosConStock(sid, { productoId: prod.id });
  res.status(201).json({ ok: true, ...resultado, producto: p });
}));

// POST /api/movimientos/salidas  → venta o retiro (dueño y empleado)
router.post('/salidas', permitir('dueno','empleado'), ah(async (req, res) => {
  const b = req.body;
  requerido(b, ['producto_id','lote_id','cantidad','motivo']);
  if(!MOTIVOS_SALIDA.includes(b.motivo)) throw new HttpError(400, 'Motivo de salida no válido.');
  const sid = req.user.sucursal_id;
  const prod = await productoDeSucursal(b.producto_id, sid);
  const cantidad = entero(b.cantidad, 'La cantidad', { min: 1 });
  const esVenta = b.motivo === 'Venta';
  if(esVenta && prod.requiere_receta && !String(b.receta || '').trim())
    throw new HttpError(400, 'Este medicamento requiere número de receta.');

  await transaction(async conn => {
    const [[lote]] = await conn.query('SELECT * FROM lotes WHERE id = ? AND producto_id = ? FOR UPDATE', [b.lote_id, prod.id]);
    if(!lote) throw new HttpError(404, 'El lote seleccionado no pertenece a este medicamento.');
    if(esVenta && lote.caducidad < hoyISO())
      throw new HttpError(400, `El lote ${lote.numero_lote} está caducado: no se puede vender. Regístralo como "Merma / caducado".`);
    if(cantidad > lote.cantidad)
      throw new HttpError(400, `Stock insuficiente en el lote: solo hay ${lote.cantidad} unidades disponibles.`);
    await conn.query('UPDATE lotes SET cantidad = cantidad - ? WHERE id = ?', [cantidad, lote.id]);
    await conn.query(`INSERT INTO movimientos (sucursal_id,producto_id,lote_id,tipo,cantidad,motivo,receta,cliente,observaciones,usuario_id,fecha)
      VALUES (?,?,?,'Salida',?,?,?,?,?,?,?)`,
      [sid, prod.id, lote.id, cantidad, b.motivo, b.receta || null, b.cliente || null, b.observaciones || null, req.user.id, ahoraSQL()]);
  });

  const [p] = await productosConStock(sid, { productoId: prod.id });
  const alerta = p.stock_bajo
    ? `Atención: ${p.nombre} quedó con ${p.stock} u., en o por debajo del mínimo (${p.stock_minimo}). Se recomienda reabastecer.`
    : null;
  res.status(201).json({ ok: true, producto: p, alerta });
}));

// GET /api/movimientos?producto_id=&tipo=&desde=&hasta=&limit=&offset=
router.get('/', ah(async (req, res) => {
  const where = ['m.sucursal_id = ?'];
  const params = [req.user.sucursal_id];
  if(req.query.producto_id){ where.push('m.producto_id = ?'); params.push(req.query.producto_id); }
  if(req.query.tipo){ where.push('m.tipo = ?'); params.push(req.query.tipo); }
  if(req.query.desde){ where.push('m.fecha >= ?'); params.push(req.query.desde + ' 00:00:00'); }
  if(req.query.hasta){ where.push('m.fecha <= ?'); params.push(req.query.hasta + ' 23:59:59'); }
  const limit = Math.min(500, Number(req.query.limit) || 50);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM movimientos m WHERE ${where.join(' AND ')}`, params);
  const filas = await query(`
    SELECT m.id, m.fecha, m.tipo, m.cantidad, m.motivo, m.proveedor, m.factura, m.receta, m.cliente, m.observaciones,
           p.nombre AS producto, p.codigo, l.numero_lote AS lote, u.nombre AS responsable
    FROM movimientos m
    JOIN productos p ON p.id = m.producto_id
    LEFT JOIN lotes l ON l.id = m.lote_id
    LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE ${where.join(' AND ')}
    ORDER BY m.fecha DESC, m.id DESC
    LIMIT ? OFFSET ?`, [...params, limit, offset]);
  res.json({ total, limit, offset, filas });
}));

module.exports = router;
