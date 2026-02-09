export async function getUserLocation() {
  if (!navigator.geolocation) {
    throw new Error("This browser does not support geolocation.");
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () =>
        reject(
          new Error("Location access is required to find nearby CTA stops."),
        ),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000,
      },
    );
  });
}
