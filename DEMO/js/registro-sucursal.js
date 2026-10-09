/* ===== registro-sucursal.js : alta de una nueva sucursal (dueño) ===== */
function pintarPlanes(){
  const grid = document.getElementById('planGrid');
  const blurb = { "Básico":"1 sucursal, hasta 3 empleados", "Profesional":"Predicción de demanda incluida", "Empresarial":"Varias sucursales y soporte prioritario" };
  grid.innerHTML = PLANES.map((p,i) => `
    <label class="plan-opt${i===0 ? ' selected' : ''}">
      <input type="radio" name="rsPlan" value="${p}" ${i===0 ? 'checked' : ''}>
      <b>${p}</b><br><span style="color:var(--muted)">${blurb[p]}</span>
    </label>`).join('');
  grid.querySelectorAll('.plan-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      grid.querySelectorAll('.plan-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
}

function nextSucursalId(){
  return 'suc-' + String(sucursales.length + 1).padStart(3, '0');
}

function mostrarError(msg){
  const err = document.getElementById('rsError');
  err.textContent = msg;
  err.style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  pintarPlanes();

  document.getElementById('rsGuardar').addEventListener('click', () => {
    document.getElementById('rsError').style.display = 'none';

    const nombre = document.getElementById('rsNombre').value.trim();
    const direccion = document.getElementById('rsDireccion').value.trim();
    const dueño = document.getElementById('rsDueno').value.trim();
    const telefono = document.getElementById('rsTelefono').value.trim();
    const correo = document.getElementById('rsCorreo').value.trim().toLowerCase();
    const pass = document.getElementById('rsPass').value.trim();
    const plan = document.querySelector('input[name="rsPlan"]:checked').value;

    if(!nombre || !direccion || !dueño || !telefono || !correo || !pass){
      mostrarError('Completa todos los campos marcados con *.');
      return;
    }
    if(cuentas.some(c => c.correo.toLowerCase() === correo)){
      mostrarError('Ya existe una cuenta registrada con ese correo.');
      return;
    }

    const id = nextSucursalId();
    const hoyStr = HOY.toISOString().slice(0,10);

    sucursales.push({ id, nombre, dueño, correo, telefono, direccion, plan, estado:'Pendiente', fechaAlta: hoyStr });
    cuentas.push({ correo, password: pass, rol:'dueño', nombre: dueño, sucursalId: id });

    document.getElementById('formPanel').style.display = 'none';
    document.getElementById('successPanel').style.display = 'block';
  });
});
