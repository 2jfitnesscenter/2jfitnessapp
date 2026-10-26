# Perfil de staging para Búnker

**Solo preparación.** No se ha ejecutado el script de servidor, creado infraestructura ni conectado a producción.

## Dominio y compatibilidad con Platform PR #89

Según A52, el dominio de staging aprobado es `2jfit.com`; Búnker debe usar `app.2jfit.com` (`RP_ID=app.2jfit.com`, `ORIGIN=https://app.2jfit.com`). El dominio anterior `2jfit.es` queda obsoleto. Antes de ejecutar el script de Platform PR #89, su configuración `DOMAIN` debe ser `2jfit.com` para que genere hosts y certificados coherentes. Este cambio solo prepara la referencia; no altera DNS ni ejecuta el script.

## Compatibilidad verificada con Platform PR #89

La revisión del `tooling/staging/setup-staging.sh` de `2j-platform` PR #89, HEAD `bacbf43bf5c09cbeb530cfdb952be08cf5c4765e` (borrador), confirma que clona Búnker en `/opt/2j/src/bunker`, escribe el `bunker.env` generado como `/opt/2j/src/bunker/.env` y ejecuta `docker compose up -d --build` desde ese checkout. El perfil de referencia [bunker.env.example](../ops/staging/bunker.env.example) coincide con las variables del script si se configura `DOMAIN=2jfit.com`: host de staging, puerto publicado solo en loopback, invitaciones obligatorias, Coach desactivado y las tres pruebas de vínculo Platform apagadas.

El script de PR #89 usa por defecto `BUNKER_REF=agent/claude/2J-V21-BUNKER-CONSUMER` marcado en el propio archivo como **ASSUMED**. Antes de cualquier futura preparación se debe fijar una rama/commit revisado y autorizado; no se debe asumir que esa referencia existe o es apta para staging. El script también tiene una barrera separada `ACCEPT_ADMIN_WITHOUT_STAFF_AUTH=no`; este perfil no la cambia ni autoriza exponer el back-office.

## Aislamiento y usuarios sintéticos

- Usar un servidor y checkout de staging nuevos bajo `/opt/2j`; nunca copiar `data/`, `.env`, secretos, backup ni bases de producción.
- El primer arranque crea su propio `data/secret`, DB y stores locales. Mantenerlos solo en el volumen/directorio de staging y no compartirlos con Búnker productivo.
- El script de PR #89 genera secretos locales en el servidor y no recibe secretos de producción. No guardar el `.env` generado, deploy keys, claves privadas ni contraseñas en Git o en artefactos.
- El `seed` actual de PR #89 carga datos sintéticos de Platform (`@example.test`), pero **no crea cuentas Búnker**. Las cuentas Búnker de QA deben registrarse manualmente en el host de staging con identidades claramente ficticias y passkeys de prueba; no importar Excel ni cuentas existentes.
- Antes de cargar esos usuarios, confirmar que `ORIGIN`/`RP_ID` apuntan al dominio de staging y que el puerto interno solo escucha por loopback tras Caddy. No reutilizar passkeys de producción.
- `ops/staging/bunker.env.example` es referencia sin secretos; el archivo generado por el script es el que consume Compose.

## Pendientes antes de que Platform pueda ejecutar staging

1. Revisar/mergear PR #89 por los responsables; la rama estaba en Draft al inspeccionarla.
2. Sustituir el `BUNKER_REF` supuesto por un SHA/branch revisado y compatible; comprobar que contiene solo los cambios aprobados y que la integración sigue apagada.
3. Revisar las protecciones de acceso al admin y los dominios DNS/HTTPS; este trabajo no los cambia ni autoriza el despliegue.
4. Acordar la rutina de creación manual y eliminación controlada de usuarios sintéticos exclusivamente en staging.

