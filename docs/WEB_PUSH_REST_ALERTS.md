# Web Push para avisos de descanso

Estado 2026-10-07: infraestructura de prueba implementada localmente; **no desplegada ni validada físicamente**. El temporizador de descanso todavía no usa esta cola. Mantener la alerta Capacitor existente para la APK.

## Arquitectura actual de esta fase

- El navegador registra una suscripción estándar con el service worker ya existente. La suscripción queda asociada a usuario y dispositivo en `db.json`; un endpoint por navegador/dispositivo. Al renovar un endpoint se cancelan sus avisos pendientes anteriores. Una cuenta puede conservar varios dispositivos.
- Solo una sesión autenticada por passkey y una petición con `Origin` idéntico al origen configurado pueden registrar suscripciones o crear/cancelar avisos. La prueba está limitada a 3 solicitudes por cuenta/suscripción cada 10 minutos. No acepta título ni contenido arbitrarios.
- `db.restAlerts` es una cola pequeña de avisos, no un segundo sistema de sincronización. El proceso Node revisa vencimientos cada segundo, guarda estados en el `db.json` persistente y recupera los que estaban en envío al reiniciar. Reintenta fallos transitorios hasta 3 veces; los endpoints revocados se eliminan. Los registros terminales se conservan hasta 7 días y los avisos vencidos más de 24 horas se descartan. Web Push tiene TTL de 5 minutos.
- El push de descanso contiene solo tipo, id opaco y ruta. El service worker fija el texto «Descanso terminado» / «Siguiente serie», etiqueta estable y `renotify:false`; un cache local de IDs evita mostrar dos veces el mismo aviso al recibir entregas duplicadas. El click vuelve a `#/workout`. Las notificaciones sociales mantienen su handler actual.
- La prueba independiente programa a +5 s el mismo aviso fijo `Descanso terminado` / `Siguiente serie` que usará el descanso real, sin alterar una alerta pendiente. Primero se solicita permiso por acción explícita del socio; un permiso denegado muestra cómo habilitarlo desde los ajustes del navegador/dispositivo y no vuelve a abrir el diálogo automáticamente.

## VAPID y recuperación

Se aceptan `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` desde el entorno; la pareja pública/privada debe configurarse junta. La clave pública se sirve por `/api/push/public-key`; la privada nunca se envía al navegador ni se registra. Para compatibilidad con instalaciones existentes, si las variables no están configuradas el servidor conserva el par persistido en `DATA/vapid.json`, creado con permisos `0600` fuera del repositorio. Ese fichero forma parte del backup de `DATA`; si se usan variables de entorno, guardar además una copia cifrada y controlada de esas variables fuera de Git.

La clave VAPID identifica las suscripciones existentes: conservar el par durante backup/restore. Rotarla invalida la clave de aplicación asociada a las suscripciones actuales; antes de rotar, planificar que cada dispositivo vuelva a suscribirse y confirmar las nuevas entregas. No pegar claves en issues, logs, handoff ni commits.

## Compatibilidad conocida

- Chrome/Edge de escritorio y Chrome Android: Push API + service worker, siempre con HTTPS, permiso concedido y conectividad; la entrega en segundo plano depende además de los límites de batería y notificaciones del sistema. La guía de [Microsoft Edge](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push) confirma el flujo PWA, permiso, servidor y service worker.
- Safari macOS: Safari 16/macOS 13 o posterior.
- iOS/iPadOS: Web Push requiere que la web esté añadida a Inicio como web app y iOS/iPadOS 16.4 o posterior; no prometer push desde una pestaña Safari normal. Referencia primaria: [Apple — Sending web push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
- Web Push es asíncrono y no garantiza el instante exacto de entrega. Sin permiso/suscripción válidos o sin conectividad, no hay aviso del sistema.

## Prueba física pendiente

Cuando la build de esta fase esté disponible en la PWA de prueba, desde el teléfono iniciar sesión con passkey, abrir Ajustes → Entrenamiento → «Activar y probar notificaciones web», conceder permiso, pulsar el botón y minimizar 2J antes de que pasen cinco segundos. Confirmar que aparece «Descanso terminado» / «Siguiente serie» con la app minimizada y, por separado, con la pantalla apagada. Revisar también el click, el permiso denegado y la suscripción después de reabrir. Esta validación **no se ha realizado**; por tanto no declarar Web Push ni el aviso de descanso resueltos. Solo tras esa prueba se conecta `/api/rest-alert` al temporizador JS existente, con el mismo `alertId` durante pausa/reanudación/cambios y cancelación del anterior; sin segundo contador.
