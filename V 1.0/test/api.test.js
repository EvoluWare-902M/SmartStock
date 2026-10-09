/* Pruebas de integración de la API (requieren la BD inicializada: npm run db:init).
   Ejecutar con:  npm test                                                        */
process.env.NODE_ENV = 'test';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server/app');
const { pool } = require('../server/db');

let server, base;
const tokens = {};

async function req(path, { method = 'GET', body, token } = {}){
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const login = (correo, password) => req('/api/auth/login', { method: 'POST', body: { correo, password } });

before(async () => {
  server = app.listen(0);
  base = 'http://localhost:' + server.address().port;
  tokens.dueno = (await login('kaled@smartstock.mx', 'dueno123')).data.token;
  tokens.empleado = (await login('esteban@smartstock.mx', 'empleado123')).data.token;
  tokens.admin = (await login('admin@smartstock.mx', 'admin123')).data.token;
});
after(async () => { server.close(); await pool.end(); });

test('HU-15 · login rechaza credenciales incorrectas', async () => {
  const r = await login('kaled@smartstock.mx', 'incorrecta');
  assert.equal(r.status, 401);
});

test('HU-15 · sucursal pendiente o suspendida no puede entrar', async () => {
  assert.equal((await login('rocio@sanjose.mx', 'dueno123')).status, 403);
  assert.equal((await login('ivan@vidasana.mx', 'dueno123')).status, 403);
});

test('HU-14 · permisos por rol: el empleado no accede a rutas del dueño', async () => {
  assert.equal((await req('/api/usuarios', { token: tokens.empleado })).status, 403);
  assert.equal((await req('/api/analitica/prediccion', { token: tokens.empleado })).status, 403);
  assert.equal((await req('/api/sucursales', { token: tokens.dueno })).status, 403);
  assert.equal((await req('/api/productos')).status, 401);
});

test('HU-2 · búsqueda por nombre, sustancia y código', async () => {
  for(const q of ['parace', 'ácido ascorbico', 'med-003']){
    const r = await req('/api/productos?q=' + encodeURIComponent(q), { token: tokens.empleado });
    assert.equal(r.status, 200);
    assert.ok(r.data.length >= 1, 'sin resultados para ' + q);
  }
});

test('HU-3/HU-4 · el LED se enciende en la ubicación y el ESP32 puede consultarlo', async () => {
  const [p] = (await req('/api/productos?q=ibuprofeno', { token: tokens.empleado })).data;
  const led = await req('/api/led', { method: 'POST', token: tokens.empleado, body: { producto_id: p.id } });
  assert.equal(led.data.ubicacion, p.ubicacion);
  const iot = await req(`/api/iot/led/${p.sucursal_id}?token=${process.env.IOT_TOKEN || 'smartstock-iot-demo'}`);
  assert.equal(iot.data.encendido, true);
  assert.equal(iot.data.ubicacion, p.ubicacion);
  assert.equal((await req(`/api/iot/led/${p.sucursal_id}?token=malo`)).status, 401);
});

test('HU-7/HU-8/HU-9 · entrada suma, salida descuenta y ambas quedan en el historial', async () => {
  const [p] = (await req('/api/productos?q=naproxeno', { token: tokens.dueno })).data;
  const lote = 'T-' + Date.now();
  const ent = await req('/api/movimientos/entradas', { method: 'POST', token: tokens.dueno,
    body: { producto_id: p.id, proveedor: 'Prueba', numero_lote: lote, caducidad: '2030-01-01', cantidad: 10 } });
  assert.equal(ent.status, 201);
  assert.equal(ent.data.producto.stock, p.stock + 10);

  const excedida = await req('/api/movimientos/salidas', { method: 'POST', token: tokens.empleado,
    body: { producto_id: p.id, lote_id: ent.data.loteId, cantidad: 11, motivo: 'Venta' } });
  assert.equal(excedida.status, 400);

  const sal = await req('/api/movimientos/salidas', { method: 'POST', token: tokens.empleado,
    body: { producto_id: p.id, lote_id: ent.data.loteId, cantidad: 10, motivo: 'Venta' } });
  assert.equal(sal.status, 201);
  assert.equal(sal.data.producto.stock, p.stock);

  const hist = await req(`/api/movimientos?producto_id=${p.id}&limit=2`, { token: tokens.empleado });
  assert.deepEqual(hist.data.filas.map(f => f.tipo), ['Salida', 'Entrada']);
});

test('HU-8 · medicamento controlado exige receta; el empleado no registra entradas', async () => {
  const p = (await req('/api/productos?q=salbutamol', { token: tokens.empleado })).data[0];
  const det = (await req('/api/productos/' + p.id, { token: tokens.empleado })).data;
  const r = await req('/api/movimientos/salidas', { method: 'POST', token: tokens.empleado,
    body: { producto_id: p.id, lote_id: det.lotes[0].id, cantidad: 1, motivo: 'Venta' } });
  assert.equal(r.status, 400);
  const e = await req('/api/movimientos/entradas', { method: 'POST', token: tokens.empleado, body: {} });
  assert.equal(e.status, 403);
});

test('HU-6 · alertas de stock mínimo y caducidad', async () => {
  const r = await req('/api/inventario/alertas', { token: tokens.empleado });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.stockBajo) && Array.isArray(r.data.porVencer));
  r.data.stockBajo.forEach(p => assert.ok(p.stock <= p.minimo));
});

test('HU-10/11/12 · el modelo genera pronóstico, compras y reubicaciones', async () => {
  const pred = await req('/api/analitica/prediccion', { token: tokens.dueno });
  assert.equal(pred.data.pronostico.length, 3);
  assert.equal(pred.data.historico.length, 24);
  const reco = await req('/api/analitica/recomendaciones', { token: tokens.dueno });
  assert.ok(reco.data.every(r => r.cantidad > 0));
  const rep = await req('/api/analitica/repisas', { token: tokens.dueno });
  assert.ok(rep.data.productos.length > 0);
});

test('HU-13 · reportes en PDF y Excel', async () => {
  for(const [fmt, tipo] of [['pdf', 'application/pdf'], ['xlsx', 'spreadsheetml']]){
    const res = await fetch(`${base}/api/reportes/general?formato=${fmt}`, { headers: { Authorization: 'Bearer ' + tokens.dueno } });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes(tipo));
    assert.ok((await res.arrayBuffer()).byteLength > 2000);
  }
});

test('Registro · plan Gratuito entra de inmediato; plan de pago queda pendiente', async () => {
  const base_ = { nombre: 'Farmacia de Prueba', tipo: 'Botica', telefono: '5511112222', calle: 'Calle 1', num_exterior: '10', colonia: 'Centro',
    codigo_postal: '57000', municipio: 'Nezahualcóyotl', entidad: 'Estado de México', nombres: 'Ana', apellido_paterno: 'Ruiz', cargo: 'Dueño',
    celular: '5533334444', password: 'prueba-2026', acepta_terminos: true };
  const sello = Date.now();

  const gratis = await req('/api/auth/registro-sucursal', { method: 'POST', body: { ...base_, correo: `gratis${sello}@test.mx`, plan: 'Gratuito' } });
  assert.equal(gratis.status, 201);
  assert.equal(gratis.data.activa, true);
  assert.ok(gratis.data.token);
  // con el plan Gratuito entra, pero la analítica está reservada a planes superiores
  assert.equal((await req('/api/productos', { token: gratis.data.token })).status, 200);
  assert.equal((await req('/api/analitica/prediccion', { token: gratis.data.token })).status, 403);

  const pago = await req('/api/auth/registro-sucursal', { method: 'POST', body: { ...base_, correo: `pago${sello}@test.mx`, plan: 'Profesional' } });
  assert.equal(pago.data.activa, false);
  assert.equal((await login(`pago${sello}@test.mx`, 'prueba-2026')).status, 403);

  // validaciones: correo repetido, código postal y campos obligatorios
  assert.equal((await req('/api/auth/registro-sucursal', { method: 'POST', body: { ...base_, correo: `gratis${sello}@test.mx`, plan: 'Gratuito' } })).status, 409);
  assert.equal((await req('/api/auth/registro-sucursal', { method: 'POST', body: { ...base_, correo: `x${sello}@test.mx`, plan: 'Gratuito', codigo_postal: '123' } })).status, 400);
  assert.equal((await req('/api/auth/registro-sucursal', { method: 'POST', body: { correo: `y${sello}@test.mx` } })).status, 400);
  assert.equal((await req(`/api/auth/correo-disponible?correo=gratis${sello}@test.mx`)).data.disponible, false);
});

/* ---------- Superadministrador ---------- */
test('Plataforma · solo el superadministrador ve el panel, las cuentas y la bitácora', async () => {
  for(const ruta of ['/api/plataforma/resumen', '/api/plataforma/usuarios', '/api/plataforma/bitacora', '/api/plataforma/avisos']){
    assert.equal((await req(ruta, { token: tokens.dueno })).status, 403, ruta);
    assert.equal((await req(ruta, { token: tokens.admin })).status, 200, ruta);
  }
  const r = (await req('/api/plataforma/resumen', { token: tokens.admin })).data;
  assert.ok(r.total >= 8 && r.porEstado.Activa >= 1 && r.ingresoMensual > 0);
  assert.ok(r.salud.every(s => s.salud >= 0 && s.salud <= 100 && s.nivel));
});

test('Plataforma · rechazar o suspender exige motivo, se le muestra al dueño y queda en bitácora', async () => {
  const sinMotivo = await req('/api/sucursales/6/estado', { method: 'PUT', token: tokens.admin, body: { estado: 'Rechazada' } });
  assert.equal(sinMotivo.status, 400);
  const motivo = 'El RFC capturado no corresponde con la razón social.';
  assert.equal((await req('/api/sucursales/6/estado', { method: 'PUT', token: tokens.admin, body: { estado: 'Rechazada', motivo } })).status, 200);
  const entrada = await login('diana@santacruz.mx', 'dueno123');
  assert.equal(entrada.status, 403);
  assert.ok(entrada.data.error.includes(motivo));

  const ficha = (await req('/api/sucursales/6', { token: tokens.admin })).data;
  assert.equal(ficha.sucursal.estado, 'Rechazada');
  assert.ok(ficha.historial.length >= 1 && ficha.usuarios.length >= 1);
  const bit = (await req('/api/plataforma/bitacora?sucursal_id=6', { token: tokens.admin })).data;
  assert.ok(bit.filas.some(f => f.accion.startsWith('sucursal.')));

  // Se puede reconsiderar: al activarla el dueño ya entra.
  assert.equal((await req('/api/sucursales/6/estado', { method: 'PUT', token: tokens.admin, body: { estado: 'Activa' } })).status, 200);
  assert.equal((await login('diana@santacruz.mx', 'dueno123')).status, 200);
});

test('Plataforma · desactivar una cuenta le impide entrar; el superadmin no se desactiva a sí mismo', async () => {
  const cuentas = (await req('/api/plataforma/usuarios', { token: tokens.admin })).data;
  const sofia = cuentas.find(u => u.correo === 'sofia@sanrafael.mx'), yo = cuentas.find(u => u.correo === 'admin@smartstock.mx');
  assert.equal((await req('/api/plataforma/usuarios/' + sofia.id, { method: 'PUT', token: tokens.admin, body: { estado: 'Inactivo' } })).status, 200);
  assert.notEqual((await login('sofia@sanrafael.mx', 'dueno123')).status, 200);
  assert.equal((await req('/api/plataforma/usuarios/' + sofia.id, { method: 'PUT', token: tokens.admin, body: { estado: 'Activo' } })).status, 200);
  assert.equal((await login('sofia@sanrafael.mx', 'dueno123')).status, 200);
  assert.notEqual((await req('/api/plataforma/usuarios/' + yo.id, { method: 'PUT', token: tokens.admin, body: { estado: 'Inactivo' } })).status, 200);
});

test('Plataforma · un aviso publicado llega a las sucursales y deja de verse al retirarlo', async () => {
  const titulo = 'Aviso de prueba ' + Date.now();
  const alta = await req('/api/plataforma/avisos', { method: 'POST', token: tokens.admin, body: { titulo, mensaje: 'Mantenimiento programado.', tipo: 'Mantenimiento' } });
  assert.equal(alta.status, 201);
  assert.ok((await req('/api/avisos', { token: tokens.empleado })).data.some(a => a.titulo === titulo));
  await req('/api/plataforma/avisos/' + alta.data.id, { method: 'PUT', token: tokens.admin, body: { activo: false } });
  assert.ok(!(await req('/api/avisos', { token: tokens.empleado })).data.some(a => a.titulo === titulo));
  assert.equal((await req('/api/plataforma/avisos/' + alta.data.id, { method: 'DELETE', token: tokens.admin })).status, 200);
});

/* ---------- Inteligencia artificial ---------- */
test('IA · la búsqueda tolera faltas de ortografía', async () => {
  for(const [mal, bien] of [['parasetamol', 'Paracetamol'], ['amoxisilina', 'Amoxicilina'], ['ibuprofno', 'Ibuprofeno']]){
    const r = (await req('/api/productos?q=' + mal, { token: tokens.empleado })).data;
    assert.ok(r.length >= 1 && r[0].nombre.includes(bien), `${mal} → ${r[0] && r[0].nombre}`);
    assert.equal(r[0].coincidencia, 'aproximada');
  }
  assert.equal((await req('/api/productos?q=zzzzqqqq', { token: tokens.empleado })).data.length, 0);
});

test('IA · anomalías, ABC-XYZ, riesgo de caducidad y hallazgos (plan con analítica)', async () => {
  const an = (await req('/api/ia/anomalias', { token: tokens.dueno })).data;
  assert.ok(an.length >= 1 && an.every(a => a.motivo && ['Alta', 'Media', 'Baja'].includes(a.nivel)));
  const abc = (await req('/api/ia/abc', { token: tokens.dueno })).data;
  assert.ok(abc.items.length >= 10);
  assert.ok(abc.items.every(i => 'ABC'.includes(i.abc) && 'XYZ'.includes(i.xyz)));
  assert.ok(Math.abs(abc.items.reduce((s, i) => s + i.participacion, 0) - 100) < 1.5, 'las participaciones suman 100 %');
  assert.ok(abc.resumen.A.porcentaje >= 75);
  const cad = (await req('/api/ia/caducidad', { token: tokens.dueno })).data;
  assert.ok(cad.every(l => l.en_riesgo > 0 && l.en_riesgo <= l.cantidad));
  assert.ok(Array.isArray((await req('/api/ia/hallazgos', { token: tokens.dueno })).data));
});

test('IA · el análisis es del gerente y de planes con analítica; las alternativas son para todos', async () => {
  assert.equal((await req('/api/ia/anomalias', { token: tokens.empleado })).status, 403);
  const basico = (await login('hector@ahorrofamiliar.mx', 'dueno123')).data.token;
  assert.equal((await req('/api/ia/abc', { token: basico })).status, 403);
  assert.equal((await req('/api/ia/asistente', { token: basico })).status, 200);
  const [p] = (await req('/api/productos?q=paracetamol', { token: tokens.empleado })).data;
  const alt = await req('/api/ia/alternativas/' + p.id, { token: tokens.empleado });
  assert.equal(alt.status, 200);
  assert.ok(alt.data.every(a => a.id !== p.id && a.stock > 0));
});

test('IA · el asistente entiende preguntas frecuentes sin modelo externo', async () => {
  const preguntar = (mensaje, token = tokens.empleado) => req('/api/ia/asistente', { method: 'POST', token, body: { mensaje } });
  const donde = (await preguntar('¿dónde está el parasetamol?')).data;
  assert.match(donde.respuesta, /Paracetamol.*anaquel/i);
  assert.ok(donde.enlace && donde.enlace.href.startsWith('buscar.html'));
  assert.match((await preguntar('que esta por caducar')).data.respuesta, /lote|caduc/i);
  assert.match((await preguntar('que tiene stock bajo')).data.respuesta, /mínimo|stock/i);
  // Lo que es del gerente no se le contesta al empleado.
  const compras = (await preguntar('¿qué debo comprar?')).data;
  assert.ok(!/\$\s?\d/.test(compras.respuesta));
  assert.equal((await preguntar('')).status, 400);
  assert.equal((await preguntar('hola')).data.modo, process.env.ANTHROPIC_API_KEY ? 'modelo' : 'local');
});

/* ---------- Operación diaria: punto de venta, compras, conteos ---------- */
const stockDe = async (q, token = tokens.dueno) => (await req('/api/productos?q=' + encodeURIComponent(q), { token })).data[0];

test('Punto de venta · un ticket con varios productos descuenta por FEFO y exige receta', async () => {
  const ibu = await stockDe('ibuprofeno'), amo = await stockDe('amoxicilina 500');
  const sinReceta = await req('/api/ventas', { method: 'POST', token: tokens.empleado, body: { partidas: [{ producto_id: amo.id, cantidad: 1 }] } });
  assert.equal(sinReceta.status, 400);
  const demasiado = await req('/api/ventas', { method: 'POST', token: tokens.empleado, body: { partidas: [{ producto_id: ibu.id, cantidad: ibu.stock + 1 }] } });
  assert.equal(demasiado.status, 400);

  const v = await req('/api/ventas', { method: 'POST', token: tokens.empleado, body: { receta: 'RX-PRUEBA', partidas: [{ producto_id: ibu.id, cantidad: 2 }, { producto_id: amo.id, cantidad: 1 }] } });
  assert.equal(v.status, 201);
  assert.match(v.data.folio, /^V-\d+$/);
  assert.equal(v.data.partidas.length, 2);
  assert.ok(v.data.partidas.every(p => p.lote && p.ubicacion));
  assert.equal(Number(v.data.total), 2 * Number(ibu.precio) + Number(amo.precio));
  assert.equal((await stockDe('ibuprofeno')).stock, ibu.stock - 2);
  assert.ok((await req('/api/ventas', { token: tokens.empleado })).data.some(t => t.id === v.data.id));

  // Solo el gerente cancela; las piezas regresan a su lote
  assert.equal((await req(`/api/ventas/${v.data.id}/cancelar`, { method: 'POST', token: tokens.empleado })).status, 403);
  assert.equal((await req(`/api/ventas/${v.data.id}/cancelar`, { method: 'POST', token: tokens.dueno })).status, 200);
  assert.equal((await stockDe('ibuprofeno')).stock, ibu.stock);
  assert.equal((await req(`/api/ventas/${v.data.id}/cancelar`, { method: 'POST', token: tokens.dueno })).status, 409);
});

test('Punto de venta · búsqueda por código de barras e IA de "ofrece también"', async () => {
  const amo = await stockDe('amoxicilina 500');
  assert.match(amo.codigo_barras, /^\d{13}$/);
  const porCodigo = (await req('/api/productos?q=' + amo.codigo_barras, { token: tokens.empleado })).data;
  assert.equal(porCodigo.length, 1); assert.equal(porCodigo[0].id, amo.id);
  const sug = (await req('/api/ventas/sugerencias?ids=' + amo.id, { token: tokens.empleado })).data;
  assert.ok(sug.some(s => s.nombre.startsWith('Paracetamol')), 'la amoxicilina suele llevarse con paracetamol');
  assert.ok(sug.every(s => s.id !== amo.id && s.stock > 0 && s.confianza > 0));
});

test('IA · reglas de asociación, mínimos sugeridos y clasificador de altas', async () => {
  const j = (await req('/api/ia/juntos', { token: tokens.dueno })).data;
  assert.ok(j.tickets > 500 && j.reglas.length >= 4);
  assert.ok(j.reglas.every(r => r.lift >= 1.5 && r.juntos >= 5 && r.confianza <= 100));
  const min = (await req('/api/ia/minimos', { token: tokens.dueno })).data;
  assert.equal(min.length, (await req('/api/productos', { token: tokens.dueno })).data.length);
  const cambio = min.find(m => m.relevante);
  assert.ok(cambio && cambio.sugerido >= 0 && cambio.motivo);
  assert.equal((await req('/api/ia/minimos/aplicar', { method: 'POST', token: tokens.dueno, body: { producto_ids: [cambio.producto_id] } })).data.aplicados, 1);
  assert.equal((await req('/api/productos/' + cambio.producto_id, { token: tokens.dueno })).data.stock_minimo, cambio.sugerido);
  assert.equal((await req('/api/ia/minimos', { token: tokens.empleado })).status, 403);

  const c = (await req('/api/ia/clasificar', { method: 'POST', token: tokens.dueno, body: { nombre: 'cefalexina 500 mg caps' } })).data;
  assert.deepEqual([c.sustancia, c.categoria, c.presentacion, c.concentracion, c.requiere_receta], ['Cefalexina', 'Antibióticos', 'Cápsula', '500mg', true]);
  const marca = (await req('/api/ia/clasificar', { method: 'POST', token: tokens.dueno, body: { nombre: 'Tempra jarabe' } })).data;
  assert.equal(marca.sustancia, 'Paracetamol');
  const dup = (await req('/api/ia/clasificar', { method: 'POST', token: tokens.dueno, body: { nombre: 'Loratadina 10mg' } })).data;
  assert.ok(dup.parecido.posible_duplicado);
});

test('Compras · la IA arma órdenes por proveedor; al recibirlas entran los lotes', async () => {
  assert.equal((await req('/api/ordenes', { token: tokens.empleado })).status, 403);
  const provs = (await req('/api/proveedores', { token: tokens.dueno })).data;
  assert.ok(provs.length >= 4 && provs.some(p => p.entrega_real !== null && p.cumplimiento !== null));

  const s = await req('/api/ordenes/sugerir', { method: 'POST', token: tokens.dueno });
  assert.equal(s.status, 201);
  assert.ok(s.data.creadas.length >= 1 && s.data.conModelo);
  // Pedir otra vez no duplica lo que ya está en borrador
  assert.equal((await req('/api/ordenes/sugerir', { method: 'POST', token: tokens.dueno })).data.creadas.length, 0);

  const o = (await req('/api/ordenes/' + s.data.creadas[0], { token: tokens.dueno })).data;
  assert.equal(o.estado, 'Borrador'); assert.equal(o.origen, 'IA');
  assert.ok(o.partidas.length >= 1 && o.partidas.every(p => p.cantidad > 0 && p.motivo));
  assert.equal((await req(`/api/ordenes/${o.id}/recibir`, { method: 'POST', token: tokens.dueno, body: { partidas: [] } })).status, 409);
  assert.equal((await req(`/api/ordenes/${o.id}/enviar`, { method: 'POST', token: tokens.dueno })).status, 200);

  const antes = (await req('/api/productos/' + o.partidas[0].producto_id, { token: tokens.dueno })).data.stock;
  const partidas = o.partidas.map((p, i) => ({ producto_id: p.producto_id, cantidad: i === 0 ? p.cantidad : 0, numero_lote: 'L-OC-' + o.id, caducidad: '2029-12-31' }));
  const sinLote = await req(`/api/ordenes/${o.id}/recibir`, { method: 'POST', token: tokens.dueno, body: { partidas: partidas.map(p => ({ ...p, numero_lote: '' })) } });
  assert.equal(sinLote.status, 400);
  const r = await req(`/api/ordenes/${o.id}/recibir`, { method: 'POST', token: tokens.dueno, body: { factura: 'F-TEST', partidas } });
  assert.equal(r.status, 200); assert.equal(r.data.unidades, o.partidas[0].cantidad);
  const despues = (await req('/api/productos/' + o.partidas[0].producto_id, { token: tokens.dueno })).data;
  assert.equal(despues.stock, antes + o.partidas[0].cantidad);
  assert.ok(despues.lotes.some(l => l.numero_lote === 'L-OC-' + o.id));
  assert.equal((await req('/api/ordenes/' + o.id, { token: tokens.dueno })).data.estado, 'Recibida');
});

test('Conteo físico · se cuenta a ciegas y al aplicar se ajusta la existencia', async () => {
  const sug = (await req('/api/conteos/sugerencia', { token: tokens.dueno })).data;
  assert.ok(sug.length >= 3 && sug.every(x => x.motivo && x.puntos !== undefined));
  assert.ok(sug[0].puntos >= sug[sug.length - 1].puntos);
  assert.equal((await req('/api/conteos/sugerencia', { token: tokens.empleado })).status, 403);

  const elegidos = sug.slice(0, 2);
  const alta = await req('/api/conteos', { method: 'POST', token: tokens.dueno, body: { producto_ids: elegidos.map(e => e.producto_id), origen: 'IA' } });
  assert.equal(alta.status, 201);
  assert.equal((await req('/api/conteos', { method: 'POST', token: tokens.dueno, body: { producto_ids: [elegidos[0].producto_id] } })).status, 409);

  const ciego = (await req('/api/conteos/' + alta.data.id, { token: tokens.empleado })).data;
  assert.ok(ciego.ciego && ciego.partidas.every(p => p.esperado === undefined), 'el empleado no ve la existencia del sistema');
  assert.equal((await req(`/api/conteos/${alta.data.id}/enviar`, { method: 'POST', token: tokens.empleado })).status, 400);
  // Al primero le faltan 2 piezas; el segundo coincide
  const real = elegidos.map(e => e.stock);
  await req(`/api/conteos/${alta.data.id}/captura`, { method: 'PUT', token: tokens.empleado, body: { partidas: [{ producto_id: elegidos[0].producto_id, contado: real[0] - 2 }, { producto_id: elegidos[1].producto_id, contado: real[1] }] } });
  assert.equal((await req(`/api/conteos/${alta.data.id}/enviar`, { method: 'POST', token: tokens.empleado })).status, 200);
  assert.equal((await req(`/api/conteos/${alta.data.id}/aplicar`, { method: 'POST', token: tokens.empleado })).status, 403);

  const rev = (await req('/api/conteos/' + alta.data.id, { token: tokens.dueno })).data;
  assert.equal(rev.partidas.find(p => p.producto_id === elegidos[0].producto_id).diferencia, -2);
  const ap = await req(`/api/conteos/${alta.data.id}/aplicar`, { method: 'POST', token: tokens.dueno });
  assert.equal(ap.data.ajustes, 1); assert.equal(ap.data.faltantes, 2);
  const p = (await req('/api/productos/' + elegidos[0].producto_id, { token: tokens.dueno })).data;
  assert.equal(p.stock + p.stock_vencido, real[0] - 2);
  const hist = (await req('/api/movimientos?tipo=Ajuste&producto_id=' + elegidos[0].producto_id, { token: tokens.dueno })).data;
  assert.ok(hist.filas.some(m => m.motivo === 'Faltante en conteo físico'));
});

test('Faltantes y Mi turno · la IA agrupa lo que piden y arma los pendientes', async () => {
  for(const texto of ['enalapril 10mg', 'Enalapril', 'enalapirl 10 mg tabs'])
    assert.equal((await req('/api/faltantes', { method: 'POST', token: tokens.empleado, body: { texto } })).status, 201);
  assert.equal((await req('/api/faltantes', { token: tokens.empleado })).status, 403);
  const d = (await req('/api/faltantes', { token: tokens.dueno })).data;
  const ena = d.find(x => /enalapril/i.test(x.nombre));
  assert.ok(ena && ena.veces === 3 && !ena.en_catalogo, 'las tres formas de escribirlo cuentan como una sola solicitud');
  const met = d.find(x => /metformina/i.test(x.nombre));
  assert.equal(met.veces, 5);
  assert.equal((await req('/api/faltantes/atender', { method: 'PUT', token: tokens.dueno, body: { ids: ena.ids } })).status, 200);
  assert.ok(!(await req('/api/faltantes', { token: tokens.dueno })).data.some(x => /enalapril/i.test(x.nombre)));

  const emp = (await req('/api/turno', { token: tokens.empleado })).data, ger = (await req('/api/turno', { token: tokens.dueno })).data;
  assert.ok(emp.resumen && emp.tareas.length >= 1 && emp.equipo === null);
  assert.ok(emp.tareas.every((t, i) => !i || emp.tareas[i - 1].prioridad >= t.prioridad), 'los pendientes vienen ordenados por urgencia');
  assert.ok(ger.equipo.length >= 1 && ger.tareas.some(t => t.tipo === 'orden' || t.tipo === 'stock' || t.tipo === 'demanda'));
  assert.ok(!emp.tareas.some(t => ['orden', 'demanda', 'anomalia'].includes(t.tipo)), 'el empleado no recibe pendientes del gerente');
  assert.match((await req('/api/ia/asistente', { method: 'POST', token: tokens.empleado, body: { mensaje: '¿qué tengo pendiente?' } })).data.respuesta, /pendiente/i);
  assert.match((await req('/api/ia/asistente', { method: 'POST', token: tokens.empleado, body: { mensaje: 'que se vende junto con amoxicilina' } })).data.respuesta, /Paracetamol/);
});

test('Importar · reconoce columnas con otros nombres, completa con IA y detecta duplicados', async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Lista');
  ws.addRow(['Descripción', 'Existencia', 'Vence', 'Precio público', 'No. lote', 'Columna rara']);
  ws.addRow(['Cefalexina 500mg cápsulas', 12, '31/12/2028', 96, 'L-IMP-1', 'x']);
  ws.addRow(['Ketorolaco 10 mg tab', '', '', 38, '', '']);
  ws.addRow(['Paracetamol 500mg', 5, '31/12/2028', 30, 'L-IMP-2', '']);      // ya existe
  ws.addRow(['Meloxicam 15mg', 8, '', 55, '', '']);                           // existencias sin caducidad
  const archivo = Buffer.from(await wb.xlsx.writeBuffer());
  const subir = token => fetch(base + '/api/productos/importar/analizar', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' }, body: archivo });
  assert.equal((await subir(tokens.empleado)).status, 403);
  const a = await (await subir(tokens.dueno)).json();
  assert.deepEqual([a.columnas.nombre, a.columnas.cantidad, a.columnas.caducidad, a.columnas.precio, a.columnas.numero_lote], ['Descripción', 'Existencia', 'Vence', 'Precio público', 'No. lote']);
  assert.deepEqual(a.sinUsar, ['Columna rara']);
  assert.deepEqual(a.filas.map(f => f.estado), ['ok', 'ok', 'duplicado', 'error']);
  const cef = a.filas[0].datos;
  assert.deepEqual([cef.categoria, cef.presentacion, cef.requiere_receta, cef.caducidad, cef.cantidad], ['Antibióticos', 'Cápsula', true, '2028-12-31', 12]);
  assert.ok(a.filas[0].sugerido.includes('categoria') && a.filas[0].sugerido.includes('ubicacion'));

  const r = await req('/api/productos/importar', { method: 'POST', token: tokens.dueno, body: { filas: a.filas.map(f => f.datos) } });
  assert.equal(r.data.creados, 2); assert.equal(r.data.unidades, 12); assert.equal(r.data.omitidos.length, 2);
  const nuevo = await stockDe('cefalexina');
  assert.equal(nuevo.stock, 12); assert.equal(nuevo.categoria, 'Antibióticos');
  assert.equal((await stockDe('ketorolaco')).stock, 0);
  assert.equal((await fetch(base + '/api/productos/importar/plantilla', { headers: { Authorization: 'Bearer ' + tokens.dueno } })).status, 200);
});
