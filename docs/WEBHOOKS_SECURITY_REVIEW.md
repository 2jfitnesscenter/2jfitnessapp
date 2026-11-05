# Revisión de seguridad — webhooks salientes firmados

Estado: **implementado en API, desactivado por defecto** (`WEBHOOKS_ENABLED=1` en el servidor y alta explícita por el socio). Sin interfaz de ajustes todavía: la gestión es por API. Esta revisión precede a la implementación; las decisiones de §2 y §5 son las que se aplican.

## 1. Alcance

Un socio puede registrar, en su propia cuenta, una URL HTTPS a la que 2J envía eventos firmados (por ejemplo, «entrenamiento terminado») para automatizaciones propias (Home Assistant, n8n, ntfy, Node-RED). No es un canal de datos de salud. Fuera de alcance: integraciones con terceros que requieran OAuth, reenvío de datos de otros socios, y cualquier receptor que no sea elegido por el propio socio.

## 2. Amenazas y decisiones

| Amenaza | Decisión |
|---|---|
| **SSRF**: la URL apunta a la red interna del servidor, loopback, enlace local o metadatos de nube (169.254.169.254, fd00:ec2::254). | Solo `https:`. Sin credenciales en la URL, puerto 443. Antes de conectar se resuelven **todas** las direcciones (`dns.lookup` con `all: true`) y si **una** está bloqueada se rechaza el destino. La conexión usa la IP validada (no se vuelve a resolver el nombre), para impedir DNS rebinding. Bloqueados: 0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.168/16, 198.18/15, 224/4, 240/4; IPv6 `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, y mapeadas IPv4 (`::ffff:`) con cualquiera de los rangos anteriores. |
| **Redirecciones** a otra URL (p. ej. una interna). | No se siguen redirecciones. Cualquier 3xx cuenta como fallo. |
| **Respuestas lentas o enormes** (agotamiento de recursos). | Tiempo máximo 5 s por envío; cuerpo de petición ≤ 16 KB; respuesta leída hasta 4 KB y descartada; el contenido de la respuesta nunca se guarda ni se muestra. |
| **Suplantación del emisor / manipulación**. | Firma HMAC-SHA256 sobre `timestamp + "." + cuerpo`, cabecera `2J-Signature: t=<unix>,v1=<hex>`. El receptor rechaza marcas fuera de una ventana de ±300 s (anti-repetición) y compara con tiempo constante. Cada evento lleva `eventId` único para idempotencia. |
| **Secreto de firma en claro** o robado de una copia de seguridad. | El secreto se genera en el servidor (32 bytes, prefijo `whsec_`) y **se muestra una sola vez**. Un hash no sirve para firmar, así que se guarda **cifrado** con AES-256-GCM mediante `api/lib/crypto.js` con un `info` propio (`webhook-secret-v1`). Nunca en texto plano, ni en logs, ni en el estado de miembro. |
| **Exposición de datos de salud** (peso, medidas, notas, fotos, salud). | Los eventos son mínimos: solo tipo, id de evento, marca temporal y fecha (§5). Ningún dato de salud, peso, notas, nombres ni fotos. Cualquier campo adicional exige una nueva decisión del propietario. |
| **Abuso o inundación** (muchos envíos o un destino caído). | Límite por endpoint (30 intentos/hora). Tras 10 fallos consecutivos el webhook se desactiva solo y avisa al socio. |
| **Filtrado de secretos o PII por el registro**. | Registro de entregas solo para el propietario de la cuenta: `{at, webhookId, event, eventId, status, httpCode, durationMs, attempt}`. Sin cuerpos, sin cabeceras, sin query string de la URL, sin secreto. Tope de 500 entradas. |
| **Estado del socio y Sync V2**. | El webhook NO se guarda en el estado de miembro (`S`), por lo que no entra en Sync V2 ni en la clasificación de claves. Vive en un almacén de servidor propio, como las suscripciones push. |
| **Borrado de cuenta**. | Al borrar la cuenta se eliminan webhooks, secretos cifrados y registro de entregas (incluido en `docs/ACCOUNT_ERASURE.md`). |
| **Activación**. | Desactivado por defecto: requiere `WEBHOOKS_ENABLED=1` en el servidor y opt-in explícito por socio. |

## 3. Primitivas (PR #98) y lo implementado después

- `api/lib/webhook-security.js` (PR #98): validación sintáctica de URL, bloqueo de direcciones por rango, comprobación de todas las direcciones, firma y verificación con ventana de tiempo, generación y cifrado del secreto. Pruebas en `api/test/webhook-security.test.js`.
- Implementación (esta fase):
  - `api/webhooks/events.js`: lista de eventos, constructor del cuerpo (única fuente de campos) y detección de eventos nuevos entre dos estados guardados.
  - `api/webhooks/store.js`: `webhooks.json` en `DATA_DIR` (endpoints, secreto cifrado, registro de entregas, claves de deduplicación). Fuera del estado de socio y de Sync V2.
  - `api/webhooks/delivery.js`: envío firmado por HTTPS: IP validada y fijada al conectar (`lookup` fijado; ninguna segunda resolución), sin redirecciones, 5 s de tiempo máximo, cuerpo ≤ 16 KB, respuesta leída ≤ 4 KB y descartada.
  - `api/webhooks/service.js`: motor fuera de la petición: hasta 4 intentos (esperas 30 s, 2 min, 10 min) solo ante timeout, error de red, 408, 429 o 5xx; límite de 30 intentos por endpoint y hora; desactivación automática tras 10 fallos finales seguidos.
  - `api/webhooks/routes.js`: `GET /api/webhooks`, `POST /api/webhooks`, `POST /api/webhooks/update`, `POST /api/webhooks/rotate`, `POST /api/webhooks/delete`. Misma autenticación que las rutas de socio (cookie de sesión de la propia cuenta). Con el servidor apagado responden 403 `webhooks_disabled`.
  - Enganche: `setStateWriteHook` en `api/lib/state-store.js`, llamado tras cada escritura correcta del estado del socio; el motor solo lee días y ids.
  - Borrado y exportación: `api/lib/account-erasure.js` elimina endpoints, secretos cifrados, registro y claves de deduplicación del socio; la exportación incluye solo host y estado, nunca secreto ni ruta de URL.
- Pruebas: `api/test/webhooks.test.js` (SSRF y fijación DNS, redirecciones, tiempos y tamaños, firma y ventana de repetición, lista de campos, detección de eventos, reintentos, límites, desactivación, secreto en reposo, borrado), `api/test/webhooks-http.test.js` (desactivado por defecto, anónimos, otro socio, secreto mostrado una vez, flujo de guardado de estado → registro sin cuerpo), y `api/test/account-erasure.test.js` ampliado con endpoints y registro de dos socios.

## 5. Campos de evento aprobados por el propietario (fijos en esta fase)

Tipos permitidos: `workout.finished` y `weighin.recorded`. Cada cuerpo contiene **solo**:

```json
{ "id": "evt_…", "type": "workout.finished", "created": "2026-11-05T12:00:00.000Z", "data": { "date": "2026-11-05" } }
```

- `id`: identificador aleatorio del evento (idempotencia del receptor).
- `type`: uno de los dos tipos anteriores.
- `created`: marca temporal del evento (ISO 8601).
- `data.date`: día (AAAA-MM-DD) del entreno o de la pesada.

No se envían pesos, valores de salud, nombres de ejercicios o rutinas, notas, duraciones, fotos ni ningún identificador del socio. Ampliar esta lista exige una nueva decisión del propietario; no añadir campos sin ella.

Reglas de disparo: solo registros nuevos o cambiados y de los últimos 3 días; el primer guardado de una cuenta o una restauración no emiten nada; un mismo registro no se emite dos veces. Un cambio de pesada del mismo día cuenta como «registrada» de nuevo. Los cambios que hace un entrenador o administrador sobre el estado de un socio pueden generar `weighin.recorded` si añaden una pesada: es un efecto conocido.

## 6. Pendiente

1. Interfaz de ajustes (alta, baja, rotación, opt-in visible). Hoy solo API.
2. Aviso al socio cuando su endpoint se desactiva por fallos. Hoy el estado (`disabledReason: "failures"`) se ve en `GET /api/webhooks`; no se envía notificación.
3. Cola de reintentos en memoria: un reinicio del servidor descarta los reintentos pendientes.
4. Decisión de producto sobre ampliar campos o eventos (§5).

## 4. Pendientes de la revisión original

Ver §6. Los puntos 1–4 de la revisión original (rutas, motor, registro y desactivación, borrado de cuenta) están implementados; el punto 5 queda fijado en §5.
