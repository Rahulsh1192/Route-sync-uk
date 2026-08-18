import '../core/api_client.dart';
import '../core/token_store.dart';
import 'models.dart';

class AuthRepository {
  AuthRepository(this._api, this._tokens);
  final ApiClient _api;
  final TokenStore _tokens;

  Future<void> login(String email, String password) async {
    final res = await _api.post('/auth/login', body: {'email': email, 'password': password});
    await _tokens.save(res['accessToken'], res['refreshToken']);
  }

  /// Create an account, or ask for another verification link for one that exists.
  ///
  /// Saves no tokens: the API issues none until the address is confirmed, and signing in is
  /// gated on that. Returns the masked address the link was sent to, for display.
  /// [displayName] is omitted when resending from the sign-in screen, which has no name field.
  /// The API requires it only to create an account.
  Future<String> register(String email, String password, String? displayName) async {
    final res = await _api.post('/auth/register', body: {
      'email': email,
      'password': password,
      if (displayName != null && displayName.isNotEmpty) 'displayName': displayName,
    });
    return (res['email'] as String?) ?? email;
  }

  Future<void> loginWithGoogle(String idToken, {String? displayName}) async {
    final res = await _api.post('/auth/oauth/google', body: {
      'token': idToken,
      if (displayName != null) 'displayName': displayName,
    });
    await _tokens.save(res['accessToken'], res['refreshToken']);
  }

  Future<void> loginWithApple(String identityToken, {String? displayName}) async {
    final res = await _api.post('/auth/oauth/apple', body: {
      'token': identityToken,
      if (displayName != null) 'displayName': displayName,
    });
    await _tokens.save(res['accessToken'], res['refreshToken']);
  }

  Future<void> logout() => _tokens.clear();
}

class RoutesRepository {
  RoutesRepository(this._api);
  final ApiClient _api;

  Future<List<RouteSummary>> list({String? cursor}) async {
    final res = await _api.get('/routes', query: {if (cursor != null) 'cursor': cursor});
    return (res['items'] as List).map((e) => RouteSummary.fromJson(e)).toList();
  }

  Future<List<RouteSummary>> search(Map<String, String> filters) async {
    final res = await _api.get('/search/routes', query: filters);
    return (res as List).map((e) => RouteSummary.fromJson(e)).toList();
  }

  Future<PlaybackManifest> playback(String routeId) async {
    final res = await _api.get('/routes/$routeId/playback');
    return PlaybackManifest.fromJson(res);
  }

  Future<PracticeRoute> practice(String routeId) async {
    final res = await _api.get('/routes/$routeId/practice');
    return PracticeRoute.fromJson(res);
  }

  /// Dry-run access decision (test-details / paywall / ok) without claiming the
  /// demo route. Lets the UI route the user to the right next step.
  Future<RouteAccess> access(String routeId) async {
    final res = await _api.get('/routes/$routeId/access');
    return RouteAccess.fromJson(res);
  }
}

/// Phase 19b: the user's test centre + date, required before using any route.
class TestDetailsRepository {
  TestDetailsRepository(this._api);
  final ApiClient _api;

  Future<TestDetails> get() async =>
      TestDetails.fromJson(await _api.get('/users/me/test-details'));

  Future<void> add(String testCentreId, String testDate) => _api.post(
        '/users/me/test-details',
        body: {'testCentreId': testCentreId, 'testDate': testDate},
      );

  Future<List<TestCentre>> searchCentres(String? q) async {
    final res = await _api.get('/search/test-centres',
        query: {if (q != null && q.isNotEmpty) 'q': q});
    return (res as List).map((e) => TestCentre.fromJson(e)).toList();
  }
}

class SubscriptionRepository {
  SubscriptionRepository(this._api);
  final ApiClient _api;

  Future<Entitlements> me() async {
    final res = await _api.get('/subscriptions/me');
    return Entitlements.fromJson(res);
  }
}

class CommunityRepository {
  CommunityRepository(this._api);
  final ApiClient _api;

  Future<void> acceptAgreement() => _api.post('/contributors/agreement');

  /// [adiExpiry] is `YYYY-MM-DD` and required by the API: a DVSA certificate is
  /// time-limited, so a verification without one could never be re-checked.
  Future<void> submitInstructor(
    String adiNumber,
    String adiExpiry,
    String? evidenceUrl,
  ) =>
      _api.post('/instructors/verify', body: {
        'adiNumber': adiNumber,
        'adiExpiry': adiExpiry,
        if (evidenceUrl != null) 'evidenceUrl': evidenceUrl,
      });

  Future<Map<String, dynamic>> instructorStatus() async =>
      (await _api.get('/instructors/me/status')) as Map<String, dynamic>;
}
