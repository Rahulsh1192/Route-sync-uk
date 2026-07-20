// API response models for RouteSync. Hand-written fromJson (no codegen) to keep
// the toolchain light. Field names mirror the NestJS API contracts.

class RouteSummary {
  RouteSummary({
    required this.id,
    required this.title,
    this.town,
    this.postcode,
    this.difficulty,
    this.distanceM,
    this.durationS,
    this.junctionCount,
    this.roundaboutCount,
    this.qualityScore,
    this.isSample = false,
    this.isInstructor = false,
  });

  final String id;
  final String title;
  final String? town;
  final String? postcode;
  final String? difficulty;
  final int? distanceM;
  final int? durationS;
  final int? junctionCount;
  final int? roundaboutCount;
  final int? qualityScore;
  final bool isSample;
  final bool isInstructor;

  factory RouteSummary.fromJson(Map<String, dynamic> j) => RouteSummary(
        id: j['id'] as String,
        title: j['title'] as String? ?? 'Untitled route',
        town: j['town'] as String?,
        postcode: j['postcode'] as String?,
        difficulty: j['difficulty'] as String?,
        distanceM: j['distanceM'] as int?,
        durationS: j['durationS'] as int?,
        junctionCount: j['junctionCount'] as int?,
        roundaboutCount: j['roundaboutCount'] as int?,
        qualityScore: j['qualityScore'] as int?,
        isSample: j['isSample'] as bool? ?? false,
        isInstructor: j['isInstructor'] as bool? ?? false,
      );

  String get distanceLabel =>
      distanceM == null ? '—' : '${(distanceM! / 1000).toStringAsFixed(1)} km';
  String get durationLabel {
    if (durationS == null) return '—';
    final m = (durationS! / 60).round();
    return '$m min';
  }
}

class VideoStream {
  VideoStream({required this.view, required this.url, required this.syncOffsetMs});
  final String view; // 'front' | 'rear'
  final String url;
  final int syncOffsetMs;

  factory VideoStream.fromJson(Map<String, dynamic> j) => VideoStream(
        view: j['view'] as String,
        url: j['url'] as String,
        syncOffsetMs: (j['syncOffsetMs'] as num?)?.toInt() ?? 0,
      );
}

class RouteMarker {
  RouteMarker({required this.tMs, required this.kind, this.label});
  final int tMs;
  final String kind; // 'junction' | 'roundabout'
  final String? label;

  factory RouteMarker.fromJson(Map<String, dynamic> j) => RouteMarker(
        tMs: (j['t_ms'] as num).toInt(),
        kind: j['kind'] as String,
        label: j['label'] as String?,
      );
}

class PlaybackManifest {
  PlaybackManifest({
    required this.routeId,
    required this.durationS,
    required this.streams,
    required this.markers,
  });
  final String routeId;
  final int durationS;
  final List<VideoStream> streams;
  final List<RouteMarker> markers;

  factory PlaybackManifest.fromJson(Map<String, dynamic> j) => PlaybackManifest(
        routeId: j['routeId'] as String,
        durationS: (j['durationS'] as num?)?.toInt() ?? 0,
        streams: (j['streams'] as List).map((e) => VideoStream.fromJson(e)).toList(),
        markers: (j['markers'] as List? ?? []).map((e) => RouteMarker.fromJson(e)).toList(),
      );

  VideoStream? streamFor(String view) {
    for (final s in streams) {
      if (s.view == view) return s;
    }
    return null;
  }
}

class Instruction {
  Instruction({
    required this.seq,
    required this.tMs,
    required this.type,
    required this.text,
    this.roundaboutExit,
    this.speedLimitMph,
  });
  final int seq;
  final int tMs;
  final String type;
  final String text;
  final int? roundaboutExit;
  final int? speedLimitMph;

  factory Instruction.fromJson(Map<String, dynamic> j) => Instruction(
        seq: (j['seq'] as num).toInt(),
        tMs: (j['t_ms'] as num).toInt(),
        type: j['type'] as String,
        text: j['text_ukenglish'] as String? ?? '',
        roundaboutExit: j['roundabout_exit'] as int?,
        speedLimitMph: j['speed_limit_mph'] as int?,
      );
}

class PracticeRoute {
  PracticeRoute({required this.routeId, required this.voice, required this.instructions});
  final String routeId;
  final String voice;
  final List<Instruction> instructions;

  factory PracticeRoute.fromJson(Map<String, dynamic> j) => PracticeRoute(
        routeId: j['routeId'] as String,
        voice: j['voice'] as String? ?? 'en-GB',
        instructions:
            (j['instructions'] as List).map((e) => Instruction.fromJson(e)).toList(),
      );
}

class Entitlements {
  Entitlements({required this.plan, required this.isPremium, this.premiumTestCentreIds = const []});
  final String plan;
  final bool isPremium;

  /// Test centres the user has active Premium for; `null` entries mean a
  /// universal/legacy grant. Premium is purchased per centre (Phase 19d).
  final List<String?> premiumTestCentreIds;

  factory Entitlements.fromJson(Map<String, dynamic> j) {
    final plan = j['plan'] as String? ?? 'free';
    final centres = (j['premiumTestCentreIds'] as List?)?.map((e) => e as String?).toList();
    return Entitlements(
      plan: plan,
      isPremium: (centres?.isNotEmpty ?? false) || plan != 'free',
      premiumTestCentreIds: centres ?? const [],
    );
  }
}

/// Server access decision for a single route (Phases 19b–19d). Mirrors
/// GET /routes/:id/access on the API.
class RouteAccess {
  RouteAccess({
    required this.allowed,
    required this.reason,
    this.testCentreId,
    required this.centreLabel,
  });

  final bool allowed;
  final String reason; // 'ok' | 'TEST_DETAILS_REQUIRED' | 'PAYWALL'
  final String? testCentreId;
  final String centreLabel;

  factory RouteAccess.fromJson(Map<String, dynamic> j) => RouteAccess(
        allowed: j['allowed'] as bool? ?? false,
        reason: j['reason'] as String? ?? 'PAYWALL',
        testCentreId: j['testCentreId'] as String?,
        centreLabel: j['centreLabel'] as String? ?? '',
      );
}

class TestCentre {
  TestCentre({required this.id, required this.name, this.town, this.postcode});
  final String id;
  final String name;
  final String? town;
  final String? postcode;

  factory TestCentre.fromJson(Map<String, dynamic> j) => TestCentre(
        id: j['id'] as String,
        name: j['name'] as String? ?? 'Test centre',
        town: j['town'] as String?,
        postcode: j['postcode'] as String?,
      );

  String get label => [name, if (town != null) town, if (postcode != null) '($postcode)'].join(' ');
}

class TestDetail {
  TestDetail({required this.testCentreId, required this.testDate});
  final String testCentreId;
  final String testDate; // ISO date

  factory TestDetail.fromJson(Map<String, dynamic> j) => TestDetail(
        testCentreId: j['testCentreId'] as String,
        testDate: (j['testDate'] as String?) ?? '',
      );
}

class TestDetails {
  TestDetails({this.current});
  final TestDetail? current;

  factory TestDetails.fromJson(Map<String, dynamic> j) => TestDetails(
        current: j['current'] == null
            ? null
            : TestDetail.fromJson(j['current'] as Map<String, dynamic>),
      );
}
