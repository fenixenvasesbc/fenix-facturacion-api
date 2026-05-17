FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm@9.15.4

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm prisma generate
RUN pnpm build

RUN mkdir -p uploads

EXPOSE 3000

CMD ["node", "dist/src/main.js"]
