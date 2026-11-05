FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go index.html ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /molino .

FROM alpine:3.20
RUN apk add --no-cache wget && adduser -D -H molino
USER molino
COPY --from=build /molino /molino
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/molino"]
