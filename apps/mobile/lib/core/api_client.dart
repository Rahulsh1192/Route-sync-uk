import 'package:dio/dio.dart';

import 'env.dart';
import 'token_store.dart';

/// Thrown for non-2xx API responses, carrying the server's problem+json title and, when the
/// server sends one, its stable `code` (e.g. `email_not_verified`). Branch on [code] rather
/// than on [message], which is copy and will change.
class ApiException implements Exception {
  ApiException(this.statusCode, this.message, {this.code});
  final int? statusCode;
  final String message;
  final String? code;
  @override
  String toString() => message;
}

/// Dio-based API client. Attaches the bearer token, and transparently refreshes
/// it once on a 401 using the stored refresh token (rotating refresh tokens).
class ApiClient {
  ApiClient(this._tokens) {
    _dio = Dio(BaseOptions(
      baseUrl: Env.apiBaseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json'},
    ));
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _tokens.accessToken;
        if (token != null) options.headers['Authorization'] = 'Bearer $token';
        handler.next(options);
      },
      onError: (e, handler) async {
        if (e.response?.statusCode == 401 && !_isAuthPath(e.requestOptions.path)) {
          final refreshed = await _tryRefresh();
          if (refreshed) {
            // replay the original request with the new token
            final token = await _tokens.accessToken;
            final opts = e.requestOptions;
            opts.headers['Authorization'] = 'Bearer $token';
            try {
              final res = await _dio.fetch(opts);
              return handler.resolve(res);
            } catch (_) {/* fall through to error */}
          } else {
            // Refresh failed → the session is over. Tell the app so it can send
            // the user back to login (and explain if another device took over).
            onSessionExpired?.call(sessionInvalidated: _sessionInvalidated);
          }
        }
        handler.next(e);
      },
    ));
  }

  late final Dio _dio;
  final TokenStore _tokens;
  bool _refreshing = false;
  bool _sessionInvalidated = false;

  /// Called when a request could not be authorised and refresh failed. The app
  /// (AuthController) registers this to force a logout. `sessionInvalidated` is
  /// true when the backend reported SESSION_INVALIDATED (single-session ADI rule).
  void Function({required bool sessionInvalidated})? onSessionExpired;

  bool _isAuthPath(String path) => path.contains('/auth/');

  Future<bool> _tryRefresh() async {
    if (_refreshing) return false;
    _refreshing = true;
    _sessionInvalidated = false;
    try {
      final refresh = await _tokens.refreshToken;
      if (refresh == null) return false;
      final res = await Dio(BaseOptions(baseUrl: Env.apiBaseUrl))
          .post('/auth/refresh', data: {'refreshToken': refresh});
      await _tokens.save(res.data['accessToken'], res.data['refreshToken']);
      return true;
    } on DioException catch (e) {
      // Distinguish "another device logged in" (single-session) from a plain
      // expired/absent token, so the UI can show a meaningful message.
      if (e.response?.data.toString().contains('SESSION_INVALIDATED') ?? false) {
        _sessionInvalidated = true;
      }
      await _tokens.clear();
      return false;
    } catch (_) {
      await _tokens.clear();
      return false;
    } finally {
      _refreshing = false;
    }
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) =>
      _unwrap(() => _dio.get(path, queryParameters: query));

  Future<dynamic> post(String path, {Object? body}) =>
      _unwrap(() => _dio.post(path, data: body));

  Future<dynamic> patch(String path, {Object? body}) =>
      _unwrap(() => _dio.patch(path, data: body));

  Future<dynamic> _unwrap(Future<Response> Function() call) async {
    try {
      final res = await call();
      return res.data;
    } on DioException catch (e) {
      final data = e.response?.data;
      final msg = (data is Map && data['title'] != null)
          ? data['title'] as String
          : e.message ?? 'Network error';
      throw ApiException(
        e.response?.statusCode,
        msg,
        code: data is Map ? data['code'] as String? : null,
      );
    }
  }
}
