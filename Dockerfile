FROM node:18-alpine As base

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci

COPY . .

EXPOSE 80

CMD [ "node", "server.js" ] 
