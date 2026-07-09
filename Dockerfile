FROM node:20-bookworm-slim

# Instala LibreOffice para conversão de DOCX para PDF no Linux
# E dependências do Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    libreoffice-writer \
    fonts-liberation \
    fonts-dejavu \
    fonts-croscore \
    wget \
    gnupg \
    ca-certificates \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia os arquivos de dependência
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante do código da aplicação
COPY . .

# Garante que as pastas necessárias existam e tenham permissão
RUN mkdir -p templates templates_temp documentos_assinados && \
    chmod -R 777 templates templates_temp documentos_assinados

EXPOSE 3001

CMD ["npm", "start"]
