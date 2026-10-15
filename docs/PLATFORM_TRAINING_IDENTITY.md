# Ownership de identidad y futura integración Platform ↔ Training

Estado: decisión de dominio documentada para preparar integración local; no implica una integración ni una migración activa.

## Fuentes de identidad

| Dominio | Propietario | Identificador y datos que conserva |
|---|---|---|
| Persona global | 2J Platform | `personId`, perfil global, membresías y derechos/entitlements |
| Cuenta de Training | 2J Training | `uid` interno estable, passkeys/sesiones y datos de rutinas, entrenamientos, programas, progresión e historial |

La relación futura es `personId → Training uid`. Platform puede resolver o mantener ese vínculo; Training no debe asumir que `personId` sustituye `uid`. La identidad humana persiste aunque caduque una cuota o un derecho.

En la preparación de Training, `db.users[].personId` es un campo opcional de metadatos. No se autogenera, no se deriva de email/username, no inicia sesión, no autoriza operaciones y no participa en Sync. Los usuarios existentes sin el campo siguen siendo válidos. No se renombra `state-<uid>.json` ni se migran chat, friends, Bunker u otros almacenes.

## Decisión recomendada para passkeys

- Mantener la experiencia final integrada bajo `https://app.2jfitnesscenter.com` cuando la solución técnica lo permita.
- Conservar el `RP_ID` compatible con las passkeys registradas actualmente. Cambiar el RP ID rompe la validación de credenciales existentes; no se debe hacer como efecto lateral de una reorganización de URLs.
- El template de producción versionado `.env.production.example` declara `ORIGIN=https://app.2jfitnesscenter.com` y `RP_ID=app.2jfitnesscenter.com`. No se leyó el `.env` del servidor, por lo que el valor live no se afirma como inspeccionado en esta tarea.
- Desarrollo local mantiene el origen/RP ID local (`http://localhost:8080` / `localhost`) según la configuración existente; las passkeys locales son distintas de las de producción.

No se cambió `RP_ID`, `ORIGIN`, cookies, passkeys, WebAuthn ni el bridge de proofs Platform. No activar ni ampliar flags de proofs por documentar esta decisión.

## Release e integración

- Producción confirmada por el propietario para este checkpoint: `aff0a694d37d2c8fbef298ffd6abcf4ab358f186`.
- `main` puede avanzar por su línea de integración y no es sinónimo del release desplegado. No desplegar `main` wholesale ni inferir la base productiva a partir de worktrees antiguos.
- Cada release debe partir del commit exacto desplegado, incorporar cambios selectivamente y usar el baseline/artifact contractual de ese release.
- La integración Platform ↔ Training se ensaya primero en local, en worktrees aislados cuya base canónica se elige explícitamente al iniciar esa integración. No se reconcilian a la fuerza `main` y producción.
