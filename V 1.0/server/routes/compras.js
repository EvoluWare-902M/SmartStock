/* ===== /api/proveedores y /api/ordenes : compras (solo gerente) =====
   Flujo de una orden:  Borrador → Enviada → Recibida   (o Cancelada)
   - La IA puede armar los borradores: toma lo que el modelo de demanda sugiere comprar
     y lo reparte por proveedor habitual.
   - Al recibirla se capturan lote y caducidad de cada producto y se generan las entradas.
*/
const PDFDocument = require('pdfkit');
const { query, transaction } = require('../db');
const { ah, HttpError, requerido, entero, hoyISO, ahoraSQL, diasEntre, EMAIL_RE, auditar } = require('../utils');
const { LIMITES_PLAN } = require('../constants');
const { productosConStock, registrarEntrada } = require('../services/inventario');
const { recomendaciones } = require('../services/prediccion');

const proveedores = require('express').Router();
const ordenes = require('express').Router();
const dinero = n => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------------- proveedores ---------------- */
function datosProveedor(b){
  requerido(b, ['nombre']);
  const correo = String(b.correo || '').trim().toLowerCase();
  if(correo && !EMAIL_RE.test(correo)) throw new HttpError(400, 'El correo del proveedor no tiene un formato válido.');
  const dias = b.dias_entrega === undefined || b.dias_entrega === '' ? 3 : entero(b.dias_entrega, 'Los días de entrega', { min: 1 });
  if(dias > 60) throw new HttpError(400, 'Los días de entrega no pueden ser más de 60.');
  return [String(b.nombre).trim().slice(0, 120), String(b.contacto || '').trim() || null, String(b.telefono || '').trim() || null, correo || null, dias, String(b.notas || '').trim().slice(0, 255) || null];
}
async function proveedorDe(id, sid){
  const [p] = await query('SELECT * FROM proveedores WHERE id = ? AND sucursal_id = ?', [id, sid]);
  if(!p) throw new HttpError(404, 'Proveedor no encontrado.');
  return p;
}

// GET /api/proveedores → con su desempeño real: cuánto tarda y qué tanto surte completo
proveedores.get('/', ah(async (req, res) => {
  const sid = req.user.sucursal_id;
  const lista = await query(`SELECT pr.*, (SELECT COUNT(*) FROM productos p WHERE p.proveedor_id = pr.id AND p.activo = 1) AS productos
    FROM proveedores pr WHERE pr.sucursal_id = ? AND pr.activo = 1 ORDER BY pr.nombre`, [sid]);
  const hist = await query(`SELECT o.proveedor_id, o.fecha_envio, o.fecha_recepcion, SUM(op.cantidad) AS pedido, SUM(COALESCE(op.cantidad_recibida, 0)) AS recibido
    FROM ordenes_compra o JOIN orden_partidas op ON op.orden_id = o.id WHERE o.sucursal_id = ? AND o.estado = 'Recibida' GROUP BY o.id`, [sid]);
  res.json(lista.map(pr => {
    const suyas = hist.filter(h => h.proveedor_id === pr.id);
    const dias = suyas.filter(h => h.fecha_envio).map(h => diasEntre(h.fecha_envio.slice(0, 10), h.fecha_recepcion.slice(0, 10)));
    const pedido = suyas.reduce((s, h) => s + Number(h.pedido), 0), recibido = suyas.reduce((s, h) => s + Number(h.recibido), 0);
    const real = dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length * 10) / 10 : null;
    return { ...pr, ordenes_recibidas: suyas.length, entrega_real: real, cumplimiento: pedido ? Math.round(recibido / pedido * 100) : null,
      // Si en la práctica tarda distinto a lo capturado, se avisa: ese dato alimenta los mínimos sugeridos
      aviso: real !== null && Math.abs(real - pr.dias_entrega) >= 1.5 ? `En sus últimas ${suyas.length} entrega(s) tardó ${real} días en promedio, no ${pr.dias_entrega}.` : null };
  }));
}));
proveedores.post('/', ah(async (req, res) => {
  const d = datosProveedor(req.body), sid = req.user.sucursal_id;
  const [dup] = await query('SELECT id, activo FROM proveedores WHERE sucursal_id = ? AND LOWER(nombre) = LOWER(?)', [sid, d[0]]);
  if(dup && dup.activo) throw new HttpError(409, 'Ya tienes un proveedor con ese nombre.');
  if(dup){ await query('UPDATE proveedores SET contacto=?, telefono=?, correo=?, dias_entrega=?, notas=?, activo=1 WHERE id = ?', [...d.slice(1), dup.id]); return res.status(201).json({ id: dup.id }); }
  const r = await query('INSERT INTO proveedores (sucursal_id,nombre,contacto,telefono,correo,dias_entrega,notas) VALUES (?,?,?,?,?,?,?)', [sid, ...d]);
  res.status(201).json({ id: r.insertId });
}));
proveedores.put('/:id', ah(async (req, res) => {
  const p = await proveedorDe(req.params.id, req.user.sucursal_id), d = datosProveedor(req.body);
  const [dup] = await query('SELECT id FROM proveedores WHERE sucursal_id = ? AND LOWER(nombre) = LOWER(?) AND id <> ?', [req.user.sucursal_id, d[0], p.id]);
  if(dup) throw new HttpError(409, 'Ya tienes un proveedor con ese nombre.');
  await query('UPDATE proveedores SET nombre=?, contacto=?, telefono=?, correo=?, dias_entrega=?, notas=? WHERE id = ?', [...d, p.id]);
  res.json({ ok: true });
}));
proveedores.delete('/:id', ah(async (req, res) => {
  const p = await proveedorDe(req.params.id, req.user.sucursal_id);
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM ordenes_compra WHERE proveedor_id = ? AND estado IN ('Borrador','Enviada')`, [p.id]);
  if(n) throw new HttpError(409, 'Este proveedor tiene órdenes sin cerrar. Recíbelas o cancélalas primero.');
  await query('UPDATE proveedores SET activo = 0 WHERE id = ?', [p.id]);
  await query('UPDATE productos SET proveedor_id = NULL WHERE proveedor_id = ?', [p.id]);
  res.json({ ok: true });
}));

/* ---------------- órdenes de compra ---------------- */
// Recorta un motivo largo sin dejar una frase a la mitad.
function resumir(texto, max = 280){
  if(texto.length <= max) return texto;
  let out = '';
  for(const frase of texto.split(/(?<=\.)\s+/)){ if((out + ' ' + frase).trim().length > max) break; out = (out + ' ' + frase).trim(); }
  return out || texto.slice(0, max);
}
async function ordenDe(id, sid){
  const [o] = await query(`SELECT o.*, pr.nombre AS proveedor, pr.contacto, pr.telefono AS proveedor_telefono, pr.correo AS proveedor_correo, pr.dias_entrega, u.nombre AS creador
    FROM ordenes_compra o LEFT JOIN proveedores pr ON pr.id = o.proveedor_id LEFT JOIN usuarios u ON u.id = o.creada_por WHERE o.id = ? AND o.sucursal_id = ?`, [id, sid]);
  if(!o) throw new HttpError(404, 'Orden no encontrada.');
  o.partidas = await query(`SELECT op.producto_id, p.nombre AS producto, p.codigo, p.requiere_receta, op.cantidad, op.costo_unitario, op.cantidad_recibida, op.motivo,
      op.cantidad * op.costo_unitario AS importe FROM orden_partidas op JOIN productos p ON p.id = op.producto_id WHERE op.orden_id = ? ORDER BY p.nombre`, [o.id]);
  o.total = Math.round(o.partidas.reduce((s, p) => s + Number(p.importe), 0) * 100) / 100;
  if(o.estado === 'Enviada' && o.dias_entrega){
    const dias = diasEntre(o.fecha_envio.slice(0, 10), hoyISO());
    o.espera = { dias, retraso: Math.max(0, dias - o.dias_entrega) };
  }
  return o;
}
async function siguienteFolio(conn, sid){
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM ordenes_compra WHERE sucursal_id = ?', [sid]);
  return 'OC-' + String(n + 1).padStart(4, '0');
}
async function ultimosCostos(sid){
  const filas = await query(`SELECT l.producto_id, l.costo_unitario FROM lotes l JOIN productos p ON p.id = l.producto_id WHERE p.sucursal_id = ? ORDER BY l.fecha_entrada DESC, l.id DESC`, [sid]);
  const c = {}; filas.forEach(f => { if(c[f.producto_id] === undefined) c[f.producto_id] = Number(f.costo_unitario); });
  return c;
}
// Valida las partidas que manda el navegador contra el catálogo de la sucursal.
async function partidasValidas(lista, sid){
  if(!Array.isArray(lista) || !lista.length) throw new HttpError(400, 'La orden necesita al menos un medicamento.');
  const catalogo = Object.fromEntries((await productosConStock(sid)).map(p => [p.id, p]));
  const vistas = new Set();
  return lista.map(p => {
    const id = Number(p.producto_id);
    if(!catalogo[id]) throw new HttpError(400, 'Algún medicamento de la orden no existe en tu sucursal.');
    if(vistas.has(id)) throw new HttpError(400, `${catalogo[id].nombre} está repetido en la orden.`);
    vistas.add(id);
    const costo = Number(p.costo_unitario) || 0;
    if(costo < 0) throw new HttpError(400, 'El costo no puede ser negativo.');
    return [id, entero(p.cantidad, 'La cantidad', { min: 1 }), costo, String(p.motivo || '').slice(0, 300) || null];
  });
}

ordenes.get('/', ah(async (req, res) => {
  const filas = await query(`SELECT o.id, o.folio, o.estado, o.origen, o.fecha, o.fecha_envio, o.fecha_recepcion, pr.nombre AS proveedor, pr.dias_entrega,
      COUNT(op.id) AS productos, COALESCE(SUM(op.cantidad), 0) AS unidades, COALESCE(SUM(op.cantidad * op.costo_unitario), 0) AS total
    FROM ordenes_compra o LEFT JOIN proveedores pr ON pr.id = o.proveedor_id LEFT JOIN orden_partidas op ON op.orden_id = o.id
    WHERE o.sucursal_id = ? GROUP BY o.id ORDER BY FIELD(o.estado,'Borrador','Enviada','Recibida','Cancelada'), o.fecha DESC LIMIT 100`, [req.user.sucursal_id]);
  res.json(filas.map(f => ({ ...f, productos: Number(f.productos), unidades: Number(f.unidades), total: Number(f.total),
    retraso: f.estado === 'Enviada' && f.dias_entrega ? Math.max(0, diasEntre(f.fecha_envio.slice(0, 10), hoyISO()) - f.dias_entrega) : 0 })));
}));

// POST /api/ordenes/sugerir → IA: arma borradores por proveedor con lo que hace falta comprar
ordenes.post('/sugerir', ah(async (req, res) => {
  const sid = req.user.sucursal_id;
  const [suc] = await query('SELECT plan FROM sucursales WHERE id = ?', [sid]);
  const conModelo = LIMITES_PLAN[suc.plan].analitica;
  const catalogo = await productosConStock(sid);
  const costos = await ultimosCostos(sid);
  // Con analítica: lo que calcula el modelo de demanda. Sin ella: regla simple de reposición hasta el doble del mínimo.
  let necesidades = conModelo
    ? (await recomendaciones(sid)).map(r => ({ producto_id: r.producto_id, cantidad: r.cantidad, motivo: r.motivo, prioridad: r.prioridad }))
    : catalogo.filter(p => p.stock_bajo && p.stock_minimo > 0).map(p => ({ producto_id: p.id, cantidad: Math.max(1, p.stock_minimo * 2 - p.stock), prioridad: 'Alta',
        motivo: `Stock actual (${p.stock} u.) en o por debajo del mínimo (${p.stock_minimo} u.). Se repone hasta el doble del mínimo.` }));
  // No se vuelve a pedir lo que ya viene en camino o está en otro borrador
  const enCamino = await query(`SELECT op.producto_id, SUM(op.cantidad) AS u FROM orden_partidas op JOIN ordenes_compra o ON o.id = op.orden_id
    WHERE o.sucursal_id = ? AND o.estado IN ('Borrador','Enviada') GROUP BY op.producto_id`, [sid]);
  const yaPedido = Object.fromEntries(enCamino.map(e => [e.producto_id, Number(e.u)]));
  let omitidos = 0;
  necesidades = necesidades.map(n => ({ ...n, cantidad: n.cantidad - (yaPedido[n.producto_id] || 0) })).filter(n => { if(n.cantidad <= 0){ omitidos++; return false; } return true; });
  if(!necesidades.length) return res.json({ creadas: [], omitidos, conModelo, mensaje: omitidos ? 'Todo lo que hace falta ya está en una orden sin recibir.' : 'Por ahora no hace falta comprar: las existencias cubren la demanda estimada.' });

  const porId = Object.fromEntries(catalogo.map(p => [p.id, p]));
  const grupos = {};
  necesidades.forEach(n => (grupos[porId[n.producto_id].proveedor_id || 0] = grupos[porId[n.producto_id].proveedor_id || 0] || []).push(n));
  const creadas = await transaction(async conn => {
    const ids = [];
    for(const [provId, lista] of Object.entries(grupos)){
      const [r] = await conn.query(`INSERT INTO ordenes_compra (sucursal_id,folio,proveedor_id,origen,notas,creada_por,fecha) VALUES (?,?,?,'IA',?,?,?)`,
        [sid, await siguienteFolio(conn, sid), Number(provId) || null,
         conModelo ? 'Generada con el modelo de predicción de demanda.' : 'Generada con la regla de reposición por stock mínimo.', req.user.id, ahoraSQL()]);
      await conn.query('INSERT INTO orden_partidas (orden_id,producto_id,cantidad,costo_unitario,motivo) VALUES ?',
        [lista.map(n => [r.insertId, n.producto_id, n.cantidad, costos[n.producto_id] || 0, resumir(n.motivo)])]);
      ids.push(r.insertId);
    }
    return ids;
  });
  res.status(201).json({ creadas, omitidos, conModelo, sinProveedor: (grupos[0] || []).length });
}));

ordenes.get('/:id', ah(async (req, res) => res.json(await ordenDe(req.params.id, req.user.sucursal_id))));

ordenes.post('/', ah(async (req, res) => {
  const sid = req.user.sucursal_id, b = req.body;
  if(b.proveedor_id) await proveedorDe(b.proveedor_id, sid);
  const partidas = await partidasValidas(b.partidas, sid);
  const id = await transaction(async conn => {
    const [r] = await conn.query('INSERT INTO ordenes_compra (sucursal_id,folio,proveedor_id,notas,creada_por,fecha) VALUES (?,?,?,?,?,?)',
      [sid, await siguienteFolio(conn, sid), b.proveedor_id || null, String(b.notas || '').slice(0, 255) || null, req.user.id, ahoraSQL()]);
    await conn.query('INSERT INTO orden_partidas (orden_id,producto_id,cantidad,costo_unitario,motivo) VALUES ?', [partidas.map(p => [r.insertId, ...p])]);
    return r.insertId;
  });
  res.status(201).json({ id });
}));

// PUT /api/ordenes/:id → editar un borrador (proveedor, notas y partidas completas)
ordenes.put('/:id', ah(async (req, res) => {
  const sid = req.user.sucursal_id, b = req.body;
  const o = await ordenDe(req.params.id, sid);
  if(o.estado !== 'Borrador') throw new HttpError(409, 'Solo se pueden editar las órdenes en borrador.');
  if(b.proveedor_id) await proveedorDe(b.proveedor_id, sid);
  const partidas = await partidasValidas(b.partidas, sid);
  await transaction(async conn => {
    await conn.query('UPDATE ordenes_compra SET proveedor_id = ?, notas = ? WHERE id = ?', [b.proveedor_id || null, String(b.notas || '').slice(0, 255) || null, o.id]);
    await conn.query('DELETE FROM orden_partidas WHERE orden_id = ?', [o.id]);
    await conn.query('INSERT INTO orden_partidas (orden_id,producto_id,cantidad,costo_unitario,motivo) VALUES ?', [partidas.map(p => [o.id, ...p])]);
  });
  res.json({ ok: true });
}));

ordenes.post('/:id/enviar', ah(async (req, res) => {
  const o = await ordenDe(req.params.id, req.user.sucursal_id);
  if(o.estado !== 'Borrador') throw new HttpError(409, 'Esta orden ya fue enviada.');
  if(!o.proveedor_id) throw new HttpError(400, 'Elige el proveedor antes de enviar la orden.');
  await query(`UPDATE ordenes_compra SET estado = 'Enviada', fecha_envio = ? WHERE id = ?`, [ahoraSQL(), o.id]);
  res.json({ ok: true });
}));

ordenes.post('/:id/cancelar', ah(async (req, res) => {
  const o = await ordenDe(req.params.id, req.user.sucursal_id);
  if(!['Borrador', 'Enviada'].includes(o.estado)) throw new HttpError(409, 'Esta orden ya está cerrada.');
  await query(`UPDATE ordenes_compra SET estado = 'Cancelada' WHERE id = ?`, [o.id]);
  res.json({ ok: true });
}));

// POST /api/ordenes/:id/recibir { factura, partidas: [{producto_id, cantidad, numero_lote, caducidad, costo_unitario}] }
// cantidad 0 = ese producto no llegó. Genera las entradas con su lote.
ordenes.post('/:id/recibir', ah(async (req, res) => {
  const sid = req.user.sucursal_id, b = req.body;
  const o = await ordenDe(req.params.id, sid);
  if(o.estado !== 'Enviada') throw new HttpError(409, o.estado === 'Borrador' ? 'Primero marca la orden como enviada al proveedor.' : 'Esta orden ya está cerrada.');
  const recibidas = new Map((Array.isArray(b.partidas) ? b.partidas : []).map(p => [Number(p.producto_id), p]));
  const hoy = hoyISO();
  for(const p of o.partidas){
    const r = recibidas.get(p.producto_id);
    if(!r) throw new HttpError(400, `Falta indicar cuánto llegó de ${p.producto} (captura 0 si no llegó).`);
    r.cantidad = entero(r.cantidad, `La cantidad recibida de ${p.producto}`);
    if(r.cantidad > 0){
      if(!String(r.numero_lote || '').trim() || !r.caducidad) throw new HttpError(400, `Captura el lote y la caducidad de ${p.producto}.`);
      if(r.caducidad <= hoy) throw new HttpError(400, `La caducidad de ${p.producto} ya pasó: no lo recibas.`);
    }
  }
  const factura = String(b.factura || '').trim() || null;
  const total = await transaction(async conn => {
    let unidades = 0;
    for(const p of o.partidas){
      const r = recibidas.get(p.producto_id);
      await conn.query('UPDATE orden_partidas SET cantidad_recibida = ? WHERE orden_id = ? AND producto_id = ?', [r.cantidad, o.id, p.producto_id]);
      if(!r.cantidad) continue;
      await registrarEntrada(conn, { sucursalId: sid, productoId: p.producto_id, numeroLote: r.numero_lote, caducidad: r.caducidad, cantidad: r.cantidad,
        costo: r.costo_unitario === undefined || r.costo_unitario === '' ? p.costo_unitario : r.costo_unitario, factura, proveedor: o.proveedor, usuarioId: req.user.id, observaciones: 'Orden ' + o.folio });
      unidades += r.cantidad;
    }
    await conn.query(`UPDATE ordenes_compra SET estado = 'Recibida', fecha_recepcion = ? WHERE id = ?`, [ahoraSQL(), o.id]);
    return unidades;
  });
  await auditar(req, 'orden.recibir', `Recibió la orden ${o.folio} de ${o.proveedor}: ${total} unidades.`, sid);
  res.json({ ok: true, unidades: total });
}));

// GET /api/ordenes/:id/pdf → documento para mandar al proveedor
ordenes.get('/:id/pdf', ah(async (req, res) => {
  const o = await ordenDe(req.params.id, req.user.sucursal_id);
  const [s] = await query('SELECT nombre, direccion, telefono, rfc, razon_social FROM sucursales WHERE id = ?', [req.user.sucursal_id]);
  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${o.folio}.pdf"`);
  doc.pipe(res);
  doc.fillColor('#103A8C').font('Helvetica-Bold').fontSize(20).text('Orden de compra ' + o.folio);
  doc.font('Helvetica').fontSize(9).fillColor('#4A6079').text(`Fecha: ${o.fecha.slice(0, 10)}   ·   Estado: ${o.estado}   ·   Generada con SmartStock`);
  doc.moveDown();
  const y0 = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0B1D3A').text('Solicita', 40, y0);
  doc.font('Helvetica').fontSize(9).text([s.razon_social || s.nombre, s.rfc ? 'RFC ' + s.rfc : null, s.direccion, 'Tel. ' + s.telefono].filter(Boolean).join('\n'), 40, y0 + 14, { width: 250 });
  doc.font('Helvetica-Bold').fontSize(10).text('Proveedor', 320, y0);
  doc.font('Helvetica').fontSize(9).text([o.proveedor || 'Sin proveedor asignado', o.contacto ? 'Atención: ' + o.contacto : null, o.proveedor_telefono ? 'Tel. ' + o.proveedor_telefono : null, o.proveedor_correo].filter(Boolean).join('\n'), 320, y0 + 14, { width: 250 });
  doc.y = y0 + 80;
  const cols = [['Código', 60], ['Medicamento', 252], ['Cantidad', 60], ['Costo unitario', 80], ['Importe', 80]];
  let y = doc.y, x = 40;
  doc.rect(40, y - 2, 532, 16).fill('#DEF7FF'); doc.font('Helvetica-Bold').fontSize(8).fillColor('#0A2A6B');
  cols.forEach(([t, w]) => { doc.text(t, x + 3, y + 2, { width: w - 6, lineBreak: false }); x += w; });
  y += 18; doc.font('Helvetica').fontSize(9).fillColor('#0B1D3A');
  for(const p of o.partidas){
    if(y > 720){ doc.addPage(); y = 40; }
    x = 40;
    [p.codigo, p.producto, p.cantidad + ' u.', dinero(p.costo_unitario), dinero(p.importe)].forEach((v, i) => { doc.text(String(v), x + 3, y, { width: cols[i][1] - 6, lineBreak: false, ellipsis: true }); x += cols[i][1]; });
    y += 15;
  }
  doc.font('Helvetica-Bold').fontSize(10).text('Total estimado: ' + dinero(o.total), 40, y + 8, { width: 532, align: 'right' });
  if(o.notas) doc.font('Helvetica').fontSize(9).fillColor('#4A6079').text('Notas: ' + o.notas, 40, y + 30, { width: 532 });
  doc.end();
}));

module.exports = { proveedores, ordenes };
