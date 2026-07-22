import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:provider/provider.dart';

import 'core/api_client.dart';
import 'core/router.dart';
import 'core/token_store.dart';
import 'data/repositories.dart';
import 'features/auth/auth_controller.dart';
import 'theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  final tokens = TokenStore(const FlutterSecureStorage());
  final api = ApiClient(tokens);

  runApp(RouteSyncApp(tokens: tokens, api: api));
}

class RouteSyncApp extends StatelessWidget {
  const RouteSyncApp({super.key, required this.tokens, required this.api});
  final TokenStore tokens;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: api),
        Provider<TokenStore>.value(value: tokens),
        Provider<AuthRepository>(create: (_) => AuthRepository(api, tokens)),
        Provider<RoutesRepository>(create: (_) => RoutesRepository(api)),
        Provider<TestDetailsRepository>(create: (_) => TestDetailsRepository(api)),
        Provider<SubscriptionRepository>(create: (_) => SubscriptionRepository(api)),
        Provider<CommunityRepository>(create: (_) => CommunityRepository(api)),
        ChangeNotifierProvider<AuthController>(
          create: (ctx) => AuthController(ctx.read<AuthRepository>(), tokens),
        ),
      ],
      child: const _AppView(),
    );
  }
}

/// Builds the router exactly once (it reacts to auth changes via refreshListenable).
class _AppView extends StatefulWidget {
  const _AppView();
  @override
  State<_AppView> createState() => _AppViewState();
}

class _AppViewState extends State<_AppView> {
  late final router = buildRouter(context.read<AuthController>());

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Test Routify',
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.system,
      routerConfig: router,
      debugShowCheckedModeBanner: false,
    );
  }
}
