# Desplegar 2J Fitness Center en Raiola Networks

Guía concreta para `app.2jfitnesscenter.com` sobre un VPS Cloud 1 de Raiola. Es la versión
específica de [SELF_HOSTING.md](./SELF_HOSTING.md) — esa guía explica el porqué de cada cosa,
esta da los comandos exactos para este proveedor y este dominio.

Este repositorio no tiene todavía un remoto propio (solo `upstream`, de donde se heredan
mejoras del proyecto original) — el código se copia al servidor directamente por SSH, no con
`git clone`. Nada de esto toca tu instancia local de pruebas en `localhost:8080`.

## 1. Crear el VPS

En el panel de Raiola: **VPS Cloud → VPS Cloud 1**, sistema operativo **Ubuntu 24.04**. Al
crearlo, Raiola te da (o te deja subir) una clave SSH — mejor usar clave que contraseña, evita
tener que escribir la contraseña root en ningún sitio. Apunta la **IP pública** del servidor.

## 2. Apuntar el dominio

En el gestor DNS de `2jfitnesscenter.com` (en el panel de Raiola si el dominio está también ahí,
si no en donde lo registraste), crea un registro:

```
Tipo: A
Nombre: app
Valor: <IP del VPS>
TTL: automático
```

Comprueba que ha propagado antes de seguir (puede tardar de minutos a un par de horas):

```bash
nslookup app.2jfitnesscenter.com
```

## 3. Preparar el servidor (por SSH)

```bash
ssh root@<IP del VPS>

# Docker + el plugin de Compose
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin

# Un usuario para la app en vez de correr todo como root
adduser --disabled-password --gecos "" 2jfitness
usermod -aG docker 2jfitness
mkdir -p /opt/2jfitness && chown 2jfitness:2jfitness /opt/2jfitness
```

## 4. Copiar el código

Desde tu ordenador (donde está este repositorio), sin salir de la carpeta del proyecto:

```bash
rsync -avz --exclude-from=.gitignore --exclude='.git' \
  ./ 2jfitness@<IP del VPS>:/opt/2jfitness/
```

Esto copia el código pero no `data/`, `node_modules/` ni `media/` (están en `.gitignore` a
propósito — `media/` se descarga solo en el servidor la primera vez que arranca).

## 5. Configurar y arrancar

Ya por SSH en el servidor:

```bash
su - 2jfitness
cd /opt/2jfitness
cp .env.production.example .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

La primera vez tarda un par de minutos: construye las imágenes y descarga las ~140 MB de
imágenes de ejercicios. Comprueba que está sano:

```bash
docker compose ps
curl http://localhost:8080/api/health        # {"ok":true,...}
```

Y desde fuera, una vez el certificado de Caddy esté listo (suele ser cuestión de segundos):

```bash
curl https://app.2jfitnesscenter.com/api/health
```

Si esto último falla, mira `docker compose logs caddy` — casi siempre es el DNS que aún no ha
propagado (paso 2) o el puerto 80/443 bloqueado por un firewall del proveedor.

## 6. Registrarte como admin

Abre `https://app.2jfitnesscenter.com` en el navegador y crea tu perfil con passkey — **la
passkey de tu instancia local no sirve aquí**, están ligadas al dominio exacto (`localhost` ≠
`app.2jfitnesscenter.com`), así que es un registro nuevo.

Luego, en el servidor:

```bash
cat data/db.json   # busca tu nuevo id en "users"
nano .env           # descomenta ADMIN_UIDS=tu-id-nuevo
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## 7. Reconectar el AI Coach

La conexión con Gemini tampoco viaja (está cifrada contra el `./data/secret` de esta instancia,
que se genera nuevo en cada servidor). Mismo paso que en local: Ajustes → Panel de
administración → Entrenador con IA → Google Gemini → Usar una clave de API → pega la misma
clave.

## 8. (Opcional) Traer tu plan actual

Tu rutina de hipertrofia generada en local no se copia sola. Desde tu cuenta local: Plan →
Herramientas → Exportar archivo del plan (JSON). Luego, ya con tu cuenta nueva en producción:
Plan → Herramientas → Importar archivo. Añade las rutinas sin tocar nada más de la cuenta nueva.

## 9. Copias de seguridad

Todo lo que importa vive en `/opt/2jfitness/data` en el servidor — perfiles, passkeys, rutinas,
historial. Ojo: esa carpeta es propiedad de `root` (la API dentro del contenedor escribe como
root), así que el backup se ejecuta como root, no como el usuario `2jfitness`.

`scripts/backup-data.sh` hace el `tar` y borra copias de más de `BACKUP_KEEP_DAYS` días (14 por
defecto) para que el disco no se llene solo. Prográmalo con `cron` (como root):

```bash
crontab -e
# añade, en su propia línea:
BACKUP_DIR=/root/backups
30 3 * * * /opt/2jfitness/scripts/backup-data.sh >> /root/backups/backup.log 2>&1
```

Y de vez en cuando baja esa copia fuera del servidor (a tu ordenador, o a otro sitio) — una copia
que solo vive en la misma máquina no protege de que esa máquina falle.

## Actualizar más adelante

Repite el paso 4 (rsync) para traer cambios, y luego en el servidor:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

`./data` y las imágenes de ejercicios no se tocan al actualizar.

## Rollback después de activar Sync V2

`51a221d8ef524776334d8d67109fb9102407eff2` es la base mínima de runtime una vez que
producción haya abierto Sync V2. No se puede volver a `90d98fe` ni a ningún paquete que no
contenga `SYNC_V2_ROLLBACK_BASE`: esos servidores aceptan PUT legacy y podrían reemplazar
revision, generation, tombstones y receipts con un snapshot antiguo.

Cada despliegue se prepara como un archivo de release creado con `git archive`. Conserva en
`/root/backups/` el archivo del último checkpoint compatible que funcionó. Antes de extraer un
rollback, comprueba el marcador sin tocar `data/`:

```bash
tar -xOf /root/backups/2jfitness-code-<commit-compatible>.tar.gz SYNC_V2_ROLLBACK_BASE \
  | grep -q 51a221d8ef524776334d8d67109fb9102407eff2
tar -xzf /root/backups/2jfitness-code-<commit-compatible>.tar.gz -C /opt/2jfitness
cd /opt/2jfitness
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

El rollback cambia solo el código. No restaura `data/`, no reduce metadata y no reabre el
protocolo legacy. Si ningún archivo compatible conocido arranca, se corrige hacia delante desde
esta base; restaurar código anterior sobre los state V2 queda prohibido.
