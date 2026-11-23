import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, View, type DimensionValue, type LayoutChangeEvent } from 'react-native';

import { Row, Txt, useReducedMotion } from '@/components/ui';
import { useFoodImage } from '@/hooks/useFoodImage';
import { creditLine, providerInfo, type FoodKind } from '@/lib/foodImages';
import type { FoodImageRef } from '@/store/types';
import { radius as radii, useTheme, type Tone } from '@/theme';

/** Tiles at or below this size use the provider's smaller rendition. */
const THUMB_MAX = 64;

/** The emoji placeholder tile. Also the fallback layer under every `FoodImage`. */
export function MealTile({ emoji, tint, size = 64, radius = radii.md }: { emoji: string; tint: Tone; size?: number; radius?: number }) {
  const { tone } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: tone(tint).bg, alignItems: 'center', justifyContent: 'center' }}>
      <Txt style={{ fontSize: size * 0.5, lineHeight: size * 0.62 }}>{emoji}</Txt>
    </View>
  );
}

function Skeleton({ tint }: { tint: Tone }) {
  const { tone } = useTheme();
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: tone(tint).bg, opacity: reduced ? 0.8 : pulse }} />;
}

const open = (url: string | null | undefined) => {
  if (url) void WebBrowser.openBrowserAsync(url);
};

/** Links to the photo provider ("Images from Pixabay"). */
export function ProviderLink({ provider }: { provider?: string | null }) {
  const info = providerInfo(provider);
  if (!info.url) return null;
  return (
    <Pressable onPress={() => open(info.url)} accessibilityRole="link" accessibilityLabel={info.linkLabel} hitSlop={8}>
      <Txt v="caption" faint style={{ textDecorationLine: 'underline' }}>
        {info.linkLabel}
      </Txt>
    </Pressable>
  );
}

/** "Photo: Jane Doe on Pixabay · Images from Pixabay", both linked. */
export function PhotoCredit({ image, align = 'flex-end' }: { image: FoodImageRef; align?: 'flex-start' | 'flex-end' | 'center' }) {
  const credit = creditLine(image);
  return (
    <Row gap={6} wrap style={{ alignSelf: align, justifyContent: align }}>
      <Pressable onPress={() => open(image.sourceUrl ?? image.photographerUrl)} disabled={!image.sourceUrl && !image.photographerUrl} accessibilityRole="link" accessibilityLabel={`Photo by ${credit}`} hitSlop={8}>
        <Txt v="caption" faint numberOfLines={1}>
          Photo: {credit}
        </Txt>
      </Pressable>
      <ProviderLink provider={image.provider} />
    </Row>
  );
}

type Props = {
  /** Meal or grocery name used to look up a photo. */
  query: string;
  fallbackEmoji: string;
  kind?: FoodKind;
  /** A photo already stored on the user's row; skips the lookup. */
  image?: FoodImageRef | null;
  /** Shorthand for `image` when only a URL (and optional attribution) is known. */
  imageUrl?: string | null;
  attribution?: Omit<FoodImageRef, 'url'> | null;
  tint?: Tone;
  /** Square tile size. Ignored when `aspectRatio` is set. */
  size?: number;
  /** Fills the parent width at this ratio (e.g. 4 / 3) instead of a fixed square. */
  aspectRatio?: number;
  width?: DimensionValue;
  radius?: number;
  /** Shows the photographer credit and the provider link under the image. */
  showAttribution?: boolean;
};

/**
 * A meal or grocery photo with the emoji tile as a permanent base layer: unconfigured
 * Supabase, offline, no match, or a failed load all leave the emoji visible, so the UI
 * never breaks.
 */
export function FoodImage({ query, fallbackEmoji, kind = 'meal', image: storedImage, imageUrl, attribution, tint = 'green', size = 64, aspectRatio, width = '100%', radius = radii.md, showAttribution }: Props) {
  const { tone } = useTheme();
  const stored = storedImage ?? (imageUrl ? { ...attribution, url: imageUrl } : null);
  const { image, loading } = useFoodImage(query, kind, stored);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [box, setBox] = useState(aspectRatio ? 0 : size);

  const fluid = aspectRatio !== undefined;
  const emojiBox = fluid ? Math.min(box, 160) : size;
  const uri = image ? (!fluid && size <= THUMB_MAX ? image.thumbUrl || image.url : image.url) : null;
  const showPhoto = !!uri && uri !== failedUrl;
  const frame = fluid ? { width, aspectRatio } : { width: size, height: size };

  const tile = (
    <View
      onLayout={fluid ? (e: LayoutChangeEvent) => setBox(Math.min(e.nativeEvent.layout.width, e.nativeEvent.layout.height)) : undefined}
      style={[frame, { borderRadius: radius, overflow: 'hidden', backgroundColor: tone(tint).bg, alignItems: 'center', justifyContent: 'center' }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={query}
      testID="food-image">
      {emojiBox > 0 ? (
        <View testID="food-image-fallback">
          <Txt style={{ fontSize: emojiBox * 0.5, lineHeight: emojiBox * 0.62 }}>{fallbackEmoji}</Txt>
        </View>
      ) : null}
      {loading ? <Skeleton tint={tint} /> : null}
      {showPhoto ? (
        <Image
          testID="food-image-photo"
          source={{ uri }}
          alt={query}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          recyclingKey={uri}
          onError={() => setFailedUrl(uri)}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        />
      ) : null}
    </View>
  );

  if (!showAttribution || !showPhoto || !image) return tile;
  return (
    <View style={{ width: fluid ? width : size, gap: 4 }}>
      {tile}
      <PhotoCredit image={image} />
    </View>
  );
}
