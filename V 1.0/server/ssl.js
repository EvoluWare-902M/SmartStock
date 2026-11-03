/* ===== ssl.js : conexión cifrada a MySQL en la nube =====
   Aiven y TiDB Cloud solo aceptan conexiones con SSL. En tu computadora
   (XAMPP o MySQL local) se deja DB_SSL=false y no cambia nada.

   DB_SSL=true            activa el cifrado
   DB_SSL_CA=database/ca.pem   certificado que descargas de Aiven
                               (ruta relativa a la carpeta del proyecto)
*/
const fs = require('fs');
const path = require('path');

function sslConfig(){
  if(process.env.DB_SSL !== 'true') return undefined;
  const ruta = process.env.DB_SSL_CA;
  if(!ruta) return { rejectUnauthorized: true };            // proveedores con certificado público (TiDB)
  const archivo = path.isAbsolute(ruta) ? ruta : path.join(__dirname, '..', ruta);
  if(!fs.existsSync(archivo))
    throw new Error(`No encuentro el certificado SSL en ${archivo}. Descárgalo de Aiven (CA certificate) y revisa DB_SSL_CA en el .env.`);
  return { ca: fs.readFileSync(archivo, 'utf8') };
}

module.exports = { sslConfig };
