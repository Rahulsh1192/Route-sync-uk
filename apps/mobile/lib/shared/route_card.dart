import 'package:flutter/material.dart';

import '../data/models.dart';

class RouteCard extends StatelessWidget {
  const RouteCard({super.key, required this.route, required this.onTap});
  final RouteSummary route;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(route.title,
                        style: Theme.of(context).textTheme.titleMedium,
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                  ),
                  if (route.isInstructor)
                    Chip(
                      label: const Text('Instructor'),
                      visualDensity: VisualDensity.compact,
                      backgroundColor: scheme.tertiaryContainer,
                    ),
                  if (route.isSample)
                    const Chip(label: Text('Free'), visualDensity: VisualDensity.compact),
                ],
              ),
              if (route.town != null || route.postcode != null)
                Text([route.town, route.postcode].where((e) => e != null).join(' · '),
                    style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 12),
              Row(
                children: [
                  _stat(context, Icons.straighten, route.distanceLabel),
                  _stat(context, Icons.schedule, route.durationLabel),
                  if (route.roundaboutCount != null)
                    _stat(context, Icons.roundabout_right, '${route.roundaboutCount}'),
                  const Spacer(),
                  if (route.qualityScore != null)
                    _QualityBadge(score: route.qualityScore!),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _stat(BuildContext context, IconData icon, String label) => Padding(
        padding: const EdgeInsets.only(right: 16),
        child: Row(children: [
          Icon(icon, size: 16, color: Theme.of(context).colorScheme.outline),
          const SizedBox(width: 4),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ]),
      );
}

class _QualityBadge extends StatelessWidget {
  const _QualityBadge({required this.score});
  final int score;
  @override
  Widget build(BuildContext context) {
    final color = score >= 70
        ? Colors.green
        : score >= 50
            ? Colors.orange
            : Colors.red;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        border: Border.all(color: color),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text('$score', style: TextStyle(color: color, fontWeight: FontWeight.bold)),
    );
  }
}
