/* ===== /api/analitica : predicción, recomendaciones y repisas (solo dueño) ===== */
const router = require('express').Router();
const { query, transaction } = require('../db');
const { ah, HttpError, ahoraSQL } = require('../utils');
const { UBICACIONES, LIMITES_PLAN } = require('../constants');
const { prediccion, recomendaciones, organizacionRepisas } = require('../services/prediccion');

// El análisis predictivo forma parte de los planes Profesional y Empresarial.
router.use(ah(async (req, res, next) => {
  const [s] = await query('SELECT plan FROM sucursales WHERE id = ?', [req.user.sucursal_id]);
  if(!LIMITES_PLAN[s.plan].analitica) throw new HttpError(403, 'El análisis predictivo está incluido en los planes Profesional y Empresarial. Solicita el cambio en "Mi sucursal".');
  next();
}));

router.get('/prediccion', ah(async (req, res) => {
  res.json(await prediccion(req.user.sucursal_id, { categoria: req.query.categoria, productoId: req.query.producto_id }));
}));

router.get('/recomendaciones', ah(async (req, res) => {
  res.json(await recomendaciones(req.user.sucursal_id));
}));

router.get('/repisas', ah(async (req, res) => {
  res.json(await organizacionRepisas(req.user.sucursal_id));
}));

// POST /api/analitica/repisas/aplicar  { movimientos: [{producto_id, hacia}] }
router.post('/repisas/aplicar', ah(async (req, res) => {
  const movs = Array.isArray(req.body.movimientos) ? req.body.movimientos : [];
  if(!movs.length) throw new HttpError(400, 'No hay reubicaciones que aplicar.');
  await transaction(async conn => {
    for(const m of movs){
      if(!UBICACIONES.includes(m.hacia)) throw new HttpError(400, 'Ubicación no válida.');
      const [r] = await conn.query('UPDATE productos SET ubicacion = ? WHERE id = ? AND sucursal_id = ?', [m.hacia, m.producto_id, req.user.sucursal_id]);
      if(!r.affectedRows) throw new HttpError(404, 'Producto no encontrado.');
    }
  });
  res.json({ ok: true, aplicado: ahoraSQL() });
}));

module.exports = router;
