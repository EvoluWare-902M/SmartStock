/* =====================================================================
   asistente.js : asistente conversacional de SmartStock

   Funciona en dos modos:

   · MODO LOCAL (siempre disponible, sin internet)
     Un motor propio reconoce la intención de la pregunta por palabras clave,
     identifica el medicamento mencionado con búsqueda tolerante a errores y
     arma la respuesta con los datos reales de la sucursal.

   · MODO MODELO DE LENGUAJE (opcional)
     Si en .env se define ANTHROPIC_API_KEY, la pregunta se envía a la API de
     Claude junto con un resumen de los datos de la sucursal, y el modelo
     redacta la respuesta. Si la llamada falla, se responde en modo local.
     Aviso: en este modo el resumen del inventario sale hacia un servicio
     externo de pago.
   ===================================================================== */
const { query } = require('../db');
const { LIMITES_PLAN } = require('../constants');
const { productosConStock, lotesDeProducto, lotesSucursal, resumenAlertas } = require('./inventario');
const { prediccion, recomendaciones } = require('./prediccion');
const ia = require('./ia');
const operacion = require('./operacion');
const { miTurno } = require('./turno');

const MODELO = () => process.env.ASISTENTE_MODELO || 'claude-haiku-4-5-20251001';
const modeloDisponible = () => !!(process.env.ANTHROPIC_API_KEY || '').trim();
const fecha = iso => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${Number(d)}/${m}/${y}`; };

async function planCon(user){
  const [s] = await query('SELECT plan FROM sucursales WHERE id = ?', [user.sucursal_id]);
  return { plan: s.plan, analitica: user.rol === 'dueno' && LIMITES_PLAN[s.plan].analitica };
}

// Encuentra el medicamento mencionado en una frase, tolerando errores de escritura.
function productoMencionado(texto, productos){
  const palabras = ia.norm(texto).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 4);
  let mejor = null;
  for(const p of productos){
    const claves = [ia.norm(p.nombre).split(/\s+/)[0], ia.norm(p.sustancia).split(/\s+/)[0], ia.norm(p.codigo)].filter(c => c && c.length >= 4);
    for(const w of palabras) for(const c of claves){
      const s = 1 - ia.distancia(w, c) / Math.max(w.length, c.length);
      if(s >= 0.72 && (!mejor || s > mejor.s)) mejor = { p, s };
    }
  }
  return mejor ? mejor.p : null;
}

/* ---------------------------------------------------------------------
   MODO LOCAL: intenciones
   Cada intención tiene un patrón, si requiere el plan con analítica, y una
   función que arma la respuesta. Se evalúan en orden.
   --------------------------------------------------------------------- */
const INTENCIONES = [
  { id: 'ordenes', dueno: true, patron: /orden(es)? de compra|ordenes? (pendiente|abierta|enviada)|por recibir|viene en camino|pedidos? pendiente|que viene|cuando llega|proveedor/, async responder({ user }){
      const o = await query(`SELECT o.folio, o.estado, o.fecha_envio, pr.nombre AS proveedor, pr.dias_entrega, COUNT(op.id) AS n FROM ordenes_compra o
        LEFT JOIN proveedores pr ON pr.id = o.proveedor_id LEFT JOIN orden_partidas op ON op.orden_id = o.id
        WHERE o.sucursal_id = ? AND o.estado IN ('Borrador','Enviada') GROUP BY o.id ORDER BY o.fecha`, [user.sucursal_id]);
      if(!o.length) return 'No hay órdenes de compra abiertas. Puedo armarlas por ti desde Compras → "Generar órdenes con IA".';
      return `Hay ${o.length} orden(es) abiertas:\n` + o.map(x => `• ${x.folio} · ${x.proveedor || 'sin proveedor'} · ${x.n} producto(s) · ${x.estado === 'Enviada' ? `enviada el ${fecha(x.fecha_envio)}, se espera en ${x.dias_entrega} día(s)` : 'en borrador, sin enviar'}`).join('\n');
  }, enlace: () => ({ texto: 'Ver órdenes de compra', href: 'compras.html' }) },
  { id: 'turno', patron: /mi turno|pendiente|tarea|que me toca|que tengo que hacer|como voy|cuanto llevo|cuanto he vendido|que hago/, async responder({ user }){
      const t = await miTurno(user);
      return t.resumen + (t.tareas.length ? '\n' + t.tareas.slice(0, 5).map(x => `• [${x.nivel}] ${x.titulo}`).join('\n') : '');
  }, enlace: () => ({ texto: 'Abrir Mi turno', href: 'turno.html' }) },
  { id: 'juntos', patron: /junto|combin|acompa|tambien llevan|se vende con|ofrecer con|venta cruzada/, async responder({ user, producto }){
      const { reglas, tickets } = await operacion.ventaConjunta(user.sucursal_id);
      const suyas = producto ? reglas.filter(r => r.a_id === producto.id) : reglas;
      if(!suyas.length) return producto ? `En los tickets de los últimos 6 meses no encontré un producto que se lleve con frecuencia junto con ${producto.nombre}.` : 'Todavía no hay suficientes tickets con varios productos para encontrar patrones.';
      return (producto ? `Quien lleva ${producto.nombre} suele llevar también:\n` : `En ${tickets} tickets analizados, estas son las combinaciones más frecuentes:\n`) +
        suyas.slice(0, 5).map(r => producto ? `• ${r.b} (${r.confianza} % de las veces)` : `• ${r.a} + ${r.b}: ${r.juntos} tickets (${r.confianza} % de quienes llevan el primero)`).join('\n') + '\nOfrecerlo en el mostrador ayuda al cliente y a la venta.';
  }, enlace: () => ({ texto: 'Ir al punto de venta', href: 'venta.html' }) },
  { id: 'no-surtido', dueno: true, patron: /pidieron|piden|no habia|no tenemos|no se surtio|demanda no atendida|solicitan/, async responder({ user }){
      const d = await operacion.demandaNoAtendida(user.sucursal_id);
      if(!d.length) return 'No hay solicitudes de clientes sin surtir anotadas en los últimos 60 días.';
      return 'Lo que más pidieron los clientes y no se pudo surtir (60 días):\n' + d.slice(0, 6).map(x => `• ${x.nombre}: ${x.veces} ${x.veces === 1 ? 'vez' : 'veces'}${x.en_catalogo ? '' : ' — no está en tu catálogo'}`).join('\n');
  }, enlace: () => ({ texto: 'Ver demanda no atendida', href: 'compras.html#demanda' }) },
  { id: 'alternativa', patron: /alternativ|sustitu|equivalent|reemplaz|otra opcion|en lugar de/, async responder({ user, producto }){
      if(!producto) return 'Dime de qué medicamento buscas alternativa, por ejemplo: "alternativas para amoxicilina".';
      const alt = await ia.alternativas(user.sucursal_id, producto.id);
      if(!alt.length) return `No encontré otro medicamento con existencia que sustituya a ${producto.nombre}.`;
      return `Alternativas con existencia para ${producto.nombre}:\n` + alt.map(a => `• ${a.nombre} — anaquel ${a.ubicacion}, ${a.stock} u. (${a.afinidad.toLowerCase()})${a.requiere_receta ? ', requiere receta' : ''}`).join('\n') +
        '\nRecuerda que la sustitución debe autorizarla el médico o el responsable sanitario.';
  } },
  { id: 'ubicacion', patron: /donde|ubicaci|localiz|anaquel|encuentr|led/, async responder({ producto }){
      if(!producto) return '¿Qué medicamento quieres localizar? Escribe por ejemplo: "¿dónde está el omeprazol?"';
      const lotes = await lotesDeProducto(producto.id); const prio = lotes.find(l => l.dias >= 0);
      return `${producto.nombre} está en el anaquel ${producto.ubicacion}. Hay ${producto.stock} u. disponibles` +
        (prio ? `; surte primero el lote ${prio.numero_lote}, que caduca el ${fecha(prio.caducidad)} (${prio.dias} días).` : '.') +
        (producto.requiere_receta ? ' Requiere receta.' : '');
  }, enlace: p => p ? { texto: 'Encender su LED', href: 'buscar.html?q=' + encodeURIComponent(p.nombre) } : null },
  { id: 'comprar', analitica: true, patron: /compr|pedir|pedido|reabast|resurt|orden|surtir/, async responder({ user }){
      const r = await recomendaciones(user.sucursal_id);
      if(!r.length) return 'Por ahora no hace falta comprar: el stock cubre la demanda estimada del mes.';
      const total = r.reduce((s, x) => s + x.costo_estimado, 0);
      return `El modelo sugiere reabastecer ${r.length} producto(s), con una inversión estimada de $${Math.round(total).toLocaleString('es-MX')}:\n` +
        r.slice(0, 6).map(x => `• ${x.producto}: ${x.cantidad} u. (prioridad ${x.prioridad.toLowerCase()}, quedan ${x.stock})`).join('\n') + (r.length > 6 ? `\n…y ${r.length - 6} más.` : '');
  }, enlace: () => ({ texto: 'Ver recomendación de compras', href: 'recomendacion.html' }) },
  { id: 'prediccion', analitica: true, patron: /predic|pronost|demanda|se vendera|proximo mes|temporada/, async responder({ user, producto }){
      if(producto){
        const d = await prediccion(user.sucursal_id, { productoId: producto.id });
        return `Para ${producto.nombre} el modelo estima ${d.pronostico.map(p => `${p.valor} u. en ${p.etiqueta}`).join(', ')}. ` +
          (d.metodo === 'descomposicion-estacional' ? `Su temporada alta es alrededor de ${d.mesPico} y la tendencia anual es de ${d.tendenciaAnual > 0 ? '+' : ''}${d.tendenciaAnual}%.` : 'Aún tiene poca historia para calcular su estacionalidad.');
      }
      const d = await prediccion(user.sucursal_id);
      if(d.sinDatos) return 'Todavía no hay ventas registradas para estimar la demanda.';
      return 'Demanda estimada para este mes, por categoría:\n' + d.resumen.map(r => `• ${r.categoria}: ${r.proximoMes} u. (temporada alta en ${r.mesPico})`).join('\n');
  }, enlace: () => ({ texto: 'Ver predicción de demanda', href: 'prediccion.html' }) },
  { id: 'anomalias', analitica: true, patron: /anomal|raro|inusual|sospech|extra[nñ]o|irregular/, async responder({ user }){
      const a = await ia.anomalias(user.sucursal_id);
      if(!a.length) return 'No detecté movimientos fuera de lo normal en los últimos 30 días.';
      return `Detecté ${a.length} movimiento(s) inusuales en 30 días. Los más relevantes:\n` +
        a.slice(0, 4).map(x => `• ${fecha(x.fecha)} · ${x.producto}: ${x.motivo} (registró ${x.responsable})`).join('\n');
  }, enlace: () => ({ texto: 'Ver análisis inteligente', href: 'ia.html#anomalias' }) },
  { id: 'caducidad', patron: /caduc|vence|vencimiento|expira|merma/, async responder({ user, producto, analitica }){
      const lotes = await lotesSucursal(user.sucursal_id);
      if(producto){
        const suyos = lotes.filter(l => l.producto_id === producto.id);
        return suyos.length ? `Lotes de ${producto.nombre}:\n` + suyos.map(l => `• ${l.numero_lote}: ${l.cantidad} u., ${l.dias < 0 ? 'CADUCADO' : 'caduca el ' + fecha(l.caducidad) + ' (' + l.dias + ' días)'}`).join('\n') : `${producto.nombre} no tiene lotes con existencia.`;
      }
      const cad = lotes.filter(l => l.dias < 0), urg = lotes.filter(l => l.dias >= 0 && l.dias <= 15), prox = lotes.filter(l => l.dias > 15 && l.dias <= 45);
      let t = `Hay ${cad.length} lote(s) caducado(s), ${urg.length} que vencen en 15 días o menos y ${prox.length} en los próximos 45 días.`;
      [...cad, ...urg].slice(0, 5).forEach(l => t += `\n• ${l.producto} · lote ${l.numero_lote}: ${l.cantidad} u., ${l.dias < 0 ? 'caducado' : 'vence en ' + l.dias + ' días'}`);
      if(analitica){ const r = (await ia.riesgoCaducidad(user.sucursal_id)).filter(x => x.nivel === 'Alto'); if(r.length) t += `\nSegún el ritmo de venta, ${r.length} lote(s) probablemente no se venderán a tiempo.`; }
      return t;
  }, enlace: () => ({ texto: 'Ver caducidades', href: 'caducidades.html' }) },
  { id: 'stock-bajo', patron: /stock bajo|faltant|agotad|por acabar|se acab|minimo|poco stock|que falta/, async responder({ user }){
      const a = await resumenAlertas(user.sucursal_id);
      if(!a.stockBajo.length) return 'Ningún medicamento está en o por debajo de su mínimo.';
      return `${a.stockBajo.length} medicamento(s) están en o por debajo del mínimo:\n` + a.stockBajo.map(p => `• ${p.nombre}: ${p.stock} de ${p.minimo} u. (anaquel ${p.ubicacion})`).join('\n');
  }, enlace: () => ({ texto: 'Ver existencias', href: 'inventario.html' }) },
  { id: 'mas-vendido', patron: /mas vendid|se vende mas|top|mejor vendid|mas salida|mayor rotacion/, async responder({ user }){
      const desde = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const t = await query(`SELECT p.nombre, SUM(m.cantidad) AS u FROM movimientos m JOIN productos p ON p.id = m.producto_id
        WHERE m.sucursal_id = ? AND m.tipo = 'Salida' AND m.motivo = 'Venta' AND m.fecha >= ? GROUP BY p.id ORDER BY u DESC LIMIT 5`, [user.sucursal_id, desde]);
      return t.length ? 'Los más vendidos en los últimos 30 días:\n' + t.map((x, i) => `${i + 1}. ${x.nombre}: ${x.u} u.`).join('\n') : 'Aún no hay ventas registradas en los últimos 30 días.';
  } },
  { id: 'existencia', patron: /cuant|existenc|stock|quedan|hay de|tenemos|inventario/, async responder({ user, producto, productos }){
      if(producto) return `De ${producto.nombre} hay ${producto.stock} u. disponibles (mínimo ${producto.stock_minimo}), en el anaquel ${producto.ubicacion}.` +
        (producto.stock_bajo ? ' Está en o por debajo del mínimo.' : '') + (producto.stock_vencido ? ` Además hay ${producto.stock_vencido} u. caducadas por retirar.` : '');
      const bajos = productos.filter(p => p.stock_bajo).length;
      return `El catálogo tiene ${productos.length} medicamentos y ${productos.reduce((s, p) => s + p.stock, 0)} unidades disponibles; ${bajos} están en o por debajo del mínimo. Pregúntame por uno en particular, por ejemplo "¿cuánto hay de loratadina?".`;
  } },
];

const EJEMPLOS = { todos: ['¿Dónde está el paracetamol?', '¿Qué tengo pendiente?', '¿Cuánto hay de amoxicilina?', '¿Qué está por caducar?', '¿Qué se vende junto con amoxicilina?', 'Alternativas para ibuprofeno'],
                   analitica: ['¿Qué debo comprar?', '¿Cuál es la demanda de antibióticos?', '¿Hay movimientos raros?'] };

async function responderLocal(mensaje, user, ctx){
  const texto = ia.norm(mensaje);
  const productos = ctx.productos;
  const producto = productoMencionado(mensaje, productos);
  const intencion = INTENCIONES.find(i => i.patron.test(texto)) || (producto ? INTENCIONES.find(i => i.id === 'existencia') : null);

  if(!intencion) return { respuesta: 'Puedo ayudarte con tus pendientes del turno, ubicaciones, existencias, caducidades, stock bajo, alternativas y qué productos se venden juntos' + (ctx.analitica ? ', compras sugeridas, predicción de demanda y movimientos inusuales' : '') + '. Prueba con una de las sugerencias.', enlace: null };
  if(intencion.dueno && user.rol !== 'dueno') return { respuesta: 'Esa consulta solo está disponible para el gerente de la sucursal.', enlace: null };
  if(intencion.analitica && !ctx.analitica)
    return { respuesta: user.rol === 'dueno' ? `Esa consulta usa el análisis predictivo, incluido en los planes Profesional y Empresarial (tu plan actual es ${ctx.plan}).` : 'Esa consulta solo está disponible para el gerente de la sucursal.', enlace: null };
  const respuesta = await intencion.responder({ user, producto, productos, analitica: ctx.analitica });
  return { respuesta, enlace: intencion.enlace ? intencion.enlace(producto) : null };
}

/* ---------------------------------------------------------------------
   MODO MODELO DE LENGUAJE
   --------------------------------------------------------------------- */
async function contextoParaModelo(user, ctx){
  const sid = user.sucursal_id;
  const lotes = await lotesSucursal(sid);
  const c = {
    fecha_de_hoy: new Date().toISOString().slice(0, 10), plan: ctx.plan, rol_de_quien_pregunta: user.rol === 'dueno' ? 'gerente' : 'empleado',
    catalogo: ctx.productos.map(p => ({ nombre: p.nombre, sustancia: p.sustancia, categoria: p.categoria, anaquel: p.ubicacion, stock: p.stock, minimo: p.stock_minimo, receta: p.requiere_receta, precio: Number(p.precio) })),
    lotes_por_caducidad: lotes.slice(0, 25).map(l => ({ producto: l.producto, lote: l.numero_lote, caducidad: l.caducidad, dias_restantes: l.dias, cantidad: l.cantidad })),
  };
  if(ctx.analitica){
    const [recos, raras, abc, riesgo, pred] = await Promise.all([recomendaciones(sid), ia.anomalias(sid), ia.abcxyz(sid), ia.riesgoCaducidad(sid), prediccion(sid)]);
    c.compras_sugeridas = recos.slice(0, 12).map(r => ({ producto: r.producto, comprar: r.cantidad, prioridad: r.prioridad, costo_estimado: r.costo_estimado, motivo: r.motivo }));
    c.movimientos_inusuales = raras.slice(0, 8).map(a => ({ fecha: a.fecha, producto: a.producto, cantidad: a.cantidad, responsable: a.responsable, motivo: a.motivo }));
    c.clasificacion_abc = abc.items.map(i => ({ producto: i.nombre, clase: i.clase, valor_vendido_6_meses: i.valor }));
    c.lotes_en_riesgo_de_caducar = riesgo.slice(0, 8).map(r => ({ producto: r.producto, lote: r.lote, unidades_en_riesgo: r.en_riesgo, nivel: r.nivel, accion: r.accion }));
    if(!pred.sinDatos) c.demanda_estimada_por_categoria = pred.resumen;
  }
  return c;
}

async function responderConModelo(mensaje, historial, user, ctx){
  const contexto = await contextoParaModelo(user, ctx);
  const sistema = `Eres el asistente de SmartStock, un sistema de inventario para farmacias en México. Respondes en español, de forma breve y directa (máximo 6 líneas o una lista corta).
Responde ÚNICAMENTE con los datos del inventario que aparecen abajo; si la respuesta no está en ellos, dilo y sugiere en qué pantalla de SmartStock consultarlo. No inventes cantidades, lotes ni precios.
No des consejo médico ni recomiendes tratamientos: si preguntan por sustituciones, aclara que debe autorizarlas el médico o el responsable sanitario.
No uses formato Markdown: escribe texto plano y usa "•" para listas.

DATOS DE LA SUCURSAL (JSON):
${JSON.stringify(contexto)}`;

  const messages = [...historial.slice(-6).map(h => ({ role: h.rol === 'asistente' ? 'assistant' : 'user', content: String(h.texto).slice(0, 1500) })), { role: 'user', content: mensaje }];
  const ctrl = new AbortController(); const reloj = setTimeout(() => ctrl.abort(), 25000);
  try{
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY.trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODELO(), max_tokens: 600, system: sistema, messages }),
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data?.error?.message || 'Error ' + res.status);
    const texto = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if(!texto) throw new Error('Respuesta vacía');
    return texto;
  }finally{ clearTimeout(reloj); }
}

/* ---------- punto de entrada ---------- */
async function responder(mensaje, historial, user){
  const { plan, analitica } = await planCon(user);
  const ctx = { plan, analitica, productos: await productosConStock(user.sucursal_id) };
  const sugerencias = [...EJEMPLOS.todos, ...(analitica ? EJEMPLOS.analitica : [])];

  if(modeloDisponible()){
    try{
      const respuesta = await responderConModelo(mensaje, Array.isArray(historial) ? historial : [], user, ctx);
      return { respuesta, modo: 'modelo', enlace: null, sugerencias };
    }catch(e){
      console.error('Asistente: falló el modelo de lenguaje, se responde en modo local →', e.message);
      const local = await responderLocal(mensaje, user, ctx);
      return { ...local, modo: 'local', aviso: 'No se pudo consultar el modelo de lenguaje; respondí con el motor local.', sugerencias };
    }
  }
  return { ...(await responderLocal(mensaje, user, ctx)), modo: 'local', sugerencias };
}

module.exports = { responder, modeloDisponible, MODELO, EJEMPLOS, planCon };
