# NexGen Android App

NexGen mobile is now wrapped with Capacitor so the existing React mobile app can
ship as an Android app.

Official references:

- Capacitor configuration: https://capacitorjs.com/docs/config
- Capacitor Android: https://capacitorjs.com/docs/android
- Capacitor sync workflow: https://capacitorjs.com/docs/getting-started

## Project Layout

```text
mobile/
  capacitor.config.ts
  android/
```

`capacitor.config.ts` points Capacitor at the Vite build output:

```text
webDir = dist
```

The generated Android project ignores copied web assets and build artifacts.
Run sync whenever the mobile React app changes.

## Development Commands

Build web assets and sync Android:

```cmd
npm run android:sync
```

Open the Android project:

```cmd
npm run android:open
```

Build a debug APK from Android Studio, or from the Gradle wrapper after Java and
Android SDK are installed:

```cmd
cd /d D:\NexGen\mobile\android
gradlew.bat assembleDebug
```

The current development machine could not run Gradle because `JAVA_HOME` is not
set and `java` is not on `PATH`. Install Android Studio plus a supported JDK,
then set `JAVA_HOME`.

## Connecting To A Station

Because the APK runs from local Capacitor assets, it cannot assume `/api` points
to the station backend. The login screen includes a `Station server` field.

Recommended values:

```text
http://nexgen-station:3001
http://100.x.y.z:3001
```

The app normalizes the saved value to `/api`. For example:

```text
http://nexgen-station:3001/api
```

Use the Tailscale MagicDNS name first. Use the `100.x.y.z` Tailnet IP if DNS is
not working on a specific phone.

The Android wrapper currently permits cleartext HTTP so it can reach the local
station backend over LAN or Tailscale. Tailscale encrypts device-to-device
traffic, but a future HTTPS/domain setup can remove that exception.

## Remaining Release Work

- Add app icon and splash assets.
- Add release signing keystore handling.
- Build signed APK/AAB for distribution.
- Add QR station pairing so users do not type the server URL manually.
