import 'package:flutter/foundation.dart';

import '../../core/token_store.dart';
import '../../data/repositories.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

/// App-wide auth state. Drives the router's redirect logic.
class AuthController extends ChangeNotifier {
  AuthController(this._auth, this._tokens) {
    _bootstrap();
  }
  final AuthRepository _auth;
  final TokenStore _tokens;

  AuthStatus status = AuthStatus.unknown;
  String? error;
  bool busy = false;

  Future<void> _bootstrap() async {
    status = (await _tokens.hasSession)
        ? AuthStatus.authenticated
        : AuthStatus.unauthenticated;
    notifyListeners();
  }

  Future<bool> _run(Future<void> Function() action) async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      await action();
      status = AuthStatus.authenticated;
      return true;
    } catch (e) {
      error = e.toString();
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<bool> login(String email, String password) =>
      _run(() => _auth.login(email, password));

  Future<bool> register(String email, String password, String name) =>
      _run(() => _auth.register(email, password, name));

  Future<bool> loginWithGoogle(String idToken) =>
      _run(() => _auth.loginWithGoogle(idToken));

  Future<bool> loginWithApple(String identityToken) =>
      _run(() => _auth.loginWithApple(identityToken));

  Future<void> logout() async {
    await _auth.logout();
    status = AuthStatus.unauthenticated;
    notifyListeners();
  }
}
