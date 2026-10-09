const MENU = [
  {group:"Plataforma", items:[
    {href:"sucursales.html", label:"🏬 Sucursales", roles:["superadmin"]},
  ]},
  {group:"Catálogo", items:[
    {href:"buscar.html", label:"🔎 Localizar producto", roles:["dueño","empleado"]},
    {href:"registro.html", label:"➕ Registrar medicamento", roles:["dueño"]},
  ]},
  {group:"Inventario", items:[
    {href:"entradas.html", label:"📥 Entradas", roles:["dueño"]},
    {href:"salidas.html", label:"📤 Salidas", roles:["dueño","empleado"]},
    {href:"inventario.html", label:"📦 Existencias y alertas", roles:["dueño","empleado"]},
    {href:"caducidades.html", label:"⏳ Caducidades", roles:["dueño","empleado"]},
    {href:"historial.html", label:"🕘 Historial", roles:["dueño","empleado"]},
  ]},
  {group:"Analítica", items:[
    {href:"prediccion.html", label:"📈 Predicción de demanda", roles:["dueño"]},
    {href:"recomendacion.html", label:"🧾 Recomendación de compras", roles:["dueño"]},
    {href:"repisas.html", label:"🗂️ Organización de repisas", roles:["dueño"]},
  ]},
  {group:"Administración", items:[
    {href:"reportes.html", label:"📊 Reportes", roles:["dueño"]},
    {href:"usuarios.html", label:"👤 Empleados", roles:["dueño"]},
    {href:"mi-sucursal.html", label:"🏠 Mi sucursal", roles:["dueño"]},
  ]},
];

const ROLE_LABEL = {
  superadmin: "Superadministrador",
  "dueño": "Dueño / Gerente",
  empleado: "Empleado",
};

function renderNav(session){
  const root = document.getElementById('sidebarRoot');
  if(!root) return;
  const currentPage = document.body.dataset.page;

  let html = `<div class="brand">Smart<span>Stock</span></div>`;
  MENU.forEach(section => {
    const visible = section.items.filter(i => i.roles.includes(session.role));
    if(!visible.length) return;
    html += `<div class="group-label">${section.group}</div>`;
    visible.forEach(item => {
      const page = item.href.replace('.html','');
      const active = page === currentPage ? ' active' : '';
      html += `<a class="nav-btn${active}" href="${item.href}">${item.label}</a>`;
    });
  });

  const suc = session.sucursalId ? sucursales.find(s => s.id === session.sucursalId) : null;
  const subline = suc ? suc.nombre : (session.role === 'superadmin' ? 'Panel de plataforma' : '');

  html += `
    <div class="user-footer">
      <div class="who">${session.nombre || session.email}</div>
      <div class="role">${ROLE_LABEL[session.role] || session.role}${subline ? ' · ' + subline : ''}</div>
      <button onclick="logout()">Cerrar sesión</button>
    </div>`;
  root.innerHTML = html;
}
