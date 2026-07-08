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

  Future<void> register(String email, String password, String displayName) async {
    final res = await _api.post('/auth/register',
        body: {'email': email, 'password': password, 'displayName': displayName});
    await _tokens.save(res['accessToken'], res['refreshToken']);
  }

  Future<void> loginWithGoogle(String idToken) async {
    final res = await _api.post('/auth/oauth/google', body: {'token': idToken});
    await _tokens.save(res['accessToken'], res['refreshToken']);
  }

  Future<void> loginWithApple(String identityToken) async {
    final res = await _api.post('/auth/oauth/apple', body: {'token': identityToken});
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

  Future<void> submitInstructor(String adiNumber, String? evidenceUrl) =>
      _api.post('/instructors/verify',
          body: {'adiNumber': adiNumber, if (evidenceUrl != null) 'evidenceUrl': evidenceUrl});

  Future<Map<String, dynamic>> instructorStatus() async =>
      (await _api.get('/instructors/me/status')) as Map<String, dynamic>;
}
