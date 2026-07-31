import React from "react";
import { View, Text } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import StarRating from "../ui/StarRating";
import { colors, cardShadow } from "../../constants";

type Review = {
  id: string;
  authorName: string;
  rating: number;
  comment: string;
  date: string;
};

type Props = {
  review: Review;
};

export const ReviewCard: React.FC<Props> = ({ review }) => {
  return (
    <View className="bg-card rounded-2xl p-4 mb-3" style={cardShadow}>
      <View className="flex-row items-center">
        {/* TODO: Replace with reviewer profile photo */}
        <View className="w-10 h-10 bg-card-light rounded-full items-center justify-center mr-3">
          <Ionicons name="person" size={20} color={colors.text.muted} />
        </View>
        <View className="flex-1">
          <Text className="text-text-primary font-semibold">
            {review.authorName}
          </Text>
          <Text className="text-text-muted text-xs">{review.date}</Text>
        </View>
        <StarRating rating={review.rating} size={14} />
      </View>
      <Text className="text-text-secondary text-sm mt-2">{review.comment}</Text>
    </View>
  );
};

export default ReviewCard;
