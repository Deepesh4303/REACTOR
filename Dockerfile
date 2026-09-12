# Multi-stage Dockerfile for Chain Reaction Rust server
FROM rust:1.80-slim as builder

WORKDIR /usr/src/app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY public ./public

RUN cargo build --release

# Final runtime image
FROM debian:bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/src/app/target/release/server /app/server
COPY --from=builder /usr/src/app/public /app/public

ENV PORT=3000
EXPOSE 3000

CMD ["/app/server"]
