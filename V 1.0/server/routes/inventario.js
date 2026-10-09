/* ===== /api/inventario : existencias, alertas (HU-6) y caducidades (HU-4, HU-5) ===== */
const router = require('express').Router();
const { ah } = require('../utils');
const { productosConStock, lotesSucursal, resumenAlertas } = require('../services/inventario');

// GET /api/inventario/alertas  → resumen para el aviso del menú y el dashboard
router.get('/alertas', ah(async (req, res) => {
  res.json(await resumenAlertas(req.user.sucursal_id));
}));

// GET /api/inventario/caducidades  → lotes ordenados por vencimiento con semáforo
router.get('/caducidades', ah(async (req, res) => {
  res.json(await lotesSucursal(req.user.sucursal_id));
}));

// GET /api/inventario  → existencias por producto
router.get('/', ah(async (req, res) => {
  let lista = await productosConStock(req.user.sucursal_id);
  if(req.query.categoria) lista = lista.filter(p => p.categoria === req.query.categoria);
  if(req.query.estado === 'bajo') lista = lista.filter(p => p.stock_bajo);
  res.json(lista);
}));

module.exports = router;
