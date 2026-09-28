import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import Constants from "expo-constants";
import LocationPickerMap, {
  type LocationPickerMapHandle,
} from "../LocationPickerMap";
import * as locationService from "../../../services/location";
import * as geoUtils from "../../../utils/geo";

const mockAnimateToRegion = jest.fn();

jest.mock("react-native-maps", () => {
  const React = require("react");
  const { View } = require("react-native");
  const MapView = React.forwardRef(function MockMapView(props: any, ref: any) {
    React.useImperativeHandle(ref, () => ({
      animateToRegion: mockAnimateToRegion,
    }));
    return <View testID="map" {...props} />;
  });
  const Circle = (props: any) => <View testID="radius-circle" {...props} />;
  const Marker = (props: any) => <View testID="marker" {...props} />;
  return {
    __esModule: true,
    default: MapView,
    Circle,
    Marker,
    PROVIDER_GOOGLE: "google",
  };
});

jest.mock("../../icons/AppIcon", () => ({ AppIcon: () => null }));
jest.mock("../../../constants", () => ({
  colors: { accent: { DEFAULT: "#E63946" } },
}));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { hasGoogleMapsKey: true } } },
}));
jest.mock("../../../services/location", () => ({
  getPrecisePosition: jest.fn(),
  LocationPermissionDeniedError: class extends Error {},
  LocationTimeoutError: class extends Error {},
}));
jest.mock("../../../utils/geo", () => ({
  reverseGeocodeDetailed: jest.fn(),
}));

const setBuildHasKey = (value: boolean) =>
  ((Constants as any).expoConfig.extra.hasGoogleMapsKey = value);

describe("LocationPickerMap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setBuildHasKey(true);
  });

  it("shows MapUnavailable when Maps SDK key is not configured", async () => {
    setBuildHasKey(false);
    const { queryByTestId, getByText } = await render(<LocationPickerMap />);
    expect(queryByTestId("map")).toBeNull();
    expect(getByText("Map unavailable in this build.")).toBeTruthy();
  });

  it("renders Google map and locate button when key is configured", async () => {
    const { getByTestId, getByLabelText } = await render(<LocationPickerMap />);
    expect(getByTestId("map")).toBeTruthy();
    expect(getByLabelText("Locate current position")).toBeTruthy();
  });

  it("renders service radius circle when serviceRadiusKm is provided", async () => {
    const { getByTestId } = await render(
      <LocationPickerMap serviceRadiusKm={10} />,
    );
    const circle = getByTestId("radius-circle");
    expect(circle).toBeTruthy();
    expect(circle.props.radius).toBe(10000); // 10km in meters
  });

  it("triggers GPS locate and camera animation when Locate button is tapped", async () => {
    (locationService.getPrecisePosition as jest.Mock).mockResolvedValue({
      lat: 14.85,
      lng: 120.82,
      accuracy: 10,
    });
    (geoUtils.reverseGeocodeDetailed as jest.Mock).mockResolvedValue({
      formatted_address: "Malolos City Hall, Bulacan",
      geometry: { location: { lat: 14.85, lng: 120.82 } },
      components: { city: "Malolos", state: "Bulacan" },
    });

    const onLocationSelected = jest.fn();
    const { getByLabelText } = await render(
      <LocationPickerMap onLocationSelected={onLocationSelected} />,
    );

    const locateButton = getByLabelText("Locate current position");
    await act(async () => {
      fireEvent.press(locateButton);
    });

    expect(locationService.getPrecisePosition).toHaveBeenCalledTimes(1);
    expect(mockAnimateToRegion).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: 14.85,
        longitude: 120.82,
      }),
      700,
    );
    expect(geoUtils.reverseGeocodeDetailed).toHaveBeenCalledWith(14.85, 120.82);
    expect(onLocationSelected).toHaveBeenCalledWith(
      { lat: 14.85, lng: 120.82 },
      expect.objectContaining({
        formatted_address: "Malolos City Hall, Bulacan",
      }),
    );
  });

  it("calls reverseGeocodeDetailed when map region drag finishes", async () => {
    (geoUtils.reverseGeocodeDetailed as jest.Mock).mockResolvedValue({
      formatted_address: "Bulacan State University",
      geometry: { location: { lat: 14.86, lng: 120.81 } },
      components: { city: "Malolos" },
    });

    const onLocationSelected = jest.fn();
    const { getByTestId } = await render(
      <LocationPickerMap onLocationSelected={onLocationSelected} />,
    );

    const map = getByTestId("map");
    await act(async () => {
      map.props.onRegionChangeComplete({
        latitude: 14.86,
        longitude: 120.81,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      });
    });

    expect(geoUtils.reverseGeocodeDetailed).toHaveBeenCalledWith(14.86, 120.81);
    expect(onLocationSelected).toHaveBeenCalledWith(
      { lat: 14.86, lng: 120.81 },
      expect.objectContaining({
        formatted_address: "Bulacan State University",
      }),
    );
  });

  it("supports imperative handle animateTo", async () => {
    const ref = React.createRef<LocationPickerMapHandle>();
    await render(<LocationPickerMap ref={ref} />);

    await act(async () => {
      ref.current?.animateTo({ lat: 14.7, lng: 121.0 });
    });

    expect(mockAnimateToRegion).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: 14.7,
        longitude: 121.0,
      }),
      600,
    );
  });
});
