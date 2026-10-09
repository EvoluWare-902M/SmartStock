/* ===== inventario.js : consultas de existencias reutilizables ===== */
const { query } = require('../db');
const { hoyISO, ahoraSQL, diasEntre, HttpError } = require('../utils');
const { DIAS_ALERTA_CADUCIDAD, DIAS_URGENTE_CADUCIDAD } = require('../constants');

// Productos de una sucursal con su existencia calculada a partir de los lotes.
// stock          = unidades en lotes vigentes (no caducados) → disponibles para venta
// stock_vencido  = unidades en lotes ya caducados (deben retirarse como merma)
async function productosConStock(sucursalId, { productoId = null, incluirInactivos = false } = {}){
  const hoy = hoyISO();
  const rows = await query(`
    SELECT p.*, (SELECT pr.nombre FROM proveedores pr WHERE pr.id = p.proveedor_id) AS proveedor_nombre,
      COALESCE(SUM(CASE WHEN l.caducidad >= ? THEN l.cantidad END), 0) AS stock,
      COALESCE(SUM(CASE WHEN l.caducidad <  ? THEN l.cantidad END), 0) AS stock_vencido,
      MIN(CASE WHEN l.cantidad > 0 AND l.caducidad >= ? THEN l.caducidad END) AS proxima_caducidad
    FROM productos p
    LEFT JOIN lotes l ON l.producto_id = p.id AND l.cantidad > 0
    WHERE p.sucursal_id = ? ${incluirInactivos ? '' : 'AND p.activo = 1'} ${productoId ? 'AND p.id = ?' : ''}
    GROUP BY p.id
    ORDER BY p.nombre`, productoId ? [hoy, hoy, hoy, sucursalId, productoId] : [hoy, hoy, hoy, sucursalId]);
  return rows.map(p => ({
    ...p,
    requiere_receta: !!p.requiere_receta,
    stock: Number(p.stock), stock_vencido: Number(p.stock_vencido),
    stock_bajo: Number(p.stock) <= p.stock_minimo,
  }));
}

function estadoCaducidad(caducidad){
  const dias = diasEntre(hoyISO(), caducidad);
  let color = 'verde', etiqueta = 'Vigente';
  if(dias < 0){ color = 'rojo'; etiqueta = 'Caducado'; }
  else if(dias <= DIAS_URGENTE_CADUCIDAD){ color = 'rojo'; etiqueta = 'Urgente'; }
  else if(dias <= DIAS_ALERTA_CADUCIDAD){ color = 'amarillo'; etiqueta = 'Próximo'; }
  return { dias, color, etiqueta };
}

// Lotes con existencia de un producto, ordenados por caducidad (FEFO:
// primero en caducar, primero en salir).
async function lotesDeProducto(productoId, { incluirVacios = false } = {}){
  const rows = await query(`SELECT * FROM lotes WHERE producto_id = ? ${incluirVacios ? '' : 'AND cantidad > 0'}
                            ORDER BY caducidad ASC, id ASC`, [productoId]);
  return rows.map(l => ({ ...l, ...estadoCaducidad(l.caducidad) }));
}

// Todos los lotes con existencia de la sucursal (control de caducidades).
async function lotesSucursal(sucursalId){
  const rows = await query(`SELECT l.*, p.nombre AS producto, p.codigo, p.ubicacion
                            FROM lotes l JOIN productos p ON p.id = l.producto_id
                            WHERE p.sucursal_id = ? AND p.activo = 1 AND l.cantidad > 0
                            ORDER BY l.caducidad ASC`, [sucursalId]);
  return rows.map(l => ({ ...l, ...estadoCaducidad(l.caducidad) }));
}

async function resumenAlertas(sucursalId){
  const productos = await productosConStock(sucursalId);
  const lotes = await lotesSucursal(sucursalId);
  return {
    stockBajo: productos.filter(p => p.stock_bajo).map(p => ({ id: p.id, nombre: p.nombre, stock: p.stock, minimo: p.stock_minimo, ubicacion: p.ubicacion })),
    caducados: lotes.filter(l => l.dias < 0).map(l => ({ id: l.id, producto: l.producto, lote: l.numero_lote, caducidad: l.caducidad, cantidad: l.cantidad })),
    porVencer: lotes.filter(l => l.dias >= 0 && l.dias <= DIAS_URGENTE_CADUCIDAD).map(l => ({ id: l.id, producto: l.producto, lote: l.numero_lote, caducidad: l.caducidad, dias: l.dias, cantidad: l.cantidad })),
  };
}

// Recepción de mercancía dentro de una transacción: suma al lote si ya existe o lo crea, y deja el movimiento.
// La usan las entradas manuales y la recepción de órdenes de compra.
async function registrarEntrada(conn, { sucursalId, productoId, numeroLote, caducidad, cantidad, costo = 0, factura = null, proveedor = null,
                                        fecha = hoyISO(), usuarioId = null, motivo = 'Compra a proveedor', observaciones = null }){
  const numero = String(numeroLote).trim();
  const [[existente]] = await conn.query('SELECT * FROM lotes WHERE producto_id = ? AND numero_lote = ? FOR UPDATE', [productoId, numero]);
  let loteId;
  if(existente){
    if(existente.caducidad !== caducidad)
      throw new HttpError(409, `El lote ${numero} ya está registrado con caducidad ${existente.caducidad}. Verifica el número de lote.`);
    await conn.query('UPDATE lotes SET cantidad = cantidad + ? WHERE id = ?', [cantidad, existente.id]);
    loteId = existente.id;
  }else{
    const [r] = await conn.query(`INSERT INTO lotes (producto_id,numero_lote,caducidad,cantidad,costo_unitario,factura,proveedor,fecha_entrada)
      VALUES (?,?,?,?,?,?,?,?)`, [productoId, numero, caducidad, cantidad, Number(costo) || 0, factura, proveedor, fecha]);
    loteId = r.insertId;
  }
  const hora = fecha === hoyISO() ? ahoraSQL() : fecha + ' 09:00:00';
  await conn.query(`INSERT INTO movimientos (sucursal_id,producto_id,lote_id,tipo,cantidad,motivo,proveedor,factura,observaciones,usuario_id,fecha)
    VALUES (?,?,?,'Entrada',?,?,?,?,?,?,?)`, [sucursalId, productoId, loteId, cantidad, motivo, proveedor, factura, observaciones, usuarioId, hora]);
  return { loteId, loteNuevo: !existente };
}

// Descuenta `cantidad` de los lotes vigentes de un producto, empezando por el que caduca primero (FEFO).
// Devuelve de qué lotes salió cada parte. Lanza error si no alcanza la existencia vigente.
async function surtirFEFO(conn, producto, cantidad){
  const [lotes] = await conn.query('SELECT * FROM lotes WHERE producto_id = ? AND cantidad > 0 AND caducidad >= ? ORDER BY caducidad ASC, id ASC FOR UPDATE', [producto.id, hoyISO()]);
  const disponible = lotes.reduce((s, l) => s + l.cantidad, 0);
  if(cantidad > disponible) throw new HttpError(400, `No hay suficiente ${producto.nombre}: pides ${cantidad} y hay ${disponible} u. vigentes.`);
  const tomado = []; let falta = cantidad;
  for(const l of lotes){
    if(!falta) break;
    const n = Math.min(falta, l.cantidad); falta -= n;
    await conn.query('UPDATE lotes SET cantidad = cantidad - ? WHERE id = ?', [n, l.id]);
    tomado.push({ lote_id: l.id, numero_lote: l.numero_lote, caducidad: l.caducidad, cantidad: n });
  }
  return tomado;
}

module.exports = { registrarEntrada, surtirFEFO, productosConStock, lotesDeProducto, lotesSucursal, estadoCaducidad, resumenAlertas };
