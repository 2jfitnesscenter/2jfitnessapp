# Multi-stage: build the React app, then serve it with nginx.
# Self-hosters never need Node locally — `docker compose up` builds everything.
#
# --platform=$BUILDPLATFORM pins the build stage to the host's native arch even when
# cross-building for other targets (e.g. amd64 host building an arm64 image). The build
# output (static JS/CSS/HTML) is arch-independent, so there's no reason to run it under
# QEMU — and QEMU-emulated npm installs are known to corrupt esbuild/rollup's platform-
# specific native binaries, which is what breaks `vite build` with unrelated-looking
# module-resolution errors.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
# VITE_BASE: public path prefix of this build. Unset/empty keeps today's '/' (byte-identical build).
# The 2J Home hub builds with --build-arg VITE_BASE=/bunker/ (its proxy strips the prefix before nginx).
ARG VITE_BASE=
ENV VITE_BASE=$VITE_BASE
COPY frontend/ ./
RUN npm run build
# nginx serves a matching .gz file directly through gzip_static, avoiding runtime compression
# work and guaranteeing JavaScript/CSS ship compressed even under sustained kiosk traffic.
RUN find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.json' -o -name '*.svg' -o -name '*.html' \) -exec gzip -9 -k {} \;

FROM nginx:alpine
# Rendered at container start by the official nginx entrypoint (envsubst over /etc/nginx/templates/*.template ->
# /etc/nginx/conf.d/default.conf). Only ${NAME} references to defined env vars are substituted; nginx's own $vars are untouched.
# BUNKER_API_UPSTREAM is host:port of the backend for /api/. Default api:3000 = standalone compose; the 2J hub overrides it.
ENV BUNKER_API_UPSTREAM=api:3000
COPY web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
# exercise media (img/gif) is mounted at runtime from the media volume
