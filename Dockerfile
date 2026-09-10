# VIGIL — zero-dependency Node app. Runs anywhere Docker runs.
FROM node:20-slim
WORKDIR /app
# No npm dependencies to install for the default (JSON) store. If you enable the
# Postgres adapter (STORAGE=pg), uncomment the next two lines:
# COPY package.json ./
# RUN npm install pg
COPY . .
ENV NODE_ENV=production
# The platform sets PORT; the app reads process.env.PORT (defaults to 8787).
EXPOSE 8787
CMD ["node", "src/server.js"]
