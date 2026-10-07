import React, { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import Avatar from "../../../components/ui/Avatar";
import EmptyState from "../../../components/feedback/EmptyState";
import { SkeletonList, TransactionItemSkeleton } from "../../../components/ui/Skeleton";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { getBlockedUsers, unblockUser, type BlockedUser } from "../../../services/api";

// Also mounted by the worker app (app/(worker)/profile/blocked-users.tsx).
export default function BlockedUsersScreen() {
  const alertModal = useAlertModal();
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setUsers(await getBlockedUsers());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const confirmUnblock = (user: BlockedUser) =>
    alertModal.confirm(`Unblock ${user.name}?`, "You'll be able to message each other again.", {
      confirmText: "Unblock",
      onConfirm: async () => {
        try {
          await unblockUser(user.userId);
          setUsers((prev) => prev.filter((u) => u.userId !== user.userId));
        } catch {
          alertModal.error("Error", `Couldn't unblock ${user.name}. Please try again.`);
        }
      },
    });

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Blocked Users" showBack />
      {loading ? (
        <View className="px-4 pt-2">
          <SkeletonList count={4} SkeletonComponent={TransactionItemSkeleton} spacing={0} />
        </View>
      ) : failed ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load blocked users"
          subtitle="Check your connection and try again."
          actionLabel="Try again"
          onAction={load}
        />
      ) : users.length === 0 ? (
        <EmptyState icon="ban-outline" title="No blocked users" subtitle="People you block from a chat show up here." />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.userId}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View className="flex-row items-center py-3 border-b border-divider">
              <Avatar uri={item.avatar} size="sm" />
              <Text className="text-text-primary flex-1 ml-3">{item.name}</Text>
              <Pressable accessibilityRole="button" onPress={() => confirmUnblock(item)} className="px-3 py-2">
                <Text className="text-accent font-semibold">Unblock</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
