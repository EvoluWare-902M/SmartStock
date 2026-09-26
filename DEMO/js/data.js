const HOY = new Date('2026-09-22');

const CATEGORIAS = ["Analgésicos","Antialérgicos","Antibióticos","Gastrointestinal","Dermatológicos","Otro"];
const PRESENTACIONES = ["Tableta","Cápsula","Jarabe","Suspensión","Inyectable","Sobre","Crema"];
const UBICACIONES = ["A1","A2","A3","A4","A5","A6","B1","B2","B3","B4","B5","B6","C1","C2","C3","C4","C5","C6","D1","D2","D3","D4","D5","D6"];
const MOTIVOS_SALIDA = ["Venta","Merma / caducado","Traslado a otra sucursal","Devolución a proveedor"];
const PLANES = ["Básico","Profesional","Empresarial"];

const sucursales = [
  {id:"suc-001", nombre:"Farmacia El Roble", dueño:"Kaled Arellano", correo:"kaled@smartstock.mx",
    telefono:"55 1234 0001", direccion:"Av. Central 45, Col. Centro, Nezahualcóyotl, Edo. Méx., CP 57000",
    plan:"Profesional", estado:"Activa", fechaAlta:"2026-06-10"},
  {id:"suc-002", nombre:"Farmacia San José", dueño:"Rocío Medina", correo:"rocio@sanjose.mx",
    telefono:"55 9876 0002", direccion:"Calle Reforma 12, Col. Valle, Chimalhuacán, Edo. Méx., CP 56330",
    plan:"Básico", estado:"Pendiente", fechaAlta:"2026-09-18"},
  {id:"suc-003", nombre:"Farmacia Vida Sana", dueño:"Iván Torres", correo:"ivan@vidasana.mx",
    telefono:"55 4455 0003", direccion:"Blvd. Juárez 200, Col. Reforma, Ecatepec, Edo. Méx., CP 55000",
    plan:"Empresarial", estado:"Suspendida", fechaAlta:"2026-04-02"},
];

const cuentas = [
  {correo:"admin@smartstock.mx", password:"admin123", rol:"superadmin", nombre:"Equipo EvoluWare", sucursalId:null},
  {correo:"kaled@smartstock.mx", password:"dueno123", rol:"dueño", nombre:"Kaled Arellano", sucursalId:"suc-001"},
  {correo:"esteban@smartstock.mx", password:"empleado123", rol:"empleado", nombre:"Esteban Pérez", sucursalId:"suc-001"},
  {correo:"ene@smartstock.mx", password:"empleado123", rol:"empleado", nombre:"Eñe Sánchez", sucursalId:"suc-001"},
  {correo:"monica@smartstock.mx", password:"empleado123", rol:"empleado", nombre:"Mónica Tentle", sucursalId:"suc-001"},
];

const productos = [
  {codigo:"MED-001", n:"Paracetamol 500mg", laboratorio:"Genfar", categoria:"Analgésicos", presentacion:"Tableta", concentracion:"500mg", requiereReceta:false, anaquel:"A2", fila:1, col:2, stock:8, min:15, precio:35, sucursalId:"suc-001"},
  {codigo:"MED-002", n:"Loratadina 10mg", laboratorio:"Bayer", categoria:"Antialérgicos", presentacion:"Tableta", concentracion:"10mg", requiereReceta:false, anaquel:"B4", fila:2, col:4, stock:22, min:10, precio:48, sucursalId:"suc-001"},
  {codigo:"MED-003", n:"Amoxicilina 500mg", laboratorio:"PiSA", categoria:"Antibióticos", presentacion:"Cápsula", concentracion:"500mg", requiereReceta:true, anaquel:"C1", fila:3, col:1, stock:5, min:12, precio:90, sucursalId:"suc-001"},
  {codigo:"MED-004", n:"Ibuprofeno 400mg", laboratorio:"Bayer", categoria:"Analgésicos", presentacion:"Tableta", concentracion:"400mg", requiereReceta:false, anaquel:"A5", fila:1, col:5, stock:30, min:15, precio:40, sucursalId:"suc-001"},
  {codigo:"MED-005", n:"Suero oral", laboratorio:"Pisa", categoria:"Gastrointestinal", presentacion:"Sobre", concentracion:"—", requiereReceta:false, anaquel:"D3", fila:4, col:3, stock:6, min:10, precio:15, sucursalId:"suc-001"},
  {codigo:"MED-006", n:"Omeprazol 20mg", laboratorio:"Genfar", categoria:"Gastrointestinal", presentacion:"Cápsula", concentracion:"20mg", requiereReceta:false, anaquel:"C6", fila:3, col:6, stock:18, min:8, precio:55, sucursalId:"suc-001"},
  {codigo:"MED-007", n:"Cetirizina 10mg", laboratorio:"UCB", categoria:"Antialérgicos", presentacion:"Tableta", concentracion:"10mg", requiereReceta:false, anaquel:"B2", fila:2, col:2, stock:14, min:10, precio:52, sucursalId:"suc-001"},
  {codigo:"MED-008", n:"Azitromicina 500mg", laboratorio:"Pfizer", categoria:"Antibióticos", presentacion:"Cápsula", concentracion:"500mg", requiereReceta:true, anaquel:"C4", fila:3, col:4, stock:9, min:10, precio:120, sucursalId:"suc-001"},
];

const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const historicos = {
  "Analgésicos":     [40,38,42,45,50,55,60,58,52,48,44,41],
  "Antialérgicos":   [20,22,35,58,72,65,50,38,25,20,18,19],
  "Antibióticos":    [30,33,55,60,58,45,35,32,30,34,50,62],
  "Gastrointestinal":[25,26,28,32,45,60,68,64,50,35,28,26],
};

const lotes = [
  {producto:"Paracetamol 500mg", lote:"L-2301", caducidad:"2026-10-05", cantidad:5, factura:"F-1042", costoUnitario:18},
  {producto:"Paracetamol 500mg", lote:"L-2455", caducidad:"2027-03-12", cantidad:3, factura:"F-1098", costoUnitario:18},
  {producto:"Amoxicilina 500mg", lote:"L-1899", caducidad:"2026-09-30", cantidad:5, factura:"F-0987", costoUnitario:60},
  {producto:"Ibuprofeno 400mg", lote:"L-2100", caducidad:"2027-01-20", cantidad:30, factura:"F-1010", costoUnitario:20},
  {producto:"Suero oral", lote:"L-2044", caducidad:"2026-10-10", cantidad:6, factura:"F-0950", costoUnitario:7},
  {producto:"Omeprazol 20mg", lote:"L-1950", caducidad:"2026-12-01", cantidad:18, factura:"F-0999", costoUnitario:30},
  {producto:"Cetirizina 10mg", lote:"L-2210", caducidad:"2027-02-14", cantidad:14, factura:"F-1075", costoUnitario:28},
  {producto:"Azitromicina 500mg", lote:"L-1780", caducidad:"2026-10-01", cantidad:9, factura:"F-0932", costoUnitario:80},
];

const movimientos = [
  {fecha:"2026-09-20", producto:"Paracetamol 500mg", lote:"L-2301", tipo:"Entrada", cantidad:20, motivo:"Compra a proveedor", responsable:"Kaled Arellano"},
  {fecha:"2026-09-20", producto:"Paracetamol 500mg", lote:"L-2301", tipo:"Salida", cantidad:12, motivo:"Venta", responsable:"Esteban Pérez"},
  {fecha:"2026-09-19", producto:"Amoxicilina 500mg", lote:"L-1899", tipo:"Entrada", cantidad:10, motivo:"Compra a proveedor", responsable:"Kaled Arellano"},
  {fecha:"2026-09-19", producto:"Amoxicilina 500mg", lote:"L-1899", tipo:"Salida", cantidad:5, motivo:"Venta", responsable:"Eñe Sánchez"},
  {fecha:"2026-09-18", producto:"Ibuprofeno 400mg", lote:"L-2100", tipo:"Entrada", cantidad:30, motivo:"Compra a proveedor", responsable:"Kaled Arellano"},
  {fecha:"2026-09-17", producto:"Suero oral", lote:"L-2044", tipo:"Salida", cantidad:4, motivo:"Venta", responsable:"Mónica Tentle"},
  {fecha:"2026-09-16", producto:"Omeprazol 20mg", lote:"L-1950", tipo:"Entrada", cantidad:18, motivo:"Compra a proveedor", responsable:"Kaled Arellano"},
  {fecha:"2026-09-15", producto:"Azitromicina 500mg", lote:"L-1780", tipo:"Salida", cantidad:6, motivo:"Venta", responsable:"Eñe Sánchez"},
];

const recomendaciones = [
  {categoria:"Antibióticos", producto:"Amoxicilina 500mg", cantidad:40, motivo:"Rotación alta y stock por debajo del mínimo."},
  {categoria:"Gastrointestinal", producto:"Suero oral", cantidad:35, motivo:"Temporada de calor: aumento histórico de casos gastrointestinales."},
  {categoria:"Analgésicos", producto:"Paracetamol 500mg", cantidad:50, motivo:"Se acerca temporada de infecciones respiratorias (otoño-invierno)."},
];

const reubicaciones = [
  {producto:"Paracetamol 500mg", actual:"A2", sugerida:"A1", motivo:"Alta rotación: acercar al mostrador."},
  {producto:"Suero oral", actual:"D3", sugerida:"B1", motivo:"Demanda estacional creciente."},
  {producto:"Omeprazol 20mg", actual:"C6", sugerida:"C2", motivo:"Consumo constante todo el año."},
];

const usuarios = [
  {nombre:"Esteban Pérez", correo:"esteban@smartstock.mx", telefono:"55 1234 0002", rol:"Empleado", sucursalId:"suc-001", estado:"Activo"},
  {nombre:"Eñe Sánchez", correo:"ene@smartstock.mx", telefono:"55 1234 0003", rol:"Empleado", sucursalId:"suc-001", estado:"Activo"},
  {nombre:"Mónica Tentle", correo:"monica@smartstock.mx", telefono:"55 1234 0004", rol:"Empleado", sucursalId:"suc-001", estado:"Inactivo"},
];