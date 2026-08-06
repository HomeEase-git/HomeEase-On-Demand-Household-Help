import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import SearchBar from "../../../components/ui/SearchBar";
import CategoryCard from "../../../components/cards/CategoryCard";
import { getServiceTypes } from "../../../services/api";

type ServiceCategory = {
  id: string;
  name: string;
  count: number;
};

export default function CategoryIndexScreen() {
  const router = useRouter();
  const [serviceCategories, setServiceCategories] = useState<ServiceCategory[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCategories() {
      setLoading(true);
      setError(null);
      try {
        const serviceTypes = await getServiceTypes();
        if (!active) return;
        const categories = serviceTypes.map((serviceType: any) => ({
          id: serviceType.name.toLowerCase().replace(/\s+/g, "-"),
          name: serviceType.name,
          count: serviceType.availableWorkerCount ?? 0,
        }));
        setServiceCategories(categories);
      } catch (err) {
        if (!active) return;
        setError("Unable to load services. Please try again.");
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }

    loadCategories();
    return () => {
      active = false;
    };
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-text-primary text-2xl font-bold">Services</Text>
        <Pressable
          className="mt-3"
          onPress={() => router.push("/(client)/home/search")}
        >
          <SearchBar placeholder="Search services..." />
        </Pressable>
      </View>

      {loading ? (
        <View className="px-4 py-6">
          <ActivityIndicator size="small" />
          <Text className="text-text-secondary mt-2">Loading services...</Text>
        </View>
      ) : error ? (
        <View className="px-4 py-6">
          <Text className="text-error">{error}</Text>
        </View>
      ) : (
        <FlatList
          data={serviceCategories}
          numColumns={2}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          columnWrapperStyle={{ gap: 12, marginBottom: 12 }}
          renderItem={({ item }) => (
            <CategoryCard
              category={item}
              onPress={() => router.push(`/(client)/category/${item.id}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
