# syntax=docker/dockerfile:1
# Multi-stage build: compile the browser collector bundle + server TypeScript, then ship a
# small runtime image with production deps only. See deploy/README.md for how to run it.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Playwright is a devDependency used only by tests; skip its browser download in the image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
# The server locates public/ relative to package.json (src/server/runtime/paths.ts).
ENV PLZBOT_ROOT=/app \
    PLZBOT_HOST=0.0.0.0 \
    PLZBOT_MODE=tls \
    PLZBOT_PORT=443 \
    PLZBOT_HTTP_PORT=80 \
    PLZBOT_TLS_CERT=/certs/fullchain.pem \
    PLZBOT_TLS_KEY=/certs/privkey.pem \
    PLZBOT_ACME_WEBROOT=/acme-webroot
EXPOSE 80 443 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "const m=process.env.PLZBOT_MODE==='http';const p=process.env.PLZBOT_PORT;require(m?'http':'https').get({host:'127.0.0.1',port:p,path:'/healthz',rejectUnauthorized:false},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/src/server/index.js"]
