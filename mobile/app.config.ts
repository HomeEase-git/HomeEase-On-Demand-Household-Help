import type { ConfigContext, ExpoConfig } from "expo/config";
import { AndroidConfig, withAndroidManifest, type ConfigPlugin } from "expo/config-plugins";

// Release builds talk to the API over HTTPS only. Android already refuses
// plain http:// by default for this target SDK; this pins it so a future
// dependency or setting can't quietly turn it back on. Debug builds (the
// emulator's http://10.0.2.2 dev server) are unaffected — their debug
// manifest overrides this attribute.
const withHttpsOnly: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$["android:usesCleartextTraffic"] = "false";
    return mod;
  });

// Everything static lives in app.json; this only layers on what must come
// from the environment at build time.
//
// GOOGLE_MAPS_ANDROID_API_KEY — the Maps SDK for Android key. Set it as an
// EAS environment variable (expo.dev → project → Environment variables, for
// the preview + production environments) or in mobile/.env for local
// `expo run:android` builds. It is baked into the APK's AndroidManifest, so
// in the Cloud Console it must be restricted to Android apps (package
// com.homeease.app + the EAS signing SHA-1) and to "Maps SDK for Android"
// only — that restriction, not secrecy, is what protects it. It's kept out
// of git all the same.
//
// Without it, the Google Maps SDK crashes the app the moment a map mounts,
// so `extra.hasGoogleMapsKey` tells components/ui/GoogleMap.tsx to show a
// "Map unavailable" placeholder instead.
export default ({ config }: ConfigContext): ExpoConfig => {
  const androidGoogleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim() || undefined;

  return withHttpsOnly({
    ...config,
    name: config.name ?? "HomeEase",
    slug: config.slug ?? "homeease",
    plugins: [...(config.plugins ?? []), ["react-native-maps", { androidGoogleMapsApiKey }]],
    extra: {
      ...config.extra,
      hasGoogleMapsKey: !!androidGoogleMapsApiKey,
    },
  });
};
