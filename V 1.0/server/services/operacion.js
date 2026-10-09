/* =====================================================================
   operacion.js : modelos de IA para el trabajo diario del gerente y del
   empleado. Corren en el propio servidor, igual que los de ia.js.

   1. Se venden juntos        → reglas de asociación sobre los tickets (soporte, confianza, lift)
   2. Mínimos sugeridos       → punto de reorden con demanda, variabilidad y tiempo de entrega
   3. Clasificador de altas   → deduce sustancia, categoría, presentación y receta a partir del nombre
   4. Qué contar hoy          → prioridad de conteo físico por valor, riesgo y antigüedad
   5. Demanda no atendida     → agrupa lo que pidieron los clientes aunque esté mal escrito
   ===================================================================== */
const { query } = require('../db');
const { hoyISO, diasEntre } = require('../utils');
const { CATEGORIAS, UBICACIONES } = require('../constants');
const { productosConStock } = require('./inventario');
const ia = require('./ia');

const haceDias = n => { const d = new Date(hoyISO() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const r2 = n => Math.round(n * 100) / 100;

/* ---------- 1. Se venden juntos ---------- */
// Para cada par (A, B):  soporte = tickets con ambos / tickets;  confianza(A→B) = tickets con ambos / tickets con A;
// lift = confianza / (tickets con B / tickets). Un lift mayor a 1 significa que se llevan juntos más de lo que
// se esperaría por casualidad. Se descartan los pares con menos de `minimo` tickets para no sacar conclusiones de pocos casos.
async function ventaConjunta(sucursalId, { dias = 180, minimo = 5 } = {}){
  const filas = await query(`SELECT m.venta_id, m.producto_id FROM movimientos m JOIN ventas v ON v.id = m.venta_id
    WHERE m.sucursal_id = ? AND v.estado = 'Completada' AND m.tipo = 'Salida' AND m.fecha >= ?`, [sucursalId, haceDias(dias) + ' 00:00:00']);
  const tickets = {};
  filas.forEach(f => (tickets[f.venta_id] = tickets[f.venta_id] || new Set()).add(f.producto_id));
  const n = Object.keys(tickets).length;
  const solo = {}, par = {};
  for(const set of Object.values(tickets)){
    const ids = [...set].sort((a, b) => a - b);
    ids.forEach(a => solo[a] = (solo[a] || 0) + 1);
    for(let i = 0; i < ids.length; i++) for(let j = i + 1; j < ids.length; j++) par[ids[i] + '-' + ids[j]] = (par[ids[i] + '-' + ids[j]] || 0) + 1;
  }
  const productos = Object.fromEntries((await productosConStock(sucursalId)).map(p => [p.id, p]));
  const reglas = [];
  for(const [clave, juntos] of Object.entries(par)){
    if(juntos < minimo) continue;
    const [x, y] = clave.split('-').map(Number);
    for(const [a, b] of [[x, y], [y, x]]){
      if(!productos[a] || !productos[b]) continue;
      const confianza = juntos / solo[a], lift = confianza / (solo[b] / n);
      if(lift < 1.5) continue;
      reglas.push({ a_id: a, a: productos[a].nombre, b_id: b, b: productos[b].nombre, juntos, tickets_a: solo[a],
        soporte: r2(juntos / n * 100), confianza: Math.round(confianza * 100), lift: r2(lift) });
    }
  }
  reglas.sort((p, q) => q.confianza - p.confianza || q.lift - p.lift);
  return { tickets: n, dias, reglas, productos };
}

// Para el punto de venta: con lo que ya está en el ticket, qué más conviene ofrecer (con existencia).
async function sugerirParaVenta(sucursalId, ids){
  const enTicket = new Set(ids.map(Number));
  if(!enTicket.size) return [];
  const { reglas, productos } = await ventaConjunta(sucursalId);
  const mejor = {};
  for(const r of reglas){
    if(!enTicket.has(r.a_id) || enTicket.has(r.b_id) || r.confianza < 15) continue;   // solo recomendaciones con respaldo claro
    const p = productos[r.b_id];
    if(!p || p.stock <= 0) continue;
    if(!mejor[r.b_id] || r.confianza > mejor[r.b_id].confianza)
      mejor[r.b_id] = { id: p.id, nombre: p.nombre, ubicacion: p.ubicacion, stock: p.stock, precio: Number(p.precio), requiere_receta: p.requiere_receta,
        confianza: r.confianza, con: r.a, motivo: `${r.confianza} % de quienes llevan ${r.a} también lo llevan.` };
  }
  return Object.values(mejor).sort((a, b) => b.confianza - a.confianza).slice(0, 3);
}

/* ---------- 2. Mínimos sugeridos (punto de reorden) ---------- */
// mínimo = demanda diaria × días de entrega del proveedor + 1.65 × desviación diaria × √(días de entrega)
// El segundo término es el stock de seguridad para un nivel de servicio de 95 %: cubre los días en que se vende
// más de lo normal mientras llega el pedido. Demanda y desviación salen de las ventas de los últimos 90 días.
async function minimosSugeridos(sucursalId, { dias = 90 } = {}){
  const productos = await productosConStock(sucursalId);
  const ventas = await query(`SELECT producto_id, DATE(fecha) AS dia, SUM(cantidad) AS u FROM movimientos
    WHERE sucursal_id = ? AND tipo = 'Salida' AND motivo = 'Venta' AND fecha >= ? GROUP BY producto_id, dia`, [sucursalId, haceDias(dias) + ' 00:00:00']);
  const provs = Object.fromEntries((await query('SELECT id, nombre, dias_entrega FROM proveedores WHERE sucursal_id = ?', [sucursalId])).map(p => [p.id, p]));
  const porProducto = {};
  ventas.forEach(v => (porProducto[v.producto_id] = porProducto[v.producto_id] || []).push(Number(v.u)));
  const lista = [];
  for(const p of productos){
    const serie = porProducto[p.id] || [];
    const total = serie.reduce((a, b) => a + b, 0), media = total / dias;
    const varianza = (serie.reduce((a, v) => a + (v - media) ** 2, 0) + (dias - serie.length) * media ** 2) / dias;   // los días sin venta cuentan como 0
    const desv = Math.sqrt(varianza);
    const prov = provs[p.proveedor_id];
    const entrega = prov ? prov.dias_entrega : 3;
    const seguridad = 1.65 * desv * Math.sqrt(entrega);
    const sugerido = total === 0 ? 0 : Math.max(1, Math.ceil(media * entrega + seguridad));
    const cambio = sugerido - p.stock_minimo;
    const relevante = Math.abs(cambio) >= Math.max(2, p.stock_minimo * 0.25);
    lista.push({ producto_id: p.id, producto: p.nombre, categoria: p.categoria, stock: p.stock, actual: p.stock_minimo, sugerido, cambio, relevante,
      demanda_diaria: r2(media), desviacion: r2(desv), dias_entrega: entrega, proveedor: prov ? prov.nombre : null, seguridad: Math.ceil(seguridad),
      motivo: total === 0 ? `Sin ventas en ${dias} días: no hace falta reservar existencias.`
        : `Vende ~${r2(media)} u. al día${prov ? ` y ${prov.nombre} tarda ${entrega} día(s) en surtir` : ` (sin proveedor asignado: se suponen ${entrega} días de entrega)`}: ` +
          `${Math.ceil(media * entrega)} u. para esperar el pedido + ${Math.ceil(seguridad)} u. de seguridad.` +
          (cambio > 0 ? ' Con el mínimo actual hay riesgo de quedarte sin producto antes de que llegue.' : cambio < 0 ? ' El mínimo actual inmoviliza más dinero del necesario.' : '') });
  }
  return lista.sort((a, b) => Number(b.relevante) - Number(a.relevante) || Math.abs(b.cambio) - Math.abs(a.cambio));
}

/* ---------- 3. Clasificador de altas ---------- */
// Base de conocimiento: sustancia activa → [categoría, ¿requiere receta?]. La receta se marca para antibióticos
// y medicamentos controlados; es una sugerencia y el responsable sanitario debe confirmarla.
const SUSTANCIAS = {
  'paracetamol': ['Analgésicos', 0], 'ibuprofeno': ['Analgésicos', 0], 'naproxeno': ['Analgésicos', 0], 'diclofenaco': ['Analgésicos', 0], 'ketorolaco': ['Analgésicos', 0],
  'metamizol': ['Analgésicos', 0], 'acido acetilsalicilico': ['Analgésicos', 0], 'tramadol': ['Analgésicos', 1], 'meloxicam': ['Analgésicos', 0], 'celecoxib': ['Analgésicos', 0],
  'loratadina': ['Antialérgicos', 0], 'cetirizina': ['Antialérgicos', 0], 'clorfenamina': ['Antialérgicos', 0], 'desloratadina': ['Antialérgicos', 0], 'fexofenadina': ['Antialérgicos', 0], 'levocetirizina': ['Antialérgicos', 0],
  'amoxicilina': ['Antibióticos', 1], 'azitromicina': ['Antibióticos', 1], 'ciprofloxacino': ['Antibióticos', 1], 'cefalexina': ['Antibióticos', 1], 'ceftriaxona': ['Antibióticos', 1],
  'claritromicina': ['Antibióticos', 1], 'ampicilina': ['Antibióticos', 1], 'levofloxacino': ['Antibióticos', 1], 'trimetoprima': ['Antibióticos', 1], 'sulfametoxazol': ['Antibióticos', 1],
  'doxiciclina': ['Antibióticos', 1], 'clindamicina': ['Antibióticos', 1], 'metronidazol': ['Antibióticos', 1], 'nitrofurantoina': ['Antibióticos', 1], 'penicilina': ['Antibióticos', 1],
  'omeprazol': ['Gastrointestinal', 0], 'pantoprazol': ['Gastrointestinal', 0], 'ranitidina': ['Gastrointestinal', 0], 'loperamida': ['Gastrointestinal', 0], 'butilhioscina': ['Gastrointestinal', 0],
  'metoclopramida': ['Gastrointestinal', 0], 'electrolitos': ['Gastrointestinal', 0], 'suero': ['Gastrointestinal', 0], 'subsalicilato': ['Gastrointestinal', 0], 'simeticona': ['Gastrointestinal', 0],
  'senosidos': ['Gastrointestinal', 0], 'esomeprazol': ['Gastrointestinal', 0], 'nitazoxanida': ['Gastrointestinal', 0], 'albendazol': ['Gastrointestinal', 0],
  'clotrimazol': ['Dermatológicos', 0], 'hidrocortisona': ['Dermatológicos', 0], 'miconazol': ['Dermatológicos', 0], 'ketoconazol': ['Dermatológicos', 0], 'betametasona': ['Dermatológicos', 0],
  'mupirocina': ['Dermatológicos', 1], 'terbinafina': ['Dermatológicos', 0], 'aciclovir': ['Dermatológicos', 0], 'oxido de zinc': ['Dermatológicos', 0],
  'ambroxol': ['Respiratorios', 0], 'salbutamol': ['Respiratorios', 1], 'dextrometorfano': ['Respiratorios', 0], 'guaifenesina': ['Respiratorios', 0], 'bromhexina': ['Respiratorios', 0],
  'oximetazolina': ['Respiratorios', 0], 'montelukast': ['Respiratorios', 1], 'budesonida': ['Respiratorios', 1], 'fenilefrina': ['Respiratorios', 0], 'benzonatato': ['Respiratorios', 0],
  'acido ascorbico': ['Vitaminas', 0], 'vitamina': ['Vitaminas', 0], 'complejo b': ['Vitaminas', 0], 'acido folico': ['Vitaminas', 0], 'calcio': ['Vitaminas', 0], 'hierro': ['Vitaminas', 0],
  'zinc': ['Vitaminas', 0], 'multivitaminico': ['Vitaminas', 0], 'omega': ['Vitaminas', 0], 'magnesio': ['Vitaminas', 0],
  'metformina': ['Otro', 1], 'losartan': ['Otro', 1], 'enalapril': ['Otro', 1], 'captopril': ['Otro', 1], 'amlodipino': ['Otro', 1], 'atorvastatina': ['Otro', 1], 'glibenclamida': ['Otro', 1],
  'levotiroxina': ['Otro', 1], 'clonazepam': ['Otro', 1], 'alprazolam': ['Otro', 1], 'sertralina': ['Otro', 1], 'fluoxetina': ['Otro', 1], 'insulina': ['Otro', 1], 'sildenafil': ['Otro', 1],
  'hidroclorotiazida': ['Otro', 1], 'telmisartan': ['Otro', 1], 'pregabalina': ['Otro', 1],
};
// Nombres comerciales frecuentes → sustancia
const MARCAS = { 'tempra': 'paracetamol', 'tylenol': 'paracetamol', 'advil': 'ibuprofeno', 'motrin': 'ibuprofeno', 'aspirina': 'acido acetilsalicilico', 'flanax': 'naproxeno', 'voltaren': 'diclofenaco',
  'clarityne': 'loratadina', 'zyrtec': 'cetirizina', 'allegra': 'fexofenadina', 'amoxil': 'amoxicilina', 'buscapina': 'butilhioscina', 'pepto': 'subsalicilato', 'electrolit': 'electrolitos',
  'canesten': 'clotrimazol', 'mucosolvan': 'ambroxol', 'ventolin': 'salbutamol', 'redoxon': 'acido ascorbico', 'bedoyecta': 'complejo b', 'cevalin': 'acido ascorbico', 'neomelubrina': 'metamizol',
  'dolac': 'ketorolaco', 'glucophage': 'metformina', 'cozaar': 'losartan', 'riopan': 'magnesio', 'afrin': 'oximetazolina' };
const PRESENTACION = [
  [/\b(tab|tabs|tableta|tabletas|comprimido|comprimidos|gragea|grageas)\b/, 'Tableta'], [/\b(cap|caps|capsula|capsulas)\b/, 'Cápsula'], [/\b(jarabe|jbe)\b/, 'Jarabe'],
  [/\b(susp|suspension)\b/, 'Suspensión'], [/\b(iny|inyectable|ampolleta|ampolletas|amp|vial|solucion inyectable)\b/, 'Inyectable'], [/\b(sobre|sobres|polvo)\b/, 'Sobre'],
  [/\b(crema|gel|unguento|pomada|locion)\b/, 'Crema'], [/\b(gotas|gts|oftalmico|otico)\b/, 'Gotas'], [/\b(aerosol|inhalador|spray|nebulizador)\b/, 'Aerosol'],
];
const TITULO = s => s.split(' ').map((w, i) => i === 0 || w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
const ACENTOS = { 'acido acetilsalicilico': 'Ácido acetilsalicílico', 'acido ascorbico': 'Ácido ascórbico', 'acido folico': 'Ácido fólico', 'losartan': 'Losartán', 'telmisartan': 'Telmisartán',
  'senosidos': 'Senósidos', 'multivitaminico': 'Multivitamínico', 'oxido de zinc': 'Óxido de zinc', 'nitrofurantoina': 'Nitrofurantoína', 'electrolitos': 'Electrolitos orales' };

function clasificar(texto, catalogo = []){
  const t = ia.norm(texto);
  if(t.length < 3) return null;
  const palabras = t.split(/[^a-z0-9ñ%.,/]+/).filter(Boolean);
  const res = { sustancia: null, categoria: null, presentacion: null, concentracion: null, requiere_receta: null, confianza: 'baja', explicacion: [] };

  // Concentración y presentación: se leen directamente del texto
  const conc = t.match(/\d+(?:[.,]\d+)?\s?(?:mg|mcg|g|ml|ui|%)(?:\s?\/\s?\d+(?:[.,]\d+)?\s?(?:ml|g))?/);
  if(conc) res.concentracion = conc[0].replace(/\s+/g, '').replace(',', '.');
  const pres = PRESENTACION.find(([re]) => re.test(t));
  if(pres) res.presentacion = pres[1];

  // Sustancia: coincidencia exacta de una frase, marca comercial o la palabra más parecida (tolera faltas)
  let clave = Object.keys(SUSTANCIAS).filter(k => k.includes(' ')).find(k => t.includes(k)), sim = clave ? 1 : 0;
  if(!clave){
    for(const w of palabras){
      if(w.length < 4) continue;
      if(MARCAS[w]){ clave = MARCAS[w]; sim = 1; res.explicacion.push(`"${w}" es un nombre comercial de ${clave}.`); break; }
      for(const k of [...Object.keys(SUSTANCIAS).filter(k => !k.includes(' ')), ...Object.keys(MARCAS)]){
        const s = 1 - ia.distancia(w, k) / Math.max(w.length, k.length);
        if(s > sim && s >= 0.8){ sim = s; clave = MARCAS[k] || k; }
      }
    }
  }
  if(clave){
    const [categoria, receta] = SUSTANCIAS[clave];
    res.sustancia = ACENTOS[clave] || TITULO(clave); res.categoria = categoria; res.requiere_receta = !!receta;
    res.confianza = sim === 1 ? 'alta' : 'media';
    res.explicacion.push(`Reconocí la sustancia ${res.sustancia} (${categoria.toLowerCase()})${receta ? ', que normalmente se vende con receta' : ''}.`);
  }

  // Vecino más parecido en el propio catálogo: sirve para heredar categoría y para avisar de duplicados
  let vecino = null;
  for(const p of catalogo){
    const s = Math.max(ia.similitud(texto, p.nombre), 1 - ia.distancia(t, ia.norm(p.nombre)) / Math.max(t.length, p.nombre.length));
    if(!vecino || s > vecino.s) vecino = { p, s };
  }
  if(vecino && vecino.s >= 0.6){
    res.parecido = { id: vecino.p.id, nombre: vecino.p.nombre, ubicacion: vecino.p.ubicacion, similitud: Math.round(vecino.s * 100), posible_duplicado: ia.norm(vecino.p.nombre) === t || vecino.s >= 0.9 };
    if(!res.categoria){
      res.categoria = vecino.p.categoria; res.sustancia = res.sustancia || vecino.p.sustancia; res.requiere_receta = !!vecino.p.requiere_receta;
      res.confianza = 'media'; res.explicacion.push(`Se parece a ${vecino.p.nombre}, que ya tienes en ${vecino.p.categoria.toLowerCase()}.`);
    }
  }
  if(!res.categoria) res.explicacion.push('No reconocí la sustancia: revisa la categoría manualmente.');
  if(res.categoria && !CATEGORIAS.includes(res.categoria)) res.categoria = 'Otro';
  res.ubicacion = ubicacionSugerida(catalogo, res.categoria);
  return res;
}

// Casilla del anaquel con menos productos; en empate, la fila donde ya hay más productos de la misma categoría.
function ubicacionSugerida(catalogo, categoria){
  const ocupacion = Object.fromEntries(UBICACIONES.map(u => [u, 0])), filaCat = {};
  catalogo.forEach(p => { if(ocupacion[p.ubicacion] !== undefined) ocupacion[p.ubicacion]++; if(p.categoria === categoria) filaCat[p.ubicacion[0]] = (filaCat[p.ubicacion[0]] || 0) + 1; });
  return [...UBICACIONES].sort((a, b) => ocupacion[a] - ocupacion[b] || (filaCat[b[0]] || 0) - (filaCat[a[0]] || 0) || a.localeCompare(b))[0];
}

/* ---------- 4. Qué contar hoy ---------- */
// Contar todo el inventario cada vez es caro; se cuenta un poco cada día, empezando por lo que más importa.
// La puntuación suma: valor para el negocio (clase ABC), control sanitario, señales de anomalía, precio y
// tiempo desde el último conteo.
async function prioridadConteo(sucursalId, n = 8){
  const [abc, raras, ultimos, abiertos] = await Promise.all([
    ia.abcxyz(sucursalId), ia.anomalias(sucursalId, { dias: 30 }),
    query(`SELECT cp.producto_id, MAX(c.fecha) AS f FROM conteo_partidas cp JOIN conteos c ON c.id = cp.conteo_id
           WHERE c.sucursal_id = ? AND c.estado IN ('Aplicado','Por revisar') AND cp.contado IS NOT NULL GROUP BY cp.producto_id`, [sucursalId]),
    query(`SELECT cp.producto_id FROM conteo_partidas cp JOIN conteos c ON c.id = cp.conteo_id WHERE c.sucursal_id = ? AND c.estado IN ('Abierto','Por revisar')`, [sucursalId]),
  ]);
  const clase = Object.fromEntries(abc.items.map(i => [i.id, i.abc]));
  const anom = {}; raras.forEach(a => anom[a.producto_id] = (anom[a.producto_id] || 0) + 1);
  const ultimo = Object.fromEntries(ultimos.map(u => [u.producto_id, u.f.slice(0, 10)]));
  const enCurso = new Set(abiertos.map(a => a.producto_id));
  const productos = await productosConStock(sucursalId);
  return productos.filter(p => !enCurso.has(p.id)).map(p => {
    let puntos = 0; const motivos = [];
    if(clase[p.id] === 'A'){ puntos += 30; motivos.push('de los que más ingreso generan'); } else if(clase[p.id] === 'B') puntos += 15;
    if(p.requiere_receta){ puntos += 20; motivos.push('se vende con receta'); }
    if(anom[p.id]){ puntos += 25; motivos.push(`${anom[p.id]} movimiento(s) inusual(es) este mes`); }
    if(Number(p.precio) >= 100){ puntos += 10; motivos.push('alto valor por pieza'); }
    const dias = ultimo[p.id] ? diasEntre(ultimo[p.id], hoyISO()) : null;
    if(dias === null){ puntos += 25; motivos.push('nunca se ha contado'); } else if(dias > 30){ puntos += 15; motivos.push(`${dias} días sin contarse`); } else puntos -= 20;
    return { producto_id: p.id, producto: p.nombre, ubicacion: p.ubicacion, stock: p.stock + p.stock_vencido, clase: clase[p.id] || 'C', puntos,
      ultimo_conteo: ultimo[p.id] || null, motivo: motivos.length ? motivos.join(', ') + '.' : 'Revisión de rutina.' };
  }).sort((a, b) => b.puntos - a.puntos || a.producto.localeCompare(b.producto)).slice(0, n)
    .map(x => ({ ...x, motivo: x.motivo[0].toUpperCase() + x.motivo.slice(1) }));
}

/* ---------- 5. Demanda no atendida ---------- */
// Los empleados anotan lo que pidió un cliente y no había, como lo escucharon. Para que "metformna 850mg" y
// "Metformina tabs" cuenten como lo mismo se quitan dosis y presentaciones y se agrupan los textos parecidos.
const RUIDO = /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|g|ml|ui|%)?\b|\b(tab|tabs|tabletas?|caps?|capsulas?|jarabe|susp|suspension|crema|gel|gotas|sobres?|inhalador|aerosol|caja|pieza|pzas?|con|de|el|la|para)\b/g;
const claveDe = texto => ia.norm(texto).replace(RUIDO, ' ').replace(/[^a-zñ ]/g, ' ').replace(/\s+/g, ' ').trim();

// Dos solicitudes hablan de lo mismo si el texto completo o su primera palabra (el nombre) se parecen.
function parecidas(a, b){
  const sim = (x, y) => 1 - ia.distancia(x, y) / Math.max(x.length, y.length);
  const pa = a.split(' ')[0], pb = b.split(' ')[0];
  return sim(a, b) >= 0.75 || (pa.length >= 5 && pb.length >= 5 && sim(pa, pb) >= 0.78);
}

async function demandaNoAtendida(sucursalId, { dias = 60 } = {}){
  const filas = await query(`SELECT f.id, f.producto_id, f.texto, f.cantidad, f.fecha, u.nombre AS quien FROM faltantes f LEFT JOIN usuarios u ON u.id = f.usuario_id
    WHERE f.sucursal_id = ? AND f.atendido = 0 AND f.fecha >= ? ORDER BY f.fecha DESC`, [sucursalId, haceDias(dias) + ' 00:00:00']);
  const catalogo = await productosConStock(sucursalId);
  const porId = Object.fromEntries(catalogo.map(p => [p.id, p]));
  const grupos = [];
  for(const f of filas){
    // ¿Corresponde a algo del catálogo? (elegido al registrar, o reconocido por parecido)
    let prod = f.producto_id ? porId[f.producto_id] : null;
    if(!prod){ const [c] = ia.buscarAproximado(catalogo, claveDe(f.texto) || f.texto, { umbral: 0.8, max: 1 }); prod = c ? porId[c.id] : null; }
    const clave = prod ? 'p' + prod.id : claveDe(f.texto) || ia.norm(f.texto);
    let g = grupos.find(x => x.clave === clave) || (!prod && grupos.find(x => !x.producto && parecidas(x.clave, clave)));
    if(!g){ g = { clave, producto: prod || null, textos: {}, ids: [], veces: 0, unidades: 0, ultima: f.fecha }; grupos.push(g); }
    g.textos[f.texto] = (g.textos[f.texto] || 0) + 1; g.ids.push(f.id); g.veces++; g.unidades += f.cantidad;
  }
  return grupos.map(g => {
    const variantes = Object.keys(g.textos);
    // Nombre del grupo: el producto del catálogo; si no, la sustancia reconocida con la dosis más pedida; si no, el texto más repetido
    const masPedido = [...variantes].sort((a, b) => g.textos[b] - g.textos[a] || b.length - a.length)[0];
    const sugerido = g.producto ? null : clasificar(masPedido, catalogo);
    const dosis = {}; variantes.forEach(v => { const d = (clasificar(v) || {}).concentracion; if(d) dosis[d] = (dosis[d] || 0) + g.textos[v]; });
    const dosisComun = Object.keys(dosis).sort((a, b) => dosis[b] - dosis[a])[0];
    const nombre = g.producto ? g.producto.nombre : sugerido && sugerido.sustancia && sugerido.confianza !== 'baja' && !sugerido.parecido ? sugerido.sustancia + (dosisComun ? ' ' + dosisComun : '') : masPedido;
    return { ids: g.ids, nombre, veces: g.veces, unidades: g.unidades, ultima: g.ultima, variantes: variantes.filter(v => ia.norm(v) !== ia.norm(nombre)),
      en_catalogo: !!g.producto, producto_id: g.producto ? g.producto.id : null, stock: g.producto ? g.producto.stock : null,
      categoria_sugerida: sugerido ? sugerido.categoria : null,
      consejo: g.producto
        ? (g.producto.stock > g.producto.stock_minimo ? 'Ya hay existencia: verifica que se esté encontrando en el anaquel.'
          : g.producto.stock > 0 ? `Quedan ${g.producto.stock} u. y lo siguen pidiendo: adelanta la compra y considera subir su mínimo (hoy ${g.producto.stock_minimo}).` : `Se agotó y lo siguieron pidiendo: inclúyelo en la próxima orden y considera subir su mínimo (hoy ${g.producto.stock_minimo}).`)
        : g.veces >= 3 ? 'Lo piden con frecuencia y no está en tu catálogo: conviene darlo de alta.' : 'Aún son pocas solicitudes; obsérvalo unas semanas.' };
  }).sort((a, b) => b.veces - a.veces || b.unidades - a.unidades);
}

module.exports = { ventaConjunta, sugerirParaVenta, minimosSugeridos, clasificar, ubicacionSugerida, prioridadConteo, demandaNoAtendida };
