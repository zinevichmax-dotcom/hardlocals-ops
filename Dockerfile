FROM node:22-alpine

RUN apk add --no-cache python3 py3-pip make g++ ffmpeg curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production && apk del make g++

COPY . .

RUN mkdir -p /app/data /app/uploads

EXPOSE 4000

CMD ["node", "server.js"]
