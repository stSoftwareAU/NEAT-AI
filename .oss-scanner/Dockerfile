# OSS Scanner build image (https://github.com/anthropics/oss-scanner).
# The scanner builds this with the repository as the build context, then runs
# its audit offline, so every dependency the library and its tests need is
# fetched here. CI uses setup-deno `v2.x`; this pins the 2.x release the image
# was verified against.
FROM denoland/deno:debian-2.9.7

# bash, perl (`shasum`), git, curl and jq are what build.sh and quality.sh use.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates bash curl git jq perl \
    && rm -rf /var/lib/apt/lists/*

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

# The WASM activation bundle is vendored in wasm_activation/pkg (pinned by
# deno.json neatCore.rev and SHA-256). `--verify-only` checks it offline
# without contacting NEAT-AI-core. Then fetch every jsr/npm module against the
# lockfile and type-check the whole tree (src, test, bench) so the offline
# audit has a warm DENO_DIR.
RUN ./build.sh --verify-only \
    && deno install --frozen \
    && deno check

# Smoke-run a small slice of the suite; a failure warns rather than aborting
# the build. The full suite is `./quality.sh` (or the `deno test` line below
# with no file arguments). The optional GPU Discovery library and native
# NEAT-AI-core library are not built; tests that need them skip.
RUN (deno test --allow-read --allow-write --allow-net --allow-env \
      --allow-run --allow-ffi --preload test/_preload.ts --config ./deno.json \
      test/security/CreatureJsonInjection.ts \
      test/creature/NeuronUuidStability.ts \
      test/creature/SemanticVersionStability.ts \
      test/validate/CreatureValidateConformance.ts \
      test/creature/GoldenMetadataRoundTrip.ts \
      || echo "WARNING: smoke tests reported failures")
