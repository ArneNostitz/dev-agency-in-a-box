# Standalone watchdog — tiny, stable, independent of the agency image.
FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs ./
ENV PORT=3000
EXPOSE 3000
# Runs as a non-root user (the SDK refuses bypassPermissions as root).
USER node
CMD ["node", "index.mjs"]
