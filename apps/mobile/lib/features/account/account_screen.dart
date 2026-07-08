import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../data/models.dart';
import '../../data/repositories.dart';
import '../auth/auth_controller.dart';

class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ListView(
        children: [
          FutureBuilder<Entitlements>(
            future: context.read<SubscriptionRepository>().me(),
            builder: (context, snap) {
              final ent = snap.data;
              return Card(
                margin: const EdgeInsets.all(16),
                child: ListTile(
                  leading: Icon(ent?.isPremium == true ? Icons.workspace_premium : Icons.person),
                  title: Text(ent == null
                      ? 'Loading…'
                      : ent.isPremium
                          ? 'Premium (${ent.plan})'
                          : 'Free plan'),
                  subtitle: ent?.isPremium == true
                      ? const Text('All features unlocked')
                      : const Text('1 sample route'),
                  trailing: ent?.isPremium == true
                      ? null
                      : FilledButton(
                          onPressed: () => context.push('/paywall'),
                          child: const Text('Upgrade'),
                        ),
                ),
              );
            },
          ),
          ListTile(
            leading: const Icon(Icons.upload_outlined),
            title: const Text('Contribute a route'),
            subtitle: const Text('Upload front + rear dashcam clips and a GPX track'),
            onTap: () => context.push('/upload'),
          ),
          ListTile(
            leading: const Icon(Icons.verified_outlined),
            title: const Text('Become a verified instructor'),
            onTap: () => context.push('/instructor-verify'),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.logout),
            title: const Text('Sign out'),
            onTap: () => context.read<AuthController>().logout(),
          ),
        ],
      ),
    );
  }
}
