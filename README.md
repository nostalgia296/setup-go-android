# Setup Go Android Environment

GitHub Action to setup Go and Android NDK for cross-compilation to Android targets.

## Usage

```yaml
- uses: nostalgia296/setup-go-android@v3
  with:
    ndk-version: 'android-ndk-r26b'
    go-version: '1.26.5'
    abi: 'arm64-v8a'
    gitrepo: 'https://github.com/esengine/deepseek-reasonix.git'
    branch: 'main-v2'
    cmd: 'go build ./cmd/reasonix'
    min-sdk: '34'
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `ndk-version` | yes | - | Android NDK version |
| `go-version` | yes | - | Go version |
| `abi` | yes | `arm64-v8a` | Target ABI |
| `min-sdk` | no | `21` | Minimum Android SDK |

## Outputs

| Output | Description |
|--------|-------------|
| `ndk-path` | Path to installed NDK |
| `cc-path` | Path to C compiler |
| `goarch` | Go architecture target |

## Supported ABIs

- `arm64-v8a`
- `armeabi-v7a`
- `x86_64`
- `x86`
