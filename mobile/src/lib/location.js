// Coarse location for discovery. Privacy by design: coordinates are rounded
// to 2 decimals (~1 km) BEFORE leaving this function — the exact position
// never exists anywhere else in the app or the backend (architecture §9).
// Returns null quietly when permission is denied or location is unavailable;
// the deck then shows players without distances instead of breaking.
export async function getCoarseLocation() {
  try {
    const Location = require('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    return {
      lat: Math.round(pos.coords.latitude * 100) / 100,
      lng: Math.round(pos.coords.longitude * 100) / 100,
    };
  } catch (e) {
    return null;
  }
}
