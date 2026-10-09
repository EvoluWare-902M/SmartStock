/* ===== buscar.js : localización asistida por LED (HU-2, HU-3, HU-4) =====
   Busca en la API, ilumina la ubicación del producto en el plano del
   anaquel y registra el encendido del LED en el servidor (para que un
   ESP32 pueda encender el LED físico). El color depende del lote
   prioritario (el que caduca primero).
*/
let CAT, productos = [], timer;

function buildGrid(lit, color){
  const grid = document.getElementById('shelfGrid');
  const porSlot = {};
  productos.forEach(p => (porSlot[p.ubicacion] = porSlot[p.ubicacion] || []).push(p.nombre));
  grid.style.gridTemplateColumns = `repeat(${CAT.columnas.length}, 1fr)`;
  grid.innerHTML = CAT.ubicaciones.map(u => `
    <div class="slot${u === lit ? ' lit ' + (color || '') : ''}" title="${esc((porSlot[u] || []).join(', '))}">
      <span class="code">${u}</span><span class="names">${esc((porSlot[u] || []).join(', '))}</span>
    </div>`).join('');
}

async function seleccionar(id){
  document.querySelectorAll('.search-item').forEach(b => b.classList.toggle('sel', Number(b.dataset.id) === id));
  const [p, led] = await Promise.all([api('/productos/' + id), api('/led', { method: 'POST', body: { producto_id: id } })]);
  buildGrid(led.ubicacion, led.color);

  const prio = led.lotePrioritario;
  const card = document.getElementById('foundCard');
  card.style.display = 'block';
  card.innerHTML = `<b>${esc(p.nombre)}</b> (${esc(p.codigo)}) · ${esc(p.sustancia || '')} ${esc(p.presentacion)}<br>
    Ubicación: anaquel <b>${esc(p.ubicacion)}</b> · existencia: <b>${p.stock} u.</b> (mínimo ${p.stock_minimo})
    ${p.stock_bajo ? ' · <span class="badge low">Stock bajo</span>' : ''}
    ${p.requiere_receta ? ' · <span class="badge low">Requiere receta</span>' : ''}
    ${prio ? `<br>Lote prioritario: <b>${esc(prio.numero_lote)}</b> — caduca ${fechaCorta(prio.caducidad)} (${prio.dias} días) <span class="led-dot ${prio.color}" style="margin-left:6px"></span>` : '<br><span class="muted">Sin lotes con existencia.</span>'}
    <div class="hint">LED encendido por ${led.segundos} s.</div><div id="alternativas"></div>`;

  // Agotado o en el mínimo: el modelo sugiere qué más ofrecer (misma sustancia o misma categoría).
  if(p.stock === 0 || p.stock_bajo){
    api('/ia/alternativas/' + id).then(alts => {
      const cont = document.getElementById('alternativas');
      if(!cont || !alts.length) return;
      cont.innerHTML = `<div class="hallazgo oportunidad" style="margin-top:12px"><span aria-hidden="true">💡</span>
        <div><strong>${p.stock === 0 ? 'Está agotado.' : 'Quedan pocas piezas.'} Alternativas con existencia</strong> <span class="ia-tag">IA</span><br>
        ${alts.map(a => `<button class="btn secondary sm alt" data-id="${a.id}" style="margin:6px 6px 0 0">${esc(a.nombre)} · ${esc(a.ubicacion)} · ${a.stock} u.</button>`).join('')}
        <br><small class="muted">${esc([...new Set(alts.map(a => a.afinidad))].join(' · '))}. ${alts.some(a => a.requiere_receta) || p.requiere_receta ? 'Respeta la receta: ' : ''}la sustitución la decide el responsable de la farmacia.</small></div></div>`;
      cont.querySelectorAll('.alt').forEach(b => b.addEventListener('click', () => seleccionar(Number(b.dataset.id)).catch(e => toast(e.message, true))));
    }).catch(() => {});
  }

  document.getElementById('lotesPanel').style.display = p.lotes.length ? 'block' : 'none';
  document.getElementById('lotesBody').innerHTML = p.lotes.map(l => `
    <tr class="${prio && l.id === prio.id ? 'hl' : ''}">
      <td>${esc(l.numero_lote)}${prio && l.id === prio.id ? ' <span class="badge ok">Surtir primero</span>' : ''}</td>
      <td>${fechaCorta(l.caducidad)}</td><td>${l.dias}</td><td>${l.cantidad} u.</td>
      <td><span class="led-dot ${l.color}"></span>${l.etiqueta}</td>
    </tr>`).join('');
}

async function buscar(q){
  const results = document.getElementById('results');
  if(!q){ results.innerHTML = ''; return; }
  const lista = await api('/productos?q=' + encodeURIComponent(q));
  if(!lista.length){
    results.innerHTML = `<div class="found-card">Sin coincidencias para "${esc(q)}".</div>`;
    return;
  }
  // Si nadie coincide exactamente, el servidor devuelve los nombres más parecidos (búsqueda tolerante a faltas).
  const aprox = lista[0].coincidencia === 'aproximada';
  results.innerHTML = (aprox ? `<div class="hint" style="margin:0 0 6px">No hay coincidencias exactas para "${esc(q)}". <b>¿Quisiste decir…?</b> <span class="ia-tag">IA</span></div>` : '')
    + lista.slice(0, 8).map(p => `
    <button class="search-item" data-id="${p.id}">
      <span><b>${esc(p.nombre)}</b> <small>· ${esc(p.sustancia || '')} · ${esc(p.codigo)}</small></span>
      <small>Anaquel ${esc(p.ubicacion)} · ${p.stock} u.</small>
    </button>`).join('');
  results.querySelectorAll('.search-item').forEach(b => b.addEventListener('click', () => seleccionar(Number(b.dataset.id)).catch(e => toast(e.message, true))));
  if(lista.length === 1 && !aprox) seleccionar(lista[0].id).catch(e => toast(e.message, true));
}

async function initPage(){
  [CAT, productos] = await Promise.all([catalogos(), api('/productos')]);
  buildGrid();
  const input = document.getElementById('searchInput');
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => buscar(input.value.trim()).catch(e => toast(e.message, true)), 250);
  });
  // Llegar desde el buscador general: buscar.html?q=paracetamol
  const q0 = new URLSearchParams(location.search).get('q');
  if(q0){ input.value = q0; buscar(q0).catch(e => toast(e.message, true)); }
  input.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ const first = document.querySelector('.search-item'); if(first) first.click(); }
  });
}
