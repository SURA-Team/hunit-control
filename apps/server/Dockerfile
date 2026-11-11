# syntax=docker/dockerfile:1

# Imagem do servidor do HUNIT Control (API + automação no mesmo processo).
# O contexto do build é a RAIZ do repositório: docker compose build / docker build -f apps/server/Dockerfile .
#
# A imagem oficial do Playwright já traz o Chromium, as dependências de sistema e o Node.js LTS.
# A versão abaixo DEVE ser igual à do pacote `playwright` em apps/server/package.json; se
# divergirem, o Chromium da imagem não é o que a biblioteca espera e o navegador não abre.
# O teste apps/server/test/unit/docker-image-version.test.ts confere isso.
ARG PLAYWRIGHT_VERSION=1.65.0

# ---------- build: instala tudo, compila e separa só o que a produção precisa ----------
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS build
WORKDIR /app

# A versão do pnpm vem do campo "packageManager" do package.json (fonte única).
COPY package.json ./
RUN npm install --global "$(node -p "require('./package.json').packageManager.split('+')[0]")"

# Só os manifestos primeiro: a camada de dependências fica em cache enquanto eles não mudam.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/server/ apps/server/
RUN pnpm --filter "@hunit/server..." run build

# Copia o servidor compilado e somente as dependências de produção para uma pasta isolada.
RUN pnpm --filter=@hunit/server --prod deploy /prod/server

# ---------- runtime: servidor compilado + dependências de produção, sem root ----------
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS runtime
ENV NODE_ENV=production
WORKDIR /app

# O código fica com o root e somente leitura para o processo; só a pasta de evidências é gravável.
COPY --from=build /prod/server ./
RUN mkdir -p /data/evidence && chown pwuser:pwuser /data/evidence

USER pwuser
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
