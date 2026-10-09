/* ===== /api/ia : análisis inteligente y asistente =====
   - Alternativas y asistente: gerente y empleado.
   - Anomalías, ABC-XYZ, riesgo de caducidad y hallazgos: gerente con plan Profesional o Empresarial.
*/
const router = require('express').Router();
const { query } = require('../db');
const { ah, HttpError } = require('../utils');
const { LIMITES_PLAN } = require('../constants');
const ia = require('../services/ia');
const asistente = require('../services/asistente');
const operacion = require('../services/operacion');
const { transaction } = require('../db');
const { productosConStock } = require('../services/inventario');
const { permitir } = require('../middleware/auth');
const { auditar } = require('../utils');

const soloAnalitica = ah(async (req, res, next) => {
  if(req.user.rol !== 'dueno') throw new HttpError(403, 'El análisis inteligente solo está disponible para el gerente.');
  const [s] = await query('SELECT plan FROM sucursales WHERE id = ?', [req.user.sucursal_id]);
  if(!LIMITES_PLAN[s.plan].analitica) throw new HttpError(403, 'El análisis inteligente está incluido en los planes Profesional y Empresarial. Solicita el cambio en "Mi sucursal".');
  next();
});

router.get('/alternativas/:id', ah(async (req, res) => res.json(await ia.alternativas(req.user.sucursal_id, req.params.id))));

router.get('/hallazgos', soloAnalitica, ah(async (req, res) => res.json(await ia.hallazgos(req.user.sucursal_id))));
router.get('/anomalias', soloAnalitica, ah(async (req, res) => res.json(await ia.anomalias(req.user.sucursal_id, { dias: Math.min(180, Number(req.query.dias) || 30) }))));
router.get('/abc', soloAnalitica, ah(async (req, res) => res.json(await ia.abcxyz(req.user.sucursal_id))));
router.get('/caducidad', soloAnalitica, ah(async (req, res) => res.json(await ia.riesgoCaducidad(req.user.sucursal_id))));

// ---------- modelos para la operación diaria ----------
// POST /api/ia/clasificar { nombre } → al dar de alta: sustancia, categoría, presentación, receta y casilla sugeridas
router.post('/clasificar', permitir('dueno'), ah(async (req, res) => {
  const r = operacion.clasificar(String(req.body.nombre || '').slice(0, 160), await productosConStock(req.user.sucursal_id));
  res.json(r || { categoria: null, explicacion: [] });
}));
router.get('/juntos', soloAnalitica, ah(async (req, res) => {
  const { tickets, dias, reglas } = await operacion.ventaConjunta(req.user.sucursal_id);
  res.json({ tickets, dias, reglas });
}));
router.get('/minimos', soloAnalitica, ah(async (req, res) => res.json(await operacion.minimosSugeridos(req.user.sucursal_id))));
// POST /api/ia/minimos/aplicar { producto_ids: [] } → cambia el stock mínimo por el que calcula el modelo
router.post('/minimos/aplicar', soloAnalitica, ah(async (req, res) => {
  const ids = (Array.isArray(req.body.producto_ids) ? req.body.producto_ids : []).map(Number);
  const cambios = (await operacion.minimosSugeridos(req.user.sucursal_id)).filter(m => ids.includes(m.producto_id) && m.sugerido !== m.actual);
  if(!cambios.length) throw new HttpError(400, 'No hay mínimos que cambiar.');
  await transaction(async conn => {
    for(const c of cambios) await conn.query('UPDATE productos SET stock_minimo = ? WHERE id = ? AND sucursal_id = ?', [c.sugerido, c.producto_id, req.user.sucursal_id]);
  });
  await auditar(req, 'producto.minimos', `Aplicó el mínimo sugerido por la IA a ${cambios.length} medicamento(s): ${cambios.slice(0, 4).map(c => `${c.producto} ${c.actual}→${c.sugerido}`).join(', ')}${cambios.length > 4 ? '…' : ''}.`, req.user.sucursal_id);
  res.json({ ok: true, aplicados: cambios.length });
}));

// ---------- asistente ----------
router.get('/asistente', ah(async (req, res) => {
  const { analitica } = await asistente.planCon(req.user);
  res.json({ modo: asistente.modeloDisponible() ? 'modelo' : 'local', modelo: asistente.modeloDisponible() ? asistente.MODELO() : null,
             sugerencias: [...asistente.EJEMPLOS.todos, ...(analitica ? asistente.EJEMPLOS.analitica : [])] });
}));
router.post('/asistente', ah(async (req, res) => {
  const mensaje = String(req.body.mensaje || '').trim();
  if(!mensaje) throw new HttpError(400, 'Escribe tu pregunta.');
  if(mensaje.length > 500) throw new HttpError(400, 'La pregunta es demasiado larga (máximo 500 caracteres).');
  res.json(await asistente.responder(mensaje, req.body.historial, req.user));
}));

module.exports = router;
