import React from "react";
import { View, Text } from "react-native";
import Avatar from "../ui/Avatar";
import StarRating from "../ui/StarRating";
import { cardShadow } from "../../constants";

type Review = {
  id: string;
  authorName: string;
  authorAvatar?: string | null;
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
        <View className="mr-3">
          <Avatar uri={review.authorAvatar} size="sm" />
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
