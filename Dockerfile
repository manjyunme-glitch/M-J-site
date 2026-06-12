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
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node
EXPOSE 1314
CMD ["node", "dist-server/index.js"]
