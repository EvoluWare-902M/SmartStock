/* =====================================================================
   prediccion.js : modelo predictivo de demanda (HU-10, HU-11, HU-12)

   Método: descomposición clásica multiplicativa de series de tiempo.
     1. Se agrupan las ventas por mes (últimos 24 meses completos).
     2. Tendencia: regresión lineal por mínimos cuadrados.
     3. Estacionalidad: índice por mes del año = promedio de
        (venta real / tendencia) para ese mes, normalizado a promedio 1.
     4. Se re-ajusta la tendencia sobre la serie desestacionalizada.
     5. Pronóstico = tendencia(t) × índice_estacional(mes).
   Si hay menos de 13 meses de historia no se puede estimar la
   estacionalidad y se usa un promedio móvil ponderado (0.2/0.3/0.5).

   La confianza se mide con un back-test: se entrena sin los últimos 3
   meses, se pronostican y se compara con lo que realmente se vendió
   (MAPE = error porcentual absoluto medio).
   ===================================================================== */
const { query } = require('../db');
const { hoyISO } = require('../utils');
const { ZONA_RAPIDA, UBICACIONES } = require('../constants');
const { productosConStock, lotesSucursal } = require('./inventario');

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MESES_LARGOS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// Lista de los últimos n meses completos: [{key:'2025-10', anio, mes(0-11)}]
function ultimosMeses(n){
  const hoy = new Date(hoyISO() + 'T00:00:00');
  const res = [];
  for(let i = n; i >= 1; i--){
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    res.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, anio: d.getFullYear(), mes: d.getMonth() });
  }
  return res;
}

// Ventas mensuales agrupadas por 'categoria' o 'producto'.
async function ventasMensuales(sucursalId, agrupar = 'categoria', meses = 24){
  const periodo = ultimosMeses(meses);
  const desde = periodo[0].key + '-01 00:00:00';
  const hasta = (() => { const h = new Date(hoyISO() + 'T00:00:00'); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-01 00:00:00`; })();
  const campo = agrupar === 'producto' ? 'p.id' : 'p.categoria';
  const filas = await query(`
    SELECT ${campo} AS clave, DATE_FORMAT(m.fecha, '%Y-%m') AS mes, SUM(m.cantidad) AS unidades
    FROM movimientos m JOIN productos p ON p.id = m.producto_id
    WHERE m.sucursal_id = ? AND m.tipo = 'Salida' AND m.motivo = 'Venta' AND m.fecha >= ? AND m.fecha < ?
    GROUP BY clave, mes`, [sucursalId, desde, hasta]);
  const series = {};
  for(const f of filas){
    if(!series[f.clave]) series[f.clave] = Object.fromEntries(periodo.map(p => [p.key, 0]));
    series[f.clave][f.mes] = Number(f.unidades);
  }
  return { periodo, series: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, periodo.map(p => v[p.key])])) };
}

function regresion(y){
  const n = y.length;
  const mx = (n - 1) / 2, my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  y.forEach((v, x) => { num += (x - mx) * (v - my); den += (x - mx) ** 2; });
  const b = den ? num / den : 0;
  return { a: my - b * mx, b };
}

// Ajusta el modelo sobre la serie y (con el mes calendario de cada punto).
function ajustar(y, mesesCal){
  const n = y.length;
  const activo = y.findIndex(v => v > 0);
  if(activo === -1) return { metodo: 'sin-datos', pronosticar: () => 0, indices: Array(12).fill(1) };
  const ys = y.slice(activo), ms = mesesCal.slice(activo);

  if(ys.length < 13){
    const w = ys.slice(-3); while(w.length < 3) w.unshift(w[0]);
    const base = w[0] * 0.2 + w[1] * 0.3 + w[2] * 0.5;
    return { metodo: 'promedio-movil', pronosticar: () => base, indices: Array(12).fill(1), pendiente: 0, nivel: base };
  }

  // 1) tendencia inicial
  const t0 = regresion(ys);
  // 2) índices estacionales
  const suma = Array(12).fill(0), cuenta = Array(12).fill(0);
  ys.forEach((v, i) => {
    const tr = t0.a + t0.b * i;
    if(tr > 0){ suma[ms[i]] += v / tr; cuenta[ms[i]]++; }
  });
  let indices = suma.map((s, i) => cuenta[i] ? s / cuenta[i] : 1);
  const prom = indices.reduce((a, b) => a + b, 0) / 12;
  indices = indices.map(v => v / prom);
  // 3) tendencia sobre la serie desestacionalizada
  const t1 = regresion(ys.map((v, i) => v / (indices[ms[i]] || 1)));
  const offset = activo;
  return {
    metodo: 'descomposicion-estacional',
    indices,
    pendiente: t1.b,
    nivel: t1.a + t1.b * (ys.length - 1),
    // h = posición absoluta en la serie original (n = primer mes futuro)
    pronosticar: (h, mesCal) => Math.max(0, (t1.a + t1.b * (h - offset)) * indices[mesCal]),
  };
}

function mape(real, pred){
  const pares = real.map((r, i) => [r, pred[i]]).filter(([r]) => r > 0);
  if(!pares.length) return null;
  return pares.reduce((s, [r, p]) => s + Math.abs(r - p) / r, 0) / pares.length * 100;
}

// Análisis completo de una serie: histórico, pronóstico de 3 meses y métricas.
function analizarSerie(y, periodo, horizonte = 3){
  const mesesCal = periodo.map(p => p.mes);
  const modelo = ajustar(y, mesesCal);
  const n = y.length;
  const ultimo = periodo[n - 1];
  const futuros = [];
  for(let h = 1; h <= horizonte; h++){
    const d = new Date(ultimo.anio, ultimo.mes + h, 1);
    futuros.push({ etiqueta: `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, mes: d.getMonth(), anio: d.getFullYear(),
                   valor: Math.round(modelo.pronosticar(n - 1 + h, d.getMonth())) });
  }

  // Back-test con los últimos 3 meses
  let confianza = null, error = null;
  if(n >= 16){
    const prueba = ajustar(y.slice(0, n - 3), mesesCal.slice(0, n - 3));
    const pred = [1, 2, 3].map(h => prueba.pronosticar(n - 4 + h, mesesCal[n - 4 + h]));
    error = mape(y.slice(n - 3), pred);
    if(error !== null) confianza = Math.max(0, Math.round(100 - error));
  }

  // Variación anual de la tendencia en %
  const promedio = y.reduce((a, b) => a + b, 0) / n || 1;
  const tendenciaAnual = modelo.pendiente !== undefined ? Math.round(modelo.pendiente * 12 / promedio * 100) : 0;
  const idx = modelo.indices;
  const mesPico = idx.indexOf(Math.max(...idx));
  const mesBajo = idx.indexOf(Math.min(...idx));

  return {
    metodo: modelo.metodo,
    etiquetas: periodo.map(p => `${MESES[p.mes]} ${String(p.anio).slice(2)}`),
    historico: y,
    pronostico: futuros,
    indices: idx.map(v => Math.round(v * 100) / 100),
    mesPico: MESES_LARGOS[mesPico], mesBajo: MESES_LARGOS[mesBajo],
    tendenciaAnual, confianza, error: error === null ? null : Math.round(error),
    _modelo: modelo,
  };
}

// ---------------- HU-10: predicción por categoría o producto ----------------
async function prediccion(sucursalId, { categoria = null, productoId = null } = {}){
  if(productoId){
    const { periodo, series } = await ventasMensuales(sucursalId, 'producto');
    const y = series[productoId] || periodo.map(() => 0);
    const r = analizarSerie(y, periodo); delete r._modelo;
    return r;
  }
  const { periodo, series } = await ventasMensuales(sucursalId, 'categoria');
  const categorias = Object.keys(series).sort();
  const cat = categoria && series[categoria] ? categoria : categorias[0];
  if(!cat) return { categorias: [], sinDatos: true };
  const r = analizarSerie(series[cat], periodo); delete r._modelo;
  // Resumen de todas las categorías para el ranking de demanda
  const resumen = categorias.map(c => {
    const a = analizarSerie(series[c], periodo);
    return { categoria: c, proximoMes: a.pronostico[0].valor, mesPico: a.mesPico, tendenciaAnual: a.tendenciaAnual };
  }).sort((a, b) => b.proximoMes - a.proximoMes);
  return { categoria: cat, categorias, ...r, resumen };
}

// ---------------- HU-11: recomendación de compras ----------------
async function recomendaciones(sucursalId){
  const productos = await productosConStock(sucursalId);
  const lotes = await lotesSucursal(sucursalId);
  const { periodo, series } = await ventasMensuales(sucursalId, 'producto');
  const costos = await query(`SELECT l.producto_id, l.costo_unitario FROM lotes l JOIN productos p ON p.id = l.producto_id
                              WHERE p.sucursal_id = ? ORDER BY l.fecha_entrada DESC, l.id DESC`, [sucursalId]);
  const ultimoCosto = {};
  costos.forEach(c => { if(ultimoCosto[c.producto_id] === undefined) ultimoCosto[c.producto_id] = Number(c.costo_unitario); });

  const lista = [];
  for(const p of productos){
    const y = series[p.id] || periodo.map(() => 0);
    const a = analizarSerie(y, periodo);
    const demandaMes = a.pronostico[0].valor;                 // mes en curso
    const demandaSig = a.pronostico[1].valor;                 // mes siguiente
    // Unidades que caducan en los próximos 30 días no cuentan como stock útil
    const porCaducar = lotes.filter(l => l.producto_id === p.id && l.dias >= 0 && l.dias <= 30).reduce((s, l) => s + l.cantidad, 0);
    const stockUtil = Math.max(0, p.stock - porCaducar);
    const seguridad = Math.max(p.stock_minimo, Math.ceil(demandaMes * 0.2));
    const sugerido = Math.max(0, Math.ceil(demandaMes + seguridad - stockUtil));
    const diario = demandaMes / 30;
    const cobertura = diario > 0 ? Math.floor(stockUtil / diario) : null;

    if(sugerido <= 0) continue;
    const motivos = [];
    if(p.stock_bajo) motivos.push(`Stock actual (${p.stock} u.) en o por debajo del mínimo (${p.stock_minimo} u.).`);
    if(cobertura !== null) motivos.push(`El stock útil alcanza para ~${cobertura} día(s) de venta.`);
    const idxActual = a.indices[a.pronostico[0].mes], idxSig = a.indices[a.pronostico[1].mes];
    if(idxSig > 1.1 || idxActual > 1.1) motivos.push(`Temporada alta: ${p.categoria.toLowerCase()} suele subir alrededor de ${a.mesPico}.`);
    if(demandaSig > demandaMes * 1.1) motivos.push(`Se espera que la demanda suba el próximo mes (~${demandaSig} u.).`);
    if(porCaducar > 0) motivos.push(`${porCaducar} u. caducan en menos de 30 días y no se consideran disponibles.`);
    if(a.tendenciaAnual >= 8) motivos.push(`Tendencia de ventas al alza (+${a.tendenciaAnual}% anual).`);

    let prioridad = 'Baja';
    if(p.stock_bajo || (cobertura !== null && cobertura < 7)) prioridad = 'Alta';
    else if(cobertura !== null && cobertura < 15) prioridad = 'Media';

    lista.push({
      producto_id: p.id, producto: p.nombre, codigo: p.codigo, categoria: p.categoria,
      stock: p.stock, stock_minimo: p.stock_minimo, demanda_estimada: demandaMes, demanda_siguiente: demandaSig,
      cantidad: sugerido, cobertura_dias: cobertura, prioridad,
      costo_estimado: Math.round(sugerido * (ultimoCosto[p.id] || 0) * 100) / 100,
      motivo: motivos.join(' '),
    });
  }
  const orden = { Alta: 0, Media: 1, Baja: 2 };
  return lista.sort((a, b) => orden[a.prioridad] - orden[b.prioridad] || b.cantidad - a.cantidad);
}

// ---------------- HU-12: organización inteligente de repisas ----------------
// Rotación = unidades vendidas en los últimos 90 días. Los productos de mayor
// rotación deben quedar en la zona de acceso rápido (cerca del mostrador).
async function organizacionRepisas(sucursalId){
  const productos = await productosConStock(sucursalId);
  const desde = new Date(Date.now() - 90 * 86400000);
  const rot = await query(`SELECT producto_id, SUM(cantidad) AS u FROM movimientos
                           WHERE sucursal_id = ? AND tipo = 'Salida' AND motivo = 'Venta' AND fecha >= ?
                           GROUP BY producto_id`, [sucursalId, desde.toISOString().slice(0, 10)]);
  const rotacion = Object.fromEntries(rot.map(r => [r.producto_id, Number(r.u)]));
  const items = productos.map(p => ({ id: p.id, nombre: p.nombre, ubicacion: p.ubicacion, rotacion: rotacion[p.id] || 0 }))
                         .sort((a, b) => b.rotacion - a.rotacion);
  const total = items.reduce((s, i) => s + i.rotacion, 0) || 1;
  items.forEach((it, i) => {
    it.ranking = i + 1;
    it.participacion = Math.round(it.rotacion / total * 1000) / 10;
    it.nivel = i < ZONA_RAPIDA.length ? 'Alta' : (i < items.length * 0.6 ? 'Media' : 'Baja');
  });

  const ocupacion = {};
  UBICACIONES.forEach(u => ocupacion[u] = []);
  items.forEach(it => (ocupacion[it.ubicacion] = ocupacion[it.ubicacion] || []).push(it));

  const sugerencias = [];
  const altos = items.filter(i => i.nivel === 'Alta');
  const yaMovidos = new Set();
  for(const p of altos){
    if(ZONA_RAPIDA.includes(p.ubicacion)) continue;
    // 1) un hueco libre en la zona rápida
    const libre = ZONA_RAPIDA.find(u => ocupacion[u].length === 0);
    if(libre){
      sugerencias.push({ movimientos: [{ producto_id: p.id, producto: p.nombre, desde: p.ubicacion, hacia: libre }],
        motivo: `Alta rotación (#${p.ranking}, ${p.rotacion} u. en 90 días): acercar al mostrador en un espacio libre.` });
      ocupacion[p.ubicacion] = ocupacion[p.ubicacion].filter(x => x.id !== p.id);
      ocupacion[libre].push(p); yaMovidos.add(p.id);
      continue;
    }
    // 2) intercambiar con el producto de menor rotación dentro de la zona rápida
    const candidatos = ZONA_RAPIDA.flatMap(u => ocupacion[u]).filter(x => x.nivel !== 'Alta' && !yaMovidos.has(x.id))
                                  .sort((a, b) => a.rotacion - b.rotacion);
    const bajo = candidatos[0];
    if(!bajo) continue;
    const destino = bajo.ubicacion, origen = p.ubicacion;
    sugerencias.push({
      movimientos: [
        { producto_id: p.id, producto: p.nombre, desde: origen, hacia: destino },
        { producto_id: bajo.id, producto: bajo.nombre, desde: destino, hacia: origen },
      ],
      motivo: `${p.nombre} tiene alta rotación (#${p.ranking}, ${p.rotacion} u. en 90 días) y ${bajo.nombre} baja rotación (#${bajo.ranking}, ${bajo.rotacion} u.): intercambiar posiciones para optimizar el acceso.`,
    });
    ocupacion[origen] = ocupacion[origen].filter(x => x.id !== p.id).concat(bajo);
    ocupacion[destino] = ocupacion[destino].filter(x => x.id !== bajo.id).concat(p);
    bajo.ubicacion = origen; p.ubicacion = destino;
    yaMovidos.add(p.id); yaMovidos.add(bajo.id);
  }

  return { zonaRapida: ZONA_RAPIDA, productos: items.map(i => ({ ...i, ubicacion: productos.find(p => p.id === i.id).ubicacion })), sugerencias };
}

module.exports = { prediccion, recomendaciones, organizacionRepisas, ventasMensuales, MESES };
