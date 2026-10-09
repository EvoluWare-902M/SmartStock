/* =====================================================================
   init.js : crea la base de datos, las tablas y carga datos de ejemplo.
   Uso:  npm run db:init
   ⚠️  Borra y vuelve a crear todas las tablas de la base "smartstock".

   Los datos de ejemplo incluyen ~2 años de ventas simuladas con
   estacionalidad por categoría, para que el modelo predictivo tenga
   un histórico con el cual trabajar desde el primer día.
   ===================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const DB_NAME = process.env.DB_NAME || 'smartstock';

// ---------- utilidades de fecha ----------
const HOY = new Date(); HOY.setHours(0, 0, 0, 0);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const iso = d => { const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); };
const dt = (d, h = 10, m = 0) => `${iso(d)} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

// Generador pseudoaleatorio con semilla: los datos salen iguales en cada instalación.
let seed = 902;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const between = (a, b) => a + rnd() * (b - a);

// ---------- estacionalidad mensual por categoría (Ene..Dic) ----------
const ESTACIONALIDAD = {
  'Analgésicos':      [40,38,42,45,50,55,60,58,52,48,44,41],
  'Antialérgicos':    [20,22,35,58,72,65,50,38,25,20,18,19],
  'Antibióticos':     [62,55,45,38,34,32,30,32,36,42,52,64],
  'Gastrointestinal': [25,26,28,32,45,60,68,64,50,35,28,26],
  'Dermatológicos':   [20,20,22,26,30,34,36,34,28,24,21,20],
  'Respiratorios':    [60,52,40,30,24,20,20,22,28,38,52,64],
  'Vitaminas':        [55,48,40,34,30,28,28,30,34,42,50,58],
};
for (const k in ESTACIONALIDAD){
  const arr = ESTACIONALIDAD[k]; const avg = arr.reduce((a, b) => a + b, 0) / 12;
  ESTACIONALIDAD[k] = arr.map(v => v / avg);
}

// ---------- catálogo de ejemplo (sucursal 1) ----------
// base = unidades vendidas por mes en promedio. lotes = [numero, días para caducar, cantidad, costo]
const PRODUCTOS = [
  ['MED-001','Paracetamol 500mg','Paracetamol','Genfar','Analgésicos','Tableta','500mg',0,'A2',15,35,45,[['L-2301',4,5,18],['L-2455',160,3,18]]],
  ['MED-002','Loratadina 10mg','Loratadina','Bayer','Antialérgicos','Tableta','10mg',0,'B4',10,48,30,[['L-2380',200,22,26]]],
  ['MED-003','Amoxicilina 500mg','Amoxicilina','PiSA','Antibióticos','Cápsula','500mg',1,'C1',12,90,35,[['L-1899',10,5,60]]],
  ['MED-004','Ibuprofeno 400mg','Ibuprofeno','Bayer','Analgésicos','Tableta','400mg',0,'A5',15,40,40,[['L-2100',110,30,20]]],
  ['MED-005','Suero oral','Electrolitos orales','PiSA','Gastrointestinal','Sobre','—',0,'D3',10,15,30,[['L-2044',9,6,7]]],
  ['MED-006','Omeprazol 20mg','Omeprazol','Genfar','Gastrointestinal','Cápsula','20mg',0,'C6',8,55,20,[['L-1950',60,18,30]]],
  ['MED-007','Cetirizina 10mg','Cetirizina','UCB','Antialérgicos','Tableta','10mg',0,'B2',10,52,18,[['L-2210',135,14,28]]],
  ['MED-008','Azitromicina 500mg','Azitromicina','Pfizer','Antibióticos','Tableta','500mg',1,'C4',10,120,12,[['L-1780',-1,3,80],['L-2290',240,6,80]]],
  ['MED-009','Naproxeno 500mg','Naproxeno','Liomont','Analgésicos','Tableta','500mg',0,'A4',10,45,20,[['L-2410',300,25,22]]],
  ['MED-010','Ambroxol jarabe 15mg/5ml','Ambroxol','Boehringer','Respiratorios','Jarabe','15mg/5ml',0,'B5',8,85,22,[['L-2333',180,12,45]]],
  ['MED-011','Salbutamol inhalador','Salbutamol','GSK','Respiratorios','Aerosol','100mcg',1,'D5',5,160,8,[['L-2120',400,9,95]]],
  ['MED-012','Loperamida 2mg','Loperamida','Janssen','Gastrointestinal','Tableta','2mg',0,'D1',8,38,15,[['L-2050',30,10,18]]],
  ['MED-013','Butilhioscina 10mg','Butilhioscina','Boehringer','Gastrointestinal','Tableta','10mg',0,'D2',8,70,14,[['L-2240',210,16,38]]],
  ['MED-014','Clotrimazol crema 1%','Clotrimazol','Bayer','Dermatológicos','Crema','1%',0,'A6',5,65,8,[['L-2177',330,11,32]]],
  ['MED-015','Hidrocortisona crema 1%','Hidrocortisona','Genomma','Dermatológicos','Crema','1%',0,'C5',5,58,6,[['L-2005',40,7,28]]],
  ['MED-016','Vitamina C 1g','Ácido ascórbico','Bayer','Vitaminas','Tableta','1g',0,'B6',10,95,25,[['L-2399',500,30,50]]],
  ['MED-017','Complejo B','Vitaminas B1, B6, B12','Genomma','Vitaminas','Tableta','—',0,'C2',6,75,10,[['L-2160',280,14,38]]],
  ['MED-018','Ciprofloxacino 500mg','Ciprofloxacino','Senosiain','Antibióticos','Tableta','500mg',1,'C3',6,110,9,[['L-2088',25,4,62]]],
  ['MED-019','Diclofenaco gel 1%','Diclofenaco','Liomont','Analgésicos','Crema','1%',0,'A1',4,89,6,[['L-2311',260,9,44]]],
  ['MED-020','Clorfenamina 4mg','Clorfenamina','PiSA','Antialérgicos','Tableta','4mg',0,'D4',8,30,16,[['L-2266',190,20,12]]],
];
const PROVEEDORES = ['Distribuidora Salud S.A.','Nadro','Marzam','Fármacos Nacionales'];
// [nombre, contacto, teléfono, correo, días de entrega]
const PROVEEDORES_DATOS = [
  ['Distribuidora Salud S.A.','Marisol Vega','55 5100 2040','ventas@distsalud.mx',2],
  ['Nadro','Jorge Ibarra','55 5292 4343','pedidos@nadro.example',3],
  ['Marzam','Patricia Solís','55 5278 7500','atencion@marzam.example',5],
  ['Fármacos Nacionales','Luis Ortega','55 5360 1188','contacto@farmacosnacionales.example',7],
];
// Código de barras EAN-13 de ejemplo (prefijo 750 = México) con su dígito verificador.
function ean13(n){
  const base = '750100' + String(100000 + n * 137).slice(-6);
  const suma = [...base].reduce((t, d, i) => t + Number(d) * (i % 2 ? 3 : 1), 0);
  return base + (10 - suma % 10) % 10;
}
// Productos que suelen llevarse juntos (por id): sirve para que el modelo de
// "se venden juntos" tenga un patrón real que descubrir en los tickets.
const AFINES = [[3, 1], [8, 10], [12, 5], [4, 19], [10, 16], [6, 13]];

async function main(){
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  console.log('→ Creando base de datos y tablas...');
  let schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  if (DB_NAME !== 'smartstock') schema = schema.replace(/smartstock;/g, DB_NAME + ';').replace(/EXISTS smartstock/, 'EXISTS ' + DB_NAME);
  await conn.query(schema);
  await conn.query(`USE \`${DB_NAME}\``);

  console.log('→ Sucursales y usuarios...');
  const sucursales = [
    [1,'Farmacia El Roble','Farmacia El Roble S.A. de C.V.','FER200115AB1','Farmacia independiente','55 1234 0001','Av. Central','45',null,'Centro','57000','Nezahualcóyotl','Estado de México','Kaled Arellano','Gerente','kaled@smartstock.mx','Profesional','Activa',iso(addDays(HOY, -740))],
    [2,'Farmacia San José',null,null,'Botica','55 9876 0002','Calle Reforma','12',null,'Valle','56330','Chimalhuacán','Estado de México','Rocío Medina','Dueño','rocio@sanjose.mx','Básico','Pendiente',iso(addDays(HOY, -13))],
    [3,'Farmacia Vida Sana','Vida Sana Farmacias S. de R.L.','VSF180920K45','Farmacia con consultorio','55 4455 0003','Blvd. Juárez','200','Local 3','Reforma','55000','Ecatepec de Morelos','Estado de México','Iván Torres','Dueño','ivan@vidasana.mx','Empresarial','Suspendida',iso(addDays(HOY, -180))],
    [4,'Botica La Providencia',null,null,'Botica','55 2211 0004','Calle Hidalgo','8',null,'San Juan','56600','Chalco','Estado de México','Laura Campos','Dueño','laura@providencia.mx','Gratuito','Activa',iso(addDays(HOY, -95))],
    [5,'Farmacia del Ahorro Familiar','Ahorro Familiar S.A. de C.V.','AFA190310QX2','Sucursal de cadena','55 3322 0005','Av. Pantitlán','310','Local B','Agrícola Pantitlán','08100','Iztacalco','Ciudad de México','Héctor Luna','Gerente','hector@ahorrofamiliar.mx','Básico','Activa',iso(addDays(HOY, -210))],
    [6,'Farmacia Santa Cruz',null,null,'Farmacia con consultorio','55 4433 0006','Calle 5 de Mayo','77',null,'Centro','56100','Texcoco','Estado de México','Diana Robles','Dueño','diana@santacruz.mx','Profesional','Pendiente',iso(addDays(HOY, -2))],
    [7,'Botica Económica',null,null,'Botica','55 5544 0007','Calle Sur 12','4',null,'Agrícola Oriental','08500','Iztacalco','Ciudad de México','Raúl Peña','Encargado','raul@economica.mx','Básico','Rechazada',iso(addDays(HOY, -40))],
    [8,'Farmacia San Rafael',null,null,'Farmacia independiente','55 6655 0008','Av. Texcoco','1502',null,'Pavón','57610','Nezahualcóyotl','Estado de México','Sofía Marín','Dueño','sofia@sanrafael.mx','Gratuito','Activa',iso(addDays(HOY, -18))],
  ].map(r => {
    const dir = `${r[6]} ${r[7]}${r[8] ? ' ' + r[8] : ''}, Col. ${r[9]}, ${r[11]}, ${r[12]}, CP ${r[10]}`;
    return [...r.slice(0, 13), dir, ...r.slice(13)];
  });
  await conn.query(`INSERT INTO sucursales (id,nombre,razon_social,rfc,tipo,telefono,calle,num_exterior,num_interior,colonia,codigo_postal,municipio,entidad,direccion,dueno_nombre,responsable_cargo,correo,plan,estado,fecha_alta) VALUES ?`, [sucursales]);

  await conn.query(`UPDATE sucursales SET motivo_estado = 'Falta de pago del plan Empresarial desde hace dos meses.' WHERE id = 3`);
  await conn.query(`UPDATE sucursales SET motivo_estado = 'No fue posible verificar el domicilio ni el aviso de funcionamiento del establecimiento.' WHERE id = 7`);
  await conn.query(`UPDATE sucursales SET plan_solicitado = 'Profesional' WHERE id = 5`);
  const h = p => bcrypt.hashSync(p, 10);
  const usuarios = [
    [1,'Equipo EvoluWare','admin@smartstock.mx','55 0000 0000',h('admin123'),'superadmin',null,'Activo'],
    [2,'Kaled Arellano','kaled@smartstock.mx','55 1234 0001',h('dueno123'),'dueno',1,'Activo'],
    [3,'Esteban Pérez','esteban@smartstock.mx','55 1234 0002',h('empleado123'),'empleado',1,'Activo'],
    [4,'Eñe Sánchez','ene@smartstock.mx','55 1234 0003',h('empleado123'),'empleado',1,'Activo'],
    [5,'Mónica Tentle','monica@smartstock.mx','55 1234 0004',h('empleado123'),'empleado',1,'Inactivo'],
    [6,'Rocío Medina','rocio@sanjose.mx','55 9876 0002',h('dueno123'),'dueno',2,'Activo'],
    [7,'Iván Torres','ivan@vidasana.mx','55 4455 0003',h('dueno123'),'dueno',3,'Activo'],
    [8,'Laura Campos','laura@providencia.mx','55 2211 0004',h('dueno123'),'dueno',4,'Activo'],
    [9,'Héctor Luna','hector@ahorrofamiliar.mx','55 3322 0005',h('dueno123'),'dueno',5,'Activo'],
    [10,'Diana Robles','diana@santacruz.mx','55 4433 0006',h('dueno123'),'dueno',6,'Activo'],
    [11,'Raúl Peña','raul@economica.mx','55 5544 0007',h('dueno123'),'dueno',7,'Activo'],
    [12,'Sofía Marín','sofia@sanrafael.mx','55 6655 0008',h('dueno123'),'dueno',8,'Activo'],
  ];
  await conn.query('INSERT INTO usuarios (id,nombre,correo,telefono,password_hash,rol,sucursal_id,estado) VALUES ?', [usuarios]);
  // Últimos accesos (para el panel de plataforma y la puntuación de salud)
  for (const [id, dias] of [[1, 0], [2, 0], [3, 1], [4, 2], [7, 62], [8, 41], [9, 6], [12, 3]])
    await conn.query('UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?', [dt(addDays(HOY, -dias), 9, 30), id]);

  const bitacora = [
    [1,'Equipo EvoluWare','sucursal.aprobar',1,'Aprobó a Farmacia El Roble',dt(addDays(HOY, -739), 10, 5)],
    [9,'Héctor Luna','sucursal.registro',5,'Farmacia del Ahorro Familiar se registró con el plan Básico (pendiente de aprobación).',dt(addDays(HOY, -210), 12, 40)],
    [1,'Equipo EvoluWare','sucursal.aprobar',5,'Aprobó a Farmacia del Ahorro Familiar',dt(addDays(HOY, -209), 9, 12)],
    [8,'Laura Campos','sucursal.registro',4,'Botica La Providencia se registró con el plan Gratuito (activación inmediata).',dt(addDays(HOY, -95), 18, 22)],
    [1,'Equipo EvoluWare','sucursal.suspender',3,'Suspendió a Farmacia Vida Sana. Motivo: Falta de pago del plan Empresarial desde hace dos meses.',dt(addDays(HOY, -60), 11, 0)],
    [11,'Raúl Peña','sucursal.registro',7,'Botica Económica se registró con el plan Básico (pendiente de aprobación).',dt(addDays(HOY, -40), 16, 3)],
    [1,'Equipo EvoluWare','sucursal.rechazar',7,'Rechazó la solicitud de Botica Económica. Motivo: No fue posible verificar el domicilio ni el aviso de funcionamiento del establecimiento.',dt(addDays(HOY, -38), 10, 30)],
    [12,'Sofía Marín','sucursal.registro',8,'Farmacia San Rafael se registró con el plan Gratuito (activación inmediata).',dt(addDays(HOY, -18), 13, 15)],
    [6,'Rocío Medina','sucursal.registro',2,'Farmacia San José se registró con el plan Básico (pendiente de aprobación).',dt(addDays(HOY, -13), 9, 48)],
    [9,'Héctor Luna','sucursal.solicitud-plan',5,'Solicitó cambiar del plan Básico al plan Profesional.',dt(addDays(HOY, -4), 17, 20)],
    [10,'Diana Robles','sucursal.registro',6,'Farmacia Santa Cruz se registró con el plan Profesional (pendiente de aprobación).',dt(addDays(HOY, -2), 11, 37)],
    [1,'Equipo EvoluWare','aviso.crear',null,'Publicó el aviso "Nuevo: análisis inteligente y asistente" para todas las sucursales.',dt(addDays(HOY, -1), 8, 0)],
  ];
  await conn.query('INSERT INTO auditoria (usuario_id,usuario_nombre,accion,sucursal_id,detalle,fecha) VALUES ?', [bitacora]);
  await conn.query(`INSERT INTO avisos (titulo,mensaje,tipo,plan,creado_por,creado_en) VALUES
    ('Nuevo: análisis inteligente y asistente','Ya puedes preguntarle al asistente dónde está un medicamento o qué está por caducar. Con los planes Profesional y Empresarial también detecta movimientos inusuales y lotes en riesgo.','Novedad',NULL,'Equipo EvoluWare',?)`, [dt(addDays(HOY, -1), 8, 0)]);

  const vendedores = [2, 3, 4, 5];

  await conn.query('INSERT INTO proveedores (sucursal_id,nombre,contacto,telefono,correo,dias_entrega) VALUES ?',
    [PROVEEDORES_DATOS.map(p => [1, ...p])]);

  console.log('→ Catálogo y lotes...');
  const movs = [];
  for (let i = 0; i < PRODUCTOS.length; i++){
    const [codigo, nombre, sustancia, lab, cat, pres, conc, receta, ubic, min, precio, base, lotes] = PRODUCTOS[i];
    const [r] = await conn.query(`INSERT INTO productos (sucursal_id,codigo,codigo_barras,proveedor_id,nombre,sustancia,laboratorio,categoria,presentacion,concentracion,requiere_receta,ubicacion,stock_minimo,precio)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [codigo, ean13(i + 1), (i % 4) + 1, nombre, sustancia, lab, cat, pres, conc, receta, ubic, min, precio]);
    const pid = r.insertId;

    for (const [num, dias, cant, costo] of lotes){
      const entrada = addDays(HOY, -Math.round(between(5, 40)));
      const prov = PROVEEDORES[Math.floor(rnd() * PROVEEDORES.length)];
      const factura = 'F-' + (1000 + Math.floor(rnd() * 200));
      const recibido = cant + Math.round(between(5, 20));
      const [lr] = await conn.query(`INSERT INTO lotes (producto_id,numero_lote,caducidad,cantidad,costo_unitario,factura,proveedor,fecha_entrada)
        VALUES (?,?,?,?,?,?,?,?)`, [pid, num, iso(addDays(HOY, dias)), cant, costo, factura, prov, iso(entrada)]);
      movs.push([1, pid, lr.insertId, 'Entrada', recibido, 'Compra a proveedor', prov, factura, null, null, 2, dt(entrada, 9, 15)]);
      // Las unidades que ya se vendieron de este lote
      const vendidas = recibido - cant;
      const dSale = addDays(entrada, Math.max(1, Math.round(between(1, 4))));
      if (dSale < HOY) movs.push([1, pid, lr.insertId, 'Salida', vendidas, 'Venta', null, null, receta ? 'RX-' + (5000 + Math.floor(rnd() * 900)) : null, null, 3 + Math.floor(rnd() * 2), dt(dSale, 12, 30)]);
    }

    // ---------- Histórico de ventas: ~104 semanas ----------
    const estac = ESTACIONALIDAD[cat] || Array(12).fill(1);
    const inicio = addDays(HOY, -7 * 104 - 7);
    for (let w = 0; w < 104; w++){
      const semana = addDays(inicio, w * 7);
      const tendencia = 1 + 0.10 * (w / 52);          // +10 % anual
      const esperado = base * estac[semana.getMonth()] * tendencia * 12 / 52;
      let total = Math.max(0, Math.round(esperado * between(0.75, 1.25)));
      // Reabastecimiento mensual histórico (entrada sin lote vigente)
      if (w % 4 === 0){
        const prov = PROVEEDORES[Math.floor(rnd() * PROVEEDORES.length)];
        movs.push([1, pid, null, 'Entrada', Math.round(base * tendencia * between(0.9, 1.2)), 'Compra a proveedor', prov, 'F-' + (100 + w), null, null, 2, dt(semana, 9, 0)]);
      }
      while (total > 0){
        const q = Math.min(total, Math.max(1, Math.round(between(1, 4))));
        total -= q;
        const dia = addDays(semana, Math.floor(rnd() * 7));
        if (dia >= HOY) continue;
        movs.push([1, pid, null, 'Salida', q, 'Venta', null, null, receta ? 'RX-' + (1000 + Math.floor(rnd() * 8999)) : null, null,
          vendedores[Math.floor(rnd() * vendedores.length)], dt(dia, 9 + Math.floor(rnd() * 11), Math.floor(rnd() * 60))]);
      }
    }
  }

  // Movimientos fuera de lo normal, para que la detección de anomalías tenga qué encontrar
  movs.push([1, 4, null, 'Salida', 28, 'Venta', null, null, null, null, 4, dt(addDays(HOY, -3), 20, 41)]);
  movs.push([1, 2, null, 'Salida', 12, 'Merma / caducado', null, null, null, null, 3, dt(addDays(HOY, -6), 13, 5)]);
  movs.push([1, 16, null, 'Salida', 3, 'Venta', null, null, null, null, 4, dt(addDays(HOY, -2), 23, 52)]);

  // ---------- Tickets del punto de venta (últimos 180 días) ----------
  // Cada venta reciente pertenece a un ticket. Los productos afines caen con frecuencia en el mismo.
  const desdeTickets = dt(addDays(HOY, -180), 0, 0);
  const porDia = {};
  movs.forEach((m, i) => { if (m[3] === 'Salida' && m[5] === 'Venta' && m[11] >= desdeTickets) (porDia[m[11].slice(0, 10)] = porDia[m[11].slice(0, 10)] || []).push(i); });
  const ventas = [];
  const precioDe = id => PRODUCTOS[id - 1][10];
  const abrir = i => { ventas.push([ventas.length + 1, 1, 'V-' + String(ventas.length + 1).padStart(5, '0'), movs[i][10], movs[i][11], 0, movs[i][8]]); return ventas.length; };
  const meter = (i, v) => { movs[i][12] = v; movs[i][10] = ventas[v - 1][3]; movs[i][11] = ventas[v - 1][4];
    ventas[v - 1][5] += movs[i][4] * precioDe(movs[i][1]); if (movs[i][8] && !ventas[v - 1][6]) ventas[v - 1][6] = movs[i][8]; };
  for (const dia of Object.keys(porDia).sort()){
    const libres = new Set(porDia[dia]);
    for (const [a, b] of AFINES){
      const deA = [...libres].filter(i => movs[i][1] === a), deB = [...libres].filter(i => movs[i][1] === b);
      for (let k = 0; k < Math.min(deA.length, deB.length); k++){
        if (rnd() > 0.65) continue;
        const v = abrir(deA[k]); meter(deA[k], v); meter(deB[k], v); libres.delete(deA[k]); libres.delete(deB[k]);
      }
    }
    let previo = null;
    for (const i of libres){
      // 1 de cada 10 se suma al ticket anterior (compras variadas, sin patrón)
      if (previo && rnd() < 0.10 && movs.every((m, j) => m[12] !== previo || m[1] !== movs[i][1] || j === i)) meter(i, previo);
      else { previo = abrir(i); meter(i, previo); }
    }
  }
  // Ventas de hoy, para que "Mi turno" tenga algo que resumir desde la primera vez
  for (const [usuario, hora, min, partidas] of [[3, 8, 5, [[1, 2], [3, 1]]], [3, 8, 40, [[16, 1]]], [3, 9, 15, [[12, 1], [5, 2]]], [4, 8, 22, [[4, 2]]], [4, 9, 2, [[7, 1], [2, 1]]]]){
    const receta = partidas.some(([pid]) => PRODUCTOS[pid - 1][7]) ? 'RX-' + (7000 + ventas.length) : null;
    ventas.push([ventas.length + 1, 1, 'V-' + String(ventas.length + 1).padStart(5, '0'), usuario, dt(HOY, hora, min), 0, receta]);
    for (const [pid, cant] of partidas){
      movs.push([1, pid, null, 'Salida', cant, 'Venta', null, null, PRODUCTOS[pid - 1][7] ? receta : null, null, usuario, dt(HOY, hora, min), ventas.length]);
      ventas[ventas.length - 1][5] += cant * precioDe(pid);
    }
  }
  movs.forEach(m => { if (m.length < 13) m[12] = null; });

  console.log(`→ Insertando ${ventas.length} tickets y ${movs.length} movimientos históricos...`);
  for (let i = 0; i < ventas.length; i += 1000)
    await conn.query('INSERT INTO ventas (id,sucursal_id,folio,usuario_id,fecha,total,receta) VALUES ?', [ventas.slice(i, i + 1000)]);
  for (let i = 0; i < movs.length; i += 1000){
    await conn.query(`INSERT INTO movimientos (sucursal_id,producto_id,lote_id,tipo,cantidad,motivo,proveedor,factura,receta,cliente,usuario_id,fecha,venta_id) VALUES ?`, [movs.slice(i, i + 1000)]);
  }

  // ---------- Órdenes de compra ----------
  await conn.query(`INSERT INTO ordenes_compra (id,sucursal_id,folio,proveedor_id,estado,origen,creada_por,fecha,fecha_envio,fecha_recepcion) VALUES ?`, [[
    [1, 1, 'OC-0001', 1, 'Recibida', 'Manual', 2, dt(addDays(HOY, -24), 9, 10), dt(addDays(HOY, -24), 9, 30), dt(addDays(HOY, -21), 11, 0)],
    [2, 1, 'OC-0002', 3, 'Recibida', 'Manual', 2, dt(addDays(HOY, -31), 10, 0), dt(addDays(HOY, -30), 8, 45), dt(addDays(HOY, -24), 12, 20)],
    [3, 1, 'OC-0003', 2, 'Enviada', 'IA', 2, dt(addDays(HOY, -2), 17, 5), dt(addDays(HOY, -2), 17, 20), null],
  ]]);
  await conn.query('INSERT INTO orden_partidas (orden_id,producto_id,cantidad,costo_unitario,cantidad_recibida,motivo) VALUES ?', [[
    [1, 4, 40, 20, 40, null], [1, 9, 30, 22, 30, null],
    [2, 16, 40, 50, 40, null], [2, 7, 20, 28, 14, null],
    [3, 18, 15, 62, null, 'Stock actual (4 u.) en o por debajo del mínimo (6 u.).'], [3, 6, 20, 30, null, 'El stock útil alcanza para pocos días de venta.'],
  ]]);

  // ---------- Conteos físicos ----------
  await conn.query('INSERT INTO conteos (id,sucursal_id,folio,estado,origen,creado_por,asignado_a,fecha,cerrado_en) VALUES ?', [[
    [1, 1, 'CF-0001', 'Aplicado', 'Manual', 2, 4, dt(addDays(HOY, -35), 9, 0), dt(addDays(HOY, -35), 13, 30)],
    [2, 1, 'CF-0002', 'Abierto', 'IA', 2, 3, dt(addDays(HOY, -1), 18, 10), null],
  ]]);
  const existencia = {};
  (await conn.query('SELECT producto_id, SUM(cantidad) AS n FROM lotes GROUP BY producto_id'))[0].forEach(r => existencia[r.producto_id] = Number(r.n));
  await conn.query('INSERT INTO conteo_partidas (conteo_id,producto_id,esperado,contado,motivo) VALUES ?', [[
    [1, 2, 24, 24, null], [1, 7, 15, 14, null], [1, 9, 25, 25, null], [1, 14, 11, 11, null], [1, 20, 20, 20, null],
    [2, 4, existencia[4], null, 'Tuvo una salida inusual esta semana.'],
    [2, 8, existencia[8], null, 'Medicamento controlado de alto valor.'],
    [2, 16, existencia[16], null, 'De los que más ingreso generan y no se ha contado.'],
    [2, 11, existencia[11], null, 'Medicamento controlado de alto valor.'],
  ]]);

  // ---------- Faltantes: lo que pidieron los clientes y no había ----------
  const faltantes = [
    ['Metformina 850', null, 2, 3, 1, 12], ['metformna 850mg', null, 1, 4, 3, 18], ['Metformina 850 mg', null, 1, 3, 6, 11], ['metformina', null, 2, 4, 9, 16], ['Metformina tabs', null, 1, 3, 15, 10],
    ['Losartán 50mg', null, 1, 3, 2, 13], ['losartan', null, 1, 4, 5, 19], ['Losartan 50', null, 2, 3, 11, 12], ['lozartan 50 mg', null, 1, 4, 20, 17],
    ['Amoxicilina 500mg', 3, 2, 3, 0, 11], ['Amoxicilina 500mg', 3, 1, 4, 1, 15], ['Amoxicilina 500mg', 3, 3, 3, 2, 18],
    ['Aspirina protect', null, 1, 4, 7, 14], ['aspirina', null, 1, 3, 13, 10],
    ['Salbutamol inhalador', 11, 1, 4, 25, 12], ['Pañales etapa 3', null, 1, 3, 8, 16],
  ].map(([texto, pid, cant, usuario, dias, hora]) => [1, pid, texto, cant, usuario, dt(addDays(HOY, -dias), hora, 20)]);
  await conn.query('INSERT INTO faltantes (sucursal_id,producto_id,texto,cantidad,usuario_id,fecha) VALUES ?', [faltantes]);

  await conn.end();
  console.log('\n✅ Base de datos lista.');
  console.log('   Superadmin: admin@smartstock.mx / admin123');
  console.log('   Dueño:      kaled@smartstock.mx / dueno123');
  console.log('   Empleado:   esteban@smartstock.mx / empleado123');
}

main().catch(err => {
  console.error('\n❌ Error al inicializar la base de datos:', err.message);
  if (err.code === 'ECONNREFUSED') console.error('   ¿Está encendido MySQL? Revisa DB_HOST y DB_PORT en el archivo .env');
  if (err.code === 'ER_ACCESS_DENIED_ERROR') console.error('   Usuario o contraseña de MySQL incorrectos. Revisa DB_USER y DB_PASSWORD en .env');
  process.exit(1);
});
