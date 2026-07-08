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
  Entitlements({required this.plan, required this.isPremium});
  final String plan;
  final bool isPremium;

  factory Entitlements.fromJson(Map<String, dynamic> j) {
    final plan = j['plan'] as String? ?? 'free';
    return Entitlements(plan: plan, isPremium: plan != 'free');
  }
}
