# Revisión de seguridad — webhooks salientes firmados

Estado: **diseño revisado; sin rutas, sin envío, sin interfaz, desactivado**. Esta revisión precede a cualquier implementación del envío. Solo se añaden primitivas puras (`api/lib/webhook-security.js`) que no se conectan a ninguna ruta.

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
| **Exposición de datos de salud** (peso, medidas, notas, fotos, salud). | Los eventos son mínimos: `workout.finished` con fecha, duración y nombre de rutina. Ningún dato de salud, peso, notas ni fotos en v1. Cualquier campo adicional exige selección explícita del socio y no se incluye por defecto. |
| **Abuso o inundación** (muchos envíos o un destino caído). | Límite por socio (30 envíos/hora). Tras 10 fallos consecutivos el webhook se desactiva solo y avisa al socio. |
| **Filtrado de secretos o PII por el registro**. | Registro de entregas solo para el propietario de la cuenta: `{at, webhookId, event, status, httpCode, durationMs}`. Sin cuerpos, sin cabeceras, sin query string de la URL, sin secreto. Tope de 500 entradas. |
| **Estado del socio y Sync V2**. | El webhook NO se guarda en el estado de miembro (`S`), por lo que no entra en Sync V2 ni en la clasificación de claves. Vive en un almacén de servidor propio, como las suscripciones push. |
| **Borrado de cuenta**. | Al borrar la cuenta se eliminan webhooks, secretos cifrados y registro de entregas (debe añadirse a `docs/ACCOUNT_ERASURE.md` antes de activar). |
| **Activación**. | Desactivado por defecto: requiere `WEBHOOKS_ENABLED=1` en el servidor y opt-in explícito por socio. |

## 3. Qué se implementa en este paso (subconjunto seguro)

- `api/lib/webhook-security.js`: validación sintáctica de URL, bloqueo de direcciones por rango, resolución y comprobación de todas las direcciones, firma y verificación con ventana de tiempo, generación de secreto y cifrado del secreto. Puras, sin red ni almacenamiento.
- Pruebas en `api/test/webhook-security.test.js`: SSRF (rangos IPv4/IPv6, mapeadas, metadatos, DNS con una dirección privada), URL (esquema, credenciales, puerto, IP literal), firma (mensaje alterado, marca fuera de ventana, secreto erróneo, comparación de longitud distinta), y que el secreto cifrado no contiene el secreto en claro.

## 4. Pendiente (no implementado; requiere decisión del propietario)

1. Rutas de alta/baja/rotación de webhooks y su interfaz de ajustes (opt-in explícito).
2. Motor de envío (conexión a la IP validada, sin redirecciones, límites, reintentos).
3. Registro de entregas y desactivación automática.
4. Inclusión en el borrado de cuenta y en `ACCOUNT_ERASURE.md`.
5. Decisión de producto: qué campos de entrenamiento se pueden enviar y si `workout.finished` es suficiente.

Hasta cerrar 1–4, los webhooks no se pueden activar.
