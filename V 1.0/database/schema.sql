-- =====================================================================
--  SmartStock · Esquema de base de datos (MySQL 8 / MariaDB 10.5+)
--  Equipo EvoluWare · UT Nezahualcóyotl
-- =====================================================================
--  Ejecutar con:  npm run db:init   (crea la BD, las tablas y los datos)
--  o manualmente: mysql -u root -p < database/schema.sql
-- =====================================================================

CREATE DATABASE IF NOT EXISTS smartstock
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smartstock;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS faltantes;
DROP TABLE IF EXISTS conteo_partidas;
DROP TABLE IF EXISTS conteos;
DROP TABLE IF EXISTS orden_partidas;
DROP TABLE IF EXISTS ordenes_compra;
DROP TABLE IF EXISTS avisos;
DROP TABLE IF EXISTS auditoria;
DROP TABLE IF EXISTS led_estado;
DROP TABLE IF EXISTS movimientos;
DROP TABLE IF EXISTS lotes;
DROP TABLE IF EXISTS ventas;
DROP TABLE IF EXISTS productos;
DROP TABLE IF EXISTS proveedores;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS sucursales;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- Sucursales: cada farmacia registrada en la plataforma.
-- El superadministrador las aprueba, suspende o reactiva.
-- ---------------------------------------------------------------------
CREATE TABLE sucursales (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  -- Datos del negocio
  nombre             VARCHAR(120) NOT NULL,            -- nombre comercial
  razon_social       VARCHAR(160) NULL,
  rfc                VARCHAR(13)  NULL,
  tipo               VARCHAR(40)  NULL,                -- farmacia independiente, con consultorio...
  licencia_sanitaria VARCHAR(40)  NULL,                -- aviso de funcionamiento / licencia COFEPRIS
  telefono           VARCHAR(30)  NOT NULL,
  -- Domicilio (formato México)
  calle              VARCHAR(120) NULL,
  num_exterior       VARCHAR(15)  NULL,
  num_interior       VARCHAR(15)  NULL,
  colonia            VARCHAR(100) NULL,
  codigo_postal      CHAR(5)      NULL,
  municipio          VARCHAR(100) NULL,                -- municipio o alcaldía
  entidad            VARCHAR(40)  NULL,                -- estado de la república
  referencias        VARCHAR(200) NULL,
  direccion          VARCHAR(255) NOT NULL,            -- domicilio completo en una línea (reportes)
  -- Responsable
  dueno_nombre       VARCHAR(120) NOT NULL,
  responsable_cargo  VARCHAR(40)  NULL,
  responsable_cedula VARCHAR(20)  NULL,                -- cédula profesional (responsable sanitario)
  correo             VARCHAR(120) NOT NULL,
  -- Plan y estado
  plan               ENUM('Gratuito','Básico','Profesional','Empresarial') NOT NULL DEFAULT 'Gratuito',
  plan_solicitado    ENUM('Gratuito','Básico','Profesional','Empresarial') NULL,
  estado             ENUM('Pendiente','Activa','Suspendida','Rechazada') NOT NULL DEFAULT 'Pendiente',
  motivo_estado      VARCHAR(300) NULL,                -- por qué se rechazó o suspendió
  fecha_alta         DATE NOT NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Usuarios: superadmin (sin sucursal), dueño/gerente y empleados.
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  nombre                VARCHAR(120) NOT NULL,
  correo                VARCHAR(120) NOT NULL UNIQUE,
  telefono              VARCHAR(30) NULL,
  password_hash         VARCHAR(100) NOT NULL,
  rol                   ENUM('superadmin','dueno','empleado') NOT NULL,
  sucursal_id           INT NULL,
  estado                ENUM('Activo','Inactivo') NOT NULL DEFAULT 'Activo',
  debe_cambiar_password TINYINT(1) NOT NULL DEFAULT 0,
  ultimo_acceso         DATETIME NULL,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_usuario_sucursal FOREIGN KEY (sucursal_id)
    REFERENCES sucursales(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Proveedores de cada sucursal. dias_entrega alimenta el cálculo del
-- punto de reorden (mínimos sugeridos por la IA).
-- ---------------------------------------------------------------------
CREATE TABLE proveedores (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  sucursal_id  INT NOT NULL,
  nombre       VARCHAR(120) NOT NULL,
  contacto     VARCHAR(120) NULL,
  telefono     VARCHAR(30)  NULL,
  correo       VARCHAR(120) NULL,
  dias_entrega INT NOT NULL DEFAULT 3,
  notas        VARCHAR(255) NULL,
  activo       TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_proveedor (sucursal_id, nombre),
  CONSTRAINT fk_prov_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Productos (catálogo de medicamentos por sucursal).
-- La existencia NO se guarda aquí: se calcula sumando sus lotes.
-- ubicacion = posición en el anaquel (fila A-D, columna 1-6), ej. "B4".
-- ---------------------------------------------------------------------
CREATE TABLE productos (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  sucursal_id     INT NOT NULL,
  codigo          VARCHAR(30)  NOT NULL,
  codigo_barras   VARCHAR(20)  NULL,                   -- el que trae impreso la caja (lector o teclado)
  proveedor_id    INT NULL,                            -- proveedor habitual
  nombre          VARCHAR(120) NOT NULL,
  sustancia       VARCHAR(120) NULL,
  laboratorio     VARCHAR(80)  NULL,
  categoria       VARCHAR(40)  NOT NULL,
  presentacion    VARCHAR(40)  NOT NULL,
  concentracion   VARCHAR(40)  NULL,
  requiere_receta TINYINT(1)   NOT NULL DEFAULT 0,
  ubicacion       VARCHAR(4)   NOT NULL,
  stock_minimo    INT          NOT NULL DEFAULT 0,
  precio          DECIMAL(10,2) NOT NULL DEFAULT 0,
  activo          TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_producto_codigo (sucursal_id, codigo),
  INDEX idx_producto_barras (sucursal_id, codigo_barras),
  CONSTRAINT fk_producto_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL,
  CONSTRAINT fk_producto_sucursal FOREIGN KEY (sucursal_id)
    REFERENCES sucursales(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Lotes: cada recepción de un medicamento con su caducidad.
-- ---------------------------------------------------------------------
CREATE TABLE lotes (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  producto_id    INT NOT NULL,
  numero_lote    VARCHAR(40) NOT NULL,
  caducidad      DATE NOT NULL,
  cantidad       INT NOT NULL DEFAULT 0,
  costo_unitario DECIMAL(10,2) NOT NULL DEFAULT 0,
  factura        VARCHAR(40) NULL,
  proveedor      VARCHAR(120) NULL,
  fecha_entrada  DATE NOT NULL,
  UNIQUE KEY uq_lote (producto_id, numero_lote),
  CONSTRAINT fk_lote_producto FOREIGN KEY (producto_id)
    REFERENCES productos(id) ON DELETE CASCADE,
  CONSTRAINT chk_lote_cantidad CHECK (cantidad >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Ventas (tickets del punto de venta). Cada partida es un movimiento
-- de salida ligado por venta_id; así se sabe qué se compra junto.
-- ---------------------------------------------------------------------
CREATE TABLE ventas (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  sucursal_id INT NOT NULL,
  folio       VARCHAR(20) NOT NULL,
  usuario_id  INT NULL,
  fecha       DATETIME NOT NULL,
  total       DECIMAL(10,2) NOT NULL DEFAULT 0,
  cliente     VARCHAR(120) NULL,
  receta      VARCHAR(60) NULL,
  estado      ENUM('Completada','Cancelada') NOT NULL DEFAULT 'Completada',
  INDEX idx_venta_fecha (sucursal_id, fecha),
  CONSTRAINT fk_venta_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  CONSTRAINT fk_venta_usuario  FOREIGN KEY (usuario_id)  REFERENCES usuarios(id)  ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Movimientos: historial de entradas y salidas (auditoría y fuente de
-- datos del modelo predictivo).
-- ---------------------------------------------------------------------
CREATE TABLE movimientos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  sucursal_id   INT NOT NULL,
  producto_id   INT NOT NULL,
  lote_id       INT NULL,
  venta_id      INT NULL,                       -- ticket al que pertenece (punto de venta)
  tipo          ENUM('Entrada','Salida','Ajuste') NOT NULL,
  cantidad      INT NOT NULL,
  motivo        VARCHAR(80) NOT NULL,
  proveedor     VARCHAR(120) NULL,
  factura       VARCHAR(40) NULL,
  receta        VARCHAR(60) NULL,
  cliente       VARCHAR(120) NULL,
  observaciones VARCHAR(255) NULL,
  usuario_id    INT NULL,
  fecha         DATETIME NOT NULL,
  INDEX idx_mov_fecha (sucursal_id, fecha),
  INDEX idx_mov_producto (producto_id, tipo, fecha),
  INDEX idx_mov_venta (venta_id),
  CONSTRAINT fk_mov_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  CONSTRAINT fk_mov_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
  CONSTRAINT fk_mov_lote     FOREIGN KEY (lote_id)     REFERENCES lotes(id)     ON DELETE SET NULL,
  CONSTRAINT fk_mov_usuario  FOREIGN KEY (usuario_id)  REFERENCES usuarios(id)  ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Estado del LED por sucursal (localización asistida).
-- La interfaz lo simula; un microcontrolador (ESP32) puede consultarlo
-- en GET /api/iot/led/:sucursalId para encender el LED físico.
-- ---------------------------------------------------------------------
CREATE TABLE led_estado (
  sucursal_id  INT PRIMARY KEY,
  ubicacion    VARCHAR(4) NULL,
  color        VARCHAR(10) NULL,
  producto_id  INT NULL,
  expira_en    DATETIME NULL,
  CONSTRAINT fk_led_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Bitácora de auditoría: quién hizo qué en la plataforma y cuándo.
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id     INT NULL,
  usuario_nombre VARCHAR(120) NOT NULL,
  accion         VARCHAR(40)  NOT NULL,          -- sucursal.aprobar, usuario.password, aviso.crear...
  sucursal_id    INT NULL,                       -- sucursal afectada (si aplica)
  detalle        VARCHAR(400) NOT NULL,
  fecha          DATETIME NOT NULL,
  INDEX idx_aud_fecha (fecha),
  INDEX idx_aud_sucursal (sucursal_id, fecha)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Avisos del equipo SmartStock que ven las sucursales en su Inicio.
-- ---------------------------------------------------------------------
CREATE TABLE avisos (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  titulo     VARCHAR(120) NOT NULL,
  mensaje    VARCHAR(600) NOT NULL,
  tipo       ENUM('Novedad','Mantenimiento','Importante') NOT NULL DEFAULT 'Novedad',
  plan       VARCHAR(20) NULL,                   -- NULL = todas las sucursales
  activo     TINYINT(1) NOT NULL DEFAULT 1,
  vence_el   DATE NULL,
  creado_por VARCHAR(120) NOT NULL,
  creado_en  DATETIME NOT NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Órdenes de compra a proveedores. Al recibirlas se generan las entradas.
-- ---------------------------------------------------------------------
CREATE TABLE ordenes_compra (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  sucursal_id     INT NOT NULL,
  folio           VARCHAR(20) NOT NULL,
  proveedor_id    INT NULL,
  estado          ENUM('Borrador','Enviada','Recibida','Cancelada') NOT NULL DEFAULT 'Borrador',
  origen          ENUM('Manual','IA') NOT NULL DEFAULT 'Manual',
  notas           VARCHAR(255) NULL,
  creada_por      INT NULL,
  fecha           DATETIME NOT NULL,
  fecha_envio     DATETIME NULL,
  fecha_recepcion DATETIME NULL,
  INDEX idx_orden (sucursal_id, estado, fecha),
  CONSTRAINT fk_orden_sucursal  FOREIGN KEY (sucursal_id)  REFERENCES sucursales(id)  ON DELETE CASCADE,
  CONSTRAINT fk_orden_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE orden_partidas (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  orden_id          INT NOT NULL,
  producto_id       INT NOT NULL,
  cantidad          INT NOT NULL,
  costo_unitario    DECIMAL(10,2) NOT NULL DEFAULT 0,
  cantidad_recibida INT NULL,
  motivo            VARCHAR(300) NULL,              -- por qué la sugirió el modelo
  UNIQUE KEY uq_partida (orden_id, producto_id),
  CONSTRAINT fk_partida_orden    FOREIGN KEY (orden_id)    REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  CONSTRAINT fk_partida_producto FOREIGN KEY (producto_id) REFERENCES productos(id)      ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Conteos físicos (inventario cíclico). El empleado cuenta "a ciegas";
-- el gerente revisa las diferencias y aplica los ajustes.
-- Más adelante, el sensor de peso podrá llenar "contado" automáticamente.
-- ---------------------------------------------------------------------
CREATE TABLE conteos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  sucursal_id INT NOT NULL,
  folio       VARCHAR(20) NOT NULL,
  estado      ENUM('Abierto','Por revisar','Aplicado','Descartado') NOT NULL DEFAULT 'Abierto',
  origen      ENUM('Manual','IA') NOT NULL DEFAULT 'Manual',
  creado_por  INT NULL,
  asignado_a  INT NULL,
  fecha       DATETIME NOT NULL,
  cerrado_en  DATETIME NULL,
  INDEX idx_conteo (sucursal_id, estado, fecha),
  CONSTRAINT fk_conteo_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE conteo_partidas (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  conteo_id   INT NOT NULL,
  producto_id INT NOT NULL,
  esperado    INT NOT NULL,                         -- existencia en sistema al abrir el conteo
  contado     INT NULL,
  motivo      VARCHAR(200) NULL,                    -- por qué se eligió (IA)
  UNIQUE KEY uq_conteo_producto (conteo_id, producto_id),
  CONSTRAINT fk_cp_conteo   FOREIGN KEY (conteo_id)   REFERENCES conteos(id)   ON DELETE CASCADE,
  CONSTRAINT fk_cp_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Faltantes: lo que un cliente pidió y no se le pudo surtir.
-- Es demanda que no aparece en las ventas; la IA la agrupa aunque
-- esté escrita con faltas.
-- ---------------------------------------------------------------------
CREATE TABLE faltantes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  sucursal_id INT NOT NULL,
  producto_id INT NULL,                             -- si existe en el catálogo
  texto       VARCHAR(120) NOT NULL,                -- lo que pidió el cliente
  cantidad    INT NOT NULL DEFAULT 1,
  usuario_id  INT NULL,
  fecha       DATETIME NOT NULL,
  atendido    TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_faltante (sucursal_id, fecha),
  CONSTRAINT fk_falt_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  CONSTRAINT fk_falt_producto FOREIGN KEY (producto_id) REFERENCES productos(id)  ON DELETE SET NULL
) ENGINE=InnoDB;
