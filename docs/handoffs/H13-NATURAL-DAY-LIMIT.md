# Handoff — H13 límite diario natural (A28)

- Repo: `2jfitnessapp` (Búnker). Base observada: `origin/main` `df1cab3acb4caee7dbf7c85448173b28e3f6420d`.
- Hallazgo: el límite implementado contaba aprobaciones en una ventana móvil de 24 horas (`countSince(now - 24h)`), mientras A28 fija 20 emisiones por día y el encargo precisa día natural.
- Corrección propuesta: contar eventos `assist_approved` por emisor y fecha local `Atlantic/Canary`; el ledger sigue siendo append-only/HMAC y cada emisor conserva una cuota independiente. Denegaciones no consumen cuota.
- Pruebas añadidas/ajustadas: 20 en una fecha, 21.ª rechazada; nueva cuota dos minutos después de medianoche local; otra fecha independiente durante el cambio de hora de primavera. Reloj de test fijo.
- Evolución Home/Búnker: endpoint NO implementado. El contrato existente sigue siendo propuesta y exige política de consentimiento/visibilidad antes de exponer runtime. El consentimiento de Coach/IA tiene otro propósito y no se reutiliza.
- Este cambio es Level 2 (seguridad/identidad). Requiere una revisión independiente única del SHA final antes de cualquier merge.
- No se desplegó, no se ejecutaron migraciones y no se accedió a producción ni a secretos.