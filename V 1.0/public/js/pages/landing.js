/* ===== landing.js : portada en formato de diapositivas horizontales =====
   La rueda del ratón, las flechas del teclado, deslizar con el dedo, los
   puntos y los enlaces de la barra cambian de diapositiva hacia los lados.
*/

/* ---------- Planes (se definen en js/planes.js) ---------- */
document.getElementById('planes-grid').innerHTML = PLANES_INFO.map(p => `
  <article class="plan${p.destacado ? ' destacado' : ''}">
    ${p.destacado ? '<span class="plan-tag">Más completo</span>' : p.aviso ? `<span class="plan-tag verde">${p.aviso}</span>` : ''}
    <h3>${p.nombre}</h3>
    <p class="plan-para">${p.para}</p>
    <p class="plan-precio"><b>${precioPlan(p)}</b>${p.precio ? ' MXN / mes' : ''}</p>
    <ul>${p.incluye.map(i => `<li>${i}</li>`).join('')}</ul>
    <a class="lbtn${p.destacado ? '' : ' borde'}" href="acceso.html?plan=${encodeURIComponent(p.nombre)}#registro">${p.precio ? 'Elegir ' + p.nombre : 'Empezar gratis'}</a>
  </article>`).join('');

/* ---------- Espacios para imágenes ----------
   Cada <figure class="foto" data-img="nombre"> busca public/img/nombre.jpg
   (o .png / .webp). Si el archivo existe lo muestra; si no, deja un marcador
   con el nombre que debe llevar. Los fondos (data-fondo) funcionan igual,
   pero si no hay imagen simplemente se queda el color de la diapositiva.   */
function cargarImagen(nombre, alCargar, alFallar){
  const ext = ['jpg', 'png', 'webp', 'svg'];
  (function probar(i){
    if(i >= ext.length) return alFallar && alFallar();
    const img = new Image(), src = `img/${nombre}.${ext[i]}`;
    img.onload = () => alCargar(src); img.onerror = () => probar(i + 1); img.src = src;
  })(0);
}
document.querySelectorAll('figure.foto').forEach(f => {
  cargarImagen(f.dataset.img,
    src => { f.innerHTML = `<img src="${src}" alt="${f.dataset.nota || ''}">`; },
    () => { f.classList.add('vacia'); f.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5 5 5M15.5 9.5h.01"/></svg>
      <figcaption><b>Espacio para imagen</b>${f.dataset.nota || ''}<code>img/${f.dataset.img}.jpg</code></figcaption>`; });
});
document.querySelectorAll('[data-fondo]').forEach(s => {
  cargarImagen(s.dataset.fondo, src => { s.style.setProperty('--fondo', `url("${src}")`); s.classList.add('con-fondo'); });
});

/* ---------- Si ya hay sesión, ofrecer entrar directo ---------- */
(function(){
  let s = null;
  try{ s = JSON.parse(sessionStorage.getItem('smartstock_session') || localStorage.getItem('smartstock_session')); }catch{}
  if(s && s.token){
    const destino = s.role === 'superadmin' ? 'pages/sucursales.html' : 'pages/inicio.html';
    document.getElementById('lnavAcciones').innerHTML = `<a class="lbtn" href="${destino}">Ir a mi panel</a>`;
  }
})();

/* ---------- Presentación ---------- */
const slides = [...document.querySelectorAll('.slide')];
const pista = document.getElementById('slides');
const puntos = document.getElementById('puntos');
let actual = 0, bloqueado = false;

puntos.innerHTML = slides.map((s, i) =>
  `<button role="tab" aria-label="${s.getAttribute('aria-label')}" data-ir="${i}"></button>`).join('');

function ir(i, { animar = true } = {}){
  i = Math.max(0, Math.min(slides.length - 1, i));
  actual = i;
  pista.style.transition = animar ? '' : 'none';
  pista.style.transform = `translateX(${-100 * i}vw)`;
  slides.forEach((s, k) => { s.classList.toggle('activa', k === i); s.inert = k !== i; });
  document.querySelectorAll('[data-ir]').forEach(a => a.classList.toggle('activo', Number(a.dataset.ir) === i));
  document.body.classList.toggle('en-oscuro', slides[i].classList.contains('cierre'));
  document.getElementById('flechaIzq').disabled = i === 0;
  document.getElementById('flechaDer').disabled = i === slides.length - 1;
  if(i > 0) document.getElementById('pista').classList.add('oculta');
  if(location.hash !== '#' + slides[i].id) history.replaceState(null, '', '#' + slides[i].id);
}

function paso(dir){
  if(bloqueado) return;
  const destino = actual + dir;
  if(destino < 0 || destino >= slides.length) return;
  bloqueado = true; setTimeout(() => bloqueado = false, 750);   // una diapositiva por gesto
  ir(destino);
}

// Rueda del ratón: avanza de lado. Si la diapositiva tiene contenido más alto
// que la pantalla, primero se desplaza ese contenido y al llegar al borde cambia.
window.addEventListener('wheel', e => {
  if(e.ctrlKey) return;                                          // zoom del navegador
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if(Math.abs(d) < 8) return;
  const s = slides[actual];
  const puedeBajar = s.scrollTop + s.clientHeight < s.scrollHeight - 2;
  const puedeSubir = s.scrollTop > 2;
  if(Math.abs(e.deltaY) >= Math.abs(e.deltaX) && ((d > 0 && puedeBajar) || (d < 0 && puedeSubir))) return;
  e.preventDefault();
  paso(d > 0 ? 1 : -1);
}, { passive: false });

window.addEventListener('keydown', e => {
  if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if(e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); paso(1); }
  if(e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); paso(-1); }
  if(e.key === 'Home') ir(0);
  if(e.key === 'End') ir(slides.length - 1);
});

// Deslizar con el dedo
let tx = 0, ty = 0;
window.addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
window.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
  if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) paso(dx < 0 ? 1 : -1);
}, { passive: true });

document.addEventListener('click', e => {
  const el = e.target.closest('[data-ir]');
  if(!el) return;
  e.preventDefault(); ir(Number(el.dataset.ir));
});
document.getElementById('flechaIzq').addEventListener('click', () => paso(-1));
document.getElementById('flechaDer').addEventListener('click', () => paso(1));
window.addEventListener('hashchange', () => { const i = slides.findIndex(s => '#' + s.id === location.hash); if(i >= 0 && i !== actual) ir(i); });

// Diapositiva inicial según la URL (por ejemplo index.html#planes)
ir(Math.max(0, slides.findIndex(s => '#' + s.id === location.hash)), { animar: false });
requestAnimationFrame(() => pista.style.transition = '');
