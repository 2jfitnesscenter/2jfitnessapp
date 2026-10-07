# QA física — aviso Android al terminar el descanso

Baseline de app: producción `831f691ca1b30a9c252bb60e8336d93edf448114` más la release local integrada. Usar un entrenamiento de prueba y un descanso corto; no cambiar el temporizador de Workout ni probar desde Bunker.

El aviso esperado es **«Descanso terminado»** / **«Siguiente serie»**. No debe incluir usuario, ejercicio, carga ni otros datos del entrenamiento.

1. **App abierta:** activar «Aviso de fin de descanso», iniciar un descanso y esperar al final. Debe llegar un solo aviso y el temporizador debe terminar normalmente.
2. **Background:** iniciar otro descanso, llevar 2J al fondo y esperar. Debe llegar el aviso local al final.
3. **Pantalla apagada/Doze:** iniciar un descanso corto, apagar la pantalla y esperar. Verificar el aviso; anotar si llegó exacto o con retraso cuando el acceso de alarma exacta no esté permitido.
4. **Pausa/reanudación:** iniciar, pausar antes del final y esperar más allá de la hora anterior: no debe avisar. Reanudar y confirmar que avisa solo en la nueva hora final.
5. **Cancelación:** iniciar y cancelar antes del final; no debe quedar ni aparecer una notificación.
6. **Dos descansos consecutivos:** iniciar uno y sustituirlo por otro antes de que termine; solo debe llegar la alerta del segundo.
7. **Permiso denegado:** denegar notificaciones y repetir un descanso. El entrenamiento y el temporizador deben seguir funcionando sin error ni prompts repetidos automáticamente.
8. **Permiso concedido posteriormente:** habilitar notificaciones desde Ajustes de Android, activar de nuevo el ajuste en 2J y confirmar el aviso.

Fuera de Android, confirmar que la PWA mantiene el aviso existente. Bunker no debe programar esta notificación. No ejecutar el escenario con usuarios ni datos de entrenamiento reales.
