# syntax=docker/dockerfile:1
#
# bot-service image. Build from the repository root (the Cargo workspace):
#
#   docker build -f crates/bot-service/Dockerfile -t bot-service .
#   docker run --rm -p 7700:7700 --cpus=2 bot-service
#
# BOT_WORKERS defaults to the CPUs the container may use (cgroup quota), so
# `--cpus` / compose `cpus:` sets the search concurrency.

ARG RUST_VERSION=1.99

FROM rust:${RUST_VERSION}-slim-bookworm AS build
WORKDIR /src
# Only the Cargo workspace is needed; rust-toolchain.toml is left out on
# purpose so the image's toolchain is used as is (no wasm target download).
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p bot-service --bin bot-service \
 && install -D target/release/bot-service /out/bot-service

# glibc + libgcc only, no shell; runs as uid 65532.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /out/bot-service /usr/local/bin/bot-service
ENV BOT_BIND=0.0.0.0:7700 \
    BOT_LOG=info \
    BOT_LOG_FORMAT=json
EXPOSE 7700
USER nonroot
# Docker sends SIGTERM on stop: the service stops accepting connections,
# finishes open requests and exits (allow ~2 s: the longest search is 500 ms).
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/bot-service"]
