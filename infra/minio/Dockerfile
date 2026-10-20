FROM golang:1.25-alpine AS build
ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
RUN apk add --no-cache git ca-certificates \
 && CGO_ENABLED=0 GOBIN=/out go install github.com/minio/minio@${MINIO_VERSION}

FROM alpine:3.22
RUN apk add --no-cache ca-certificates curl su-exec \
 && addgroup -S -g 1000 minio \
 && adduser -S -D -H -u 1000 -G minio minio
COPY --from=build /out/minio /usr/local/bin/minio
COPY entrypoint.sh /usr/local/bin/genocular-minio-entrypoint
EXPOSE 9000 9001
ENTRYPOINT ["/usr/local/bin/genocular-minio-entrypoint"]
