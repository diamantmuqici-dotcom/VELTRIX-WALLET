# Development signing key

`veltrix-dev.jks` is a **public, development-only** key used to sign the
VELTRIX Wallet simulator APK so it can be installed for testing.

- Store type: PKCS12 · alias `veltrix` · store/key password `veltrix-dev`
- Anyone can sign an APK with this key. Do **not** use it for a store listing
  or for any app that handles real data. Generate your own release key instead:

```bash
keytool -genkeypair -keystore my-release.jks -alias release -keyalg RSA -keysize 3072 -validity 10950
VELTRIX_KEYSTORE=my-release.jks VELTRIX_KEY_ALIAS=release \
VELTRIX_STORE_PASS=... VELTRIX_KEY_PASS=... tools/build-apk.sh
```
