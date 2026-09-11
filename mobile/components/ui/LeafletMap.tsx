import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { StyleProp, ViewStyle } from "react-native";
import { WebView } from "react-native-webview";
import type { LatLng } from "../../utils/geo";

export type LeafletMapHandle = {
  // Moves (or creates, on first call) the worker marker without reloading the
  // WebView/tiles — used for live tracking, where a fresh call arrives every
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

const buildHtml = ({
  destination,
  destinationLabel,
  currentLocation,
  workerLocation,
  workerLabel,
  routeCoordinates,
  zoom,
}: Omit<Props, "onMapReady" | "style">) => {
  const data = {
    destination,
    destinationLabel: destinationLabel ?? "Selected location",
    currentLocation: currentLocation ?? null,
    workerLocation: workerLocation ?? null,
    workerLabel: workerLabel ?? "Worker's location",
    route: routeCoordinates ?? [],
    zoom: zoom ?? 15,
  };

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; }
    .pin { width: 20px; height: 20px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.4); }
    .pin-destination { background: #E63946; }
    .dot-current { width: 14px; height: 14px; border-radius: 50%; background: #2A6DF4; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.4); }
    .dot-worker { width: 16px; height: 16px; border-radius: 50%; background: #22C55E; border: 2px solid #fff; box-shadow: 0 0 0 4px rgba(34,197,94,0.25); }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var data = ${JSON.stringify(data)};

    var map = L.map('map', { zoomControl: false }).setView([data.destination.lat, data.destination.lng], data.zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    var destinationIcon = L.divIcon({
      className: '',
      html: '<div class="pin pin-destination"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 20],
    });

    var bounds = [[data.destination.lat, data.destination.lng]];

    L.marker([data.destination.lat, data.destination.lng], { icon: destinationIcon })
      .addTo(map)
      .bindPopup(data.destinationLabel)
      .openPopup();

    if (data.currentLocation) {
      var currentIcon = L.divIcon({
        className: '',
        html: '<div class="dot-current"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      L.marker([data.currentLocation.lat, data.currentLocation.lng], { icon: currentIcon })
        .addTo(map)
        .bindPopup('Your location');
      bounds.push([data.currentLocation.lat, data.currentLocation.lng]);
    }

    if (data.route && data.route.length > 1) {
      var routeLatLngs = data.route.map(function (p) { return [p.lat, p.lng]; });
      L.polyline(routeLatLngs, { color: '#2A6DF4', weight: 4, opacity: 0.85 }).addTo(map);
      bounds = bounds.concat(routeLatLngs);
    }

    var workerIcon = L.divIcon({
      className: '',
      html: '<div class="dot-worker"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    var workerMarker = null;

    // Called via WebView.injectJavaScript for every live location push, so a
    // moving marker never forces the map/tiles to reload.
    window.setWorkerLocation = function (lat, lng) {
      if (workerMarker) {
        workerMarker.setLatLng([lat, lng]);
      } else {
        workerMarker = L.marker([lat, lng], { icon: workerIcon }).addTo(map).bindPopup(data.workerLabel);
        map.fitBounds([[data.destination.lat, data.destination.lng], [lat, lng]], { padding: [40, 40] });
      }
    };

    if (data.workerLocation) {
      window.setWorkerLocation(data.workerLocation.lat, data.workerLocation.lng);
      bounds.push([data.workerLocation.lat, data.workerLocation.lng]);
    }

    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  </script>
</body>
</html>`;
};

export const LeafletMap = forwardRef<LeafletMapHandle, Props>(function LeafletMap(
  { destination, destinationLabel, currentLocation, workerLocation, workerLabel, routeCoordinates, zoom, onMapReady, style },
  ref,
) {
  const webviewRef = useRef<WebView>(null);

  // Intentionally excludes workerLocation/workerLabel — live updates go
  // through the imperative handle below (injectJavaScript), not a re-render,
  // so the WebView/tiles never reload mid-tracking. Only the *initial* value
  // (captured at mount, via buildHtml's closure) seeds the first marker.
  const html = useMemo(
    () =>
      buildHtml({
        destination,
        destinationLabel,
        currentLocation,
        workerLocation,
        workerLabel,
        routeCoordinates,
        zoom,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destination.lat, destination.lng, destinationLabel, currentLocation?.lat, currentLocation?.lng, routeCoordinates, zoom],
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

  return (
    <WebView
      ref={webviewRef}
      source={{ html }}
      style={style ?? { flex: 1 }}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled
      startInLoadingState
      onLoadEnd={onMapReady}
    />
  );
});

export default LeafletMap;
