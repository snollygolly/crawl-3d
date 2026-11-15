# The toolchain the engine was first built and tested with:
# Ubuntu 24.04's Emscripten 3.1.6 + clang 15, plus Crawl's native build deps.
FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential git python3 nodejs bison flex pkg-config \
      libncurses-dev libpng-dev zlib1g-dev ca-certificates \
      emscripten \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
