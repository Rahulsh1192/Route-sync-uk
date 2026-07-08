import 'package:go_router/go_router.dart';

import '../data/models.dart';
import '../features/account/account_screen.dart';
import '../features/auth/auth_controller.dart';
import '../features/auth/login_screen.dart';
import '../features/contribute/instructor_verify_screen.dart';
import '../features/contribute/upload_screen.dart';
import '../features/home/home_screen.dart';
import '../features/practice/practice_screen.dart';
import '../features/route_detail/route_detail_screen.dart';
import '../features/route_player/player_screen.dart';
import '../features/search/search_screen.dart';
import '../features/shell/app_shell.dart';
import '../features/subscription/paywall_screen.dart';

GoRouter buildRouter(AuthController auth) {
  return GoRouter(
    initialLocation: '/home',
    refreshListenable: auth,
    redirect: (context, state) {
      if (auth.status == AuthStatus.unknown) return null;
      final loggedIn = auth.status == AuthStatus.authenticated;
      final atLogin = state.matchedLocation == '/login';
      if (!loggedIn) return atLogin ? null : '/login';
      if (atLogin) return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),

      // bottom-nav shell
      ShellRoute(
        builder: (context, state, child) =>
            AppShell(location: state.matchedLocation, child: child),
        routes: [
          GoRoute(path: '/home', builder: (_, __) => const HomeScreen()),
          GoRoute(path: '/search', builder: (_, __) => const SearchScreen()),
          GoRoute(path: '/account', builder: (_, __) => const AccountScreen()),
        ],
      ),

      // full-screen routes
      GoRoute(
        path: '/route/:id',
        builder: (context, state) => RouteDetailScreen(
          routeId: state.pathParameters['id']!,
          summary: state.extra as RouteSummary?,
        ),
      ),
      GoRoute(
        path: '/route/:id/watch',
        builder: (context, state) => PlayerScreen(routeId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/route/:id/practice',
        builder: (context, state) => PracticeScreen(routeId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/paywall', builder: (_, __) => const PaywallScreen()),
      GoRoute(path: '/upload', builder: (_, __) => const UploadScreen()),
      GoRoute(path: '/instructor-verify', builder: (_, __) => const InstructorVerifyScreen()),
    ],
  );
}
