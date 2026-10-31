# Handshake: Next.js standalone server + headless Chromium for the review agent.
FROM mcr.microsoft.com/playwright:v1.64.1-noble AS build
WORKDIR /app
# better-sqlite3 compiles from source when no prebuilt matches this Node version.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_PAYPAL_CLIENT_ID
ENV NEXT_PUBLIC_PAYPAL_CLIENT_ID=$NEXT_PUBLIC_PAYPAL_CLIENT_ID NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=10000 HOSTNAME=0.0.0.0 HANDSHAKE_DB=/data/handshake.db
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p /data && chown -R pwuser /data /app
USER pwuser
EXPOSE 10000
CMD ["node", "server.js"]
