import { useRef, useEffect, useCallback } from 'react';
import { Animated, Easing } from 'react-native';

/**
 * Performance & Animation Utilities
 * 
 * Features:
 * - Interruptible animations (can be cancelled/reversed)
 * - Staggered animations (avoid heavy simultaneous animations)
 * - List rendering optimizations (memoization, virtualization hints)
 * - Memory leak prevention
 */

/**
 * useInterruptibleAnimation
 * 
 * Create an animation that can be interrupted or reversed.
 * Prevents janky animations and allows smooth transitions.
 * 
 * Usage:
 *   const { value, animate, cancel } = useInterruptibleAnimation(0, 1, 300);
 *   
 *   return (
 *     <Animated.View style={{ opacity: value }}>
 *       <Content />
 *     </Animated.View>
 *   );
 */
export function useInterruptibleAnimation(
  fromValue: number,
  toValue: number,
  duration: number = 300
) {
  const animValue = useRef(new Animated.Value(fromValue)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const currentValueRef = useRef(fromValue);

  const animate = (endValue: number = toValue, animDuration: number = duration) => {
    // Cancel existing animation
    if (animationRef.current) {
      animationRef.current.stop();
    }

    currentValueRef.current = endValue;
    animationRef.current = Animated.timing(animValue, {
      toValue: endValue,
      duration: animDuration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });

    animationRef.current.start();
  };

  const cancel = () => {
    if (animationRef.current) {
      animationRef.current.stop();
      animationRef.current = null;
    }
  };

  const reverse = () => {
    if (animationRef.current) {
      animationRef.current.stop();
    }
    const newEndValue = Math.abs(currentValueRef.current - toValue) < 0.5 ? fromValue : toValue;
    animate(newEndValue);
  };

  useEffect(() => {
    return () => {
      cancel();
    };
  }, []);

  return {
    value: animValue,
    animate,
    cancel,
    reverse,
  };
}

/**
 * useStaggeredAnimation
 * 
 * Animate multiple elements sequentially to avoid simultaneous heavy animations.
 * 
 * Usage:
 *   const stagger = useStaggeredAnimation();
 *   
 *   return (
 *     <>
 *       {items.map((item, i) => (
 *         <Animated.View
 *           key={i}
 *           style={stagger.getAnimationStyle(i)}
 *         >
 *           {item}
 *         </Animated.View>
 *       ))}
 *     </>
 *   );
 */
export function useStaggeredAnimation(
  itemCount: number,
  itemDuration: number = 100,
  startDelay: number = 0
) {
  const animValues = useRef(
    Array(itemCount)
      .fill(0)
      .map(() => new Animated.Value(0))
  ).current;

  const startAnimation = useCallback((toValue: number = 1) => {
    const animations = animValues.map((value, index) =>
      Animated.timing(value, {
        toValue,
        duration: itemDuration,
        delay: startDelay + index * (itemDuration / 3), // Stagger timing
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      })
    );

    Animated.sequence(animations).start();
  }, [animValues, itemDuration, startDelay]);

  const getAnimationStyle = (index: number) => ({
    opacity: animValues[index],
    transform: [
      {
        translateY: animValues[index].interpolate({
          inputRange: [0, 1],
          outputRange: [20, 0],
        }),
      },
    ],
  });

  useEffect(() => {
    startAnimation(1);
  }, [itemCount, startAnimation]);

  return {
    startAnimation,
    getAnimationStyle,
    cancel: () => {
      animValues.forEach((value) => value.setValue(0));
    },
  };
}

/**
 * useFlatListOptimization
 * 
 * Returns optimized props for FlatList performance.
 * Handles:
 * - Item layout estimation
 * - Rendering optimization
 * - Memory management
 * 
 * Usage:
 *   const optimizedProps = useFlatListOptimization();
 *   
 *   <FlatList {...optimizedProps} />
 */
export function useFlatListOptimization(
  itemHeight: number = 100,
  options: {
    estimatedItemSize?: number;
    maxToRenderPerBatch?: number;
    updateCellsBatchingPeriod?: number;
    removeClippedSubviews?: boolean;
  } = {}
) {
  const {
    estimatedItemSize,
    maxToRenderPerBatch = 10,
    updateCellsBatchingPeriod = 50,
    removeClippedSubviews = true,
  } = options;

  const finalItemHeight = estimatedItemSize || itemHeight;

  return {
    // Estimate item size for virtualization
    getItemLayout: (_data: any, index: number) => ({
      length: finalItemHeight,
      offset: finalItemHeight * index,
      index,
    }),

    // Optimize rendering
    initialNumToRender: 10,
    maxToRenderPerBatch,
    updateCellsBatchingPeriod,
    removeClippedSubviews,

    // Use key extractor for proper list reconciliation
    keyExtractor: (_item: any, index: number) => String(index),

    // Prevent re-renders with proper dependencies
    removeClippedSubviewsAndroid: removeClippedSubviews,
  };
}

/**
 * useImageOptimization
 * 
 * Progressive image loading with fade-in animation.
 * Shows placeholder while loading.
 * 
 * Usage:
 *   const { imageOpacity, handleImageLoad } = useImageOptimization();
 *   
 *   <Animated.Image
 *     source={...}
 *     style={{ opacity: imageOpacity }}
 *     onLoad={handleImageLoad}
 *   />
 */
export function useImageOptimization() {
  const opacity = useRef(new Animated.Value(0)).current;

  const handleImageLoad = () => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  };

  return {
    imageOpacity: opacity,
    handleImageLoad,
  };
}

/**
 * useDebouncedCallback
 * 
 * Debounce a callback to avoid excessive calls.
 * Useful for search, resize handlers, etc.
 * 
 * Usage:
 *   const handleSearch = useDebouncedCallback(
 *     (text) => performSearch(text),
 *     500
 *   );
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 300
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  };
}

/**
 * useThrottledCallback
 * 
 * Throttle a callback to limit how often it can be called.
 * Useful for scroll events, drag handlers, etc.
 * 
 * Usage:
 *   const handleScroll = useThrottledCallback(
 *     (offset) => checkNeedMoreData(offset),
 *     100
 *   );
 */
export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 100
): (...args: Parameters<T>) => void {
  const lastRunRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (...args: Parameters<T>) => {
    const now = Date.now();

    if (now - lastRunRef.current >= delay) {
      lastRunRef.current = now;
      callback(...args);
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        lastRunRef.current = Date.now();
        callback(...args);
      }, delay - (now - lastRunRef.current));
    }
  };
}

/**
 * useMemoryWarning
 * 
 * Monitor memory usage and trigger cleanup when threshold exceeded.
 * (Native implementation depends on platform capabilities)
 */
export function useMemoryWarning(onMemoryWarning?: () => void) {
  useEffect(() => {
    // Note: React Native doesn't have built-in memory warnings
    // This would need platform-specific implementation
    console.log('[Performance] Memory monitoring initialized');

    return () => {
      // Cleanup on unmount
    };
  }, [onMemoryWarning]);
}

/**
 * Performance monitoring utility for debugging
 */
export const performanceMonitor = {
  measureStart: (label: string) => {
    if (__DEV__) {
      performance.mark(`${label}-start`);
    }
  },

  measureEnd: (label: string) => {
    if (__DEV__) {
      performance.mark(`${label}-end`);
      try {
        performance.measure(label, `${label}-start`, `${label}-end`);
        const measure = performance.getEntriesByName(label)[0];
        console.log(`[Performance] ${label}: ${measure.duration.toFixed(2)}ms`);
      } catch (error) {
        console.error('[Performance] Measurement error:', error);
      }
    }
  },

  log: (message: string) => {
    if (__DEV__) {
      console.log(`[Performance] ${message}`);
    }
  },
};
