import React from "react";
import type { StyleProp, ImageStyle } from "react-native";
import { Image } from "expo-image";
import { cssInterop } from "nativewind";

// NativeWind only maps className -> style on components it knows about.
cssInterop(Image, { className: "style" });

const FIT = { cover: "cover", contain: "contain", stretch: "fill", center: "none" } as const;

type Props = {
  source: { uri?: string | null } | null | undefined;
  style?: StyleProp<ImageStyle>;
  className?: string;
  /** Same values as React Native's Image, so call sites swap in unchanged. */
  resizeMode?: keyof typeof FIT;
  accessibilityLabel?: string;
};

/**
 * For images loaded from the internet (avatars, job and chat photos,
 * documents): cached in memory and on disk so they don't re-download on
 * every visit, with a short fade-in instead of popping in. Bundled images
 * (require(...)) keep using React Native's Image.
 */
export const RemoteImage: React.FC<Props> = ({ source, resizeMode = "cover", ...rest }) => (
  <Image
    source={source?.uri ? { uri: source.uri } : null}
    contentFit={FIT[resizeMode]}
    transition={150}
    cachePolicy="memory-disk"
    {...rest}
  />
);

export default RemoteImage;
