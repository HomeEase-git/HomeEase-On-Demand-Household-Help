import type { ConfigContext, ExpoConfig } from "expo/config";
import { AndroidConfig, withAndroidManifest, type ConfigPlugin } from "expo/config-plugins";

const withHttpsOnly: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$["android:usesCleartextTraffic"] = "false";
    return mod;
  });

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
