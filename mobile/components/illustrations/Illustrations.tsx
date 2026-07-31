import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { colors } from "../../constants";

interface IllustrationProps {
  size?: number;
}

// Empty inbox / conversations / notifications
export const EmptyInboxIllustration: React.FC<IllustrationProps> = ({
  size = 140,
}) => (
  <Svg width={size} height={size} viewBox="0 0 140 140" fill="none">
    <Circle cx={70} cy={70} r={70} fill={colors.card.DEFAULT} />
    <Rect
      x={34}
      y={46}
      width={72}
      height={52}
      rx={12}
      fill={colors.card.dark}
    />
    <Path
      d="M34 58 L70 82 L106 58"
      stroke={colors.brand.DEFAULT}
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <Circle cx={98} cy={44} r={12} fill={colors.accent.DEFAULT} />
    <Path
      d="M93 44 h10 M98 39 v10"
      stroke={colors.white}
      strokeWidth={2.5}
      strokeLinecap="round"
    />
  </Svg>
);

// Generic empty list / no data (clipboard)
export const EmptyListIllustration: React.FC<IllustrationProps> = ({
  size = 140,
}) => (
  <Svg width={size} height={size} viewBox="0 0 140 140" fill="none">
    <Circle cx={70} cy={70} r={70} fill={colors.card.DEFAULT} />
    <Rect
      x={42}
      y={38}
      width={56}
      height={72}
      rx={10}
      fill={colors.white}
      stroke={colors.card.dark}
      strokeWidth={3}
    />
    <Rect x={58} y={32} width={24} height={12} rx={4} fill={colors.brand.light} />
    <Rect x={52} y={62} width={36} height={5} rx={2.5} fill={colors.card.dark} />
    <Rect x={52} y={76} width={36} height={5} rx={2.5} fill={colors.card.dark} />
    <Rect x={52} y={90} width={22} height={5} rx={2.5} fill={colors.card.dark} />
  </Svg>
);

// KYC verification pending (hourglass)
export const KycPendingIllustration: React.FC<IllustrationProps> = ({
  size = 160,
}) => (
  <Svg width={size} height={size} viewBox="0 0 160 160" fill="none">
    <Circle cx={80} cy={80} r={80} fill={colors.warning + "22"} />
    <Path
      d="M56 40 h48 a6 6 0 0 1 0 12 h-48 a6 6 0 0 1 0 -12 Z"
      fill={colors.warning}
    />
    <Path
      d="M56 108 h48 a6 6 0 0 1 0 12 h-48 a6 6 0 0 1 0 -12 Z"
      fill={colors.warning}
    />
    <Path
      d="M62 52 h36 c0 16 -14 20 -18 28 c-4 -8 -18 -12 -18 -28 Z"
      fill={colors.white}
      stroke={colors.warning}
      strokeWidth={3}
    />
    <Path
      d="M62 108 h36 c0 -16 -14 -20 -18 -28 c-4 8 -18 12 -18 28 Z"
      fill={colors.white}
      stroke={colors.warning}
      strokeWidth={3}
    />
  </Svg>
);

// Onboarding: welcome / home
export const OnboardingWelcomeIllustration: React.FC<IllustrationProps> = ({
  size = 220,
}) => (
  <Svg width={size} height={size} viewBox="0 0 220 220" fill="none">
    <Circle cx={110} cy={110} r={110} fill={colors.card.dark} />
    <Path d="M60 118 L110 76 L160 118 V166 H60 Z" fill={colors.brand.light} />
    <Rect x={78} y={130} width={26} height={36} fill={colors.white} />
    <Rect x={116} y={130} width={26} height={20} fill={colors.brand.DEFAULT} />
    <Path
      d="M52 122 L110 72 L168 122"
      stroke={colors.brand.dark}
      strokeWidth={5}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Svg>
);

// Onboarding: booking / schedule
export const OnboardingBookingIllustration: React.FC<IllustrationProps> = ({
  size = 220,
}) => (
  <Svg width={size} height={size} viewBox="0 0 220 220" fill="none">
    <Circle cx={110} cy={110} r={110} fill={colors.card.dark} />
    <Rect
      x={58}
      y={70}
      width={104}
      height={92}
      rx={14}
      fill={colors.white}
      stroke={colors.brand.light}
      strokeWidth={3}
    />
    <Rect x={58} y={70} width={104} height={26} rx={14} fill={colors.brand.DEFAULT} />
    <Rect x={74} y={110} width={18} height={18} rx={4} fill={colors.accent.light} />
    <Rect x={101} y={110} width={18} height={18} rx={4} fill={colors.card.dark} />
    <Rect x={128} y={110} width={18} height={18} rx={4} fill={colors.card.dark} />
    <Rect x={74} y={136} width={18} height={18} rx={4} fill={colors.card.dark} />
    <Rect x={101} y={136} width={18} height={18} rx={4} fill={colors.accent.DEFAULT} />
    <Rect x={128} y={136} width={18} height={18} rx={4} fill={colors.card.dark} />
  </Svg>
);

// Onboarding: trust / verified professionals
export const OnboardingTrustIllustration: React.FC<IllustrationProps> = ({
  size = 220,
}) => (
  <Svg width={size} height={size} viewBox="0 0 220 220" fill="none">
    <Circle cx={110} cy={110} r={110} fill={colors.card.dark} />
    <Path
      d="M110 54 L156 72 V112 C156 142 136 160 110 168 C84 160 64 142 64 112 V72 Z"
      fill={colors.brand.light}
    />
    <Path
      d="M110 54 L156 72 V112 C156 142 136 160 110 168 Z"
      fill={colors.brand.DEFAULT}
    />
    <Path
      d="M90 112 L104 126 L132 96"
      stroke={colors.white}
      strokeWidth={7}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Svg>
);
