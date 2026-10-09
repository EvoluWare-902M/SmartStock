/* ===== importar.js : alta masiva de medicamentos desde Excel =====
   1) se sube el archivo → 2) el servidor lo analiza y propone → 3) se revisa y se confirma.
*/
const $ = id => document.getElementById(id);
let analisis = null;
const ESTADO_FILA = { ok: ['ok', 'Lista'], revisar: ['warn', 'Revisar'], error: ['low', 'No se importa'], duplicado: ['muted', 'Duplicado'] };
const CAMPO = { nombre: 'Nombre', sustancia: 'Sustancia', laboratorio: 'Laboratorio', categoria: 'Categoría', presentacion: 'Presentación', concentracion: 'Concentración', requiere_receta: 'Receta', ubicacion: 'Ubicación',
  stock_minimo: 'Stock mínimo', precio: 'Precio', codigo_barras: 'Código de barras', proveedor: 'Proveedor', numero_lote: 'Lote', caducidad: 'Caducidad', cantidad: 'Cantidad', costo_unitario: 'Costo' };

async function analizar(archivo){
  if(!archivo) return;
  if(!/\.xlsx$/i.test(archivo.name)) return toast('El archivo debe ser de Excel (.xlsx). Si tienes un .xls o .csv, ábrelo y guárdalo como .xlsx.', true);
  if(archivo.size > 3 * 1024 * 1024) return toast('El archivo pesa más de 3 MB. Divídelo en partes.', true);
  $('imZona').classList.add('cargando');
  try{
    const res = await fetch('/api/productos/importar/analizar', { method: 'POST', headers: { Authorization: 'Bearer ' + getSession().token, 'Content-Type': 'application/octet-stream' }, body: archivo });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || 'No se pudo analizar el archivo.');
    analisis = data; pintarRevision(archivo.name);
  }catch(e){ toast(e.message, true); }
  finally{ $('imZona').classList.remove('cargando'); $('imArchivo').value = ''; }
}

function pintarRevision(nombre){
  const r = analisis.resumen;
  $('imSubir').hidden = true; $('imRevision').hidden = false; $('imResultado').innerHTML = '';
  $('imStats').innerHTML = `
    <div class="stat-card"><div class="num">${r.total}</div><div class="lbl">Filas leídas de ${esc(nombre)}</div></div>
    <div class="stat-card"><div class="num">${r.listas + r.revisar}</div><div class="lbl">Se pueden importar${r.revisar ? ` (${r.revisar} con observaciones)` : ''}</div></div>
    <div class="stat-card"><div class="num">${r.completadas}</div><div class="lbl">Completadas por la IA</div></div>
    <div class="stat-card"><div class="num" style="color:${r.errores + r.duplicados ? 'var(--coral)' : 'var(--primario)'}">${r.errores + r.duplicados}</div><div class="lbl">No se importan (${r.errores} con error, ${r.duplicados} duplicadas)</div></div>`;
  const cols = Object.entries(analisis.columnas);
  $('imColumnas').innerHTML = `<div class="explica"><b>Columnas reconocidas:</b> ${cols.map(([c, h]) => `"${esc(h)}" → ${CAMPO[c]}`).join(' · ')}.
    ${analisis.sinUsar.length ? `<br><b>No se usaron:</b> ${analisis.sinUsar.map(h => `"${esc(h)}"`).join(', ')}.` : ''}
    ${analisis.cupo !== null ? `<br><b>Tu plan ${esc(analisis.plan)}</b> admite ${analisis.cupo} medicamento(s) más.` : ''}</div>`;
  $('imFilas').innerHTML = analisis.filas.map((f, i) => {
    const d = f.datos, ok = f.estado === 'ok' || f.estado === 'revisar', ia = c => f.sugerido.includes(c) ? ' <span class="im-ia" title="Propuesto por la IA">✨</span>' : '';
    return `<tr class="${ok ? '' : 'im-no'}">
      <td><input type="checkbox" data-i="${i}" ${ok ? 'checked' : 'disabled'} aria-label="Importar ${esc(d.nombre || 'fila ' + f.fila)}"></td>
      <td>${f.fila}</td>
      <td><b>${esc(d.nombre || '—')}</b><br><small class="muted">${esc(d.sustancia || '')}${ia('sustancia')}${d.concentracion ? ' · ' + esc(d.concentracion) + ia('concentracion') : ''}</small></td>
      <td>${ok ? esc(d.categoria) + ia('categoria') : '—'}</td><td>${ok ? esc(d.presentacion) + ia('presentacion') : '—'}</td>
      <td>${ok ? (d.requiere_receta ? 'Sí' : 'No') + ia('requiere_receta') : '—'}</td><td>${ok ? esc(d.ubicacion) + ia('ubicacion') : '—'}</td>
      <td>${ok ? (d.cantidad ? `${d.cantidad} u.<br><small class="muted">${esc(d.numero_lote || '')} · ${fechaCorta(d.caducidad)}</small>` : '<span class="muted">Sin existencias</span>') : '—'}</td>
      <td>${ok ? dinero(d.precio) : '—'}</td>
      <td><span class="badge ${ESTADO_FILA[f.estado][0]}">${ESTADO_FILA[f.estado][1]}</span>${(f.estado === 'error' ? f.errores : f.avisos).map(t => `<br><small class="${f.errores.includes(t) ? 'im-error' : 'muted'}">${esc(t)}</small>`).join('')}</td></tr>`;
  }).join('');
  contar();
}
function elegidas(){ return [...$('imFilas').querySelectorAll('input:checked')].map(c => analisis.filas[Number(c.dataset.i)].datos); }
function contar(){ const n = elegidas().length; $('imConfirmar').textContent = `Importar ${n} medicamento${n === 1 ? '' : 's'}`; $('imConfirmar').disabled = !n; }

function reiniciar(){ analisis = null; $('imRevision').hidden = true; $('imSubir').hidden = false; }

async function initPage(){
  const zona = $('imZona');
  $('imArchivo').addEventListener('change', e => analizar(e.target.files[0]));
  ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add('sobre'); }));
  ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove('sobre'); }));
  zona.addEventListener('drop', e => analizar(e.dataTransfer.files[0]));
  $('imPlantilla').addEventListener('click', () => conBoton($('imPlantilla'), () => descargar('/productos/importar/plantilla')));
  $('imFilas').addEventListener('change', contar);
  $('imOtro').addEventListener('click', reiniciar);
  $('imConfirmar').addEventListener('click', () => conBoton($('imConfirmar'), async () => {
    const r = await api('/productos/importar', { method: 'POST', body: { filas: elegidas() } });
    reiniciar();
    $('imResultado').innerHTML = `<div class="alert-box ${r.creados ? 'info' : 'warn'}">${r.creados ? '✅' : '⚠️'} <div><b>${r.creados} medicamento(s) dados de alta</b>${r.unidades ? ` con ${r.unidades} unidades en existencia` : ''}.
      ${r.omitidos.length ? `<br>${r.omitidos.length} no se importaron: ${r.omitidos.slice(0, 5).map(o => `${esc(o.nombre)} (${esc(o.motivo)})`).join('; ')}${r.omitidos.length > 5 ? '…' : ''}` : ''}
      <br><a href="registro.html">Ver el catálogo →</a> · <a href="buscar.html">Localizarlos en el anaquel →</a></div></div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}
