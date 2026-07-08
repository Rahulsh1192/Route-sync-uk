import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../data/models.dart';
import '../../data/repositories.dart';

/// Route preview with Watch / Practice actions. Both are premium-gated server-side;
/// a 403 here routes the user to the paywall.
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

  /// Pre-check entitlement so we can show the paywall instead of a raw 403.
  Future<void> _open(BuildContext context, String path) async {
    final ent = await context.read<SubscriptionRepository>().me();
    final isSample = summary?.isSample ?? false;
    if (!ent.isPremium && !(isSample && path.endsWith('/watch'))) {
      if (context.mounted) context.push('/paywall');
      return;
    }
    if (context.mounted) context.push(path);
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
