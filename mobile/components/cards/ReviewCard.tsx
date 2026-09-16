import React, { useState } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator } from "react-native";
import Avatar from "../ui/Avatar";
import StarRating from "../ui/StarRating";
import { cardShadow, colors } from "../../constants";

type Review = {
  id: string;
  authorName: string;
  authorAvatar?: string | null;
  rating: number;
  comment: string;
  date: string;
  workerResponse?: string | null;
};

type Props = {
  review: Review;
  // Worker-only: lets the worker post a one-time public reply. Omitted
  // entirely on the client-facing worker-profile reviews list.
  onRespond?: (reviewId: string, response: string) => Promise<void>;
};

export const ReviewCard: React.FC<Props> = ({ review, onRespond }) => {
  const [responding, setResponding] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!onRespond || !draft.trim()) return;
    setSubmitting(true);
    try {
      await onRespond(review.id, draft.trim());
      setResponding(false);
    } finally {
      setSubmitting(false);
    }
  };

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

      {review.workerResponse ? (
        <View className="bg-background rounded-xl p-3 mt-3">
          <Text className="text-text-primary font-semibold text-xs mb-1">Your response</Text>
          <Text className="text-text-secondary text-sm">{review.workerResponse}</Text>
        </View>
      ) : onRespond ? (
        responding ? (
          <View className="mt-3">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a public reply..."
              multiline
              maxLength={1000}
              className="bg-background rounded-xl p-3 text-text-primary text-sm"
              style={{ minHeight: 72, textAlignVertical: "top" }}
            />
            <View className="flex-row justify-end mt-2 gap-3">
              <Pressable onPress={() => { setResponding(false); setDraft(""); }} disabled={submitting}>
                <Text className="text-text-muted text-sm font-medium">Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSubmit} disabled={submitting || !draft.trim()}>
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.accent.DEFAULT} />
                ) : (
                  <Text className="text-accent text-sm font-semibold">Post Reply</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setResponding(true)} className="mt-3 self-start">
            <Text className="text-accent text-sm font-semibold">Respond</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
};

export default ReviewCard;
