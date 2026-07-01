# Home Assistant add-on image. Build context is the repo root; the HA builder and
# our CI both pass BUILD_FROM via --build-arg.
ARG BUILD_FROM
FROM ${BUILD_FROM} AS base
RUN apk add --no-cache nodejs npm

# Build stage: compile TypeScript to dist/.
FROM base AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --include=dev
COPY src ./src
RUN npx tsc -p tsconfig.json

# Runtime stage: production deps + compiled output + entrypoint.
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /build/dist ./dist
COPY zwavejs-lock-manager/run.sh /run.sh
RUN chmod +x /run.sh
EXPOSE 8080
CMD ["/run.sh"]
