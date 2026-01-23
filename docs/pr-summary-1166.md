## Summary

Added automatic wasm-pack version checking and updating to the WASM activation build script. Similar to how `deno outdated --update --latest` works for Deno packages, the build script now automatically checks for newer versions of wasm-pack on crates.io and updates it if a newer version is available.

**Changes made:**
- Updated `wasm_activation/build.sh` to include a `check_and_update_wasm_pack()` function
- The function queries crates.io to determine the latest wasm-pack version
- Compares the installed version with the latest version
- Automatically updates wasm-pack using `cargo install wasm-pack --force` when outdated
- If wasm-pack is not installed, it installs the latest version automatically

**Behaviour:**
- When wasm-pack is outdated: Updates to latest version before building
- When wasm-pack is up-to-date: Displays "wasm-pack is already up to date." and proceeds with build
- When wasm-pack is not installed: Installs the latest version
- When version check fails (e.g., offline): Proceeds with existing installation

## Evidence

Unable to generate screenshot: This is a CLI-only tool with no visual interface.

**Console output demonstrating the automatic update from 0.13.1 to 0.14.0:**

```
Building WASM activation module...
Checking for wasm-pack updates...
Current wasm-pack version: 0.13.1
Latest wasm-pack version:  0.14.0
Updating wasm-pack from 0.13.1 to 0.14.0...
...
wasm-pack updated successfully.
Using wasm-pack for build...
```

**Console output when already up-to-date:**

```
Building WASM activation module...
Checking for wasm-pack updates...
Current wasm-pack version: 0.14.0
Latest wasm-pack version:  0.14.0
wasm-pack is already up to date.
Using wasm-pack for build...
```

## Test Plan

- Manually tested the build script with wasm-pack 0.13.1 installed
- Verified it automatically updated to 0.14.0
- Verified subsequent runs correctly detect wasm-pack is already up-to-date
- Verified WASM module builds successfully after update
- All existing tests pass via `./quality.sh` (1765 passed, 0 failed)
