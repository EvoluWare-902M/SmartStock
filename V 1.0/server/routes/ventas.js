/* ===== /api/ventas : punto de venta (tickets con varios productos) =====
   Cada ticket descuenta existencias por FEFO (primero lo que caduca antes) y deja un
   movimiento de salida por lote, ligado al ticket. Con esos tickets el modelo de
   "se venden juntos" aprende qué ofrecer.
*/
const router = require('express').Router();
const { query, transaction } = require('../db');
const { permitir } = require('../middleware/auth');
const { ah, HttpError, entero, hoyISO, ahoraSQL, auditar } = require('../utils');
const { productosConStock, surtirFEFO } = require('../services/inventario');
const { sugerirParaVenta } = require('../services/operacion');
const { productoDeSucursal } = require('./productos');

async function ticket(id, sucursalId){
  const [v] = await query(`SELECT v.*, u.nombre AS vendedor FROM ventas v LEFT JOIN usuarios u ON u.id = v.usuario_id WHERE v.id = ? AND v.sucursal_id = ?`, [id, sucursalId]);
  if(!v) throw new HttpError(404, 'Venta no encontrada.');
  v.partidas = await query(`SELECT m.producto_id, p.nombre AS producto, p.ubicacion, l.numero_lote AS lote, m.cantidad, p.precio, m.cantidad * p.precio AS importe
    FROM movimientos m JOIN productos p ON p.id = m.producto_id LEFT JOIN lotes l ON l.id = m.lote_id WHERE m.venta_id = ? AND m.tipo = 'Salida' ORDER BY m.id`, [v.id]);
  return v;
}

// GET /api/ventas/sugerencias?ids=1,2  → IA: qué más ofrecer con lo que ya está en el ticket
router.get('/sugerencias', ah(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
  res.json(await sugerirParaVenta(req.user.sucursal_id, ids));
}));

// GET /api/ventas?fecha=YYYY-MM-DD&mias=1  → tickets del día (el empleado solo ve los suyos)
router.get('/', ah(async (req, res) => {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || '') ? req.query.fecha : hoyISO();
  const soloMias = req.user.rol === 'empleado' || req.query.mias === '1';
  const filas = await query(`SELECT v.id, v.folio, v.fecha, v.total, v.estado, v.cliente, v.receta, u.nombre AS vendedor,
      (SELECT COALESCE(SUM(m.cantidad), 0) FROM movimientos m WHERE m.venta_id = v.id AND m.tipo = 'Salida') AS unidades,
      (SELECT GROUP_CONCAT(DISTINCT p.nombre ORDER BY p.nombre SEPARATOR ', ') FROM movimientos m JOIN productos p ON p.id = m.producto_id WHERE m.venta_id = v.id AND m.tipo = 'Salida') AS productos
    FROM ventas v LEFT JOIN usuarios u ON u.id = v.usuario_id
    WHERE v.sucursal_id = ? AND v.fecha BETWEEN ? AND ? ${soloMias ? 'AND v.usuario_id = ?' : ''} ORDER BY v.fecha DESC, v.id DESC LIMIT 200`,
    [req.user.sucursal_id, fecha + ' 00:00:00', fecha + ' 23:59:59', ...(soloMias ? [req.user.id] : [])]);
  res.json(filas.map(f => ({ ...f, unidades: Number(f.unidades) })));
}));

router.get('/:id', ah(async (req, res) => res.json(await ticket(req.params.id, req.user.sucursal_id))));

// POST /api/ventas  { partidas: [{producto_id, cantidad}], cliente, receta }
router.post('/', ah(async (req, res) => {
  const b = req.body, sid = req.user.sucursal_id;
  if(!Array.isArray(b.partidas) || !b.partidas.length) throw new HttpError(400, 'Agrega al menos un medicamento al ticket.');
  if(b.partidas.length > 40) throw new HttpError(400, 'Un ticket admite hasta 40 productos distintos.');
  // Se juntan las cantidades si el mismo producto viene dos veces
  const cantidades = new Map();
  for(const p of b.partidas) cantidades.set(Number(p.producto_id), (cantidades.get(Number(p.producto_id)) || 0) + entero(p.cantidad, 'La cantidad', { min: 1 }));
  const productos = [];
  for(const [id, cantidad] of cantidades) productos.push({ ...(await productoDeSucursal(id, sid)), cantidad });
  const receta = String(b.receta || '').trim();
  const controlados = productos.filter(p => p.requiere_receta);
  if(controlados.length && !receta) throw new HttpError(400, `Falta el número de receta: ${controlados.map(p => p.nombre).join(', ')} se vende${controlados.length > 1 ? 'n' : ''} solo con receta.`);

  const ventaId = await transaction(async conn => {
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM ventas WHERE sucursal_id = ?', [sid]);
    const ahora = ahoraSQL();
    const total = productos.reduce((s, p) => s + p.cantidad * Number(p.precio), 0);
    const [v] = await conn.query('INSERT INTO ventas (sucursal_id,folio,usuario_id,fecha,total,cliente,receta) VALUES (?,?,?,?,?,?,?)',
      [sid, 'V-' + String(n + 1).padStart(5, '0'), req.user.id, ahora, total, String(b.cliente || '').trim() || null, receta || null]);
    for(const p of productos){
      for(const t of await surtirFEFO(conn, p, p.cantidad))
        await conn.query(`INSERT INTO movimientos (sucursal_id,producto_id,lote_id,venta_id,tipo,cantidad,motivo,receta,cliente,usuario_id,fecha)
          VALUES (?,?,?,?,'Salida',?,'Venta',?,?,?,?)`, [sid, p.id, t.lote_id, v.insertId, t.cantidad, p.requiere_receta ? receta : null, String(b.cliente || '').trim() || null, req.user.id, ahora]);
    }
    return v.insertId;
  });

  const despues = await productosConStock(sid);
  const alertas = despues.filter(p => cantidades.has(p.id) && p.stock_bajo).map(p => `${p.nombre} quedó con ${p.stock} u. (mínimo ${p.stock_minimo}).`);
  res.status(201).json({ ...(await ticket(ventaId, sid)), alertas });
}));

// POST /api/ventas/:id/cancelar  → solo el gerente y solo el mismo día: regresa las piezas a sus lotes
router.post('/:id/cancelar', permitir('dueno'), ah(async (req, res) => {
  const sid = req.user.sucursal_id;
  const v = await ticket(req.params.id, sid);
  if(v.estado === 'Cancelada') throw new HttpError(409, 'Esta venta ya estaba cancelada.');
  if(v.fecha.slice(0, 10) !== hoyISO()) throw new HttpError(400, 'Solo se pueden cancelar ventas del día. Para días anteriores registra una entrada por devolución.');
  await transaction(async conn => {
    const [movs] = await conn.query(`SELECT * FROM movimientos WHERE venta_id = ? AND tipo = 'Salida' FOR UPDATE`, [v.id]);
    for(const m of movs){
      if(m.lote_id) await conn.query('UPDATE lotes SET cantidad = cantidad + ? WHERE id = ?', [m.cantidad, m.lote_id]);
      await conn.query(`INSERT INTO movimientos (sucursal_id,producto_id,lote_id,venta_id,tipo,cantidad,motivo,observaciones,usuario_id,fecha)
        VALUES (?,?,?,?,'Entrada',?,'Cancelación de venta',?,?,?)`, [sid, m.producto_id, m.lote_id, v.id, m.cantidad, 'Ticket ' + v.folio, req.user.id, ahoraSQL()]);
    }
    // Las salidas dejan de contar como venta para las estadísticas y el modelo predictivo
    await conn.query(`UPDATE movimientos SET motivo = 'Venta cancelada' WHERE venta_id = ? AND tipo = 'Salida'`, [v.id]);
    await conn.query(`UPDATE ventas SET estado = 'Cancelada' WHERE id = ?`, [v.id]);
  });
  await auditar(req, 'venta.cancelar', `Canceló el ticket ${v.folio} por $${v.total}.`, sid);
  res.json({ ok: true });
}));

module.exports = router;
