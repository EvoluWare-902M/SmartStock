/* ===== /api/productos/importar : alta masiva de medicamentos desde Excel (solo gerente) =====
   1. GET  /plantilla  → archivo de ejemplo.
   2. POST /analizar   → se sube el .xlsx; el servidor reconoce las columnas aunque tengan otros
                          nombres, completa con IA lo que falte (categoría, presentación, receta,
                          ubicación) y marca errores y duplicados. No guarda nada.
   3. POST /           → se confirman las filas revisadas y se dan de alta.
*/
const express = require('express');
const ExcelJS = require('exceljs');
const router = express.Router();
const { query, transaction } = require('../db');
const { ah, HttpError, hoyISO, ahoraSQL, auditar } = require('../utils');
const { CATEGORIAS, PRESENTACIONES, UBICACIONES, LIMITES_PLAN } = require('../constants');
const { productosConStock } = require('../services/inventario');
const ia = require('../services/ia');
const { clasificar, ubicacionSugerida } = require('../services/operacion');

// Campo del sistema → nombres con los que suele venir la columna
const COLUMNAS = {
  nombre: ['nombre', 'medicamento', 'producto', 'descripcion', 'articulo', 'nombre comercial'],
  sustancia: ['sustancia', 'sustancia activa', 'principio activo', 'activo', 'generico', 'formula'],
  laboratorio: ['laboratorio', 'marca', 'fabricante', 'lab'],
  categoria: ['categoria', 'familia', 'clasificacion', 'grupo', 'departamento', 'linea'],
  presentacion: ['presentacion', 'forma farmaceutica', 'forma', 'tipo'],
  concentracion: ['concentracion', 'dosis', 'gramaje', 'contenido'],
  requiere_receta: ['receta', 'requiere receta', 'con receta', 'controlado', 'antibiotico'],
  ubicacion: ['ubicacion', 'anaquel', 'casilla', 'posicion', 'estante', 'repisa'],
  stock_minimo: ['stock minimo', 'minimo', 'min', 'punto de reorden', 'existencia minima'],
  precio: ['precio', 'precio venta', 'precio publico', 'pvp', 'precio de venta'],
  codigo_barras: ['codigo de barras', 'codigo barras', 'barras', 'ean', 'upc', 'sku', 'codigo'],
  proveedor: ['proveedor', 'distribuidor', 'mayorista'],
  numero_lote: ['lote', 'numero de lote', 'no lote', 'num lote'],
  caducidad: ['caducidad', 'vencimiento', 'fecha de caducidad', 'expira', 'vence', 'fecha caducidad'],
  cantidad: ['cantidad', 'existencia', 'existencias', 'stock', 'piezas', 'unidades', 'inventario'],
  costo_unitario: ['costo', 'costo unitario', 'precio compra', 'precio de compra', 'costo compra'],
};

// Empareja cada encabezado del archivo con el campo más parecido (tolera acentos, mayúsculas y faltas).
function reconocerColumnas(encabezados){
  const candidatos = [];
  encabezados.forEach((h, col) => {
    const t = ia.norm(h).replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
    if(!t) return;
    for(const [campo, nombres] of Object.entries(COLUMNAS)) for(const n of nombres){
      const s = t === n ? 1 : 1 - ia.distancia(t, n) / Math.max(t.length, n.length);
      if(s >= 0.78) candidatos.push({ campo, col, s, h });
    }
  });
  const mapa = {}, usadas = new Set();
  candidatos.sort((a, b) => b.s - a.s).forEach(c => { if(mapa[c.campo] === undefined && !usadas.has(c.col)){ mapa[c.campo] = c; usadas.add(c.col); } });
  return { mapa, sinUsar: encabezados.filter((h, i) => String(h || '').trim() && !usadas.has(i)) };
}

const texto = v => v === null || v === undefined ? '' : String(typeof v === 'object' && v.text !== undefined ? v.text : typeof v === 'object' && v.result !== undefined ? v.result : v).trim();
function fechaISO(v){
  if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const t = texto(v); let m;
  if((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if((m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;      // día/mes/año
  if((m = t.match(/^(\d{1,2})[/-](\d{4})$/))) return `${m[2]}-${m[1].padStart(2, '0')}-${new Date(Number(m[2]), Number(m[1]), 0).getDate()}`; // mes/año → fin de mes
  return t ? null : '';
}
const enLista = (valor, lista) => { const n = ia.norm(valor); if(!n) return null;
  return lista.map(x => ({ x, s: ia.norm(x) === n ? 1 : Math.max(ia.similitud(n, x), ia.norm(x).startsWith(n.slice(0, 4)) ? 0.8 : 0) })).sort((a, b) => b.s - a.s).find(c => c.s >= 0.75)?.x || null; };

// Revisa una fila ya convertida a campos del sistema. `catalogo` crece con las filas aceptadas del propio archivo.
function revisarFila(d, catalogo, proveedores){
  const errores = [], avisos = [], sugerido = [];
  const f = { ...d };
  f.nombre = texto(f.nombre).slice(0, 120);
  if(!f.nombre){ return { datos: f, errores: ['Falta el nombre del medicamento.'], avisos, sugerido, estado: 'error' }; }
  const igual = catalogo.find(p => ia.norm(p.nombre) === ia.norm(f.nombre));
  if(igual) return { datos: f, errores: [], avisos: [igual.deArchivo ? 'Está repetido en el archivo.' : 'Ya existe en tu catálogo.'], sugerido, estado: 'duplicado' };

  const c = clasificar(f.nombre + ' ' + texto(f.sustancia), catalogo) || {};
  if(c.parecido && c.parecido.similitud >= 88) avisos.push(`Se parece mucho a "${c.parecido.nombre}" (${c.parecido.similitud} %): confirma que no sea el mismo.`);
  const completar = (campo, valor) => { if(valor !== null && valor !== undefined && valor !== ''){ f[campo] = valor; sugerido.push(campo); } };

  f.sustancia = texto(f.sustancia) || undefined; if(!f.sustancia) completar('sustancia', c.sustancia);
  const cat = enLista(f.categoria, CATEGORIAS);
  if(cat) f.categoria = cat; else { if(texto(f.categoria)) avisos.push(`La categoría "${texto(f.categoria)}" no existe en SmartStock.`); f.categoria = undefined; completar('categoria', c.categoria || 'Otro'); }
  const pres = enLista(f.presentacion, PRESENTACIONES);
  if(pres) f.presentacion = pres; else { f.presentacion = undefined; completar('presentacion', c.presentacion || 'Tableta'); if(!c.presentacion) avisos.push('No pude deducir la presentación: se propone Tableta.'); }
  f.concentracion = texto(f.concentracion) || undefined; if(!f.concentracion) completar('concentracion', c.concentracion);
  const rec = ia.norm(f.requiere_receta);
  if(rec) f.requiere_receta = /^(si|s|x|1|true|verdadero|yes)$/.test(rec); else { f.requiere_receta = undefined; completar('requiere_receta', !!c.requiere_receta); }
  const ubi = texto(f.ubicacion).toUpperCase().replace(/[\s-]/g, '');
  if(UBICACIONES.includes(ubi)) f.ubicacion = ubi; else { if(ubi) avisos.push(`La ubicación "${ubi}" no existe en el anaquel.`); f.ubicacion = undefined; completar('ubicacion', ubicacionSugerida(catalogo, f.categoria)); }

  const numero = (campo, etiqueta, { entero = false, def = 0 } = {}) => {
    const t = texto(f[campo]).replace(/[$,\s]/g, '');
    if(!t){ f[campo] = def; return; }
    const n = Number(t);
    if(!Number.isFinite(n) || n < 0 || (entero && !Number.isInteger(n))) errores.push(`${etiqueta} no es un número válido ("${texto(f[campo])}").`); else f[campo] = n;
  };
  numero('precio', 'El precio'); numero('costo_unitario', 'El costo'); numero('stock_minimo', 'El stock mínimo', { entero: true }); numero('cantidad', 'La cantidad', { entero: true });
  if(!texto(d.stock_minimo)) { f.stock_minimo = 5; sugerido.push('stock_minimo'); }

  f.codigo_barras = texto(f.codigo_barras).replace(/\D/g, '') || null;
  if(f.codigo_barras && !/^\d{8,14}$/.test(f.codigo_barras)){ avisos.push('El código de barras no tiene entre 8 y 14 dígitos: se omite.'); f.codigo_barras = null; }
  if(f.codigo_barras && catalogo.some(p => p.codigo_barras === f.codigo_barras)){ avisos.push('Ese código de barras ya lo usa otro medicamento: se omite.'); f.codigo_barras = null; }

  const prov = texto(f.proveedor); f.proveedor = prov || null; f.proveedor_id = null;
  if(prov){ const p = proveedores.find(x => ia.norm(x.nombre) === ia.norm(prov)) || proveedores.find(x => ia.similitud(prov, x.nombre) >= 0.8);
    if(p){ f.proveedor_id = p.id; f.proveedor = p.nombre; } else avisos.push(`El proveedor "${prov}" no está registrado: se guardará solo como texto del lote.`); }

  f.numero_lote = texto(f.numero_lote).slice(0, 40) || null;
  const cad = fechaISO(f.caducidad);
  if(cad === null) errores.push(`No entendí la fecha de caducidad ("${texto(f.caducidad)}"). Usa día/mes/año.`);
  f.caducidad = cad || null;
  if(typeof f.cantidad === 'number' && f.cantidad > 0){
    if(!f.caducidad && cad !== null) errores.push('Tiene existencias pero falta la fecha de caducidad.');
    else if(f.caducidad && f.caducidad <= hoyISO()) errores.push('La caducidad ya pasó: no se puede dar de alta con existencias.');
    if(!f.numero_lote){ f.numero_lote = 'INICIAL-' + hoyISO().replace(/-/g, ''); sugerido.push('numero_lote'); avisos.push('Sin número de lote: se usará uno genérico.'); }
  }
  return { datos: f, errores, avisos, sugerido, estado: errores.length ? 'error' : avisos.length ? 'revisar' : 'ok', confianza: c.confianza || 'baja' };
}

async function contexto(sid){
  const [catalogo, proveedores, [suc]] = await Promise.all([productosConStock(sid), query('SELECT id, nombre FROM proveedores WHERE sucursal_id = ? AND activo = 1', [sid]), query('SELECT plan FROM sucursales WHERE id = ?', [sid])]);
  const tope = LIMITES_PLAN[suc.plan].medicamentos;
  return { catalogo, proveedores, plan: suc.plan, cupo: tope ? Math.max(0, tope - catalogo.length) : null };
}

router.get('/plantilla', ah(async (req, res) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Medicamentos');
  ws.columns = [['Nombre', 30], ['Sustancia activa', 22], ['Laboratorio', 16], ['Categoría', 18], ['Presentación', 14], ['Concentración', 14], ['Receta', 8], ['Ubicación', 10],
    ['Stock mínimo', 12], ['Precio', 10], ['Código de barras', 18], ['Proveedor', 22], ['Lote', 12], ['Caducidad', 12], ['Cantidad', 10], ['Costo', 10]].map(([header, width]) => ({ header, width }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF103A8C' } };
  ws.addRow(['Metformina 850mg tabletas', 'Metformina', 'Genfar', 'Otro', 'Tableta', '850mg', 'Sí', 'D6', 10, 42, '7501002003004', 'Nadro', 'L-3001', '30/06/2028', 40, 21]);
  ws.addRow(['Ketorolaco 10mg', '', '', '', '', '', '', '', '', 38, '', '', 'L-3002', '15/03/2028', 25, 16]);
  ws.addRow(['Solo el nombre es obligatorio: lo demás lo propone SmartStock y lo revisas antes de guardar. Borra estas filas de ejemplo.']);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-medicamentos.xlsx"');
  await wb.xlsx.write(res); res.end();
}));

router.post('/analizar', express.raw({ type: () => true, limit: '3mb' }), ah(async (req, res) => {
  if(!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'No llegó ningún archivo.');
  const wb = new ExcelJS.Workbook();
  try{ await wb.xlsx.load(req.body); }catch{ throw new HttpError(400, 'No pude leer el archivo. Debe ser un libro de Excel (.xlsx).'); }
  const ws = wb.worksheets.find(w => w.actualRowCount > 1) || wb.worksheets[0];
  if(!ws || ws.actualRowCount < 2) throw new HttpError(400, 'El archivo no tiene filas con medicamentos.');
  // El encabezado es la primera fila con al menos dos celdas de texto
  let filaEnc = 1;
  for(let i = 1; i <= Math.min(10, ws.rowCount); i++){ if(ws.getRow(i).values.filter(v => texto(v)).length >= 2){ filaEnc = i; break; } }
  const encabezados = []; ws.getRow(filaEnc).eachCell({ includeEmpty: true }, (c, n) => encabezados[n - 1] = texto(c.value));
  const { mapa, sinUsar } = reconocerColumnas(encabezados);
  if(!mapa.nombre) throw new HttpError(400, `No encontré la columna con el nombre del medicamento. Encabezados leídos: ${encabezados.filter(Boolean).join(', ') || 'ninguno'}.`);

  const ctx = await contexto(req.user.sucursal_id);
  const trabajo = ctx.catalogo.map(p => ({ ...p }));
  const filas = [];
  for(let i = filaEnc + 1; i <= ws.rowCount && filas.length < 300; i++){
    const row = ws.getRow(i), d = {};
    for(const [campo, c] of Object.entries(mapa)) d[campo] = campo === 'caducidad' ? row.getCell(c.col + 1).value : texto(row.getCell(c.col + 1).value);
    if(!Object.values(d).some(v => texto(v))) continue;
    if(texto(d.nombre).length > 90 && !texto(d.precio) && !texto(d.cantidad)) continue;      // nota de la plantilla
    const r = revisarFila(d, trabajo, ctx.proveedores);
    if(r.estado !== 'error' && r.estado !== 'duplicado') trabajo.push({ id: -i, nombre: r.datos.nombre, categoria: r.datos.categoria, ubicacion: r.datos.ubicacion, codigo_barras: r.datos.codigo_barras, sustancia: r.datos.sustancia, deArchivo: true });
    filas.push({ fila: i, ...r });
  }
  if(!filas.length) throw new HttpError(400, 'El archivo no tiene filas con medicamentos.');
  const cuenta = e => filas.filter(f => f.estado === e).length;
  res.json({ hoja: ws.name, columnas: Object.fromEntries(Object.entries(mapa).map(([k, c]) => [k, c.h])), sinUsar, filas, cupo: ctx.cupo, plan: ctx.plan,
    resumen: { total: filas.length, listas: cuenta('ok'), revisar: cuenta('revisar'), errores: cuenta('error'), duplicados: cuenta('duplicado'),
      completadas: filas.filter(f => f.sugerido.length && f.estado !== 'error' && f.estado !== 'duplicado').length } });
}));

// POST /api/productos/importar { filas: [datos] }  → se vuelven a validar una por una y se guardan las correctas
router.post('/', ah(async (req, res) => {
  const sid = req.user.sucursal_id;
  const lista = Array.isArray(req.body.filas) ? req.body.filas.slice(0, 300) : [];
  if(!lista.length) throw new HttpError(400, 'No hay medicamentos que importar.');
  const ctx = await contexto(sid);
  const trabajo = ctx.catalogo.map(p => ({ ...p }));
  const omitidos = []; let creados = 0, unidades = 0;
  await transaction(async conn => {
    const [[{ n }]] = await conn.query(`SELECT COALESCE(MAX(CAST(SUBSTRING(codigo, 5) AS UNSIGNED)), 0) AS n FROM productos WHERE sucursal_id = ? AND codigo LIKE 'MED-%'`, [sid]);
    let consecutivo = n;
    for(const d of lista){
      const r = revisarFila(d, trabajo, ctx.proveedores), f = r.datos;
      if(r.estado === 'error' || r.estado === 'duplicado'){ omitidos.push({ nombre: f.nombre || '(sin nombre)', motivo: [...r.errores, ...r.avisos][0] }); continue; }
      if(ctx.cupo !== null && creados >= ctx.cupo){ omitidos.push({ nombre: f.nombre, motivo: `Tu plan ${ctx.plan} ya no admite más medicamentos.` }); continue; }
      const [p] = await conn.query(`INSERT INTO productos (sucursal_id,codigo,codigo_barras,proveedor_id,nombre,sustancia,laboratorio,categoria,presentacion,concentracion,requiere_receta,ubicacion,stock_minimo,precio)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [sid, 'MED-' + String(++consecutivo).padStart(3, '0'), f.codigo_barras, f.proveedor_id, f.nombre, f.sustancia || null, texto(f.laboratorio) || null,
         f.categoria, f.presentacion, f.concentracion || null, f.requiere_receta ? 1 : 0, f.ubicacion, f.stock_minimo, f.precio]);
      if(f.cantidad > 0){
        const [l] = await conn.query('INSERT INTO lotes (producto_id,numero_lote,caducidad,cantidad,costo_unitario,proveedor,fecha_entrada) VALUES (?,?,?,?,?,?,?)',
          [p.insertId, f.numero_lote, f.caducidad, f.cantidad, f.costo_unitario, f.proveedor, hoyISO()]);
        await conn.query(`INSERT INTO movimientos (sucursal_id,producto_id,lote_id,tipo,cantidad,motivo,proveedor,usuario_id,fecha) VALUES (?,?,?,'Entrada',?,'Alta por importación',?,?,?)`,
          [sid, p.insertId, l.insertId, f.cantidad, f.proveedor, req.user.id, ahoraSQL()]);
        unidades += f.cantidad;
      }
      trabajo.push({ id: p.insertId, nombre: f.nombre, categoria: f.categoria, ubicacion: f.ubicacion, codigo_barras: f.codigo_barras, sustancia: f.sustancia, deArchivo: true });
      creados++;
    }
  });
  if(creados) await auditar(req, 'producto.importar', `Importó ${creados} medicamento(s) desde Excel (${unidades} unidades).`, sid);
  res.status(creados ? 201 : 200).json({ creados, unidades, omitidos });
}));

module.exports = router;
