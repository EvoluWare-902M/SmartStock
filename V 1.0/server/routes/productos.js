/* ===== /api/productos : catálogo de medicamentos (HU-1, HU-2) ===== */
const router = require('express').Router();
const { query, transaction } = require('../db');
const { permitir } = require('../middleware/auth');
const { ah, HttpError, requerido, entero, hoyISO, ahoraSQL } = require('../utils');
const { CATEGORIAS, PRESENTACIONES, UBICACIONES, LIMITES_PLAN } = require('../constants');
const { productosConStock, lotesDeProducto } = require('../services/inventario');
const { buscarAproximado } = require('../services/ia');

async function siguienteCodigo(sucursalId){
  const [r] = await query(`SELECT MAX(CAST(SUBSTRING(codigo, 5) AS UNSIGNED)) AS n FROM productos
                           WHERE sucursal_id = ? AND codigo LIKE 'MED-%'`, [sucursalId]);
  return 'MED-' + String((r.n || 0) + 1).padStart(3, '0');
}

function validarCampos(b){
  if(b.categoria !== undefined && !CATEGORIAS.includes(b.categoria)) throw new HttpError(400, 'Categoría no válida.');
  if(b.presentacion !== undefined && !PRESENTACIONES.includes(b.presentacion)) throw new HttpError(400, 'Presentación no válida.');
  if(b.ubicacion !== undefined && !UBICACIONES.includes(String(b.ubicacion).toUpperCase())) throw new HttpError(400, 'Ubicación de anaquel no válida.');
  if(b.codigo_barras && !/^\d{8,14}$/.test(String(b.codigo_barras).trim())) throw new HttpError(400, 'El código de barras debe tener entre 8 y 14 dígitos.');
}
// Código de barras único por sucursal y proveedor que sí sea de la sucursal.
async function validarVinculos(b, sid, excluirId = 0){
  if(b.codigo_barras){
    const [d] = await query('SELECT nombre FROM productos WHERE sucursal_id = ? AND activo = 1 AND codigo_barras = ? AND id <> ?', [sid, String(b.codigo_barras).trim(), excluirId]);
    if(d) throw new HttpError(409, `Ese código de barras ya está asignado a ${d.nombre}.`);
  }
  if(b.proveedor_id){
    const [pr] = await query('SELECT id FROM proveedores WHERE id = ? AND sucursal_id = ?', [b.proveedor_id, sid]);
    if(!pr) throw new HttpError(400, 'El proveedor no existe en tu sucursal.');
  }
}

async function productoDeSucursal(id, sucursalId){
  const [p] = await query('SELECT * FROM productos WHERE id = ? AND sucursal_id = ? AND activo = 1', [id, sucursalId]);
  if(!p) throw new HttpError(404, 'El medicamento no existe en tu sucursal.');
  return p;
}

// GET /api/productos?q=texto&categoria=X
// Búsqueda por nombre, sustancia activa o código.
router.get('/', ah(async (req, res) => {
  const todos = await productosConStock(req.user.sucursal_id);
  let lista = todos;
  const q = String(req.query.q || '').trim().toLowerCase();
  if(q){
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const nq = norm(q);
    lista = lista.filter(p => norm(p.nombre).includes(nq) || norm(p.sustancia).includes(nq) || norm(p.codigo).includes(nq) || (p.codigo_barras && p.codigo_barras === q));
    // Los que empiezan con el texto buscado aparecen primero
    lista.sort((a, b) => (norm(b.nombre).startsWith(nq) - norm(a.nombre).startsWith(nq)));
    // IA: si no hubo coincidencia exacta, se proponen los más parecidos (tolera errores de escritura)
    if(!lista.length && nq.length >= 3) lista = buscarAproximado(todos, q);
  }
  if(req.query.categoria) lista = lista.filter(p => p.categoria === req.query.categoria);
  res.json(lista);
}));

// GET /api/productos/:id  → detalle con sus lotes (FEFO)
router.get('/:id', ah(async (req, res) => {
  const [p] = await productosConStock(req.user.sucursal_id, { productoId: Number(req.params.id) });
  if(!p) throw new HttpError(404, 'El medicamento no existe en tu sucursal.');
  p.lotes = await lotesDeProducto(p.id);
  res.json(p);
}));

// POST /api/productos  → alta de medicamento + lote inicial (solo dueño)
router.post('/', permitir('dueno'), ah(async (req, res) => {
  const b = req.body;
  requerido(b, ['nombre','categoria','presentacion','ubicacion','stock_minimo','numero_lote','caducidad','cantidad']);
  validarCampos(b);
  const minimo = entero(b.stock_minimo, 'El stock mínimo');
  const cantidad = entero(b.cantidad, 'La cantidad inicial', { min: 1 });
  if(b.caducidad <= hoyISO()) throw new HttpError(400, 'La fecha de caducidad debe ser posterior a hoy.');

  const sid = req.user.sucursal_id;
  const [suc] = await query('SELECT plan FROM sucursales WHERE id = ?', [sid]);
  const tope = LIMITES_PLAN[suc.plan].medicamentos;
  if(tope){
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM productos WHERE sucursal_id = ? AND activo = 1', [sid]);
    if(n >= tope) throw new HttpError(403, `Tu plan ${suc.plan} permite hasta ${tope} medicamentos. Solicita un cambio de plan en "Mi sucursal".`);
  }
  const codigo = String(b.codigo || '').trim().toUpperCase() || await siguienteCodigo(sid);
  const [dup] = await query('SELECT id FROM productos WHERE sucursal_id = ? AND codigo = ?', [sid, codigo]);
  if(dup) throw new HttpError(409, `Ya existe un medicamento con el código ${codigo}.`);
  const [dupNombre] = await query('SELECT id FROM productos WHERE sucursal_id = ? AND activo = 1 AND LOWER(nombre) = LOWER(?)', [sid, b.nombre.trim()]);
  if(dupNombre) throw new HttpError(409, 'Ya existe un medicamento registrado con ese nombre.');

  await validarVinculos(b, sid);

  const id = await transaction(async conn => {
    const [r] = await conn.query(`INSERT INTO productos (sucursal_id,codigo,codigo_barras,proveedor_id,nombre,sustancia,laboratorio,categoria,presentacion,concentracion,requiere_receta,ubicacion,stock_minimo,precio)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [sid, codigo, String(b.codigo_barras || '').trim() || null, b.proveedor_id || null, b.nombre.trim(), b.sustancia || null, b.laboratorio || null, b.categoria, b.presentacion, b.concentracion || null,
       b.requiere_receta ? 1 : 0, String(b.ubicacion).toUpperCase(), minimo, Number(b.precio) || 0]);
    const [l] = await conn.query(`INSERT INTO lotes (producto_id,numero_lote,caducidad,cantidad,costo_unitario,factura,proveedor,fecha_entrada)
      VALUES (?,?,?,?,?,?,?,?)`, [r.insertId, b.numero_lote.trim(), b.caducidad, cantidad, Number(b.costo_unitario) || 0, b.factura || null, b.proveedor || null, hoyISO()]);
    await conn.query(`INSERT INTO movimientos (sucursal_id,producto_id,lote_id,tipo,cantidad,motivo,proveedor,factura,usuario_id,fecha)
      VALUES (?,?,?,'Entrada',?,'Alta de medicamento (lote inicial)',?,?,?,?)`,
      [sid, r.insertId, l.insertId, cantidad, b.proveedor || null, b.factura || null, req.user.id, ahoraSQL()]);
    return r.insertId;
  });
  const [p] = await productosConStock(sid, { productoId: id });
  res.status(201).json(p);
}));

// PUT /api/productos/:id  → editar datos, ubicación o stock mínimo (solo dueño)
router.put('/:id', permitir('dueno'), ah(async (req, res) => {
  const sid = req.user.sucursal_id;
  const actual = await productoDeSucursal(req.params.id, sid);
  const b = req.body;
  validarCampos(b);
  await validarVinculos(b, sid, actual.id);
  const campos = {
    codigo_barras: b.codigo_barras === undefined ? actual.codigo_barras : (String(b.codigo_barras || '').trim() || null),
    proveedor_id: b.proveedor_id === undefined ? actual.proveedor_id : (b.proveedor_id || null),
    nombre: b.nombre?.trim() || actual.nombre,
    sustancia: b.sustancia ?? actual.sustancia,
    laboratorio: b.laboratorio ?? actual.laboratorio,
    categoria: b.categoria ?? actual.categoria,
    presentacion: b.presentacion ?? actual.presentacion,
    concentracion: b.concentracion ?? actual.concentracion,
    requiere_receta: b.requiere_receta === undefined ? actual.requiere_receta : (b.requiere_receta ? 1 : 0),
    ubicacion: b.ubicacion ? String(b.ubicacion).toUpperCase() : actual.ubicacion,
    stock_minimo: b.stock_minimo === undefined ? actual.stock_minimo : entero(b.stock_minimo, 'El stock mínimo'),
    precio: b.precio === undefined ? actual.precio : (Number(b.precio) || 0),
  };
  await query(`UPDATE productos SET codigo_barras=?, proveedor_id=?, nombre=?, sustancia=?, laboratorio=?, categoria=?, presentacion=?, concentracion=?,
               requiere_receta=?, ubicacion=?, stock_minimo=?, precio=? WHERE id = ?`, [...Object.values(campos), actual.id]);
  const [p] = await productosConStock(sid, { productoId: actual.id });
  res.json(p);
}));

// DELETE /api/productos/:id  → baja lógica (se conserva su historial)
router.delete('/:id', permitir('dueno'), ah(async (req, res) => {
  const p = await productoDeSucursal(req.params.id, req.user.sucursal_id);
  await query('UPDATE productos SET activo = 0 WHERE id = ?', [p.id]);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.productoDeSucursal = productoDeSucursal;
