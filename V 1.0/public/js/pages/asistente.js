/* ===== asistente.js : chat con el asistente de SmartStock =====
   El servidor responde de dos formas (server/services/asistente.js):
   - "local":  motor propio que entiende preguntas frecuentes. Siempre disponible.
   - "modelo": modelo de lenguaje (si el servidor tiene ANTHROPIC_API_KEY).
   La conversación vive solo en esta pestaña: no se guarda en la base de datos.
*/
const historial = [];   // [{rol:'usuario'|'asistente', texto}]
let ocupado = false;

function burbuja(clase, html){
  const caja = document.getElementById('asMensajes');
  const el = document.createElement('div');
  el.className = 'burbuja ' + clase;
  el.innerHTML = html;
  caja.appendChild(el);
  caja.scrollTop = caja.scrollHeight;
  return el;
}
// El texto del asistente llega como texto plano: se escapa y solo se respetan saltos de línea y **negritas**.
const formato = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

function pintarSugerencias(lista){
  const cont = document.getElementById('asSugerencias');
  cont.innerHTML = (lista || []).map(s => `<button type="button">${esc(s)}</button>`).join('');
  cont.querySelectorAll('button').forEach(b => b.addEventListener('click', () => enviar(b.textContent)));
}

async function enviar(texto){
  texto = String(texto || '').trim();
  if(!texto || ocupado) return;
  ocupado = true;
  const input = document.getElementById('asTexto'), boton = document.getElementById('asEnviar');
  input.value = ''; boton.disabled = true;
  burbuja('yo', esc(texto));
  const espera = burbuja('ia escribiendo', 'Pensando…');
  try{
    const r = await api('/ia/asistente', { method: 'POST', body: { mensaje: texto, historial: historial.slice(-8) } });
    espera.remove();
    burbuja('ia', formato(r.respuesta)
      + (r.enlace ? `<br><a href="${esc(r.enlace.href)}">${esc(r.enlace.texto)} →</a>` : '')
      + (r.aviso ? `<br><small>${esc(r.aviso)}</small>` : '')
      + `<br><small>${r.modo === 'modelo' ? 'Respuesta de un modelo de lenguaje: verifica los datos importantes.' : 'Respuesta calculada con tus datos.'}</small>`);
    historial.push({ rol: 'usuario', texto }, { rol: 'asistente', texto: r.respuesta });
    if(r.sugerencias) pintarSugerencias(r.sugerencias);
  }catch(e){
    espera.remove();
    burbuja('ia', '⚠️ ' + esc(e.message));
  }finally{
    ocupado = false; boton.disabled = false; input.focus();
  }
}

async function initPage(session){
  const info = await api('/ia/asistente');
  document.getElementById('asModo').textContent = info.modo === 'modelo'
    ? 'Conectado a un modelo de lenguaje. Pregunta con tus propias palabras; tus preguntas y un resumen del inventario se envían al proveedor del modelo.'
    : 'Pregunta en tus propias palabras por ubicaciones, existencias, caducidades o compras. Responde con los datos de tu sucursal, sin enviar nada fuera del sistema.';
  burbuja('ia', `Hola, ${esc((session.nombre || '').split(' ')[0])}. Soy el asistente de SmartStock. Puedo decirte dónde está un medicamento, cuánto queda, qué está por caducar${session.role === 'dueno' ? ', qué conviene comprar' : ''} y sugerirte alternativas cuando algo se agota. No importa si escribes el nombre con alguna falta.`);
  pintarSugerencias(info.sugerencias);
  document.getElementById('asForm').addEventListener('submit', e => { e.preventDefault(); enviar(document.getElementById('asTexto').value); });
  document.getElementById('asTexto').focus();
}
