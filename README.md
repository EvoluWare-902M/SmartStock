# SmartStock
***********
## DESCRIPCIÓN
Sistema web inteligente para la gestión de inventario en farmacias, que combina localización visual, monitoreo de existencias y análisis predictivo para anticipar necesidades de abastecimiento.

# HERRAMIENTAS DE DESARROLLO
+ HTML5
+ CSS3
+ JavaScript
+ Chart.js
+ Node.js con Express
+ PHP
+ MySQL

# EQUIPO DE TRABAJO
+ SCRUM
+ Arellano Hernández Kaled Yael
+ Pérez GarcÍa Jorge Esteban
+ Reyes Ramírez Leyvi Dayana
+ Sanchez Gomez Esmeralda Yossibeth
+ TENTLE ZURITA MONICA MONTSERRAT

# FUNCIONALIDADES

## Autenticación y accesos
- [ ] Login con correo y contraseña
- [ ] Determinación automática de rol según la cuenta (Superadmin / Dueño / Empleado)
- [ ] Registro de sucursal (autoservicio, queda pendiente de aprobación)
- [ ] Recuperación de contraseña
- [ ] Cierre de sesión
- [ ] Control de permisos por rol (rutas protegidas)

## Gestión de sucursales (Superadmin)
- [ ] CRUD de sucursales
- [ ] Aprobar / rechazar solicitud de nueva sucursal
- [ ] Suspender / reactivar sucursal
- [ ] Panel general de la plataforma (métricas globales)
- [ ] Historial de cambios de estado por sucursal

## CRUD de productos
- [ ] Registrar medicamento (nombre, código/SKU, laboratorio, categoría, presentación, concentración, receta)
- [ ] Editar medicamento
- [ ] Eliminar / dar de baja medicamento
- [ ] Listado y búsqueda de productos
- [ ] Localización asistida (LED / mapa de anaqueles)

## CRUD de proveedores
- [ ] Registrar proveedor (nombre, contacto, teléfono, correo, dirección)
- [ ] Editar proveedor
- [ ] Eliminar proveedor
- [ ] Historial de compras por proveedor
- [ ] Vincular proveedor a cada entrada de mercancía

## CRUD de usuarios / empleados
- [ ] Registrar empleado (por el Dueño, acotado a su sucursal)
- [ ] Editar datos de empleado
- [ ] Activar / desactivar empleado
- [ ] Eliminar empleado
- [ ] Asignación de rol y permisos

## Control de inventario
- [ ] Registro de entradas (proveedor, lote, cantidad, factura, costo)
- [ ] Registro de salidas (venta, merma, traslado, devolución)
- [ ] Control de stock mínimo y alertas de reabastecimiento
- [ ] Control de lotes y fechas de caducidad (semáforo de urgencia)
- [ ] Historial de movimientos con filtros (producto, tipo, fechas)
- [ ] Ajuste manual de inventario (correcciones)

## Analítica e inteligencia
- [ ] Predicción de demanda por categoría/temporada
- [ ] Recomendación automática de compras
- [ ] Organización inteligente de repisas (por rotación)

## Reportes
- [ ] Reporte de existencias
- [ ] Reporte de caducidades
- [ ] Reporte de movimientos
- [ ] Exportación a PDF / Excel
- [ ] Filtro por rango de fechas y tipo de reporte

## Dashboard Admin
- [ ] Dashboard del Superadmin (sucursales activas, pendientes, suspendidas)
- [ ] Dashboard del Dueño (stock bajo, caducidades próximas, ventas del día)
- [ ] Gráficas de ventas e inventario
- [ ] Indicadores clave (KPIs): productos totales, alertas activas, valor del inventario

## Stock de producto
- [ ] Consulta de existencia en tiempo real
- [ ] Alertas visuales de stock bajo
- [ ] Historial de existencia por producto

# FECHAS
+ Fecha de inicio: 16 de Septiembre del 2026
+ Fecha de termino: 20 de Noviembre del 2026
