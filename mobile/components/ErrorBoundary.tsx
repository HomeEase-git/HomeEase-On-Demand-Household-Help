import React from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { AppIcon as Ionicons } from "./icons/AppIcon";
import EmptyState from "./feedback/EmptyState";
import PrimaryButton from "./ui/PrimaryButton";
import {
  captureErrorBoundary,
  errorLogger,
  type ErrorBoundaryState,
} from "../utils/errorHandling";
import { colors } from "../constants";

type Props = {
  children: React.ReactNode;
  onError?: (error: Error, errorInfo: any) => void;
};

type State = ErrorBoundaryState & {
  showDetails: boolean;
};

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    // Capture error details
    const state = captureErrorBoundary(error, errorInfo);

    // Log the error
    errorLogger.log(
      {
        type: "unknown",
        message: error.message,
        userMessage: "A critical error occurred",
        isRetryable: false,
      },
      {
        componentStack: errorInfo.componentStack,
      },
    );

    // Update state
    this.setState(state);

    // Call parent error handler if provided
    this.props.onError?.(error, errorInfo);

    // Log to console in development
    console.error("ErrorBoundary caught error", error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <View className="flex-1 bg-white">
          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              paddingHorizontal: 24,
              paddingVertical: 40,
              justifyContent: "center",
            }}
          >
            <View className="items-center mb-6">
              <View className="w-16 h-16 rounded-full bg-error/10 items-center justify-center mb-4">
                <Ionicons name="alert-circle" size={32} color={colors.error} />
              </View>
              <Text className="text-xl font-bold text-text-primary mb-2">
                Oops! Something went wrong
              </Text>
              <Text className="text-text-secondary text-center text-sm">
                We encountered an unexpected error. Please try to recover or
                restart the app.
              </Text>
            </View>

            {this.state.showDetails && this.state.error && (
              <View className="bg-error/5 border border-error/20 rounded-lg p-4 mb-6">
                <Text className="text-error font-semibold text-xs mb-2">
                  Error Details (Dev Only)
                </Text>
                <Text className="text-error text-xs font-mono">
                  {this.state.error.message}
                </Text>
                {this.state.errorInfo && (
                  <Text
                    className="text-error/60 text-xs mt-2 font-mono"
                    numberOfLines={5}
                  >
                    {this.state.errorInfo.componentStack}
                  </Text>
                )}
              </View>
            )}

            <View className="mb-4">
              <PrimaryButton
                label="Try Again"
                fullWidth
                onPress={this.handleReset}
              />
            </View>

            {__DEV__ && (
              <Pressable
                className="items-center py-3"
                onPress={() => {
                  this.setState({ showDetails: !this.state.showDetails });
                }}
              >
                <Text className="text-accent text-xs font-semibold">
                  {this.state.showDetails ? "Hide" : "Show"} Details
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
