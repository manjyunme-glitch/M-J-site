FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist-client ./dist-client
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/build-info.json ./build-info.json
COPY --from=build /app/seed-assets ./seed-assets
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /app/data /app/uploads && chown node:node /app /app/data /app/uploads
EXPOSE 1314
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist-server/index.js"]
