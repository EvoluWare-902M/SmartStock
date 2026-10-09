/* =====================================================================
   ia.js : modelos de análisis inteligente que corren en el propio servidor
   (sin servicios externos). Complementan al modelo de predicción de
   demanda de prediccion.js.

   1. Búsqueda tolerante a errores  → distancia de edición (Damerau-Levenshtein)
   2. Alternativas terapéuticas     → misma sustancia activa / misma categoría
   3. Detección de anomalías        → puntuación z robusta (mediana y MAD)
   4. Clasificación ABC-XYZ         → Pareto por valor + variabilidad de la demanda
   5. Riesgo de caducidad           → simulación de consumo FEFO contra la demanda
   6. Hallazgos del día             → resumen en lenguaje natural de lo anterior
   7. Salud de las sucursales       → puntuación de riesgo de abandono (plataforma)
   ===================================================================== */
const { query } = require('../db');
const { hoyISO, diasEntre } = require('../utils');
const { productosConStock, lotesSucursal } = require('./inventario');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const haceDias = n => { const d = new Date(hoyISO() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const mediana = a => { if(!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* ---------- 1. Búsqueda tolerante a errores ---------- */
// Distancia de Damerau-Levenshtein: inserciones, borrados, sustituciones y letras intercambiadas.
function distancia(a, b){
  const m = a.length, n = b.length;
  if(!m) return n; if(!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for(let j = 1; j <= n; j++) d[0][j] = j;
  for(let i = 1; i <= m; i++){
    for(let j = 1; j <= n; j++){
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if(i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}
// Similitud 0–1 entre lo que se escribió y un texto candidato (compara palabra por palabra y por prefijo).
function similitud(consulta, texto){
  const q = norm(consulta), t = norm(texto);
  if(!q || !t) return 0;
  if(t.includes(q)) return 1;
  let mejor = 0;
  for(const palabra of t.split(/[\s/]+/)){
    const corte = palabra.slice(0, Math.max(q.length, 3));            // permite escribir solo el inicio
    for(const cand of [palabra, corte]){
      const s = 1 - distancia(q, cand) / Math.max(q.length, cand.length);
      if(s > mejor) mejor = s;
    }
  }
  return mejor;
}
// Devuelve los productos más parecidos a la consulta cuando no hubo coincidencia exacta.
function buscarAproximado(productos, consulta, { umbral = 0.62, max = 5 } = {}){
  return productos
    .map(p => ({ p, s: Math.max(similitud(consulta, p.nombre), similitud(consulta, p.sustancia) * 0.97) }))
    .filter(x => x.s >= umbral)
    .sort((a, b) => b.s - a.s).slice(0, max)
    .map(x => ({ ...x.p, coincidencia: 'aproximada', similitud: Math.round(x.s * 100) }));
}

/* ---------- 2. Alternativas ---------- */
async function alternativas(sucursalId, productoId){
  const productos = await productosConStock(sucursalId);
  const base = productos.find(p => p.id === Number(productoId));
  if(!base) return [];
  const sust = norm(base.sustancia);
  return productos
    .filter(p => p.id !== base.id && p.stock > 0)
    .map(p => {
      const mismaSustancia = sust && norm(p.sustancia) === sust;
      const mismaCategoria = p.categoria === base.categoria;
      if(!mismaSustancia && !mismaCategoria) return null;
      return { id: p.id, nombre: p.nombre, sustancia: p.sustancia, ubicacion: p.ubicacion, stock: p.stock, requiere_receta: p.requiere_receta,
        afinidad: mismaSustancia ? 'Misma sustancia activa' : `Misma categoría (${p.categoria})`,
        puntos: (mismaSustancia ? 100 : 40) + (p.presentacion === base.presentacion ? 10 : 0) + (p.requiere_receta === base.requiere_receta ? 5 : 0) };
    })
    .filter(Boolean).sort((a, b) => b.puntos - a.puntos).slice(0, 4);
}

/* ---------- 3. Detección de anomalías ---------- */
// Para cada medicamento se aprende su "salida típica" (mediana) y su dispersión (MAD) con 180 días
// de historia. Un movimiento reciente es anómalo si su z robusta supera 3.5, si es una merma grande
// o si se registró fuera del horario habitual.
async function anomalias(sucursalId, { dias = 30 } = {}){
  const filas = await query(`
    SELECT m.id, m.fecha, m.cantidad, m.motivo, m.producto_id, p.nombre AS producto, p.precio, u.nombre AS responsable
    FROM movimientos m JOIN productos p ON p.id = m.producto_id LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.sucursal_id = ? AND m.tipo = 'Salida' AND m.fecha >= ? ORDER BY m.fecha`, [sucursalId, haceDias(180) + ' 00:00:00']);
  const porProducto = {};
  filas.forEach(f => (porProducto[f.producto_id] = porProducto[f.producto_id] || []).push(f));
  const desde = haceDias(dias) + ' 00:00:00';
  const halladas = [];

  for(const lista of Object.values(porProducto)){
    const ventas = lista.filter(f => f.motivo === 'Venta').map(f => f.cantidad);
    if(ventas.length < 8) continue;                                   // sin historia suficiente no se juzga
    const med = mediana(ventas);
    const mad = Math.max(1, mediana(ventas.map(v => Math.abs(v - med))));
    for(const f of lista){
      if(f.fecha < desde) continue;
      const z = 0.6745 * (f.cantidad - med) / mad;
      const hora = Number(f.fecha.slice(11, 13));
      let motivo = null, gravedad = 0;
      if(f.motivo === 'Venta' && z > 3.5){ motivo = `Cantidad inusual: ${f.cantidad} u. cuando lo típico son ${med} u. por venta.`; gravedad = Math.min(100, Math.round(z * 10)); }
      else if(f.motivo !== 'Venta' && f.cantidad >= Math.max(5, med * 3)){ motivo = `${f.motivo} de ${f.cantidad} u., muy por encima de una salida normal (${med} u.).`; gravedad = 70; }
      else if(hora < 7 || hora >= 23){ motivo = `Registrada a las ${f.fecha.slice(11, 16)}, fuera del horario habitual.`; gravedad = 45; }
      if(motivo) halladas.push({ id: f.id, fecha: f.fecha, producto: f.producto, producto_id: f.producto_id, cantidad: f.cantidad, tipo: f.motivo,
        responsable: f.responsable || '—', motivo, gravedad, nivel: gravedad >= 70 ? 'Alta' : gravedad >= 50 ? 'Media' : 'Baja',
        importe: Math.round(f.cantidad * Number(f.precio) * 100) / 100 });
    }
  }
  return halladas.sort((a, b) => b.gravedad - a.gravedad || b.fecha.localeCompare(a.fecha)).slice(0, 40);
}

/* ---------- 4. Clasificación ABC-XYZ ---------- */
// ABC: ordena por valor vendido en 180 días; A = 80 % del valor, B = siguiente 15 %, C = resto.
// XYZ: coeficiente de variación de la demanda semanal; X estable (<0.5), Y variable (<1), Z errática.
async function abcxyz(sucursalId){
  const productos = await productosConStock(sucursalId);
  const semanas = 26;
  const filas = await query(`
    SELECT producto_id, FLOOR(DATEDIFF(?, DATE(fecha)) / 7) AS semana, SUM(cantidad) AS u
    FROM movimientos WHERE sucursal_id = ? AND tipo = 'Salida' AND motivo = 'Venta' AND fecha >= ?
    GROUP BY producto_id, semana`, [hoyISO(), sucursalId, haceDias(semanas * 7) + ' 00:00:00']);
  const serie = {};
  filas.forEach(f => { if(f.semana < semanas){ (serie[f.producto_id] = serie[f.producto_id] || Array(semanas).fill(0))[f.semana] = Number(f.u); } });

  const items = productos.map(p => {
    const s = serie[p.id] || Array(semanas).fill(0);
    const unidades = s.reduce((a, b) => a + b, 0), media = unidades / semanas;
    const desv = Math.sqrt(s.reduce((a, v) => a + (v - media) ** 2, 0) / semanas);
    const cv = media > 0 ? desv / media : null;
    return { id: p.id, nombre: p.nombre, categoria: p.categoria, stock: p.stock, stock_bajo: p.stock_bajo, unidades,
      valor: Math.round(unidades * Number(p.precio) * 100) / 100, cv: cv === null ? null : Math.round(cv * 100) / 100,
      xyz: cv === null ? 'Z' : cv < 0.5 ? 'X' : cv < 1 ? 'Y' : 'Z' };
  }).sort((a, b) => b.valor - a.valor);

  const total = items.reduce((s, i) => s + i.valor, 0) || 1;
  let acum = 0;
  const CONSEJO = {
    AX: 'Vital y predecible: nunca debe faltar. Mantén stock de seguridad y reabastece automáticamente.',
    AY: 'Vital con demanda variable: revisa el pronóstico cada semana y sube el mínimo en temporada alta.',
    AZ: 'Vital pero errático: compra en lotes pequeños y frecuentes para no quedarte sin producto ni con exceso.',
    BX: 'Importante y estable: reabastece con calendario fijo.', BY: 'Importante y variable: sigue la recomendación de compras del sistema.',
    BZ: 'Importante pero errático: mantén poco inventario y vigila su caducidad.',
    CX: 'Bajo valor y estable: pide lo justo; no inmovilices dinero aquí.', CY: 'Bajo valor y variable: compra solo cuando se acerque al mínimo.',
    CZ: 'Bajo valor y errático: candidato a surtir solo sobre pedido o a retirar del catálogo.',
  };
  items.forEach(i => {
    acum += i.valor; i.participacion = Math.round(i.valor / total * 1000) / 10; i.acumulado = Math.round(acum / total * 1000) / 10;
    i.abc = (acum - i.valor) / total < 0.8 ? 'A' : (acum - i.valor) / total < 0.95 ? 'B' : 'C';
    i.clase = i.abc + i.xyz; i.consejo = CONSEJO[i.clase];
  });
  const resumen = {};
  ['A', 'B', 'C'].forEach(c => { const g = items.filter(i => i.abc === c); resumen[c] = { productos: g.length, valor: Math.round(g.reduce((s, i) => s + i.valor, 0)), porcentaje: Math.round(g.reduce((s, i) => s + i.valor, 0) / total * 100) }; });
  return { items, resumen, total: Math.round(total) };
}

/* ---------- 5. Riesgo de caducidad ---------- */
// Se estima el ritmo de venta diario (últimos 90 días) y se simula el consumo de los lotes en orden
// de caducidad (FEFO). Lo que el modelo calcula que no alcanzará a venderse antes de vencer es el riesgo.
async function riesgoCaducidad(sucursalId){
  const lotes = await lotesSucursal(sucursalId);
  const ventas = await query(`SELECT producto_id, SUM(cantidad) AS u FROM movimientos
    WHERE sucursal_id = ? AND tipo = 'Salida' AND motivo = 'Venta' AND fecha >= ? GROUP BY producto_id`, [sucursalId, haceDias(90) + ' 00:00:00']);
  const ritmo = Object.fromEntries(ventas.map(v => [v.producto_id, Number(v.u) / 90]));
  const consumido = {};                                               // días-venta ya asignados a lotes anteriores del mismo producto
  const res = [];
  for(const l of lotes){                                              // ya vienen ordenados por caducidad
    const r = ritmo[l.producto_id] || 0;
    const previo = consumido[l.producto_id] || 0;
    const alcanza = l.dias < 0 ? 0 : Math.max(0, r * l.dias - previo);  // unidades que se venderán de este lote antes de vencer
    const vendera = Math.min(l.cantidad, Math.floor(alcanza));
    consumido[l.producto_id] = previo + vendera;
    const enRiesgo = l.cantidad - vendera;
    if(enRiesgo <= 0) continue;
    const pct = Math.round(enRiesgo / l.cantidad * 100);
    let accion;
    if(l.dias < 0) accion = 'Ya caducó: retíralo como merma.';
    else if(l.dias <= 15) accion = 'Súrtelo primero y ofrece descuento; si no sale, tramita la devolución al proveedor.';
    else if(l.dias <= 60) accion = 'Colócalo al frente y considera una promoción para acelerar su salida.';
    else accion = 'Reduce la próxima compra de este producto: el ritmo de venta no alcanza a consumirlo.';
    res.push({ lote_id: l.id, producto_id: l.producto_id, producto: l.producto, lote: l.numero_lote, caducidad: l.caducidad, dias: l.dias, cantidad: l.cantidad,
      ritmo_diario: Math.round(r * 100) / 100, en_riesgo: enRiesgo, porcentaje: pct, perdida: Math.round(enRiesgo * Number(l.costo_unitario) * 100) / 100,
      nivel: l.dias < 0 || (pct >= 60 && l.dias <= 30) ? 'Alto' : pct >= 30 ? 'Medio' : 'Bajo', accion });
  }
  const orden = { Alto: 0, Medio: 1, Bajo: 2 };
  return res.sort((a, b) => orden[a.nivel] - orden[b.nivel] || a.dias - b.dias);
}

/* ---------- 6. Hallazgos del día (resumen en lenguaje natural) ---------- */
async function hallazgos(sucursalId){
  const [abc, riesgo, raras, productos] = await Promise.all([abcxyz(sucursalId), riesgoCaducidad(sucursalId), anomalias(sucursalId, { dias: 14 }), productosConStock(sucursalId)]);
  const h = [];
  const vitales = abc.items.filter(i => i.abc === 'A' && i.stock_bajo);
  if(vitales.length) h.push({ tipo: 'alerta', titulo: 'Productos clave con stock bajo',
    texto: `${vitales.map(v => v.nombre).slice(0, 3).join(', ')}${vitales.length > 3 ? ` y ${vitales.length - 3} más` : ''} ${vitales.length === 1 ? 'es de clase A (de los' : 'son de clase A (los'} que más ingreso generan) y ${vitales.length === 1 ? 'está' : 'están'} en o por debajo del mínimo.`, enlace: 'recomendacion.html' });
  const perdida = riesgo.filter(r => r.nivel !== 'Bajo').reduce((s, r) => s + r.perdida, 0);
  const altos = riesgo.filter(r => r.nivel === 'Alto');
  if(altos.length) h.push({ tipo: 'riesgo', titulo: 'Lotes que probablemente no se venderán a tiempo',
    texto: `${altos.length} lote(s) tienen riesgo alto de caducar con producto dentro. El más urgente: ${altos[0].producto} (lote ${altos[0].lote}, ${altos[0].en_riesgo} u.). Pérdida estimada: $${Math.round(perdida).toLocaleString('es-MX')}.`, enlace: 'ia.html#caducidad' });
  const graves = raras.filter(a => a.nivel === 'Alta');
  if(graves.length) h.push({ tipo: 'anomalia', titulo: 'Movimientos fuera de lo normal',
    texto: `Se detectaron ${graves.length} salida(s) inusuales en los últimos 14 días. Ejemplo: ${graves[0].producto}, ${graves[0].cantidad} u. registradas por ${graves[0].responsable}.`, enlace: 'ia.html#anomalias' });
  const muertos = abc.items.filter(i => i.unidades === 0 && i.stock > 0);
  if(muertos.length) h.push({ tipo: 'info', titulo: 'Producto sin movimiento',
    texto: `${muertos.map(m => m.nombre).slice(0, 3).join(', ')} no ${muertos.length === 1 ? 'ha' : 'han'} tenido ventas en 6 meses y ${muertos.length === 1 ? 'ocupa' : 'ocupan'} espacio en el anaquel.`, enlace: 'ia.html#abc' });
  if(!h.length) h.push({ tipo: 'ok', titulo: 'Sin hallazgos relevantes',
    texto: `Los ${productos.length} medicamentos se comportan dentro de lo esperado: no hay anomalías ni lotes en riesgo alto.`, enlace: 'ia.html' });
  return h;
}

/* ---------- 7. Salud de las sucursales (plataforma) ---------- */
// Puntuación 0–100 de qué tan activa está una sucursal. Combina señales de uso con pesos fijos y
// una función logística, para ordenar a cuáles conviene dar seguimiento antes de que abandonen.
async function saludSucursales(){
  const filas = await query(`
    SELECT s.id, s.nombre, s.plan, s.estado, s.fecha_alta,
      (SELECT MAX(u.ultimo_acceso) FROM usuarios u WHERE u.sucursal_id = s.id) AS ultimo_acceso,
      (SELECT COUNT(*) FROM productos p WHERE p.sucursal_id = s.id AND p.activo = 1) AS productos,
      (SELECT COUNT(*) FROM usuarios u WHERE u.sucursal_id = s.id AND u.estado = 'Activo') AS usuarios,
      (SELECT COUNT(*) FROM movimientos m WHERE m.sucursal_id = s.id AND m.fecha >= ?) AS mov30,
      (SELECT COUNT(*) FROM movimientos m WHERE m.sucursal_id = s.id AND m.fecha >= ? AND m.fecha < ?) AS mov_previos
    FROM sucursales s WHERE s.estado = 'Activa'`, [haceDias(30) + ' 00:00:00', haceDias(60) + ' 00:00:00', haceDias(30) + ' 00:00:00']);
  return filas.map(s => {
    const sinEntrar = s.ultimo_acceso ? diasEntre(s.ultimo_acceso.slice(0, 10), hoyISO()) : null;
    const antiguedad = diasEntre(s.fecha_alta, hoyISO());
    const tendencia = s.mov_previos ? (s.mov30 - s.mov_previos) / s.mov_previos : (s.mov30 ? 1 : 0);
    // señales normalizadas a [0,1]
    const x = 2.2 * Math.min(1, s.mov30 / 60) + 1.4 * Math.min(1, s.productos / 20) + 0.6 * Math.min(1, s.usuarios / 3)
            + 0.8 * Math.max(-1, Math.min(1, tendencia)) - 2.4 * Math.min(1, (sinEntrar ?? 45) / 30) - 0.3;
    const salud = Math.round(100 / (1 + Math.exp(-1.6 * x)));
    const motivos = [];
    if(sinEntrar === null) motivos.push('nadie ha iniciado sesión'); else if(sinEntrar >= 14) motivos.push(`${sinEntrar} días sin entrar`);
    if(s.productos === 0) motivos.push('catálogo vacío'); else if(s.productos < 5) motivos.push('catálogo muy pequeño');
    if(s.mov30 === 0) motivos.push('sin movimientos en 30 días'); else if(tendencia <= -0.3) motivos.push(`actividad ${Math.round(-tendencia * 100)}% menor que el mes anterior`);
    return { id: s.id, nombre: s.nombre, plan: s.plan, salud, ultimo_acceso: s.ultimo_acceso, dias_sin_entrar: sinEntrar, antiguedad,
      productos: s.productos, usuarios: s.usuarios, mov30: s.mov30,
      nivel: salud >= 65 ? 'Saludable' : salud >= 35 ? 'En riesgo' : 'Inactiva', motivos };
  }).sort((a, b) => a.salud - b.salud);
}

module.exports = { norm, distancia, similitud, buscarAproximado, alternativas, anomalias, abcxyz, riesgoCaducidad, hallazgos, saludSucursales };
