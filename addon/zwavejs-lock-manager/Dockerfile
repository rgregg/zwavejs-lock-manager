ARG BUILD_FROM
FROM $BUILD_FROM AS base

# HA base images are Alpine; install Node 22 + npm
RUN apk add --no-cache nodejs npm

FROM base AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --include=dev
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /build/dist ./dist
COPY addon/zwavejs-lock-manager/run.sh /run.sh
RUN chmod +x /run.sh
EXPOSE 8080
CMD ["/run.sh"]
