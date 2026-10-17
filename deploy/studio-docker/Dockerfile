FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=studio_ca \
    if [ -f /run/secrets/studio_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/studio_ca; fi; \
    npm ci --ignore-scripts --include=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY packages ./packages
COPY tsconfig.json ./
COPY deploy/studio-docker ./deploy/studio-docker
RUN node --test deploy/studio-docker/*.test.mjs \
 && mkdir -p /state /run/studio-secrets \
 && chown node:node /state && chmod 0700 /state
USER node
ENV NODE_ENV=production STUDIO_STATE_DIR=/state
EXPOSE 8787
CMD ["node", "--import", "tsx", "deploy/studio-docker/bootstrap.mjs"]
