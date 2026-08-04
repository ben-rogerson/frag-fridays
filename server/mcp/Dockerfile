# Control-plane container: talks to the host docker daemon via the mounted
# socket, so it needs the docker + compose CLIs (compose is what swap_mod
# shells out to - dockerode can't drive compose, hence CLI for everything).
FROM node:24-alpine
RUN apk add --no-cache docker-cli docker-cli-compose
WORKDIR /app
COPY package.json .
# no lockfile ships to the box - deps are exact-pinned in package.json
RUN npm install --omit=dev
COPY src ./src
EXPOSE 27017
CMD ["node", "src/index.js"]
