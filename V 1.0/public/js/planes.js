/* ===== planes.js : planes de SmartStock (los usan la portada y el registro) =====
   Edita aquí precios y características. Los límites reales (empleados,
   medicamentos, analítica) se aplican en el servidor: server/constants.js
*/
const PLANES_INFO = [
  { nombre: 'Gratuito', precio: 0, para: 'Para probar SmartStock sin costo', aviso: 'Acceso inmediato',
    incluye: ['1 empleado', 'Hasta 30 medicamentos', 'Localización con LED', 'Existencias, alertas y caducidades'] },
  { nombre: 'Básico', precio: 299, para: 'Para ordenar todo el inventario',
    incluye: ['Hasta 3 empleados', 'Medicamentos ilimitados', 'Todo lo del plan Gratuito', 'Reportes en PDF y Excel'] },
  { nombre: 'Profesional', precio: 599, destacado: true, para: 'Para anticiparse a la demanda',
    incluye: ['Hasta 15 empleados', 'Todo lo del plan Básico', 'Predicción de demanda', 'Recomendación de compras y repisas'] },
  { nombre: 'Empresarial', precio: 1199, para: 'Para farmacias con mucho personal',
    incluye: ['Hasta 100 empleados', 'Todo lo del plan Profesional', 'Soporte prioritario'] },
];
const precioPlan = p => p.precio === 0 ? 'Gratis' : '$' + p.precio.toLocaleString('es-MX');
