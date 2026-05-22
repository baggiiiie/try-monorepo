FROM node:22-alpine AS web-builder

RUN corepack enable
WORKDIR /web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM golang:1.25-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web-builder /web/dist ./web/dist
RUN CGO_ENABLED=0 go build -o /expense ./cmd/expense/

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /expense /usr/local/bin/expense

RUN adduser -D nonroot && mkdir -p /data && chown nonroot:nonroot /data
USER nonroot
VOLUME /data

EXPOSE 8080

ENTRYPOINT ["expense"]
CMD ["serve", "--db", "/data/expense.db", "--config", "/data/preferences.json", "--secret-file", "/data/secret.json"]
