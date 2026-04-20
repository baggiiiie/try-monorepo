FROM golang:1.25-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /expense ./cmd/expense/

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /expense /usr/local/bin/expense

RUN adduser -D nonroot && mkdir -p /data && chown nonroot:nonroot /data
USER nonroot
VOLUME /data

EXPOSE 8080

ENTRYPOINT ["expense"]
CMD ["serve", "--db", "/data/expense.db", "--config", "/data/preferences.json"]
