FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p data public/uploads
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:3001/health || exit 1
CMD ["node", "server.js"]
