/// Build-time configuration. Override with --dart-define at build/run time, e.g.
///   flutter run --dart-define=API_BASE_URL=https://api.routesync.uk
class Env {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000/api', // Android emulator -> host localhost
  );

  static const String mapTileUrl = String.fromEnvironment(
    'MAP_TILE_URL',
    defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  );

  static const String revenueCatApiKey = String.fromEnvironment('REVENUECAT_KEY');
}
