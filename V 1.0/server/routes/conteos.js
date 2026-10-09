/* ===== /api/conteos : conteo físico (inventario cíclico) =====
   1. El gerente abre un conteo (a mano o con los productos que sugiere la IA) y lo asigna.
   2. Quien cuenta captura las piezas "a ciegas": no ve cuántas dice el sistema.
   3. El gerente revisa las diferencias y las aplica: se generan movimientos de ajuste.
*/
const router = require('express').Router();
const { query, transaction } = require('../db');
const { permitir } = require('../middleware/auth');
const { ah, HttpError, hoyISO, ahoraSQL, auditar } = require('../utils');
const { productosConStock } = require('../services/inventario');
const { prioridadConteo } = require('../services/operacion');

async function conteoDe(id, user){
  const [c] = await query(`SELECT c.*, a.nombre AS asignado, cr.nombre AS creador FROM conteos c
    LEFT JOIN usuarios a ON a.id = c.asignado_a LEFT JOIN usuarios cr ON cr.id = c.creado_por WHERE c.id = ? AND c.sucursal_id = ?`, [id, user.sucursal_id]);
  if(!c) throw new HttpError(404, 'Conteo no encontrado.');
  if(user.rol === 'empleado' && c.asignado_a && c.asignado_a !== user.id) throw new HttpError(403, 'Este conteo está asignado a otra persona.');
  return c;
}

// GET /api/conteos/sugerencia  → IA: qué conviene contar hoy
router.get('/sugerencia', permitir('dueno'), ah(async (req, res) => res.json(await prioridadConteo(req.user.sucursal_id, Math.min(15, Number(req.query.n) || 8)))));

router.get('/', ah(async (req, res) => {
  const emp = req.user.rol === 'empleado';
  const filas = await query(`SELECT c.id, c.folio, c.estado, c.origen, c.fecha, c.cerrado_en, c.asignado_a, a.nombre AS asignado,
      COUNT(cp.id) AS productos, SUM(cp.contado IS NOT NULL) AS contados, SUM(cp.contado IS NOT NULL AND cp.contado <> cp.esperado) AS diferencias
    FROM conteos c LEFT JOIN usuarios a ON a.id = c.asignado_a LEFT JOIN conteo_partidas cp ON cp.conteo_id = c.id
    WHERE c.sucursal_id = ? ${emp ? "AND (c.asignado_a = ? OR c.asignado_a IS NULL) AND c.estado IN ('Abierto','Por revisar')" : ''}
    GROUP BY c.id ORDER BY FIELD(c.estado,'Por revisar','Abierto','Aplicado','Descartado'), c.fecha DESC LIMIT 50`, emp ? [req.user.sucursal_id, req.user.id] : [req.user.sucursal_id]);
  // El empleado no ve cuántas diferencias hubo: eso lo revisa el gerente
  res.json(filas.map(f => ({ ...f, productos: Number(f.productos), contados: Number(f.contados || 0), diferencias: emp ? null : Number(f.diferencias || 0) })));
}));

router.get('/:id', ah(async (req, res) => {
  const c = await conteoDe(req.params.id, req.user);
  const ciego = req.user.rol === 'empleado' || (c.estado === 'Abierto' && req.query.ciego === '1');
  const partidas = await query(`SELECT cp.producto_id, p.nombre AS producto, p.codigo, p.codigo_barras, p.ubicacion, p.precio, cp.esperado, cp.contado, cp.motivo
    FROM conteo_partidas cp JOIN productos p ON p.id = cp.producto_id WHERE cp.conteo_id = ? ORDER BY p.ubicacion, p.nombre`, [c.id]);
  c.ciego = ciego;
  c.partidas = partidas.map(p => ciego ? { ...p, esperado: undefined, precio: undefined }
    : { ...p, diferencia: p.contado === null ? null : p.contado - p.esperado, importe: p.contado === null ? null : Math.round((p.contado - p.esperado) * Number(p.precio) * 100) / 100 });
  res.json(c);
}));

// POST /api/conteos { producto_ids: [], asignado_a, origen }
router.post('/', permitir('dueno'), ah(async (req, res) => {
  const sid = req.user.sucursal_id;
  const ids = [...new Set((Array.isArray(req.body.producto_ids) ? req.body.producto_ids : []).map(Number).filter(Boolean))];
  if(!ids.length) throw new HttpError(400, 'Elige al menos un medicamento para contar.');
  if(ids.length > 60) throw new HttpError(400, 'Un conteo admite hasta 60 medicamentos; divide el trabajo en varios conteos.');
  let asignado = null;
  if(req.body.asignado_a){
    const [u] = await query(`SELECT id FROM usuarios WHERE id = ? AND sucursal_id = ? AND estado = 'Activo'`, [req.body.asignado_a, sid]);
    if(!u) throw new HttpError(400, 'La persona asignada no pertenece a tu sucursal.');
    asignado = u.id;
  }
  const productos = (await productosConStock(sid)).filter(p => ids.includes(p.id));
  if(productos.length !== ids.length) throw new HttpError(400, 'Algún medicamento no existe en tu sucursal.');
  const enCurso = await query(`SELECT p.nombre FROM conteo_partidas cp JOIN conteos c ON c.id = cp.conteo_id JOIN productos p ON p.id = cp.producto_id
    WHERE c.sucursal_id = ? AND c.estado IN ('Abierto','Por revisar') AND cp.producto_id IN (?)`, [sid, ids]);
  if(enCurso.length) throw new HttpError(409, `${enCurso.map(e => e.nombre).slice(0, 3).join(', ')} ya está${enCurso.length > 1 ? 'n' : ''} en un conteo sin cerrar.`);
  const motivos = req.body.motivos || {};
  const id = await transaction(async conn => {
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM conteos WHERE sucursal_id = ?', [sid]);
    const [r] = await conn.query('INSERT INTO conteos (sucursal_id,folio,origen,creado_por,asignado_a,fecha) VALUES (?,?,?,?,?,?)',
      [sid, 'CF-' + String(n + 1).padStart(4, '0'), req.body.origen === 'IA' ? 'IA' : 'Manual', req.user.id, asignado, ahoraSQL()]);
    // Se cuenta todo lo que hay físicamente, incluidas las piezas caducadas que no se han retirado
    await conn.query('INSERT INTO conteo_partidas (conteo_id,producto_id,esperado,motivo) VALUES ?',
      [productos.map(p => [r.insertId, p.id, p.stock + p.stock_vencido, String(motivos[p.id] || '').slice(0, 200) || null])]);
    return r.insertId;
  });
  res.status(201).json({ id });
}));

// PUT /api/conteos/:id/captura { partidas: [{producto_id, contado}] }  → se puede guardar por partes
router.put('/:id/captura', ah(async (req, res) => {
  const c = await conteoDe(req.params.id, req.user);
  if(c.estado !== 'Abierto') throw new HttpError(409, 'Este conteo ya no admite capturas.');
  for(const p of Array.isArray(req.body.partidas) ? req.body.partidas : []){
    const contado = p.contado === '' || p.contado === null || p.contado === undefined ? null : Number(p.contado);
    if(contado !== null && (!Number.isInteger(contado) || contado < 0 || contado > 100000)) throw new HttpError(400, 'Las piezas contadas deben ser números enteros.');
    // Al capturar se toma la existencia de ese momento: así las ventas hechas entre que se abrió el conteo
    // y que se contó la casilla no aparecen como faltantes.
    await query(`UPDATE conteo_partidas SET contado = ?, esperado = IF(? IS NULL, esperado, (SELECT COALESCE(SUM(l.cantidad), 0) FROM lotes l WHERE l.producto_id = conteo_partidas.producto_id))
                 WHERE conteo_id = ? AND producto_id = ?`, [contado, contado, c.id, p.producto_id]);
  }
  res.json({ ok: true });
}));

// POST /api/conteos/:id/enviar  → termina la captura y pasa a revisión del gerente
router.post('/:id/enviar', ah(async (req, res) => {
  const c = await conteoDe(req.params.id, req.user);
  if(c.estado !== 'Abierto') throw new HttpError(409, 'Este conteo ya fue enviado.');
  const [{ faltan }] = await query('SELECT COUNT(*) AS faltan FROM conteo_partidas WHERE conteo_id = ? AND contado IS NULL', [c.id]);
  if(faltan) throw new HttpError(400, `Falta contar ${faltan} medicamento(s). Si no hay piezas, captura 0.`);
  await query(`UPDATE conteos SET estado = 'Por revisar' WHERE id = ?`, [c.id]);
  res.json({ ok: true });
}));

// POST /api/conteos/:id/aplicar  → ajusta las existencias a lo contado
router.post('/:id/aplicar', permitir('dueno'), ah(async (req, res) => {
  const c = await conteoDe(req.params.id, req.user), sid = req.user.sucursal_id;
  if(c.estado !== 'Por revisar') throw new HttpError(409, c.estado === 'Abierto' ? 'El conteo aún no se ha terminado de capturar.' : 'Este conteo ya está cerrado.');
  const resumen = await transaction(async conn => {
    const [partidas] = await conn.query(`SELECT cp.*, p.nombre FROM conteo_partidas cp JOIN productos p ON p.id = cp.producto_id WHERE cp.conteo_id = ?`, [c.id]);
    let ajustes = 0, sobrantes = 0, faltantes = 0; const sinLote = [];
    for(const p of partidas){
      const [lotes] = await conn.query('SELECT * FROM lotes WHERE producto_id = ? ORDER BY caducidad ASC, id ASC FOR UPDATE', [p.producto_id]);
      const actual = lotes.reduce((s, l) => s + l.cantidad, 0);
      let dif = p.contado - p.esperado;
      if(!dif) continue;
      if(dif < 0){
        let quitar = Math.min(-dif, actual);
        for(const l of lotes){
          if(!quitar) break;
          const n = Math.min(quitar, l.cantidad); if(!n) continue; quitar -= n;
          await conn.query('UPDATE lotes SET cantidad = cantidad - ? WHERE id = ?', [n, l.id]);
          await conn.query(`INSERT INTO movimientos (sucursal_id,producto_id,lote_id,tipo,cantidad,motivo,observaciones,usuario_id,fecha)
            VALUES (?,?,?,'Ajuste',?,'Faltante en conteo físico',?,?,?)`, [sid, p.producto_id, l.id, n, 'Conteo ' + c.folio, req.user.id, ahoraSQL()]);
        }
        faltantes += -dif; ajustes++;
      }else{
        // El sobrante se suma al lote vigente que caduca más tarde (el más probable de haberse contado de menos)
        const destino = [...lotes].reverse().find(l => l.caducidad >= hoyISO()) || lotes[lotes.length - 1];
        if(!destino){ sinLote.push(p.nombre); continue; }
        await conn.query('UPDATE lotes SET cantidad = cantidad + ? WHERE id = ?', [dif, destino.id]);
        await conn.query(`INSERT INTO movimientos (sucursal_id,producto_id,lote_id,tipo,cantidad,motivo,observaciones,usuario_id,fecha)
          VALUES (?,?,?,'Ajuste',?,'Sobrante en conteo físico',?,?,?)`, [sid, p.producto_id, destino.id, dif, 'Conteo ' + c.folio, req.user.id, ahoraSQL()]);
        sobrantes += dif; ajustes++;
      }
    }
    await conn.query(`UPDATE conteos SET estado = 'Aplicado', cerrado_en = ? WHERE id = ?`, [ahoraSQL(), c.id]);
    return { ajustes, sobrantes, faltantes, sinLote };
  });
  await auditar(req, 'conteo.aplicar', `Aplicó el conteo ${c.folio}: ${resumen.ajustes} ajuste(s), ${resumen.faltantes} u. faltantes y ${resumen.sobrantes} u. sobrantes.`, sid);
  res.json({ ok: true, ...resumen });
}));

// POST /api/conteos/:id/descartar | reabrir
router.post('/:id/descartar', permitir('dueno'), ah(async (req, res) => {
  const c = await conteoDe(req.params.id, req.user);
  if(!['Abierto', 'Por revisar'].includes(c.estado)) throw new HttpError(409, 'Este conteo ya está cerrado.');
  await query(`UPDATE conteos SET estado = 'Descartado', cerrado_en = ? WHERE id = ?`, [ahoraSQL(), c.id]);
  res.json({ ok: true });
}));
router.post('/:id/reabrir', permitir('dueno'), ah(async (req, res) => {
  const c = await conteoDe(req.params.id, req.user);
  if(c.estado !== 'Por revisar') throw new HttpError(409, 'Solo se puede pedir recuento de un conteo en revisión.');
  await query(`UPDATE conteos SET estado = 'Abierto' WHERE id = ?`, [c.id]);
  res.json({ ok: true });
}));

module.exports = router;
