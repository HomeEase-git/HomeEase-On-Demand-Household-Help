import React from "react";
import type { StyleProp, ImageStyle } from "react-native";
import { Image } from "expo-image";
import { cssInterop } from "nativewind";

cssInterop(Image, { className: "style" });

const FIT = { cover: "cover", contain: "contain", stretch: "fill", center: "none" } as const;

type Props = {
  source: { uri?: string | null } | null | undefined;
  style?: StyleProp<ImageStyle>;
  className?: string;
  resizeMode?: keyof typeof FIT;
  accessibilityLabel?: string;
};

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
