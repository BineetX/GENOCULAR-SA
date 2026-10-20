FROM golang:1.25-alpine AS build
ARG MC_VERSION=RELEASE.2025-04-16T18-13-26Z
RUN apk add --no-cache git ca-certificates \
 && CGO_ENABLED=0 GOBIN=/out go install github.com/minio/mc@${MC_VERSION}

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/mc /usr/local/bin/mc
ENTRYPOINT ["/usr/local/bin/mc"]
