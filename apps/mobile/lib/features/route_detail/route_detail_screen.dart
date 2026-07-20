import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../data/models.dart';
import '../../data/repositories.dart';

/// Route preview with Watch / Practice actions. Access is decided server-side
/// (test-details gate → per-centre Premium → one-route demo allowance); we route
/// the user to the test-details screen, the paywall, or the player accordingly.
class RouteDetailScreen extends StatelessWidget {
  const RouteDetailScreen({super.key, required this.routeId, this.summary});
  final String routeId;
  final RouteSummary? summary;

  @override
  Widget build(BuildContext context) {
    final r = summary;
    return Scaffold(
      appBar: AppBar(title: Text(r?.title ?? 'Route')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (r != null) ...[
            Text(r.title, style: Theme.of(context).textTheme.headlineSmall),
            if (r.town != null) Text(r.town!, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 16),
            Wrap(spacing: 12, runSpacing: 12, children: [
              _Metric(icon: Icons.straighten, label: 'Distance', value: r.distanceLabel),
              _Metric(icon: Icons.schedule, label: 'Duration', value: r.durationLabel),
              _Metric(
                  icon: Icons.roundabout_right,
                  label: 'Roundabouts',
                  value: '${r.roundaboutCount ?? '—'}'),
              _Metric(
                  icon: Icons.fork_right,
                  label: 'Junctions',
                  value: '${r.junctionCount ?? '—'}'),
            ]),
            const SizedBox(height: 24),
          ],
          FilledButton.icon(
            icon: const Icon(Icons.play_circle),
            label: const Text('Watch route'),
            onPressed: () => _open(context, '/route/$routeId/watch'),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            icon: const Icon(Icons.navigation),
            label: const Text('Practice route'),
            onPressed: () => _open(context, '/route/$routeId/practice'),
          ),
          const SizedBox(height: 24),
          Text('Practice mode gives turn-by-turn UK-English voice guidance with no video — '
              'just like your real test.',
              style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }

  /// Ask the server whether this route is accessible, then route accordingly:
  /// collect test details, show the paywall (with the centre), or open the player.
  Future<void> _open(BuildContext context, String path) async {
    final RouteAccess access;
    try {
      access = await context.read<RoutesRepository>().access(routeId);
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
      return;
    }
    if (!context.mounted) return;

    if (access.reason == 'TEST_DETAILS_REQUIRED') {
      context.push('/test-details', extra: '/route/$routeId');
      return;
    }
    if (!access.allowed) {
      context.push('/paywall', extra: {
        'testCentreId': access.testCentreId,
        'centreLabel': access.centreLabel,
      });
      return;
    }
    context.push(path);
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 150,
      child: Row(children: [
        Icon(icon, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: 8),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value, style: Theme.of(context).textTheme.titleMedium),
            Text(label, style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ]),
    );
  }
}
