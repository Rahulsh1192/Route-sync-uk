import 'package:flutter_test/flutter_test.dart';
import 'package:routesync/data/models.dart';

void main() {
  group('RouteSummary', () {
    test('parses JSON and formats labels', () {
      final r = RouteSummary.fromJson({
        'id': 'abc',
        'title': 'Mill Hill test route',
        'town': 'Mill Hill',
        'distanceM': 8200,
        'durationS': 1500,
        'roundaboutCount': 4,
        'qualityScore': 82,
        'isInstructor': true,
      });
      expect(r.title, 'Mill Hill test route');
      expect(r.distanceLabel, '8.2 km');
      expect(r.durationLabel, '25 min');
      expect(r.isInstructor, true);
    });
  });

  group('PlaybackManifest', () {
    test('parses streams + markers and finds a view', () {
      final m = PlaybackManifest.fromJson({
        'routeId': 'r1',
        'durationS': 120,
        'streams': [
          {'view': 'front', 'url': 'https://x/front.m3u8', 'syncOffsetMs': 0},
          {'view': 'rear', 'url': 'https://x/rear.m3u8', 'syncOffsetMs': 250},
        ],
        'markers': [
          {'t_ms': 5000, 'kind': 'junction', 'label': 'Turn left'},
        ],
      });
      expect(m.streams.length, 2);
      expect(m.streamFor('rear')!.syncOffsetMs, 250);
      expect(m.markers.first.kind, 'junction');
    });
  });

  group('PracticeRoute', () {
    test('parses instructions', () {
      final p = PracticeRoute.fromJson({
        'routeId': 'r1',
        'voice': 'en-GB',
        'instructions': [
          {'seq': 0, 't_ms': 0, 'type': 'start', 'text_ukenglish': 'Start the route'},
          {'seq': 1, 't_ms': 8000, 'type': 'turn_left', 'text_ukenglish': 'Turn left'},
        ],
      });
      expect(p.voice, 'en-GB');
      expect(p.instructions.length, 2);
      expect(p.instructions[1].text, 'Turn left');
    });
  });
}
