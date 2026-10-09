/* ===== utils.js : helpers compartidos por todas las páginas ===== */

function toast(msg, isError){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => { t.className = ''; }, isError ? 4200 : 3000);
}

// Escapa texto para insertarlo en HTML (evita inyección de código).
function esc(v){
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// values: arreglo de textos o de objetos {value, label}
function fillSelect(select, values, placeholder){
  if(!select) return;
  select.innerHTML = (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '') +
    values.map(v => typeof v === 'object'
      ? `<option value="${esc(v.value)}">${esc(v.label)}</option>`
      : `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function hoyISO(){
  const d = new Date(); const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function fechaCorta(iso){
  if(!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${Number(d)} ${meses[Number(m) - 1]} ${y}`;
}
function fechaHora(s){
  if(!s) return '—';
  return fechaCorta(s) + (s.length > 10 ? ' · ' + s.slice(11, 16) : '');
}
function dinero(n){
  return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function valoresDe(ids){
  const o = {};
  ids.forEach(id => { const el = document.getElementById(id); o[id] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
  return o;
}
function limpiar(ids){
  ids.forEach(id => { const el = document.getElementById(id); if(el.type === 'checkbox') el.checked = false; else el.value = ''; });
}

// Deshabilita un botón mientras se ejecuta una acción async.
async function conBoton(btn, fn){
  if(btn.disabled) return;
  const txt = btn.textContent;
  btn.disabled = true; btn.textContent = 'Procesando…';
  try{ return await fn(); }
  catch(e){ toast(e.message, true); }
  finally{ btn.disabled = false; btn.textContent = txt; }
}

const ROLE_LABEL = { superadmin: 'Superadministrador', dueno: 'Dueño / Gerente', empleado: 'Empleado' };

// Ventana modal sencilla. campos: [{id, label, type, placeholder}] → resuelve con los valores o null.
function modal({ titulo, texto = '', campos = [], aceptar = 'Aceptar', peligro = false }){
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>${esc(titulo)}</h3>${texto ? `<p>${texto}</p>` : ''}
      ${campos.map(c => `<div class="field" style="margin-bottom:12px"><label for="mf_${c.id}">${esc(c.label)}</label>
        <input id="mf_${c.id}" type="${c.type || 'text'}" placeholder="${esc(c.placeholder || '')}" value="${esc(c.value || '')}"></div>`).join('')}
      <div class="form-actions"><button class="btn secondary" data-r="0">Cancelar</button>
      <button class="btn ${peligro ? 'danger' : ''}" data-r="1">${esc(aceptar)}</button></div></div>`;
    document.body.appendChild(bg);
    const cerrar = ok => {
      const vals = {}; campos.forEach(c => vals[c.id] = bg.querySelector('#mf_' + c.id).value);
      bg.remove(); resolve(ok ? vals : null);
    };
    bg.addEventListener('click', e => { if(e.target === bg) cerrar(false); const r = e.target.dataset.r; if(r !== undefined) cerrar(r === '1'); });
    bg.addEventListener('keydown', e => { if(e.key === 'Escape') cerrar(false); if(e.key === 'Enter' && campos.length) cerrar(true); });
    (bg.querySelector('input') || bg.querySelector('[data-r="1"]')).focus();
  });
}

// Pestañas: botones .tabs [data-tab] ↔ secciones #tab-<nombre>. Recuerda la pestaña en la dirección (#nombre).
function activarTabs(alCambiar){
  const botones = [...document.querySelectorAll('.tabs button')];
  const mostrar = (id, guardar) => {
    if(!botones.some(b => b.dataset.tab === id)) id = botones[0].dataset.tab;
    botones.forEach(b => { const on = b.dataset.tab === id; b.classList.toggle('activa', on); b.setAttribute('aria-selected', on); });
    document.querySelectorAll('.tab-panel').forEach(p => p.hidden = p.id !== 'tab-' + id);
    if(guardar) history.replaceState(null, '', '#' + id);
    if(alCambiar) alCambiar(id);
  };
  botones.forEach(b => b.addEventListener('click', () => mostrar(b.dataset.tab, true)));
  window.addEventListener('hashchange', () => mostrar(location.hash.slice(1)));
  mostrar(location.hash.slice(1));
}

