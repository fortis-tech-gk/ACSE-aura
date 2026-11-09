import { Alert, Linking } from 'react-native';

/** Meet venue: Dr. A.C.S. College of Engineering, Kambipura (same pin as the website) */
export const VENUE = {
  name: 'Dr. A.C.S. College of Engineering',
  address: '#207, Kambipura, Mysore Road, Kengeri Hobli, Bengaluru 560074',
  lat: 12.8910233,
  lng: 77.4655618,
};

/**
 * Open turn-by-turn directions to the venue from the athlete's current location.
 * The Google Maps URL opens the Maps app on Android and iPhone (or the browser if it is missing).
 */
export async function openVenueDirections(): Promise<void> {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${VENUE.lat},${VENUE.lng}&travelmode=driving`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Could not open Maps', `${VENUE.name}\n${VENUE.address}`);
  }
}
