import React from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "../ui/ScreenHeader";
import type { LegalDocument } from "../../constants/legalDocuments";

/** The sections of a legal document, for embedding in an existing ScrollView. */
export function LegalSections({ document }: { document: LegalDocument }) {
  return (
    <View>
      {document.sections.map((section) => (
        <View key={section.heading} className="mb-5">
          <Text className="text-text-primary text-base font-bold mb-2">
            {section.heading}
          </Text>
          {section.paragraphs?.map((paragraph, index) => (
            <Text key={index} className="text-text-secondary text-sm leading-6 mb-2">
              {paragraph}
            </Text>
          ))}
          {section.bullets?.map((bullet, index) => (
            <View key={index} className="flex-row mb-2 pl-1">
              <Text className="text-accent font-bold mr-2">•</Text>
              <Text className="text-text-secondary text-sm flex-1 leading-5">{bullet}</Text>
            </View>
          ))}
        </View>
      ))}
      <Text className="text-text-muted text-xs text-center mt-2">
        Version {document.version}
      </Text>
    </View>
  );
}

/** A full read-only screen for a legal document. */
export function LegalDocumentScreen({ document }: { document: LegalDocument }) {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title={document.title} showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <LegalSections document={document} />
      </ScrollView>
    </SafeAreaView>
  );
}
