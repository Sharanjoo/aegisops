# syntax=docker/dockerfile:1.7

FROM golang:1.27.0-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./

RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux \
    go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/cluster-agent \
    ./cmd/agent

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder \
    --chown=nonroot:nonroot \
    /out/cluster-agent \
    /cluster-agent

USER 65532:65532

ENTRYPOINT ["/cluster-agent"]