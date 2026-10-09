/* ===== nav.js : navegación de SmartStock (buscador + círculo de navegación) =====
   Cada página trae un <nav id="sidebarRoot"></nav> vacío; este script arma:

   1. BARRA SUPERIOR con el buscador: se escribe una acción ("reporte") o un
      medicamento ("parace") y se entra directo. Ctrl+K lo enfoca.
      En Inicio el buscador aparece grande, y al deslizar hacia abajo está
      el dashboard normal.

   2. CÍRCULO DE NAVEGACIÓN, siempre visible en el borde derecho. Muestra la
      sección actual. Al señalarlo se despliegan a su alrededor las secciones
      (primer arco) y, al señalar una sección, sus opciones (segundo arco).
      Cada círculo lleva icono y texto.

   El menú se filtra por rol: cada quien ve solo lo que le corresponde.
*/

/* ---------- iconos (trazo, 24×24) ---------- */
const ICONOS = {
  casa:      'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  capsula:   'M4.2 12.8l8.6-8.6a5 5 0 0 1 7 7l-8.6 8.6a5 5 0 0 1-7-7zM8.5 8.5l7 7',
  caja:      'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  tendencia: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  ajustes:   'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4',
  edificio:  'M4 21V5l8-2v18M12 9l8 2v10M2 21h20M8 8h.01M8 12h.01M8 16h.01M16 14h.01M16 17h.01',
  usuario:   'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  lupa:      'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  mas:       'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v8M8 12h8',
  entrada:   'M12 3v12M7 10l5 5 5-5M4 20h16',
  salida:    'M12 15V3M7 8l5-5 5 5M4 20h16',
  reloj:     'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  lista:     'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  carrito:   'M3 4h2l2.5 11h10L20 7H6.3M9 20h.01M17 20h.01',
  repisas:   'M4 3v18M20 3v18M4 9h16M4 15h16M8 5v4M12 6v3M15 11v4',
  barras:    'M5 20V10M11 20V4M17 20v-7M2 20h20',
  equipo:    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
  tienda:    'M4 10v10h16V10M3 10l2-6h14l2 6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M10 20v-5h4v5',
  campana:   'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  tablero:   'M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z',
  megafono:  'M4 10v4h3l7 4V6l-7 4zM17 9a4 4 0 0 1 0 6M8 14l1 6h3',
  bitacora:  'M6 3h10l3 3v15H6zM9 8h6M9 12h7M9 16h4',
  chispa:    'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  chat:      'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
  ticket:    'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  turno:     'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  camion:    'M2 6h11v10H2zM13 9h4l4 4v3h-8zM6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  conteo:    'M8 4h8v3H8zM6 5H5v16h14V5h-1M9 13l2 2 4-4',
  subir:     'M12 16V4M7 9l5-5 5 5M4 20h16',
};
function icono(nombre){
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONOS[nombre] || ICONOS.casa}"/></svg>`;
}

/* ---------- menú: secciones y opciones ---------- */
const TODOS = ['superadmin', 'dueno', 'empleado'];
const MENU = [
  {id:'plataforma', group:'Plataforma', corto:'Plataforma', icon:'edificio', items:[
    {href:'plataforma.html', icon:'tablero', text:'Panel', hint:'Indicadores y solicitudes', roles:['superadmin']},
    {href:'sucursales.html', icon:'edificio', text:'Sucursales', hint:'Aprobar, suspender y planes', roles:['superadmin']},
    {href:'cuentas.html', icon:'equipo', text:'Usuarios', hint:'Cuentas de toda la plataforma', roles:['superadmin']},
  ]},
  {id:'control', group:'Control', corto:'Control', icon:'bitacora', items:[
    {href:'bitacora.html', icon:'bitacora', text:'Bitácora', hint:'Quién hizo qué y cuándo', roles:['superadmin']},
    {href:'avisos.html', icon:'megafono', text:'Avisos', hint:'Mensajes para las sucursales', roles:['superadmin']},
    {href:'cuenta.html', icon:'usuario', text:'Mi cuenta', hint:'Tus datos y contraseña', roles:['superadmin']},
  ]},
  {id:'inicio', group:'Inicio', corto:'Inicio', icon:'casa', items:[
    {href:'inicio.html', icon:'casa', text:'Inicio', hint:'Buscador y resumen del día', roles:['dueno','empleado']},
    {href:'turno.html', icon:'turno', text:'Mi turno', hint:'Tus ventas y pendientes de hoy', roles:['dueno','empleado']},
    {href:'asistente.html', icon:'chat', text:'Asistente', hint:'Pregunta con tus palabras', roles:['dueno','empleado']},
    {href:'cuenta.html', icon:'usuario', text:'Mi cuenta', hint:'Tus datos y contraseña', roles:['dueno','empleado']},
  ]},
  {id:'catalogo', group:'Catálogo', corto:'Catálogo', icon:'capsula', items:[
    {href:'buscar.html', icon:'lupa', text:'Localizar producto', hint:'Busca y enciende el LED', roles:['dueno','empleado']},
    {href:'registro.html', icon:'mas', text:'Medicamentos', hint:'Alta, edición y ubicación', roles:['dueno']},
    {href:'importar.html', icon:'subir', text:'Importar de Excel', hint:'Alta de muchos a la vez', roles:['dueno']},
  ]},
  {id:'inventario', group:'Inventario', corto:'Inventario', icon:'caja', items:[
    {href:'venta.html', icon:'ticket', text:'Punto de venta', hint:'Ticket con varios productos', roles:['dueno','empleado']},
    {href:'entradas.html', icon:'entrada', text:'Entradas', hint:'Recibir mercancía', roles:['dueno']},
    {href:'salidas.html', icon:'salida', text:'Mermas y retiros', hint:'Caducados, traslados, devoluciones', roles:['dueno','empleado']},
    {href:'inventario.html', icon:'caja', text:'Existencias y alertas', hint:'Stock y mínimos', roles:['dueno','empleado']},
    {href:'caducidades.html', icon:'reloj', text:'Caducidades', hint:'Lotes por vencer', roles:['dueno','empleado']},
    {href:'conteo.html', icon:'conteo', text:'Conteo físico', hint:'Contar y ajustar diferencias', roles:['dueno','empleado']},
    {href:'historial.html', icon:'lista', text:'Historial', hint:'Movimientos y responsables', roles:['dueno','empleado']},
  ]},
  {id:'compras', group:'Compras', corto:'Compras', icon:'camion', items:[
    {href:'compras.html', icon:'camion', text:'Órdenes y proveedores', hint:'Pedir, recibir y lo que falta', roles:['dueno']},
    {href:'recomendacion.html', icon:'carrito', text:'Recomendación de compras', hint:'Qué pedir y cuánto', roles:['dueno']},
  ]},
  {id:'analitica', group:'Analítica', corto:'Analítica', icon:'tendencia', items:[
    {href:'ia.html', icon:'chispa', text:'Análisis inteligente', hint:'Anomalías, ABC y riesgo', roles:['dueno']},
    {href:'prediccion.html', icon:'tendencia', text:'Predicción de demanda', hint:'Próximos 3 meses', roles:['dueno']},
    {href:'repisas.html', icon:'repisas', text:'Organización de repisas', hint:'Reubicar por rotación', roles:['dueno']},
  ]},
  {id:'admin', group:'Administración', corto:'Admin.', icon:'ajustes', items:[
    {href:'reportes.html', icon:'barras', text:'Reportes', hint:'Indicadores, PDF y Excel', roles:['dueno']},
    {href:'usuarios.html', icon:'equipo', text:'Empleados', hint:'Altas, roles y accesos', roles:['dueno']},
    {href:'mi-sucursal.html', icon:'tienda', text:'Mi sucursal', hint:'Datos del negocio y plan', roles:['dueno']},
  ]},
];

const Nav = {
  page: () => document.body.dataset.page,
  sinAcentos: s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
  secciones(session){
    return MENU.map(s => ({ ...s, items: s.items.filter(i => i.roles.includes(session.role)) })).filter(s => s.items.length);
  },
  actual(session){
    const page = ({ sucursal: 'sucursales', orden: 'compras' })[Nav.page()] || Nav.page();   // la ficha pertenece a "Sucursales"
    for(const s of Nav.secciones(session)){
      const it = s.items.find(i => i.href === page + '.html');
      if(it) return { seccion: s, item: it };
    }
    return { seccion: null, item: null };
  },
  // Contenedor a nivel de <body> para el círculo de navegación. Se vacía en cada render.
  extra(){
    let el = document.getElementById('navExtra');
    if(!el){ el = document.createElement('div'); el.id = 'navExtra'; document.body.appendChild(el); }
    el.innerHTML = '';
    return el;
  },
  // Bloque al inicio de <main> para la portada con el buscador grande (solo en Inicio).
  portada(){
    let el = document.getElementById('navPortada');
    if(!el){ el = document.createElement('div'); el.id = 'navPortada'; const m = document.querySelector('main'); m.insertBefore(el, m.firstChild); }
    el.innerHTML = '';
    return el;
  },
};

/* =====================================================================
   1 · BARRA SUPERIOR Y BUSCADOR
   ===================================================================== */
function cajaBuscador(id, grande, soloAcciones){
  return `<div class="bq${grande ? ' grande' : ''}" id="${id}">
    ${icono('lupa')}
    <input type="text" role="combobox" aria-expanded="false" aria-controls="${id}Lista" aria-label="${soloAcciones ? 'Buscar una sección' : 'Buscar una acción o un medicamento'}" autocomplete="off"
      placeholder="${soloAcciones ? 'Buscar sección: bitácora, avisos…  (Ctrl+K)' : grande ? 'Ej. paracetamol, registrar salida, reporte…' : 'Buscar acción o medicamento  (Ctrl+K)'}">
    <div class="bq-lista" id="${id}Lista" role="listbox" hidden></div>
  </div>`;
}

function activarBuscador(session, cont){
  const acciones = Nav.secciones(session).flatMap(s => s.items.map(i => ({ ...i, grupo: s.group })));
  const input = cont.querySelector('input'), lista = cont.querySelector('.bq-lista');
  const buscaProductos = session.role !== 'superadmin';
  let resultados = [], sel = 0, timer, pedido = 0;

  function pintar(){
    lista.innerHTML = resultados.length
      ? resultados.map((r, i) => `<a role="option" href="${r.href}" class="${i === sel ? 'sel' : ''}" aria-selected="${i === sel}">
          <span class="bq-ico">${icono(r.icon)}</span>
          <span class="bq-txt"><b>${esc(r.titulo)}</b><small>${esc(r.detalle)}</small></span><em>${esc(r.tipo)}</em></a>`).join('')
      : `<div class="bq-vacio">Sin coincidencias. Prueba con el nombre de un medicamento o una acción.</div>`;
    lista.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  const cerrar = () => { lista.hidden = true; input.setAttribute('aria-expanded', 'false'); };

  async function buscar(){
    const q = Nav.sinAcentos(input.value.trim());
    const deAcciones = acciones
      .filter(a => !q || Nav.sinAcentos(`${a.text} ${a.hint} ${a.grupo}`).includes(q))
      .map(a => ({ href: a.href, icon: a.icon, titulo: a.text, detalle: a.hint, tipo: a.grupo }));
    resultados = q ? deAcciones.slice(0, 6) : deAcciones; sel = 0; pintar();
    if(q.length < 2 || !buscaProductos) return;
    const mio = ++pedido;
    try{
      const prods = await api('/productos?q=' + encodeURIComponent(input.value.trim()));
      if(mio !== pedido) return;
      const dePro = prods.slice(0, 5).map(p => ({ href: 'buscar.html?q=' + encodeURIComponent(p.nombre), icon: 'capsula', titulo: p.nombre,
        detalle: `${p.coincidencia === 'aproximada' ? '¿Quisiste decir esto? · ' : ''}Anaquel ${p.ubicacion} · ${p.stock} u.${p.stock_bajo ? ' · stock bajo' : ''}`, tipo: 'Localizar' }));
      resultados = [...dePro, ...deAcciones.slice(0, 6)]; sel = 0; pintar();
    }catch{ /* si falla la búsqueda de medicamentos, quedan las acciones */ }
  }

  input.addEventListener('focus', buscar);
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(buscar, 180); });
  input.addEventListener('keydown', e => {
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault(); if(!resultados.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + resultados.length) % resultados.length; pintar();
      lista.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }
    if(e.key === 'Enter' && resultados[sel]) location.href = resultados[sel].href;
    if(e.key === 'Escape'){ cerrar(); input.blur(); }
  });
  document.addEventListener('click', e => { if(!cont.contains(e.target)) cerrar(); });
}

function renderBarra(session, root){
  const enInicio = Nav.page() === 'inicio';
  const inicioHref = homeFor(session.role);
  root.className = 'topbar';
  root.innerHTML = `
    <a class="tb-brand brand" href="${inicioHref}"><img src="../img/isotipo-blanco.png" alt=""><b>Smart<span>Stock</span></b></a>
    <div class="tb-centro">${enInicio ? '' : cajaBuscador('bqTop', false, session.role === 'superadmin')}</div>
    <div class="tb-der">
      ${session.role === 'superadmin' ? '' : `<a class="tb-alertas" href="inventario.html" title="Alertas activas">${icono('campana')}<span class="tb-alertas-txt">Alertas</span><span class="nav-badge" id="navBadge" hidden></span></a>`}
      <a class="tb-user" href="cuenta.html" title="Mi cuenta">
        <span class="who">${esc(session.nombre || session.email)}</span>
        <span class="role">${ROLE_LABEL[session.role] || session.role}${session.sucursalNombre ? ' · ' + esc(session.sucursalNombre) : ''}</span>
      </a>
      <button class="tb-salir" onclick="logout()">Cerrar sesión</button>
    </div>`;

  if(enInicio){
    const acciones = Nav.secciones(session).flatMap(s => s.items);
    const atajos = ['venta.html', 'buscar.html', 'turno.html', 'asistente.html', 'entradas.html', 'recomendacion.html', 'caducidades.html', 'inventario.html']
      .map(h => acciones.find(a => a.href === h)).filter(Boolean).slice(0, 5);
    Nav.portada().innerHTML = `
      <section class="bq-portada" aria-label="Buscador">
        <h1>¿Qué necesitas hacer, ${esc((session.nombre || '').split(' ')[0])}?</h1>
        <p>Escribe un medicamento o una acción, o usa el círculo de la derecha para recorrer las secciones.</p>
        ${cajaBuscador('bqHero', true)}
        <div class="bq-chips">${atajos.map(a => `<a href="${a.href}">${icono(a.icon)}${esc(a.text)}</a>`).join('')}</div>
        <a class="bq-bajar" href="#resumenDia">Tu resumen de hoy <span aria-hidden="true">↓</span></a>
      </section>
      <div id="resumenDia"></div>`;
  }

  const caja = document.getElementById(enInicio ? 'bqHero' : 'bqTop');
  if(caja) activarBuscador(session, caja);
  if(!window.__bqGlobal){
    window.__bqGlobal = true;
    document.addEventListener('keydown', e => {
      const enCampo = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if(((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !enCampo)){
        e.preventDefault(); document.querySelector('.bq input')?.focus();
      }
    });
  }
}

/* =====================================================================
   2 · CÍRCULO DE NAVEGACIÓN (órbita)
   Geometría: el centro del círculo principal está pegado al borde derecho.
   Arco 1 (secciones) a radio R1 y arco 2 (opciones) a radio R2, ambos
   abiertos hacia la izquierda. En celular el círculo va en la esquina
   inferior derecha y las opciones salen en una lista.
   ===================================================================== */
function renderOrbita(session){
  const secciones = Nav.secciones(session);
  const { seccion: secActual, item: itemActual } = Nav.actual(session);
  const extra = Nav.extra();
  const movil = () => window.innerWidth < 760;

  extra.innerHTML = `
    <div class="orb-velo" id="orbVelo" hidden></div>
    <div class="orb" id="orb">
      <button class="orb-hub" id="orbHub" aria-haspopup="true" aria-expanded="false" aria-controls="orbArcos" aria-label="Menú de navegación. Sección actual: ${esc(secActual ? secActual.group : 'ninguna')}">
        ${icono(secActual ? secActual.icon : 'casa')}
        <span class="orb-hub-sec">${esc(secActual ? secActual.corto : 'Menú')}</span>
      </button>
      <div class="orb-arcos" id="orbArcos" hidden></div>
    </div>`;

  const orb = extra.querySelector('#orb'), hub = extra.querySelector('#orbHub');
  const arcos = extra.querySelector('#orbArcos'), velo = extra.querySelector('#orbVelo');
  let abierta = false, elegida = null, cierre = null;

  // Posición (x hacia la izquierda, y hacia abajo) de un punto a `radio` y `ang` grados (180° = izquierda).
  const pos = (radio, ang) => ({ x: -radio * Math.cos(ang * Math.PI / 180), y: -radio * Math.sin(ang * Math.PI / 180) });
  // Reparte n elementos en un arco centrado en `centro`, separados `paso` grados.
  const angulos = (n, centro, paso) => Array.from({ length: n }, (_, i) => centro + (i - (n - 1) / 2) * paso);

  function pintar(){
    const m = movil();
    const R1 = m ? 160 : secciones.length > 5 ? 188 : 166, R2 = secciones.length > 5 ? 296 : 276;   // con 6 secciones se abre el arco para que no se encimen
    const a1 = m ? angulos(secciones.length, 135, Math.min(22, 88 / Math.max(1, secciones.length - 1)))
                 : angulos(secciones.length, 180, Math.min(32, 150 / Math.max(1, secciones.length - 1)));
    const sec = secciones.find(s => s.id === elegida);

    let html = secciones.map((s, i) => {
      const p = pos(R1, a1[i]);
      return `<button class="orb-sec${s.id === elegida ? ' elegida' : ''}${secActual && s.id === secActual.id ? ' actual' : ''}" data-id="${s.id}"
                style="--x:${p.x.toFixed(1)}px; --y:${p.y.toFixed(1)}px; --d:${i * 28}ms" aria-expanded="${s.id === elegida}">
                ${icono(s.icon)}<span>${esc(s.corto)}</span></button>`;
    }).join('');

    if(sec && !m){
      const a2 = angulos(sec.items.length, 180, Math.min(24, 110 / Math.max(1, sec.items.length - 1)));
      html += sec.items.map((it, i) => {
        const p = pos(R2, a2[i]);
        const aqui = itemActual && it.href === itemActual.href;
        return `<a class="orb-op${aqui ? ' aqui' : ''}" href="${it.href}" style="--x:${p.x.toFixed(1)}px; --y:${p.y.toFixed(1)}px; --d:${i * 30}ms">
                  <span class="orb-op-txt"><b>${esc(it.text)}</b><small>${aqui ? 'Estás aquí' : esc(it.hint)}</small></span>
                  <span class="orb-op-circ">${icono(it.icon)}</span></a>`;
      }).join('');
    }
    if(sec && m){
      html += `<div class="orb-hoja"><div class="orb-hoja-tit">${icono(sec.icon)}${esc(sec.group)}</div>
        ${sec.items.map(it => `<a href="${it.href}" class="${itemActual && it.href === itemActual.href ? 'aqui' : ''}">
          <span class="orb-op-circ">${icono(it.icon)}</span><span class="orb-op-txt"><b>${esc(it.text)}</b><small>${esc(it.hint)}</small></span></a>`).join('')}</div>`;
    }
    arcos.innerHTML = html;

    arcos.querySelectorAll('.orb-sec').forEach(b => {
      const elegir = () => {
        if(elegida === b.dataset.id) return;
        const teniaFoco = document.activeElement === b;
        elegida = b.dataset.id; arcos.classList.add('sin-anim'); pintar();
        if(teniaFoco) arcos.querySelector(`.orb-sec[data-id="${elegida}"]`)?.focus();
      };
      b.addEventListener('mouseenter', () => { if(!movil()) elegir(); });
      b.addEventListener('focus', elegir);
      b.addEventListener('click', elegir);
    });
  }

  function abrir(){
    clearTimeout(cierre);
    if(abierta) return;
    abierta = true; elegida = secActual ? secActual.id : secciones[0].id;
    arcos.classList.remove('sin-anim');
    arcos.hidden = false; velo.hidden = false; orb.classList.add('abierta'); hub.setAttribute('aria-expanded', 'true');
    pintar();
  }
  function cerrar(){
    clearTimeout(cierre);
    abierta = false; arcos.hidden = true; velo.hidden = true; orb.classList.remove('abierta'); hub.setAttribute('aria-expanded', 'false');
  }
  const cerrarLuego = () => { clearTimeout(cierre); cierre = setTimeout(cerrar, 450); };

  // Escritorio: se abre al señalar y se cierra poco después de salir de los círculos.
  orb.addEventListener('mouseenter', () => { if(!movil()) abrir(); });
  orb.addEventListener('mouseover', () => { if(!movil()) clearTimeout(cierre); });
  orb.addEventListener('mouseleave', () => { if(!movil()) cerrarLuego(); });
  // Clic / toque y teclado
  hub.addEventListener('click', () => { if(movil()) (abierta ? cerrar() : abrir()); else abrir(); });
  hub.addEventListener('focus', () => { if(!movil()) abrir(); });
  velo.addEventListener('click', cerrar);
  orb.addEventListener('focusout', e => { if(!movil() && !orb.contains(e.relatedTarget)) cerrarLuego(); });
  if(!window.__orbGlobal){
    window.__orbGlobal = true;
    document.addEventListener('keydown', e => { if(e.key === 'Escape') document.getElementById('orbVelo')?.click(); });
  }
}

/* ---------- punto de entrada: lo llama cada página ---------- */
function renderNav(session){
  const root = document.getElementById('sidebarRoot');
  if(!root) return;
  renderBarra(session, root);
  renderOrbita(session);
  if(session.role !== 'superadmin') actualizarBadgeAlertas();
}

async function actualizarBadgeAlertas(){
  try{
    const a = await api('/inventario/alertas');
    const n = a.stockBajo.length + a.porVencer.length + a.caducados.length;
    const b = document.getElementById('navBadge');
    if(b){ b.textContent = n; b.hidden = n === 0; b.title = `${a.stockBajo.length} con stock bajo · ${a.porVencer.length + a.caducados.length} lote(s) por vencer o caducados`; }
  }catch{ /* el badge es informativo; si falla no bloquea la página */ }
}
