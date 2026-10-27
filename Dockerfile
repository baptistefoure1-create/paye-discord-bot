FROM node:22-alpine

WORKDIR /app

# Aucun package-lock n'est fourni dans ce prototype : npm install est donc volontaire.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production

# Bot Discord : aucun port HTTP/public n'est nécessaire.
CMD ["npm", "start"]
