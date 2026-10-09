/* ===== LED de localización (HU-3) =====
   La app enciende un LED "virtual" en el plano del anaquel. El mismo estado
   queda guardado en la BD para que un microcontrolador (ESP32/Arduino con
   WiFi) lo consulte y encienda el LED físico:

     GET /api/iot/led/:sucursalId   (header  X-IoT-Token: <IOT_TOKEN>)
     → { encendido: true, ubicacion: "A2", fila: 1, columna: 2, color: "verde" }
*/
const express = require('express');
const { query } = require('../db');
const { ah, HttpError, ahoraSQL } = require('../utils');
const { FILAS } = require('../constants');
const { lotesDeProducto } = require('../services/inventario');
const { productoDeSucursal } = require('./productos');

const SEGUNDOS_ENCENDIDO = 30;

// ---------- desde la app (usuario autenticado) ----------
const app = express.Router();

app.post('/', ah(async (req, res) => {
  const p = await productoDeSucursal(req.body.producto_id, req.user.sucursal_id);
  const lotes = await lotesDeProducto(p.id);
  const prioritario = lotes.find(l => l.dias >= 0) || lotes[0] || null;
  // Color del LED según el lote prioritario: verde vigente, amarillo próximo, rojo urgente
  const color = prioritario ? prioritario.color : 'verde';
  const expira = ahoraSQL(new Date(Date.now() + SEGUNDOS_ENCENDIDO * 1000));
  await query(`INSERT INTO led_estado (sucursal_id, ubicacion, color, producto_id, expira_en) VALUES (?,?,?,?,?)
               ON DUPLICATE KEY UPDATE ubicacion = VALUES(ubicacion), color = VALUES(color), producto_id = VALUES(producto_id), expira_en = VALUES(expira_en)`,
    [req.user.sucursal_id, p.ubicacion, color, p.id, expira]);
  res.json({ ubicacion: p.ubicacion, color, segundos: SEGUNDOS_ENCENDIDO, lotePrioritario: prioritario });
}));

app.delete('/', ah(async (req, res) => {
  await query('UPDATE led_estado SET ubicacion = NULL, producto_id = NULL, expira_en = NULL WHERE sucursal_id = ?', [req.user.sucursal_id]);
  res.json({ ok: true });
}));

// ---------- para el microcontrolador ----------
const iot = express.Router();

iot.get('/led/:sucursalId', ah(async (req, res) => {
  const token = req.get('X-IoT-Token') || req.query.token;
  if(token !== (process.env.IOT_TOKEN || 'smartstock-iot-demo')) throw new HttpError(401, 'Token IoT inválido.');
  const [e] = await query('SELECT * FROM led_estado WHERE sucursal_id = ?', [req.params.sucursalId]);
  if(!e || !e.ubicacion || !e.expira_en || e.expira_en < ahoraSQL()) return res.json({ encendido: false });
  res.json({
    encendido: true,
    ubicacion: e.ubicacion,
    fila: FILAS.indexOf(e.ubicacion[0]) + 1,
    columna: Number(e.ubicacion.slice(1)),
    color: e.color,
    expira_en: e.expira_en,
  });
}));

module.exports = { app, iot };
