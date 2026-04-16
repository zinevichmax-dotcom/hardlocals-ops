FROM node:22-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production && apk del python3 make g++

COPY . .

RUN mkdir -p /app/data /app/uploads

EXPOSE 4000

CMD ["node", "server.js"]
