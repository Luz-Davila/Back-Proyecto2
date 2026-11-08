# ProfeLink - API NestJS (Node.js 22)
# Etapa 1: instalar dependencias y compilar TypeScript.
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# npm ci utiliza las versiones exactas de package-lock.json.
COPY package.json package-lock.json ./
RUN npm ci

# Copiar el codigo fuente (el .dockerignore excluye secretos y artefactos).
COPY . .

# Generar dist/ con el JavaScript de produccion.
RUN npm run build

# Retirar herramientas de desarrollo de la imagen final.
RUN npm prune --omit=dev

# Etapa 2: imagen de ejecucion, sin compilador TypeScript.
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Ejecutar como usuario sin privilegios.
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/package-lock.json ./package-lock.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000

# La imagen slim no trae wget, así que el chequeo usa Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

# Mantener el script del proyecto, que puede configurar OpenTelemetry.
# Verificar que package.json incluya start:prod y que apunte a la ruta compilada.
CMD ["npm", "run", "start:prod"]
