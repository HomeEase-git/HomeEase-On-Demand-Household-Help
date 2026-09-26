import React, { createRef } from "react";
import { act, render } from "@testing-library/react-native";
import Constants from "expo-constants";
import GoogleMap, { type GoogleMapHandle } from "../GoogleMap";

const mockFitToCoordinates = jest.fn();
const mockShowCallout = jest.fn();

// react-native-maps is a native module — stand in with plain host views that
// record their props, and expose the two imperative methods the map uses.
jest.mock("react-native-maps", () => {
  const React = require("react");
  const { View } = require("react-native");
  const MapView = React.forwardRef(function MockMapView(props: any, ref: any) {
    React.useImperativeHandle(ref, () => ({ fitToCoordinates: mockFitToCoordinates }));
    return <View testID="map" {...props} />;
  });
  const Marker = React.forwardRef(function MockMarker(props: any, ref: any) {
    React.useImperativeHandle(ref, () => ({ showCallout: mockShowCallout }));
    return <View testID={`marker:${props.title}`} {...props} />;
  });
  const Polyline = (props: any) => <View testID="route" {...props} />;
  return { __esModule: true, default: MapView, Marker, Polyline, PROVIDER_GOOGLE: "google" };
});

jest.mock("../../icons/AppIcon", () => ({ AppIcon: () => null }));
jest.mock("../../../constants", () => ({ colors: { accent: { DEFAULT: "#000" } } }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: { hasGoogleMapsKey: true } } } }));

const setBuildHasKey = (value: boolean) => ((Constants as any).expoConfig.extra.hasGoogleMapsKey = value);

const destination = { lat: 14.6, lng: 120.98 };

describe("GoogleMap (native)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setBuildHasKey(true);
  });

  it("shows a placeholder instead of mounting the native map when the build has no key", async () => {
    setBuildHasKey(false);
    const { queryByTestId, getByText } = await render(<GoogleMap destination={destination} />);
    expect(queryByTestId("map")).toBeNull();
    expect(getByText("Map unavailable in this build.")).toBeTruthy();
  });

  it("renders a Google-provider map centred on the destination with its callout open", async () => {
    const onMapReady = jest.fn();
    const { getByTestId } = await render(
      <GoogleMap destination={destination} destinationLabel="Home" zoom={16} onMapReady={onMapReady} />,
    );

    const map = getByTestId("map");
    expect(map.props.provider).toBe("google");
    expect(map.props.initialCamera.center).toEqual({ latitude: 14.6, longitude: 120.98 });
    expect(map.props.initialCamera.zoom).toBe(16);
    expect(getByTestId("marker:Home").props.coordinate).toEqual({ latitude: 14.6, longitude: 120.98 });

    await act(async () => map.props.onMapReady());
    expect(mockShowCallout).toHaveBeenCalled();
    expect(onMapReady).toHaveBeenCalled();
    // Only one point — nothing to fit.
    expect(mockFitToCoordinates).not.toHaveBeenCalled();
  });

  it("draws the route and fits the camera to it", async () => {
    const route = [destination, { lat: 14.65, lng: 121.0 }];
    const { getByTestId } = await render(<GoogleMap destination={destination} routeCoordinates={route} />);

    expect(getByTestId("route").props.coordinates).toHaveLength(2);
    await act(async () => getByTestId("map").props.onMapReady());
    expect(mockFitToCoordinates).toHaveBeenCalledTimes(1);
  });

  it("adds the worker marker on the first live update, fits once, then just moves it", async () => {
    const ref = createRef<GoogleMapHandle>();
    const { getByTestId, queryByTestId } = await render(
      <GoogleMap ref={ref} destination={destination} workerLabel="Maria" />,
    );
    await act(async () => getByTestId("map").props.onMapReady());
    expect(queryByTestId("marker:Maria")).toBeNull();

    await act(async () => ref.current!.updateWorkerLocation({ lat: 14.61, lng: 120.99 }));
    expect(getByTestId("marker:Maria").props.coordinate).toEqual({ latitude: 14.61, longitude: 120.99 });
    expect(mockFitToCoordinates).toHaveBeenCalledTimes(1);

    await act(async () => ref.current!.updateWorkerLocation({ lat: 14.62, lng: 121.0 }));
    expect(getByTestId("marker:Maria").props.coordinate).toEqual({ latitude: 14.62, longitude: 121.0 });
    expect(mockFitToCoordinates).toHaveBeenCalledTimes(1);
  });
});
