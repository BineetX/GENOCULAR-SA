# ---------- build stage: compile the Vite app ----------
FROM node:24-alpine AS build
WORKDIR /app

# 1) copy ONLY package files first for better cache
COPY app/package*.json ./app/

# 2) install deps inside the image
WORKDIR /app/app
RUN npm ci

# 3) copy the rest of the app (without node_modules because of .dockerignore)
COPY app/ .

# 4) set Vite env (overridable via build args)
ARG VITE_API_BASE=/api
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_MEASUREMENT_ID
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY}
ENV VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN}
ENV VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID}
ENV VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID}
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=${VITE_FIREBASE_MESSAGING_SENDER_ID}
ENV VITE_FIREBASE_MEASUREMENT_ID=${VITE_FIREBASE_MEASUREMENT_ID}

# 5) build the static site
RUN npm run build

# ---------- runtime stage: serve with your server.js ----------
FROM alpine:3.24
RUN apk add --no-cache libstdc++ ca-certificates \
 && addgroup -g 1000 node && adduser -D -u 1000 -G node node
# Static serving needs Node, not the vulnerable package-manager dependency tree.
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app

# your simple static server
COPY server.js .

# built assets from the build stage
COPY --from=build /app/app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node","server.js"]
