# Android Release CI/CD

This project publishes a signed Android APK from GitHub Actions whenever `main`
receives a push. The workflow builds the Vite app, syncs Capacitor, signs the
release APK, creates a GitHub prerelease, and optionally sends a LINE download
link.

## GitHub Secrets

Add these repository secrets in GitHub:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_TARGET_ID`

LINE secrets are optional. If they are missing, the APK release still completes
and the notification step is skipped.

## Create The Android Keystore

Run this once on your machine, then keep the generated keystore outside the repo.

```powershell
keytool -genkeypair -v `
  -keystore release.keystore `
  -alias twstock-agent `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000
```

Convert it to base64 for the `ANDROID_KEYSTORE_BASE64` secret:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore"))
```

Use the keystore password, alias, and key password from the `keytool` prompts for
the other Android secrets.

## Versioning

The workflow uses GitHub's run number for Android versioning:

- `versionCode`: `GITHUB_RUN_NUMBER`
- `versionName`: `0.1.${GITHUB_RUN_NUMBER}`
- Release tag: `v0.1.${GITHUB_RUN_NUMBER}`

This guarantees each pushed build can be installed as an update over the
previous signed build.

## LINE Delivery

LINE Notify ended on 2025-03-31, so the workflow uses LINE Messaging API push
messages. The message contains the GitHub Release URL and APK asset URL.

If the GitHub repository is private, the phone downloading the APK must be able
to access that private release page.
