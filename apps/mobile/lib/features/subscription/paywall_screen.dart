import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Premium paywall. On mobile, purchases MUST go through Apple/Google IAP — wired
/// via RevenueCat (purchases_flutter). Web uses Stripe Checkout instead. After a
/// successful purchase RevenueCat's webhook updates the server-side entitlement.
class PaywallScreen extends StatelessWidget {
  const PaywallScreen({super.key});

  static const _features = [
    'Unlimited routes',
    'Practice mode with UK voice guidance',
    'Multi-view playback (front, rear, split, map)',
    'Offline downloads',
    'Verified instructor routes',
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('RouteSync Premium')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text('Unlock everything', style: Theme.of(context).textTheme.headlineMedium),
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
            period: 'per month',
            onTap: () => _purchase(context, 'premium_monthly'),
          ),
          const SizedBox(height: 12),
          _PlanCard(
            title: 'Yearly',
            price: '£29.99',
            period: 'per year — best value',
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
    // TODO: drive RevenueCat purchase flow:
    //   final offerings = await Purchases.getOfferings();
    //   await Purchases.purchasePackage(package);
    // RevenueCat webhook then updates the entitlement server-side.
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('IAP for $plan pending RevenueCat wiring')),
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
