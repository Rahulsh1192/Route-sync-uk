import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/models.dart';
import '../../data/repositories.dart';
import 'tts_service.dart';

/// Practice mode: turn-by-turn UK-English voice guidance with NO video, driven by
/// a synthetic timeline clock. Each instruction is spoken as its timestamp passes.
class PracticeScreen extends StatefulWidget {
  const PracticeScreen({super.key, required this.routeId});
  final String routeId;

  @override
  State<PracticeScreen> createState() => _PracticeScreenState();
}

class _PracticeScreenState extends State<PracticeScreen> {
  final _tts = TtsService();
  PracticeRoute? _route;
  String? _error;

  Timer? _timer;
  int _elapsedMs = 0;
  int _nextIndex = 0;
  bool _running = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await context.read<RoutesRepository>().practice(widget.routeId);
      if (mounted) setState(() => _route = r);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _tts.dispose();
    super.dispose();
  }

  void _start() {
    final route = _route;
    if (route == null) return;
    setState(() => _running = true);
    // announce the first instruction immediately
    if (_nextIndex < route.instructions.length && route.instructions[_nextIndex].tMs == 0) {
      _speak(route.instructions[_nextIndex]);
      _nextIndex++;
    }
    _timer = Timer.periodic(const Duration(milliseconds: 200), (_) {
      _elapsedMs += 200;
      while (_nextIndex < route.instructions.length &&
          route.instructions[_nextIndex].tMs <= _elapsedMs) {
        _speak(route.instructions[_nextIndex]);
        _nextIndex++;
      }
      if (_nextIndex >= route.instructions.length) {
        _timer?.cancel();
        setState(() => _running = false);
      } else {
        setState(() {});
      }
    });
  }

  void _pause() {
    _timer?.cancel();
    _tts.stop();
    setState(() => _running = false);
  }

  void _restart() {
    _timer?.cancel();
    _tts.stop();
    setState(() {
      _elapsedMs = 0;
      _nextIndex = 0;
      _running = false;
    });
  }

  void _speak(Instruction i) => _tts.speak(i.text);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Practice route')),
      body: _error != null
          ? Center(child: Text(_error!))
          : _route == null
              ? const Center(child: CircularProgressIndicator())
              : _build(_route!),
    );
  }

  Widget _build(PracticeRoute route) {
    final upcoming = _nextIndex < route.instructions.length
        ? route.instructions[_nextIndex]
        : null;
    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(24),
          color: Theme.of(context).colorScheme.primaryContainer,
          child: Column(
            children: [
              Text('NEXT', style: Theme.of(context).textTheme.labelSmall),
              const SizedBox(height: 8),
              Text(
                upcoming?.text ?? 'Route complete',
                style: Theme.of(context).textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              if (upcoming?.speedLimitMph != null) ...[
                const SizedBox(height: 8),
                Chip(label: Text('${upcoming!.speedLimitMph} mph limit')),
              ],
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            itemCount: route.instructions.length,
            itemBuilder: (context, i) {
              final ins = route.instructions[i];
              final done = i < _nextIndex;
              return ListTile(
                leading: Icon(_iconFor(ins.type),
                    color: done ? Colors.grey : Theme.of(context).colorScheme.primary),
                title: Text(ins.text,
                    style: TextStyle(
                        decoration: done ? TextDecoration.lineThrough : null,
                        color: done ? Colors.grey : null)),
                trailing: Text(_fmt(ins.tMs), style: Theme.of(context).textTheme.bodySmall),
              );
            },
          ),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _running ? _pause : _start,
                    icon: Icon(_running ? Icons.pause : Icons.play_arrow),
                    label: Text(_running ? 'Pause' : 'Start practice'),
                  ),
                ),
                const SizedBox(width: 12),
                OutlinedButton(onPressed: _restart, child: const Icon(Icons.replay)),
              ],
            ),
          ),
        ),
      ],
    );
  }

  IconData _iconFor(String type) {
    if (type.contains('roundabout')) return Icons.roundabout_right;
    if (type.contains('left')) return Icons.turn_left;
    if (type.contains('right')) return Icons.turn_right;
    if (type == 'destination') return Icons.flag;
    if (type == 'start') return Icons.my_location;
    return Icons.straight;
  }

  String _fmt(int ms) {
    final s = ms ~/ 1000;
    return '${(s ~/ 60).toString().padLeft(2, '0')}:${(s % 60).toString().padLeft(2, '0')}';
  }
}
