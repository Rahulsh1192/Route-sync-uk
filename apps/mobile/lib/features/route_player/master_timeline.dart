import 'package:flutter/foundation.dart';
import 'package:video_player/video_player.dart';

import '../../data/models.dart';

/// The master timeline controller (architecture §9).
///
/// One logical `position` (in route-master milliseconds) drives every view. The
/// front stream is the pacing reference; the rear stream is kept in lock-step,
/// each shifted by its own `syncOffsetMs` so all views render the same instant on
/// the route. Scrubbing sets the master position and fans seeks out to both
/// streams. View modes only change rendering — never the clock.
class MasterTimelineController extends ChangeNotifier {
  MasterTimelineController(this.manifest);

  final PlaybackManifest manifest;

  VideoPlayerController? front;
  VideoPlayerController? rear;
  bool initialised = false;
  bool isPlaying = false;
  double rate = 1.0;
  String? error;

  /// Master position in milliseconds along the route.
  final ValueNotifier<int> positionMs = ValueNotifier<int>(0);

  int get durationMs => manifest.durationS * 1000;
  int _frontOffset = 0;
  int _rearOffset = 0;
  static const _resyncThresholdMs = 250;

  Future<void> init() async {
    try {
      final f = manifest.streamFor('front');
      final r = manifest.streamFor('rear');
      _frontOffset = f?.syncOffsetMs ?? 0;
      _rearOffset = r?.syncOffsetMs ?? 0;

      if (f != null) {
        front = VideoPlayerController.networkUrl(Uri.parse(f.url));
        await front!.initialize();
        await front!.setLooping(false);
        front!.addListener(_onFrontTick);
      }
      if (r != null) {
        rear = VideoPlayerController.networkUrl(Uri.parse(r.url));
        await rear!.initialize();
        await rear!.setLooping(false);
      }
      initialised = true;
    } catch (e) {
      error = 'Could not load video: $e';
    }
    notifyListeners();
  }

  /// Front is the reference: derive master position from it and keep rear aligned.
  void _onFrontTick() {
    final f = front;
    if (f == null || !f.value.isInitialized) return;
    final master = f.value.position.inMilliseconds + _frontOffset;
    positionMs.value = master.clamp(0, durationMs);

    final r = rear;
    if (r != null && r.value.isInitialized && isPlaying) {
      final target = (master - _rearOffset).clamp(0, durationMs);
      final drift = (r.value.position.inMilliseconds - target).abs();
      if (drift > _resyncThresholdMs) {
        r.seekTo(Duration(milliseconds: target));
      }
    }

    if (f.value.position >= f.value.duration && isPlaying) {
      pause();
    }
  }

  Future<void> play() async {
    isPlaying = true;
    await front?.play();
    await rear?.play();
    notifyListeners();
  }

  Future<void> pause() async {
    isPlaying = false;
    await front?.pause();
    await rear?.pause();
    notifyListeners();
  }

  Future<void> togglePlay() => isPlaying ? pause() : play();

  /// Scrub: set the master position; fan seeks to both streams with their offsets.
  Future<void> seekTo(int masterMs) async {
    final m = masterMs.clamp(0, durationMs);
    positionMs.value = m;
    await front?.seekTo(Duration(milliseconds: (m - _frontOffset).clamp(0, durationMs)));
    await rear?.seekTo(Duration(milliseconds: (m - _rearOffset).clamp(0, durationMs)));
  }

  Future<void> setRate(double r) async {
    rate = r;
    await front?.setPlaybackSpeed(r);
    await rear?.setPlaybackSpeed(r);
    notifyListeners();
  }

  /// Nearest marker at or before the current position (for HUD context).
  RouteMarker? markerAt(int ms) {
    RouteMarker? current;
    for (final m in manifest.markers) {
      if (m.tMs <= ms) current = m;
    }
    return current;
  }

  @override
  void dispose() {
    front?.removeListener(_onFrontTick);
    front?.dispose();
    rear?.dispose();
    positionMs.dispose();
    super.dispose();
  }
}
