/* =====================================================================
   turno.js : "Mi turno" — qué hice hoy y qué me toca hacer.
   Las tareas no se capturan a mano: las genera el sistema a partir del
   estado del inventario y las ordena por urgencia (IA de priorización).
   ===================================================================== */
const { query } = require('../db');
const { hoyISO, diasEntre } = require('../utils');
const { LIMITES_PLAN } = require('../constants');
const { resumenAlertas } = require('./inventario');
const ia = require('./ia');
const { demandaNoAtendida } = require('./operacion');

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const lista = (arr, max = 3) => arr.slice(0, max).join(', ') + (arr.length > max ? ` y ${arr.length - max} más` : '');

async function ventasDe(sucursalId, desde, hasta, usuarioId = null){
  const filas = await query(`SELECT v.usuario_id, u.nombre, COUNT(DISTINCT v.id) AS tickets, COALESCE(SUM(m.cantidad), 0) AS unidades, COALESCE(SUM(m.cantidad * p.precio), 0) AS importe
    FROM ventas v JOIN movimientos m ON m.venta_id = v.id AND m.tipo = 'Salida' JOIN productos p ON p.id = m.producto_id LEFT JOIN usuarios u ON u.id = v.usuario_id
    WHERE v.sucursal_id = ? AND v.estado = 'Completada' AND v.fecha BETWEEN ? AND ? ${usuarioId ? 'AND v.usuario_id = ?' : ''} GROUP BY v.usuario_id`,
    [sucursalId, desde + ' 00:00:00', hasta + ' 23:59:59', ...(usuarioId ? [usuarioId] : [])]);
  return filas.map(f => ({ ...f, tickets: Number(f.tickets), unidades: Number(f.unidades), importe: Math.round(Number(f.importe) * 100) / 100 }));
}

async function miTurno(user){
  const sid = user.sucursal_id, hoy = hoyISO(), gerente = user.rol === 'dueno';
  const hace = n => { const d = new Date(hoy + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const [suc] = await query('SELECT plan FROM sucursales WHERE id = ?', [sid]);
  const analitica = gerente && LIMITES_PLAN[suc.plan].analitica;

  const [hoyVentas, previas, alertas, conteos, mermasHoy] = await Promise.all([
    ventasDe(sid, hoy, hoy), ventasDe(sid, hace(28), hace(1), gerente ? null : user.id), resumenAlertas(sid),
    query(`SELECT c.id, c.folio, c.estado, c.asignado_a, COUNT(cp.id) AS n, SUM(cp.contado IS NULL) AS faltan FROM conteos c JOIN conteo_partidas cp ON cp.conteo_id = c.id
           WHERE c.sucursal_id = ? AND c.estado IN ('Abierto','Por revisar') GROUP BY c.id`, [sid]),
    query(`SELECT COALESCE(SUM(cantidad), 0) AS u FROM movimientos WHERE sucursal_id = ? AND usuario_id = ? AND tipo = 'Salida' AND motivo LIKE 'Merma%' AND fecha >= ?`, [sid, user.id, hoy + ' 00:00:00']),
  ]);
  const mias = hoyVentas.find(v => v.usuario_id === user.id) || { tickets: 0, unidades: 0, importe: 0 };
  const total = hoyVentas.reduce((s, v) => ({ tickets: s.tickets + v.tickets, unidades: s.unidades + v.unidades, importe: s.importe + v.importe }), { tickets: 0, unidades: 0, importe: 0 });
  // Promedio diario de las últimas 4 semanas (del empleado, o de toda la sucursal para el gerente)
  const promedio = Math.round(previas.reduce((s, v) => s + v.tickets, 0) / 28 * 10) / 10;

  const tareas = [];
  const tarea = (prioridad, tipo, titulo, detalle, href, accion) => tareas.push({ prioridad, tipo, titulo, detalle, href, accion });

  if(alertas.caducados.length) tarea(100, 'caducado', `Retirar ${plural(alertas.caducados.length, 'lote caducado', 'lotes caducados')}`,
    `${lista(alertas.caducados.map(l => `${l.producto} (lote ${l.lote}, ${l.cantidad} u.)`))}. No deben venderse: regístralos como merma y sepáralos del anaquel.`, 'salidas.html', 'Registrar merma');
  for(const c of conteos){
    const esMio = c.asignado_a === user.id || (!c.asignado_a && !gerente);
    if(c.estado === 'Abierto' && (esMio || (gerente && !c.asignado_a)))
      tarea(85, 'conteo', `Contar ${plural(Number(c.n), 'medicamento', 'medicamentos')} (${c.folio})`, Number(c.faltan) < Number(c.n) ? `Llevas ${c.n - c.faltan} de ${c.n}. Termina y envíalo a revisión.` : 'Cuenta las piezas que hay físicamente en cada casilla y captúralas.', 'conteo.html?id=' + c.id, 'Empezar a contar');
    if(c.estado === 'Por revisar' && gerente) tarea(80, 'conteo', `Revisar el conteo ${c.folio}`, 'Ya se terminó de contar. Revisa las diferencias y aplica los ajustes.', 'conteo.html?id=' + c.id, 'Revisar diferencias');
  }
  if(alertas.porVencer.length) tarea(70, 'por-vencer', `Dar salida primero a ${plural(alertas.porVencer.length, 'lote por vencer', 'lotes por vencer')}`,
    `${lista(alertas.porVencer.map(l => `${l.producto} (${l.dias} día${l.dias === 1 ? '' : 's'})`))}. Ponlos al frente de su casilla y ofrécelos antes que otros lotes.`, 'caducidades.html', 'Ver caducidades');

  if(gerente){
    const ordenes = await query(`SELECT o.id, o.folio, o.estado, o.fecha_envio, pr.nombre AS proveedor, pr.dias_entrega FROM ordenes_compra o LEFT JOIN proveedores pr ON pr.id = o.proveedor_id
      WHERE o.sucursal_id = ? AND o.estado IN ('Borrador','Enviada')`, [sid]);
    for(const o of ordenes.filter(o => o.estado === 'Enviada')){
      const dias = diasEntre(o.fecha_envio.slice(0, 10), hoy), retraso = dias - (o.dias_entrega || 3);
      tarea(retraso > 0 ? 78 : 45, 'orden', `${retraso > 0 ? 'Reclamar' : 'Recibir'} la orden ${o.folio} de ${o.proveedor || 'proveedor sin asignar'}`,
        retraso > 0 ? `Se envió hace ${dias} días y ${o.proveedor} suele tardar ${o.dias_entrega}: lleva ${plural(retraso, 'día', 'días')} de retraso.` : `Se envió ${dias === 0 ? 'hoy' : 'hace ' + plural(dias, 'día', 'días')}; ${o.proveedor || 'el proveedor'} suele tardar ${o.dias_entrega || 3}. Cuando llegue, captura lote y caducidad.`,
        'orden.html?id=' + o.id, 'Abrir orden');
    }
    const borradores = ordenes.filter(o => o.estado === 'Borrador');
    if(borradores.length) tarea(60, 'orden', `Revisar y enviar ${plural(borradores.length, 'orden en borrador', 'órdenes en borrador')}`, `${lista(borradores.map(o => o.folio))} aún no se envían al proveedor.`, 'compras.html', 'Ver órdenes');
    const pedidos = await query(`SELECT DISTINCT op.producto_id FROM orden_partidas op JOIN ordenes_compra o ON o.id = op.orden_id WHERE o.sucursal_id = ? AND o.estado IN ('Borrador','Enviada')`, [sid]);
    const sinPedir = alertas.stockBajo.filter(p => !pedidos.some(x => x.producto_id === p.id));
    if(sinPedir.length) tarea(75, 'stock', `Pedir ${plural(sinPedir.length, 'medicamento en el mínimo', 'medicamentos en el mínimo')}`,
      `${lista(sinPedir.map(p => `${p.nombre} (${p.stock} u.)`))} no están en ninguna orden. La IA puede armar las órdenes por proveedor.`, 'compras.html', 'Generar órdenes');
    const demanda = (await demandaNoAtendida(sid)).filter(d => d.veces >= 3);
    if(demanda.length) tarea(55, 'demanda', `Los clientes pidieron ${lista(demanda.map(d => d.nombre), 2)} y no había`,
      `${demanda.map(d => `${d.nombre}: ${d.veces} veces`).slice(0, 3).join(' · ')}. ${demanda.some(d => !d.en_catalogo) ? 'Alguno no está en tu catálogo.' : ''}`.trim(), 'compras.html#demanda', 'Ver lo que piden');
    if(analitica){
      const graves = (await ia.anomalias(sid, { dias: 7 })).filter(a => a.nivel === 'Alta');
      if(graves.length) tarea(65, 'anomalia', `Revisar ${plural(graves.length, 'movimiento inusual', 'movimientos inusuales')} de la semana`,
        `Ejemplo: ${graves[0].producto}, ${graves[0].cantidad} u. registradas por ${graves[0].responsable}.`, 'ia.html#anomalias', 'Ver detalle');
    }
  }else{
    const agotados = alertas.stockBajo.filter(p => p.stock === 0);
    if(agotados.length) tarea(50, 'stock', `${plural(agotados.length, 'medicamento agotado', 'medicamentos agotados')}: ofrece alternativas`,
      `${lista(agotados.map(p => p.nombre))}. Si te lo piden, busca el producto y el sistema te sugiere con qué sustituirlo; anótalo también como "no había".`, 'buscar.html', 'Buscar alternativas');
    const pocos = alertas.stockBajo.filter(p => p.stock > 0);
    if(pocos.length) tarea(35, 'stock', `Quedan pocas piezas de ${plural(pocos.length, 'medicamento', 'medicamentos')}`, `${lista(pocos.map(p => `${p.nombre} (${p.stock} u.)`), 4)}. Avisa al gerente si alguno se termina.`, 'inventario.html', 'Ver existencias');
  }
  tareas.sort((a, b) => b.prioridad - a.prioridad);
  tareas.forEach(t => t.nivel = t.prioridad >= 80 ? 'Urgente' : t.prioridad >= 60 ? 'Hoy' : 'Cuando puedas');

  // Resumen redactado
  const yo = gerente ? total : mias;
  const frases = [];
  frases.push(yo.tickets ? `${gerente ? 'La sucursal lleva' : 'Llevas'} ${plural(yo.tickets, 'venta', 'ventas')} hoy (${plural(yo.unidades, 'pieza', 'piezas')}, $${Math.round(yo.importe).toLocaleString('es-MX')}).`
                         : `${gerente ? 'Aún no hay ventas registradas hoy' : 'Aún no registras ventas hoy'}.`);
  if(promedio > 0) frases.push(`${gerente ? 'El promedio' : 'Tu promedio'} de las últimas 4 semanas es de ${promedio} al día.`);
  const urgentes = tareas.filter(t => t.nivel === 'Urgente').length;
  frases.push(tareas.length ? `Tienes ${plural(tareas.length, 'pendiente', 'pendientes')}${urgentes ? `, ${urgentes} urgente${urgentes > 1 ? 's' : ''}` : ''}${urgentes ? ': empieza por ' + tareas[0].titulo.toLowerCase() + '.' : '.'}` : 'No tienes pendientes: todo está en orden.');

  return { fecha: hoy, rol: user.rol, resumen: frases.join(' '), mias: { ...mias, mermas: Number(mermasHoy[0].u) }, sucursal: gerente ? total : null, promedio_diario: promedio, tareas,
    equipo: gerente ? hoyVentas.map(v => ({ nombre: v.nombre || 'Sin usuario', tickets: v.tickets, unidades: v.unidades, importe: v.importe })).sort((a, b) => b.importe - a.importe) : null };
}

module.exports = { miTurno };
