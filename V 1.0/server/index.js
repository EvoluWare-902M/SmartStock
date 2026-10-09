/* ===== index.js : punto de entrada del servidor ===== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const app = require('./app');
const { pool } = require('./db');

const PORT = Number(process.env.PORT || 3000);

pool.query('SELECT 1')
  .then(() => console.log('✔ Conectado a MySQL (' + (process.env.DB_NAME || 'smartstock') + ')'))
  .catch(err => console.error('✖ No se pudo conectar a MySQL:', err.message, '\n  Revisa tu archivo .env y que MySQL esté encendido. Luego ejecuta: npm run db:init'));

app.listen(PORT, () => console.log(`SmartStock en http://localhost:${PORT}`));
