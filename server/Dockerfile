FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
# Install exactly what package-lock.json pins. --ignore-scripts is needed
# because npm ignores better-sqlite3's "gypfile": false when installing from a
# lockfile and tries to run node-gyp, which needs Python and build tools the
# slim image doesn't have. better-sqlite3 ships prebuilt binaries, and no
# other package the image uses has an install script.
RUN npm ci --workspace server --include-workspace-root=false --ignore-scripts
COPY server/tsconfig.json server/
COPY server/src server/src
RUN npm run build --prefix server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --workspace server --omit=dev --ignore-scripts
COPY --from=build /app/server/dist server/dist
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "dist/index.js"]
