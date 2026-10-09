/* ===== constants.js : catálogos fijos del sistema ===== */
const FILAS = ['A','B','C','D'];
const COLUMNAS = [1,2,3,4,5,6];

module.exports = {
  CATEGORIAS: ['Analgésicos','Antialérgicos','Antibióticos','Gastrointestinal','Dermatológicos','Respiratorios','Vitaminas','Otro'],
  PRESENTACIONES: ['Tableta','Cápsula','Jarabe','Suspensión','Inyectable','Sobre','Crema','Gotas','Aerosol'],
  MOTIVOS_SALIDA: ['Venta','Merma / caducado','Traslado a otra sucursal','Devolución a proveedor'],
  PLANES: ['Gratuito','Básico','Profesional','Empresarial'],
  // Límites por plan. El plan Gratuito se activa al instante; los de pago pasan por revisión.
  LIMITES_PLAN: {
    'Gratuito':    { precio: 0, empleados: 1,   medicamentos: 30,   analitica: false },
    'Básico':      { precio: 299, empleados: 3,   medicamentos: null, analitica: false },
    'Profesional': { precio: 599, empleados: 15,  medicamentos: null, analitica: true },
    'Empresarial': { precio: 1199, empleados: 100, medicamentos: null, analitica: true },
  },
  TIPOS_NEGOCIO: ['Farmacia independiente','Farmacia con consultorio','Botica','Sucursal de cadena','Otro'],
  CARGOS: ['Dueño','Gerente','Responsable sanitario','Encargado','Otro'],
  ESTADOS_MX: ['Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas','Chihuahua','Ciudad de México','Coahuila','Colima','Durango','Estado de México','Guanajuato','Guerrero','Hidalgo','Jalisco','Michoacán','Morelos','Nayarit','Nuevo León','Oaxaca','Puebla','Querétaro','Quintana Roo','San Luis Potosí','Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz','Yucatán','Zacatecas'],
  FILAS, COLUMNAS,
  UBICACIONES: FILAS.flatMap(f => COLUMNAS.map(c => f + c)),
  // Zona de acceso rápido (cerca del mostrador): filas A y B, columnas 1 a 3.
  ZONA_RAPIDA: ['A1','A2','A3','B1','B2','B3'],
  DIAS_ALERTA_CADUCIDAD: 45,   // amarillo
  DIAS_URGENTE_CADUCIDAD: 15,  // rojo
};
