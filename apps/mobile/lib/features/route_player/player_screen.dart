import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import 'package:video_player/video_player.dart';

import '../../core/env.dart';
import '../../data/repositories.dart';
import 'master_timeline.dart';

enum ViewMode { front, rear, split, map }

class PlayerScreen extends StatefulWidget {
  const PlayerScreen({super.key, required this.routeId});
  final String routeId;

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  MasterTimelineController? _ctrl;
  ViewMode _mode = ViewMode.front;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final manifest = await context.read<RoutesRepository>().playback(widget.routeId);
      final ctrl = MasterTimelineController(manifest);
      await ctrl.init();
      if (mounted) setState(() => _ctrl = ctrl);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  @override
  void dispose() {
    _ctrl?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: const Text('Watch route'),
      ),
      body: _error != null
          ? Center(child: Text(_error!, style: const TextStyle(color: Colors.white70)))
          : _ctrl == null || !_ctrl!.initialised
              ? const Center(child: CircularProgressIndicator())
              : _buildPlayer(_ctrl!),
    );
  }

  Widget _buildPlayer(MasterTimelineController c) {
    return Column(
      children: [
        Expanded(child: _buildView(c)),
        _Hud(controller: c),
        _Scrubber(controller: c),
        _Controls(
          controller: c,
          mode: _mode,
          onMode: (m) => setState(() => _mode = m),
        ),
      ],
    );
  }

  Widget _buildView(MasterTimelineController c) {
    switch (_mode) {
      case ViewMode.front:
        return _video(c.front);
      case ViewMode.rear:
        return _video(c.rear);
      case ViewMode.split:
        return Column(
          children: [
            Expanded(child: _video(c.front)),
            const Divider(height: 1, color: Colors.white24),
            Expanded(child: _video(c.rear)),
          ],
        );
      case ViewMode.map:
        return _MapView(controller: c);
    }
  }

  Widget _video(VideoPlayerController? vc) {
    if (vc == null || !vc.value.isInitialized) {
      return const Center(
        child: Text('No footage for this view', style: TextStyle(color: Colors.white54)),
      );
    }
    return Center(
      child: AspectRatio(aspectRatio: vc.value.aspectRatio, child: VideoPlayer(vc)),
    );
  }
}

class _Hud extends StatelessWidget {
  const _Hud({required this.controller});
  final MasterTimelineController controller;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: controller.positionMs,
      builder: (context, ms, _) {
        final marker = controller.markerAt(ms);
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          color: Colors.black,
          child: Row(
            children: [
              Text(_fmt(ms), style: const TextStyle(color: Colors.white)),
              const Spacer(),
              if (marker != null)
                Row(children: [
                  Icon(
                    marker.kind == 'roundabout' ? Icons.roundabout_right : Icons.turn_right,
                    color: Colors.amber,
                    size: 18,
                  ),
                  const SizedBox(width: 6),
                  Text(marker.label ?? marker.kind,
                      style: const TextStyle(color: Colors.amber)),
                ]),
              const Spacer(),
              Text(_fmt(controller.durationMs), style: const TextStyle(color: Colors.white70)),
            ],
          ),
        );
      },
    );
  }

  String _fmt(int ms) {
    final s = ms ~/ 1000;
    return '${(s ~/ 60).toString().padLeft(2, '0')}:${(s % 60).toString().padLeft(2, '0')}';
  }
}

class _Scrubber extends StatelessWidget {
  const _Scrubber({required this.controller});
  final MasterTimelineController controller;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: controller.positionMs,
      builder: (context, ms, _) {
        final maxMs = controller.durationMs.toDouble();
        final max = maxMs < 1 ? 1.0 : maxMs;
        final value = ms.toDouble().clamp(0.0, max);
        return Slider(
          value: value,
          max: max,
          onChanged: (v) => controller.seekTo(v.round()),
        );
      },
    );
  }
}

class _Controls extends StatelessWidget {
  const _Controls({required this.controller, required this.mode, required this.onMode});
  final MasterTimelineController controller;
  final ViewMode mode;
  final ValueChanged<ViewMode> onMode;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black,
      padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
      child: Column(
        children: [
          AnimatedBuilder(
            animation: controller,
            builder: (context, _) => Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  iconSize: 40,
                  color: Colors.white,
                  icon: Icon(controller.isPlaying ? Icons.pause_circle : Icons.play_circle),
                  onPressed: controller.togglePlay,
                ),
                const SizedBox(width: 12),
                // slow-motion toggle (scales rate on all streams together)
                TextButton(
                  onPressed: () => controller.setRate(controller.rate == 1.0 ? 0.5 : 1.0),
                  child: Text(controller.rate == 1.0 ? '0.5×' : '1×',
                      style: const TextStyle(color: Colors.white)),
                ),
              ],
            ),
          ),
          SegmentedButton<ViewMode>(
            segments: const [
              ButtonSegment(value: ViewMode.front, label: Text('Front')),
              ButtonSegment(value: ViewMode.rear, label: Text('Rear')),
              ButtonSegment(value: ViewMode.split, label: Text('Split')),
              ButtonSegment(value: ViewMode.map, label: Text('Map')),
            ],
            selected: {mode},
            onSelectionChanged: (s) => onMode(s.first),
          ),
        ],
      ),
    );
  }
}

/// Map view: OSM tiles + marker overlay. Drawing the actual driven polyline needs
/// a track-geometry endpoint (route_track_points) — TODO: add lat/lon to the
/// playback manifest so markers and the route line can be placed precisely.
class _MapView extends StatelessWidget {
  const _MapView({required this.controller});
  final MasterTimelineController controller;

  @override
  Widget build(BuildContext context) {
    return FlutterMap(
      options: const MapOptions(
        initialCenter: LatLng(52.4862, -1.8904), // UK default until geometry lands
        initialZoom: 12,
      ),
      children: [
        TileLayer(urlTemplate: Env.mapTileUrl, userAgentPackageName: 'uk.routesync'),
        // marker pins require coordinates from the API (see class doc)
      ],
    );
  }
}
