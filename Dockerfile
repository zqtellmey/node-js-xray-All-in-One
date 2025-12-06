FROM node:alpine

WORKDIR /app

COPY . .

# 暴露端口：3000(订阅), 8000(Xray直连)
EXPOSE 3000/tcp 8000/tcp

# 安装基础依赖: curl用于下载, unzip用于解压Xray, bash用于脚本
RUN apk update && \
    apk add --no-cache curl unzip bash coreutils && \
    npm install

CMD ["node", "index.js"]
