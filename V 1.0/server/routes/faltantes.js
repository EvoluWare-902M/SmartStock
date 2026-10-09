/* ===== /api/faltantes : lo que pidió un cliente y no se le pudo surtir =====
   Cualquiera en el mostrador lo anota en segundos; el gerente lo ve agrupado por la IA.
*/
const router = require('express').Router();
const { query } = require('../db');
const { permitir } = require('../middleware/auth');
const { ah, HttpError, ahoraSQL } = require('../utils');
const { demandaNoAtendida } = require('../services/operacion');

router.post('/', ah(async (req, res) => {
  const texto = String(req.body.texto || '').trim().slice(0, 120);
  if(texto.length < 3) throw new HttpError(400, 'Escribe qué pidió el cliente.');
  const cantidad = Math.max(1, Math.min(99, Number(req.body.cantidad) || 1));
  let productoId = null;
  if(req.body.producto_id){
    const [p] = await query('SELECT id FROM productos WHERE id = ? AND sucursal_id = ?', [req.body.producto_id, req.user.sucursal_id]);
    if(p) productoId = p.id;
  }
  const r = await query('INSERT INTO faltantes (sucursal_id,producto_id,texto,cantidad,usuario_id,fecha) VALUES (?,?,?,?,?,?)',
    [req.user.sucursal_id, productoId, texto, cantidad, req.user.id, ahoraSQL()]);
  res.status(201).json({ id: r.insertId });
}));

router.get('/', permitir('dueno'), ah(async (req, res) => res.json(await demandaNoAtendida(req.user.sucursal_id))));

// PUT /api/faltantes/atender { ids: [..] }  → el gerente ya lo resolvió (lo pidió, lo dio de alta o lo descartó)
router.put('/atender', permitir('dueno'), ah(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean);
  if(!ids.length) throw new HttpError(400, 'No hay solicitudes que marcar.');
  await query('UPDATE faltantes SET atendido = 1 WHERE sucursal_id = ? AND id IN (?)', [req.user.sucursal_id, ids]);
  res.json({ ok: true });
}));

module.exports = router;
