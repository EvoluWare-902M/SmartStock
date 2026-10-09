/* ===== /api/reportes : indicadores y exportación PDF / Excel (HU-13) ===== */
const router = require('express').Router();
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { query } = require('../db');
const { ah, HttpError, hoyISO } = require('../utils');
const { productosConStock, lotesSucursal } = require('../services/inventario');
const { recomendaciones, ventasMensuales } = require('../services/prediccion');
const { DIAS_ALERTA_CADUCIDAD, LIMITES_PLAN } = require('../constants');

const dinero = n => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const haceDias = n => { const d = new Date(hoyISO() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

// ---------- GET /api/reportes/resumen : dashboard de indicadores ----------
router.get('/resumen', ah(async (req, res) => {
  const sid = req.user.sucursal_id;
  const productos = await productosConStock(sid);
  const lotes = await lotesSucursal(sid);
  const desde30 = haceDias(30) + ' 00:00:00';
  const [ventas] = await query(`SELECT COALESCE(SUM(m.cantidad),0) AS unidades, COALESCE(SUM(m.cantidad * p.precio),0) AS importe
                                FROM movimientos m JOIN productos p ON p.id = m.producto_id
                                WHERE m.sucursal_id = ? AND m.tipo = 'Salida' AND m.motivo = 'Venta' AND m.fecha >= ?`, [sid, desde30]);
  const top = await query(`SELECT p.nombre, SUM(m.cantidad) AS unidades FROM movimientos m JOIN productos p ON p.id = m.producto_id
                           WHERE m.sucursal_id = ? AND m.tipo = 'Salida' AND m.motivo = 'Venta' AND m.fecha >= ?
                           GROUP BY p.id ORDER BY unidades DESC LIMIT 5`, [sid, desde30]);
  const { periodo, series } = await ventasMensuales(sid, 'categoria', 12);
  const totalMes = periodo.map((_, i) => Object.values(series).reduce((s, arr) => s + arr[i], 0));
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  res.json({
    productos: productos.length,
    unidades: productos.reduce((s, p) => s + p.stock, 0),
    valorInventario: Math.round(productos.reduce((s, p) => s + p.stock * Number(p.precio), 0) * 100) / 100,
    stockBajo: productos.filter(p => p.stock_bajo).length,
    lotesPorVencer: lotes.filter(l => l.dias <= DIAS_ALERTA_CADUCIDAD).length,
    lotesCaducados: lotes.filter(l => l.dias < 0).length,
    ventas30: { unidades: Number(ventas.unidades), importe: Number(ventas.importe) },
    topProductos: top.map(t => ({ nombre: t.nombre, unidades: Number(t.unidades) })),
    ventasMensuales: { etiquetas: periodo.map(p => `${MESES[p.mes]} ${String(p.anio).slice(2)}`), valores: totalMes },
  });
}));

// ---------- construcción de las secciones de cada reporte ----------
async function seccionExistencias(sid){
  const productos = await productosConStock(sid);
  return {
    titulo: 'Existencias y límites de stock',
    columnas: ['Código','Producto','Categoría','Ubicación','Existencia','Mínimo','Estado','Precio','Valor'],
    anchos: [50, 120, 70, 45, 50, 40, 55, 45, 50],
    filas: productos.map(p => [p.codigo, p.nombre, p.categoria, p.ubicacion, p.stock, p.stock_minimo,
      p.stock_bajo ? 'Stock bajo' : 'Suficiente', dinero(p.precio), dinero(p.stock * p.precio)]),
    resaltar: productos.map(p => p.stock_bajo),
  };
}
async function seccionCaducidades(sid){
  const lotes = await lotesSucursal(sid);
  return {
    titulo: 'Control de caducidades',
    columnas: ['Estado','Producto','Lote','Caducidad','Días','Cantidad','Factura','Ubicación'],
    anchos: [55, 130, 55, 60, 40, 50, 55, 50],
    filas: lotes.map(l => [l.etiqueta, l.producto, l.numero_lote, l.caducidad, l.dias, l.cantidad, l.factura || '—', l.ubicacion]),
    resaltar: lotes.map(l => l.color === 'rojo'),
  };
}
async function seccionMovimientos(sid, desde, hasta){
  const filas = await query(`
    SELECT m.fecha, m.tipo, p.nombre AS producto, l.numero_lote AS lote, m.cantidad, m.motivo, u.nombre AS responsable
    FROM movimientos m JOIN productos p ON p.id = m.producto_id
    LEFT JOIN lotes l ON l.id = m.lote_id LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.sucursal_id = ? AND m.fecha >= ? AND m.fecha <= ?
    ORDER BY m.fecha DESC LIMIT 2000`, [sid, desde + ' 00:00:00', hasta + ' 23:59:59']);
  return {
    titulo: `Movimientos del ${desde} al ${hasta}`,
    columnas: ['Fecha','Tipo','Producto','Lote','Cantidad','Motivo','Responsable'],
    anchos: [80, 45, 120, 50, 45, 90, 95],
    filas: filas.map(m => [m.fecha.slice(0, 16), m.tipo, m.producto, m.lote || '—', m.cantidad, m.motivo, m.responsable || '—']),
  };
}
async function seccionCompras(sid){
  const [s] = await query('SELECT plan FROM sucursales WHERE id = ?', [sid]);
  if(!LIMITES_PLAN[s.plan].analitica) throw new HttpError(403, 'La orden de compra sugerida requiere el plan Profesional o Empresarial.');
  const recos = await recomendaciones(sid);
  return {
    titulo: 'Orden de compra sugerida (modelo predictivo)',
    columnas: ['Prioridad','Producto','Categoría','Stock','Demanda est.','Comprar','Costo est.'],
    anchos: [55, 140, 80, 45, 60, 50, 70],
    filas: recos.map(r => [r.prioridad, r.producto, r.categoria, r.stock, r.demanda_estimada, r.cantidad, dinero(r.costo_estimado)]),
    resaltar: recos.map(r => r.prioridad === 'Alta'),
  };
}

const TITULOS = { general: 'Reporte general de inventario', existencias: 'Reporte de existencias',
  caducidades: 'Reporte de caducidades', movimientos: 'Reporte de movimientos', compras: 'Orden de compra sugerida' };

async function construir(tipo, sid, desde, hasta){
  switch(tipo){
    case 'existencias': return [await seccionExistencias(sid)];
    case 'caducidades': return [await seccionCaducidades(sid)];
    case 'movimientos': return [await seccionMovimientos(sid, desde, hasta)];
    case 'compras':     return [await seccionCompras(sid)];
    case 'general':     return [await seccionExistencias(sid), await seccionCaducidades(sid), await seccionMovimientos(sid, desde, hasta)];
    default: throw new HttpError(400, 'Tipo de reporte no válido.');
  }
}

// ---------- PDF ----------
function generarPDF(res, titulo, sucursal, secciones){
  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  doc.pipe(res);
  const TEAL = '#103A8C', ROJO = '#B5382E';

  try{ doc.image(require('path').join(__dirname, '..', '..', 'public', 'img', 'isotipo-azul.png'), 512, 34, { width: 60 }); }catch{ /* sin logo */ }
  doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(20).text('SmartStock');
  doc.fillColor('#0B1D3A').fontSize(14).text(titulo);
  doc.font('Helvetica').fontSize(9).fillColor('#4A6079')
     .text(`${sucursal.nombre} · ${sucursal.direccion}`).text(`Generado el ${new Date().toLocaleString('es-MX')}`);
  doc.moveDown();

  for(const s of secciones){
    if(doc.y > 650) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(12).fillColor(TEAL).text(s.titulo, 40);
    doc.moveDown(0.4);
    const total = s.anchos.reduce((a, b) => a + b, 0);
    const escala = 532 / total;
    const anchos = s.anchos.map(a => a * escala);

    const encabezado = () => {
      let x = 40; const y = doc.y;
      doc.rect(40, y - 2, 532, 16).fill('#DEF7FF');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#0A2A6B');
      s.columnas.forEach((c, i) => { doc.text(c, x + 3, y + 2, { width: anchos[i] - 6, lineBreak: false, ellipsis: true }); x += anchos[i]; });
      doc.y = y + 18;
    };
    encabezado();
    if(!s.filas.length){ doc.font('Helvetica').fontSize(9).fillColor('#4A6079').text('Sin registros.', 43); }
    s.filas.forEach((f, idx) => {
      if(doc.y > 730){ doc.addPage(); encabezado(); }
      let x = 40; const y = doc.y;
      doc.font('Helvetica').fontSize(8).fillColor(s.resaltar && s.resaltar[idx] ? ROJO : '#0B1D3A');
      f.forEach((v, i) => { doc.text(String(v ?? ''), x + 3, y, { width: anchos[i] - 6, lineBreak: false, ellipsis: true }); x += anchos[i]; });
      doc.moveTo(40, y + 12).lineTo(572, y + 12).lineWidth(0.4).strokeColor('#C9E4F2').stroke();
      doc.y = y + 15;
    });
    doc.font('Helvetica').fontSize(8).fillColor('#4A6079').text(`${s.filas.length} registro(s)`, 40);
    doc.moveDown(1.2);
  }
  doc.end();
}

// ---------- Excel ----------
async function generarExcel(res, titulo, sucursal, secciones){
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SmartStock';
  for(const s of secciones){
    const ws = wb.addWorksheet(s.titulo.slice(0, 31).replace(/[\\/?*[\]:]/g, '-'));
    ws.addRow([`SmartStock · ${titulo}`]).font = { bold: true, size: 14, color: { argb: 'FF103A8C' } };
    ws.addRow([`${sucursal.nombre} · generado el ${new Date().toLocaleString('es-MX')}`]).font = { italic: true, color: { argb: 'FF4A6079' } };
    ws.addRow([s.titulo]).font = { bold: true };
    const head = ws.addRow(s.columnas);
    head.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF103A8C' } }; });
    s.filas.forEach((f, i) => {
      const row = ws.addRow(f);
      if(s.resaltar && s.resaltar[i]) row.font = { color: { argb: 'FFB5382E' } };
    });
    s.columnas.forEach((_, i) => { ws.getColumn(i + 1).width = Math.max(10, Math.round(s.anchos[i] / 4.5)); });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
  }
  await wb.xlsx.write(res);
  res.end();
}

// ---------- GET /api/reportes/:tipo?formato=pdf|xlsx|json&desde=&hasta= ----------
router.get('/:tipo', ah(async (req, res) => {
  const sid = req.user.sucursal_id;
  const tipo = req.params.tipo;
  const hasta = req.query.hasta || hoyISO();
  const desde = req.query.desde || haceDias(30);
  if(desde > hasta) throw new HttpError(400, 'La fecha "desde" no puede ser posterior a "hasta".');
  const secciones = await construir(tipo, sid, desde, hasta);
  const [sucursal] = await query('SELECT nombre, direccion FROM sucursales WHERE id = ?', [sid]);
  const titulo = TITULOS[tipo];
  const archivo = `smartstock-${tipo}-${hoyISO()}`;

  if(req.query.formato === 'pdf'){
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${archivo}.pdf"`);
    return generarPDF(res, titulo, sucursal, secciones);
  }
  if(req.query.formato === 'xlsx'){
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${archivo}.xlsx"`);
    return generarExcel(res, titulo, sucursal, secciones);
  }
  res.json({ titulo, sucursal, secciones });
}));

module.exports = router;
