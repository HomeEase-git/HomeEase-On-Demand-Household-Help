import React, { useState } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView } from "react-native";
import Avatar from "../ui/Avatar";
import StarRating from "../ui/StarRating";
import RemoteImage from "../ui/RemoteImage";
import { cardShadow, colors } from "../../constants";

type Review = {
  id: string;
  authorName: string;
  authorAvatar?: string | null;
  rating: number;
  comment: string;
  date: string;
  workerResponse?: string | null;
  // The client's proof photos, shown on the review itself.
  photoUrls?: string[];
};

// API dates arrive as ISO strings ("2026-10-13T11:11:20.852Z").
function formatReviewDate(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
}

type Props = {
  review: Review;
  // Worker-only: lets the worker post a one-time public reply. Omitted
  // entirely on the client-facing worker-profile reviews list.
  onRespond?: (reviewId: string, response: string) => Promise<void>;
  // Worker-only: report the review to an admin.
  onReport?: () => void;
};

export const ReviewCard: React.FC<Props> = ({ review, onRespond, onReport }) => {
  const [responding, setResponding] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);

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
          <Text className="text-text-muted text-xs">{formatReviewDate(review.date)}</Text>
        </View>
        <StarRating rating={review.rating} size={14} />
      </View>
      <Text className="text-text-secondary text-sm mt-2">{review.comment}</Text>

      {!!review.photoUrls?.length && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} className="mt-3">
          {review.photoUrls.map((url) => (
            <Pressable
              key={url}
              onPress={() => setOpenPhoto(url)}
              accessibilityRole="imagebutton"
              accessibilityLabel="Open review photo"
            >
              <RemoteImage source={{ uri: url }} className="w-20 h-20 rounded-xl bg-card-dark" />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!openPhoto} transparent animationType="fade" onRequestClose={() => setOpenPhoto(null)}>
        <Pressable className="flex-1 bg-black/90 items-center justify-center" onPress={() => setOpenPhoto(null)}>
          <RemoteImage source={{ uri: openPhoto }} resizeMode="contain" style={{ width: "100%", height: "80%" }} />
          <Text className="text-white/70 text-xs mt-3">Tap anywhere to close</Text>
        </Pressable>
      </Modal>

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
              style={{ minHeight: 72, textAlignVertical: "top", includeFontPadding: false }}
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

      {onReport && (
        <Pressable onPress={onReport} className="mt-3 self-end">
          <Text className="text-text-muted text-xs font-medium">Report review</Text>
        </Pressable>
      )}
    </View>
  );
};

export default ReviewCard;
