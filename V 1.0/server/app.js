/* ===== app.js : configuración de Express y montaje de rutas ===== */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const { autenticar, permitir } = require('./middleware/auth');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '1mb' }));
if(process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// ---------- API ----------
const api = express.Router();
api.get('/salud', (req, res) => res.json({ ok: true, servicio: 'SmartStock API' }));
api.use('/auth', require('./routes/auth'));
api.use('/catalogos', require('./routes/catalogos'));
api.use('/iot', require('./routes/led').iot);              // usa token IoT, no JWT

api.use(autenticar);                                        // todo lo de abajo requiere sesión
const sucursales = require('./routes/sucursales');
api.use('/sucursales', sucursales.admin);
api.use('/mi-sucursal', sucursales.mia);
const operacion = permitir('dueno', 'empleado');
api.use('/productos/importar', permitir('dueno'), require('./routes/importar'));
api.use('/productos', operacion, require('./routes/productos'));
api.use('/ventas', operacion, require('./routes/ventas'));
api.use('/faltantes', operacion, require('./routes/faltantes'));
api.use('/conteos', operacion, require('./routes/conteos'));
api.get('/turno', operacion, async (req, res, next) => { try{ res.json(await require('./services/turno').miTurno(req.user)); }catch(e){ next(e); } });
const compras = require('./routes/compras');
api.use('/proveedores', permitir('dueno'), compras.proveedores);
api.use('/ordenes', permitir('dueno'), compras.ordenes);
api.use('/inventario', operacion, require('./routes/inventario'));
api.use('/movimientos', operacion, require('./routes/movimientos'));
api.use('/led', operacion, require('./routes/led').app);
api.use('/usuarios', permitir('dueno'), require('./routes/usuarios'));
api.use('/ia', operacion, require('./routes/ia'));
api.use('/plataforma', permitir('superadmin'), require('./routes/plataforma'));
// Avisos del equipo SmartStock vigentes para la sucursal de quien consulta
api.get('/avisos', operacion, async (req, res, next) => {
  try{
    const { query } = require('./db'); const { hoyISO } = require('./utils');
    res.json(await query(`SELECT a.id, a.titulo, a.mensaje, a.tipo, a.creado_en FROM avisos a JOIN sucursales s ON s.id = ?
      WHERE a.activo = 1 AND (a.vence_el IS NULL OR a.vence_el >= ?) AND (a.plan IS NULL OR a.plan = s.plan)
      ORDER BY FIELD(a.tipo,'Importante','Mantenimiento','Novedad'), a.creado_en DESC`, [req.user.sucursal_id, hoyISO()]));
  }catch(e){ next(e); }
});
api.use('/analitica', permitir('dueno'), require('./routes/analitica'));
api.use('/reportes', permitir('dueno'), require('./routes/reportes'));

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// ---------- Frontend estático ----------
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// ---------- Manejo central de errores ----------
app.use((err, req, res, next) => {
  if(err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  const status = err.status || 500;
  if(status >= 500) console.error(err);
  const msg = status >= 500
    ? (err.code === 'ECONNREFUSED' ? 'No hay conexión con la base de datos. ¿Está encendido MySQL?' : 'Ocurrió un error en el servidor.')
    : err.message;
  res.status(status).json({ error: msg });
});

module.exports = app;
