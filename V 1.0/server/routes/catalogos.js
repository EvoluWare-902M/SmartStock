/* ===== /api/catalogos : listas fijas para los formularios ===== */
const router = require('express').Router();
const C = require('../constants');
router.get('/', (req, res) => res.json({
  categorias: C.CATEGORIAS, presentaciones: C.PRESENTACIONES, motivosSalida: C.MOTIVOS_SALIDA,
  planes: C.PLANES, limitesPlan: C.LIMITES_PLAN, tiposNegocio: C.TIPOS_NEGOCIO, cargos: C.CARGOS, estados: C.ESTADOS_MX, filas: C.FILAS, columnas: C.COLUMNAS, ubicaciones: C.UBICACIONES, zonaRapida: C.ZONA_RAPIDA,
}));
module.exports = router;
