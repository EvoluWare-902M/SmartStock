/* ===== conteo.js : conteo físico =====
   Sin ?id  → lista de conteos y, para el gerente, la sugerencia de la IA de qué contar hoy.
   Con ?id  → captura a ciegas (quien cuenta no ve la existencia del sistema) o revisión de diferencias.
*/
const $ = id => document.getElementById(id);
const idConteo = new URLSearchParams(location.search).get('id');
const ESTADO_CONTEO = { Abierto: 'info', 'Por revisar': 'warn', Aplicado: 'ok', Descartado: 'muted' };
let sesion, sugeridos = [], extras = [], catalogo = [];

/* ---------- lista ---------- */
function pintarSugeridos(){
  const filas = [...sugeridos, ...extras];
  $('cnSugeridos').innerHTML = filas.map(s => `<tr>
      <td><input type="checkbox" value="${s.producto_id}" ${s.marcado === false ? '' : 'checked'} aria-label="Contar ${esc(s.producto)}"></td>
      <td><b>${esc(s.producto)}</b></td><td>${esc(s.ubicacion)}</td><td><span class="clase ${s.clase || ''}">${s.clase || '—'}</span></td>
      <td class="muted" style="font-size:.86rem">${esc(s.motivo)}</td><td>${s.ultimo_conteo ? fechaCorta(s.ultimo_conteo) : 'Nunca'}</td></tr>`).join('')
    || `<tr><td colspan="6" class="empty">Todo el catálogo se contó recientemente o ya está en un conteo abierto.</td></tr>`;
  const usados = new Set(filas.map(f => f.producto_id));
  fillSelect($('cnOtro'), catalogo.filter(p => !usados.has(p.id)).map(p => ({ value: p.id, label: `${p.nombre} (${p.ubicacion})` })), 'Agregar otro medicamento…');
}

async function pintarLista(){
  const filas = await api('/conteos');
  const gerente = sesion.role === 'dueno';
  $('cnBody').innerHTML = filas.map(c => `<tr>
      <td><a class="enlace" href="conteo.html?id=${c.id}">${esc(c.folio)}</a>${c.origen === 'IA' ? ' <span class="ia-tag">IA</span>' : ''}</td>
      <td><span class="badge ${ESTADO_CONTEO[c.estado]}">${c.estado}</span></td><td>${esc(c.asignado || 'Quien esté disponible')}</td>
      <td>${c.contados} de ${c.productos}</td><td>${c.diferencias === null || c.estado === 'Abierto' ? '—' : c.diferencias ? `<span class="badge warn">${c.diferencias}</span>` : '<span class="badge ok">Ninguna</span>'}</td>
      <td>${fechaCorta(c.fecha)}</td>
      <td><a class="btn secondary sm" href="conteo.html?id=${c.id}">${c.estado === 'Abierto' ? 'Contar' : c.estado === 'Por revisar' && gerente ? 'Revisar' : 'Ver'}</a></td></tr>`).join('')
    || `<tr><td colspan="7" class="empty">${gerente ? 'Aún no hay conteos. Abre el primero con la sugerencia de arriba.' : 'No tienes conteos asignados por ahora.'}</td></tr>`;
}

async function iniciarLista(){
  await pintarLista();
  if(sesion.role !== 'dueno') return;
  $('cnNuevo').hidden = false;
  const [sug, prods, equipo] = await Promise.all([api('/conteos/sugerencia?n=8'), api('/productos'), api('/usuarios')]);
  sugeridos = sug; catalogo = prods;
  fillSelect($('cnAsignar'), equipo.usuarios.filter(u => u.estado === 'Activo').map(u => ({ value: u.id, label: 'Lo cuenta ' + u.nombre })), 'Quien esté disponible');
  pintarSugeridos();
  const marcas = () => $('cnSugeridos').querySelectorAll('input').forEach(c => { const f = [...sugeridos, ...extras].find(x => x.producto_id === Number(c.value)); if(f) f.marcado = c.checked; });
  $('cnOtro').addEventListener('change', () => {
    const p = catalogo.find(x => x.id === Number($('cnOtro').value)); if(!p) return;
    marcas(); extras.push({ producto_id: p.id, producto: p.nombre, ubicacion: p.ubicacion, clase: '', motivo: 'Agregado a mano.', ultimo_conteo: null }); pintarSugeridos();
  });
  const abrir = $('cnAbrir');
  abrir.addEventListener('click', () => conBoton(abrir, async () => {
    marcas();
    const elegidos = [...sugeridos, ...extras].filter(f => f.marcado !== false);
    if(!elegidos.length) return toast('Marca al menos un medicamento.', true);
    const r = await api('/conteos', { method: 'POST', body: { producto_ids: elegidos.map(e => e.producto_id), asignado_a: $('cnAsignar').value || null,
      origen: elegidos.some(e => sugeridos.includes(e)) ? 'IA' : 'Manual', motivos: Object.fromEntries(elegidos.map(e => [e.producto_id, e.motivo])) } });
    location.href = 'conteo.html?id=' + r.id;
  }));
}

/* ---------- detalle ---------- */
async function pintarDetalle(){
  const gerente = sesion.role === 'dueno';
  // El gerente también cuenta a ciegas mientras el conteo está abierto; ve las diferencias cuando se envía
  let c = await api('/conteos/' + idConteo + (gerente ? '?ciego=1' : ''));
  const abierto = c.estado === 'Abierto';
  $('cnLista').hidden = true; $('cnDetalle').hidden = false;
  $('cnTitulo').innerHTML = `Conteo ${esc(c.folio)} <span class="badge ${ESTADO_CONTEO[c.estado]}">${c.estado}</span>${c.origen === 'IA' ? ' <span class="ia-tag">IA</span>' : ''}`;
  $('cnSub').textContent = `Abierto el ${fechaHora(c.fecha)} por ${c.creador || '—'} · lo cuenta ${c.asignado || 'quien esté disponible'}`;

  if(abierto){
    $('cnStats').innerHTML = '';
    $('cnAviso').innerHTML = `<div class="alert-box info">🧮 <div><b>Cuenta lo que hay físicamente en cada casilla</b>, incluidas las cajas caducadas que no se hayan retirado. No verás cuántas dice el sistema: así el conteo no se contamina. Si no hay ninguna, escribe 0. Puedes guardar y seguir después.</div></div>`;
    $('cnHead').innerHTML = '<tr><th>Casilla</th><th>Medicamento</th><th>Por qué se cuenta</th><th style="width:140px">Piezas contadas</th></tr>';
    $('cnPartidas').innerHTML = c.partidas.map(p => `<tr>
        <td><span class="clase A">${esc(p.ubicacion)}</span></td><td><b>${esc(p.producto)}</b><br><small class="muted">${esc(p.codigo)}${p.codigo_barras ? ' · ' + esc(p.codigo_barras) : ''}</small></td>
        <td class="muted" style="font-size:.86rem">${esc(p.motivo || 'Revisión de rutina.')}</td>
        <td><input type="number" min="0" inputmode="numeric" data-p="${p.producto_id}" value="${p.contado === null ? '' : p.contado}" placeholder="—" aria-label="Piezas contadas de ${esc(p.producto)}"></td></tr>`).join('');
    $('cnAcciones').innerHTML = `<button class="btn secondary" id="cnGuardar">Guardar avance</button><button class="btn" id="cnEnviar">Terminar y enviar a revisión</button>${gerente ? '<button class="btn danger" id="cnDescartar">Descartar</button>' : ''}`;
    const captura = () => api(`/conteos/${idConteo}/captura`, { method: 'PUT', body: { partidas: [...$('cnPartidas').querySelectorAll('input')].map(i => ({ producto_id: Number(i.dataset.p), contado: i.value.trim() })) } });
    $('cnGuardar').addEventListener('click', () => conBoton($('cnGuardar'), async () => { await captura(); toast('Avance guardado.'); }));
    $('cnEnviar').addEventListener('click', () => conBoton($('cnEnviar'), async () => { await captura(); await api(`/conteos/${idConteo}/enviar`, { method: 'POST' }); toast('Conteo enviado a revisión.'); await pintarDetalle(); }));
  }else{
    if(gerente) c = await api('/conteos/' + idConteo);
    const visible = !c.ciego;
    const difs = visible ? c.partidas.filter(p => p.diferencia) : [];
    const neto = difs.reduce((s, p) => s + p.importe, 0);
    $('cnStats').innerHTML = visible ? `
      <div class="stat-card"><div class="num">${c.partidas.length}</div><div class="lbl">Medicamentos contados</div></div>
      <div class="stat-card"><div class="num" style="color:${difs.length ? 'var(--ambar-texto)' : 'var(--primario)'}">${difs.length}</div><div class="lbl">Con diferencia</div></div>
      <div class="stat-card"><div class="num">${Math.round((1 - difs.length / c.partidas.length) * 100)} %</div><div class="lbl">Exactitud del inventario</div></div>
      <div class="stat-card"><div class="num" style="color:${neto < 0 ? 'var(--coral)' : 'var(--primario)'}">${dinero(neto)}</div><div class="lbl">Diferencia neta a precio de venta</div></div>` : '';
    $('cnAviso').innerHTML = c.estado === 'Por revisar'
      ? `<div class="alert-box ${visible ? 'warn' : 'info'}">${visible ? '🔎' : '✅'} <div>${visible ? '<b>Revisa las diferencias antes de aplicar.</b> Al aplicar, la existencia del sistema se iguala a lo contado y cada diferencia queda como un movimiento de ajuste en el historial. Si algo no te convence, pide que se vuelva a contar.' : '<b>Conteo enviado.</b> El gerente revisará las diferencias.'}</div></div>` : '';
    $('cnHead').innerHTML = visible ? '<tr><th>Casilla</th><th>Medicamento</th><th>En sistema</th><th>Contado</th><th>Diferencia</th><th>Importe</th></tr>' : '<tr><th>Casilla</th><th>Medicamento</th><th>Contado</th></tr>';
    $('cnPartidas').innerHTML = c.partidas.map(p => visible ? `<tr class="${p.diferencia ? 'hl' : ''}">
        <td>${esc(p.ubicacion)}</td><td><b>${esc(p.producto)}</b></td><td>${p.esperado}</td><td>${p.contado ?? '—'}</td>
        <td>${!p.diferencia ? '<span class="badge ok">Coincide</span>' : `<span class="badge ${p.diferencia < 0 ? 'low' : 'warn'}">${p.diferencia > 0 ? '+' : ''}${p.diferencia} u. ${p.diferencia < 0 ? 'faltan' : 'sobran'}</span>`}</td>
        <td>${p.diferencia ? dinero(p.importe) : '—'}</td></tr>`
      : `<tr><td>${esc(p.ubicacion)}</td><td><b>${esc(p.producto)}</b></td><td>${p.contado ?? '—'}</td></tr>`).join('');
    $('cnAcciones').innerHTML = c.estado === 'Por revisar' && gerente
      ? '<button class="btn" id="cnAplicar">Aplicar ajustes</button><button class="btn secondary" id="cnReabrir">Pedir recuento</button><button class="btn danger" id="cnDescartar">Descartar</button>' : '';
    if($('cnAplicar')){
      $('cnAplicar').addEventListener('click', () => conBoton($('cnAplicar'), async () => {
        if(difs.length && !(await modal({ titulo: 'Aplicar ajustes', aceptar: 'Aplicar', texto: `Se ajustará la existencia de <b>${difs.length}</b> medicamento(s) a lo contado. Queda registrado en el historial y en la bitácora.` }))) return;
        const r = await api(`/conteos/${idConteo}/aplicar`, { method: 'POST' });
        toast(r.ajustes ? `Ajustes aplicados: ${r.faltantes} u. faltantes y ${r.sobrantes} u. sobrantes.` : 'Conteo cerrado: todo coincidió.');
        if(r.sinLote.length) toast(`Sin lote donde sumar el sobrante de ${r.sinLote.join(', ')}: regístralo como entrada.`, true);
        await pintarDetalle();
      }));
      $('cnReabrir').addEventListener('click', () => conBoton($('cnReabrir'), async () => { await api(`/conteos/${idConteo}/reabrir`, { method: 'POST' }); toast('Se pidió volver a contar.'); await pintarDetalle(); }));
    }
  }
  if($('cnDescartar')) $('cnDescartar').addEventListener('click', async () => {
    if(!(await modal({ titulo: 'Descartar conteo', peligro: true, aceptar: 'Descartar', texto: 'El conteo se cierra sin cambiar existencias.' }))) return;
    try{ await api(`/conteos/${idConteo}/descartar`, { method: 'POST' }); location.href = 'conteo.html'; }catch(e){ toast(e.message, true); }
  });
}

async function initPage(session){
  sesion = session;
  if(idConteo) await pintarDetalle(); else await iniciarLista();
}
