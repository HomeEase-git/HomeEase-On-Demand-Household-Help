import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { StyleProp, View, Text, ViewStyle } from "react-native";
import { WebView } from "react-native-webview";
import type { LatLng } from "../../utils/geo";
import { config } from "../../constants/config";
import { colors } from "../../constants";
import { AppIcon as Ionicons } from "../icons/AppIcon";

export type GoogleMapHandle = {
  // Moves (or creates, on first call) the worker marker without reloading the
  // WebView/map — used for live tracking, where a fresh call arrives every
  // few seconds and a full HTML reload would flicker and re-fetch tiles.
  updateWorkerLocation: (position: LatLng) => void;
};

type Props = {
  destination: LatLng;
  destinationLabel?: string;
  currentLocation?: LatLng | null;
  workerLocation?: LatLng | null;
  workerLabel?: string;
  routeCoordinates?: LatLng[];
  zoom?: number;
  onMapReady?: () => void;
  style?: StyleProp<ViewStyle>;
};

// Small inline SVG pin/dot icons (data URIs) so the map doesn't depend on any
// bundled image assets — mirrors the colors/shapes the old Leaflet divIcon
// markers used.
function pinIconDataUrl(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36"><path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.3 21.7 0 14 0z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="14" cy="14" r="5" fill="#fff"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function dotIconDataUrl(color: string, size: number, haloColor?: string): string {
  const r = size / 2;
  const canvas = size + 8;
  const center = canvas / 2;
  const halo = haloColor ? `<circle cx="${center}" cy="${center}" r="${center}" fill="${haloColor}"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}">${halo}<circle cx="${center}" cy="${center}" r="${r}" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const DESTINATION_ICON = pinIconDataUrl("#E63946");
const CURRENT_LOCATION_ICON = dotIconDataUrl("#2A6DF4", 14);
const WORKER_ICON = dotIconDataUrl("#22C55E", 16, "rgba(34,197,94,0.25)");

const buildHtml = ({
  apiKey,
  destination,
  destinationLabel,
  currentLocation,
  workerLocation,
  workerLabel,
  routeCoordinates,
  zoom,
}: Omit<Props, "onMapReady" | "style"> & { apiKey: string }) => {
  const data = {
    destination,
    destinationLabel: destinationLabel ?? "Selected location",
    currentLocation: currentLocation ?? null,
    workerLocation: workerLocation ?? null,
    workerLabel: workerLabel ?? "Worker's location",
    route: routeCoordinates ?? [],
    zoom: zoom ?? 15,
    icons: {
      destination: DESTINATION_ICON,
      current: CURRENT_LOCATION_ICON,
      worker: WORKER_ICON,
    },
  };

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var data = ${JSON.stringify(data).replace(/</g, "\\u003c")};
    var map, workerMarker;

    function initMap() {
      map = new google.maps.Map(document.getElementById('map'), {
        center: data.destination,
        zoom: data.zoom,
        disableDefaultUI: true,
        zoomControl: false,
        clickableIcons: false,
        gestureHandling: 'greedy',
      });

      var bounds = new google.maps.LatLngBounds();

      var destinationMarker = new google.maps.Marker({
        position: data.destination,
        map: map,
        title: data.destinationLabel,
        icon: { url: data.icons.destination, scaledSize: new google.maps.Size(28, 36), anchor: new google.maps.Point(14, 36) },
      });
      new google.maps.InfoWindow({ content: data.destinationLabel }).open(map, destinationMarker);
      bounds.extend(data.destination);

      if (data.currentLocation) {
        new google.maps.Marker({
          position: data.currentLocation,
          map: map,
          title: 'Your location',
          icon: { url: data.icons.current, scaledSize: new google.maps.Size(22, 22), anchor: new google.maps.Point(11, 11) },
        });
        bounds.extend(data.currentLocation);
      }

      if (data.route && data.route.length > 1) {
        new google.maps.Polyline({
          path: data.route,
          map: map,
          strokeColor: '#2A6DF4',
          strokeWeight: 4,
          strokeOpacity: 0.85,
        });
        data.route.forEach(function (point) { bounds.extend(point); });
      }

      // Called via WebView.injectJavaScript for every live location push, so
      // a moving marker never forces the map to reload.
      window.setWorkerLocation = function (lat, lng) {
        var position = { lat: lat, lng: lng };
        if (workerMarker) {
          workerMarker.setPosition(position);
        } else {
          workerMarker = new google.maps.Marker({
            position: position,
            map: map,
            title: data.workerLabel,
            icon: { url: data.icons.worker, scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) },
          });
          var liveBounds = new google.maps.LatLngBounds();
          liveBounds.extend(data.destination);
          liveBounds.extend(position);
          map.fitBounds(liveBounds, 40);
        }
      };

      if (data.workerLocation) {
        window.setWorkerLocation(data.workerLocation.lat, data.workerLocation.lng);
        bounds.extend(data.workerLocation);
      }

      var hasMultiplePoints = data.currentLocation || data.workerLocation || (data.route && data.route.length > 1);
      if (hasMultiplePoints) {
        map.fitBounds(bounds, 40);
      }

      window.ReactNativeWebView && window.ReactNativeWebView.postMessage('ready');
    }
  </script>
  <script src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap" async defer></script>
</body>
</html>`;
};

export const GoogleMap = forwardRef<GoogleMapHandle, Props>(function GoogleMap(
  { destination, destinationLabel, currentLocation, workerLocation, workerLabel, routeCoordinates, zoom, onMapReady, style },
  ref,
) {
  const webviewRef = useRef<WebView>(null);
  const apiKey = config.GOOGLE_MAPS_API_KEY;

  // Intentionally excludes workerLocation/workerLabel — live updates go
  // through the imperative handle below (injectJavaScript), not a re-render,
  // so the WebView/map never reloads mid-tracking. Only the *initial* value
  // (captured at mount, via buildHtml's closure) seeds the first marker.
  const html = useMemo(
    () =>
      buildHtml({
        apiKey,
        destination,
        destinationLabel,
        currentLocation,
        workerLocation,
        workerLabel,
        routeCoordinates,
        zoom,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiKey, destination.lat, destination.lng, destinationLabel, currentLocation?.lat, currentLocation?.lng, routeCoordinates, zoom],
  );

  useImperativeHandle(
    ref,
    () => ({
      updateWorkerLocation: (position: LatLng) => {
        webviewRef.current?.injectJavaScript(
          `window.setWorkerLocation && window.setWorkerLocation(${position.lat}, ${position.lng}); true;`,
        );
      },
    }),
    [],
  );

  if (!apiKey) {
    return (
      <View
        style={style ?? { flex: 1 }}
        className="bg-card-dark items-center justify-center px-4"
      >
        <Ionicons name="map-outline" size={32} color={colors.accent.DEFAULT} />
        <Text className="text-brand mt-2 text-xs text-center">
          Map unavailable — Google Maps API key not configured.
        </Text>
      </View>
    );
  }

  return (
    <WebView
      ref={webviewRef}
      source={{ html }}
      style={style ?? { flex: 1 }}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled
      startInLoadingState
      onMessage={onMapReady ? () => onMapReady() : undefined}
    />
  );
});

export default GoogleMap;
