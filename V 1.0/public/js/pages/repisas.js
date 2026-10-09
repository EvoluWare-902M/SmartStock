/* ===== repisas.js : reubicación sugerida por rotación (HU-12) ===== */
let CAT;

async function cargar(){
  const d = await api('/analitica/repisas');
  const porSlot = {};
  d.productos.forEach(p => (porSlot[p.ubicacion] = porSlot[p.ubicacion] || []).push(p));

  const mapa = document.getElementById('mapa');
  mapa.style.gridTemplateColumns = `repeat(${CAT.columnas.length}, 1fr)`;
  mapa.innerHTML = CAT.ubicaciones.map(u => {
    const ps = porSlot[u] || [];
    const nivel = ps.some(p => p.nivel === 'Alta') ? 'alta' : ps.some(p => p.nivel === 'Media') ? 'media' : '';
    return `<div class="slot ${d.zonaRapida.includes(u) ? 'zona' : ''} ${nivel ? 'heat-' + nivel : ''}" title="${esc(ps.map(p => `${p.nombre}: ${p.rotacion} u.`).join(', '))}">
      <span class="code">${u}</span><span class="names">${esc(ps.map(p => p.nombre).join(', '))}</span></div>`;
  }).join('');

  document.getElementById('repisasList').innerHTML = d.sugerencias.map((s, i) => `
    <div class="reco-card">
      <div>
        <div>${s.movimientos.map(m => `<b>${esc(m.producto)}</b>: ${m.desde} → ${m.hacia}`).join('<br>')}</div>
        <div class="meta">${esc(s.motivo)}</div>
      </div>
      <div class="side"><button class="btn sm" data-i="${i}">Aplicar</button></div>
    </div>`).join('') || `<div class="alert-box info">✅ <div>La distribución actual ya es óptima: los productos de mayor rotación están en la zona de acceso rápido.</div></div>`;

  document.querySelectorAll('#repisasList button[data-i]').forEach(btn => btn.addEventListener('click', () => conBoton(btn, async () => {
    const s = d.sugerencias[Number(btn.dataset.i)];
    await api('/analitica/repisas/aplicar', { method: 'POST', body: { movimientos: s.movimientos.map(m => ({ producto_id: m.producto_id, hacia: m.hacia })) } });
    toast('Reubicación aplicada: la nueva ubicación ya aparece en "Localizar producto".');
    await cargar();
  })));

  const clase = { Alta: 'ok', Media: 'warn', Baja: 'muted' };
  document.getElementById('rotBody').innerHTML = d.productos.map(p => `<tr>
    <td>${p.ranking}</td><td>${esc(p.nombre)}</td>
    <td>${p.ubicacion}${d.zonaRapida.includes(p.ubicacion) ? ' <span class="hint" style="display:inline">· acceso rápido</span>' : ''}</td>
    <td>${p.rotacion} u.</td><td>${p.participacion}%</td>
    <td><span class="badge ${clase[p.nivel]}">${p.nivel}</span></td></tr>`).join('');
}

async function initPage(){
  CAT = await catalogos();
  try{ await cargar(); }
  catch(e){
    document.querySelectorAll('main .panel').forEach(p => p.style.display = 'none');
    document.getElementById('repisasList').innerHTML = `<div class="alert-box warn">🔒 <div>${esc(e.message)} <a href="mi-sucursal.html">Ir a Mi sucursal →</a></div></div>`;
  }
}
