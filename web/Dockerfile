FROM node:22-slim AS build
WORKDIR /app
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Drop root: the standalone server only reads its own bundle at runtime, so
# handing /app to the unprivileged `node` user is enough.
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]
