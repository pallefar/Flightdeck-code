FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/studio-drafts ./packages/studio-drafts
RUN --mount=type=secret,id=studio_ca \
    if [ -f /run/secrets/studio_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/studio_ca; fi; \
    npm ci --ignore-scripts --include=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY packages ./packages
COPY src/process-studio/plan.ts src/process-studio/roi.ts src/process-studio/contracts.ts ./src/process-studio/
COPY tsconfig.json .gitignore .dockerignore ./
COPY deploy/studio-docker ./deploy/studio-docker
RUN npm --prefix packages/studio-drafts run build
RUN node --test deploy/studio-docker/*.test.mjs \
 && mkdir -p /state /run/studio-secrets \
 && chown node:node /state && chmod 0700 /state
USER node
ENV NODE_ENV=production STUDIO_STATE_DIR=/state
EXPOSE 8787
CMD ["node", "--import", "tsx", "deploy/studio-docker/bootstrap.mjs"]
