import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Premium paywall. On mobile, purchases MUST go through Apple/Google IAP — wired
/// via RevenueCat (purchases_flutter). Web uses Stripe Checkout instead. After a
/// successful purchase RevenueCat's webhook updates the server-side entitlement.
class PaywallScreen extends StatelessWidget {
  const PaywallScreen({super.key, this.testCentreId, this.centreLabel});

  /// The test centre this subscription unlocks. Premium is purchased per centre
  /// and is not switchable (Phase 19d).
  final String? testCentreId;
  final String? centreLabel;

  static const _features = [
    'Unlimited routes for the chosen test centre',
    'Practice mode with UK voice guidance',
    'Multi-view playback (front, rear, split, map)',
    'AI-generated learning summaries',
    'Offline downloads',
    'Verified instructor routes',
  ];

  static const _bookingNote =
      'Booking an instructor does not require Premium — anyone can book a lesson.';

  @override
  Widget build(BuildContext context) {
    final heading = centreLabel != null && centreLabel!.isNotEmpty
        ? 'Unlock $centreLabel'
        : 'Unlock a test centre';
    return Scaffold(
      appBar: AppBar(title: const Text('RouteSync Premium')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(heading, style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 8),
          Text(
            'Premium is purchased per test centre and is not switchable.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.grey),
          ),
          const SizedBox(height: 4),
          Text(_bookingNote,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.grey)),
          const SizedBox(height: 16),
          ..._features.map((f) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(children: [
                  const Icon(Icons.check_circle, color: Colors.green),
                  const SizedBox(width: 12),
                  Expanded(child: Text(f, style: Theme.of(context).textTheme.bodyLarge)),
                ]),
              )),
          const SizedBox(height: 24),
          _PlanCard(
            title: 'Monthly',
            price: '£4.99',
            period: 'per month · per test centre',
            onTap: () => _purchase(context, 'premium_monthly'),
          ),
          const SizedBox(height: 12),
          _PlanCard(
            title: 'Yearly',
            price: '£39.99',
            period: 'per year · per test centre — save 33%',
            highlight: true,
            onTap: () => _purchase(context, 'premium_yearly'),
          ),
          const SizedBox(height: 24),
          Text(
            'Payment is charged to your Apple/Google account. Subscriptions auto-renew '
            'unless cancelled at least 24 hours before the period ends.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }

  Future<void> _purchase(BuildContext context, String plan) async {
    // TODO: drive RevenueCat purchase flow. Premium is per test centre, so set
    // the subscriber attribute the webhook reads before purchasing:
    //   await Purchases.setAttributes({'test_centre_id': testCentreId ?? ''});
    //   final offerings = await Purchases.getOfferings();
    //   await Purchases.purchasePackage(package);
    // The RevenueCat webhook then attaches the entitlement to this centre.
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('IAP for $plan (centre: ${testCentreId ?? 'unset'}) pending RevenueCat wiring')),
    );
    if (context.mounted) context.pop();
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.title,
    required this.price,
    required this.period,
    required this.onTap,
    this.highlight = false,
  });
  final String title;
  final String price;
  final String period;
  final VoidCallback onTap;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: highlight ? scheme.primaryContainer : null,
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        title: Text(title, style: Theme.of(context).textTheme.titleLarge),
        subtitle: Text(period),
        trailing: Text(price, style: Theme.of(context).textTheme.headlineSmall),
        onTap: onTap,
      ),
    );
  }
}
