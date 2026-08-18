import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../../core/api_client.dart';
import '../../core/token_store.dart';
import '../../data/repositories.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

/// App-wide auth state. Drives the router's redirect logic.
class AuthController extends ChangeNotifier {
  AuthController(this._auth, this._tokens, this._api) {
    // Force a logout if a request's session can't be refreshed (e.g. the ADI
    // single-session rule signed this device out).
    _api.onSessionExpired = _onSessionExpired;
    _bootstrap();
  }
  final AuthRepository _auth;
  final TokenStore _tokens;
  final ApiClient _api;
  final GoogleSignIn _googleSignIn = GoogleSignIn(scopes: ['email']);

  AuthStatus status = AuthStatus.unknown;
  String? error;
  bool busy = false;

  /// Masked address a verification link was just sent to. Non-null means the UI shows the
  /// check-your-inbox panel: signing up no longer produces a session.
  String? pendingVerificationEmail;

  /// True when the last sign-in failed *only* because the address is unconfirmed, which needs
  /// a resend affordance rather than the generic error treatment.
  bool emailNotVerified = false;

  Future<void> _bootstrap() async {
    status = (await _tokens.hasSession)
        ? AuthStatus.authenticated
        : AuthStatus.unauthenticated;
    notifyListeners();
  }

  void _onSessionExpired({required bool sessionInvalidated}) {
    status = AuthStatus.unauthenticated;
    error = sessionInvalidated
        ? 'You were signed out because your account was used on another device.'
        : null;
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
      // Distinguished so the screen can offer another link instead of just showing the text.
      if (e is ApiException && e.code == 'email_not_verified') emailNotVerified = true;
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<bool> login(String email, String password) {
    emailNotVerified = false;
    return _run(() => _auth.login(email, password));
  }

  /// Create an account, or resend its link. Does NOT sign in — the API withholds tokens until
  /// the address is confirmed, so this ends on [pendingVerificationEmail] rather than
  /// `AuthStatus.authenticated`, which is why it doesn't go through [_run].
  Future<bool> register(String email, String password, String? name) async {
    busy = true;
    error = null;
    emailNotVerified = false;
    notifyListeners();
    try {
      pendingVerificationEmail = await _auth.register(email, password, name);
      return true;
    } catch (e) {
      error = e.toString();
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  void clearPendingVerification() {
    pendingVerificationEmail = null;
    notifyListeners();
  }

  /// Native Google sign-in → exchange the Google ID token for our own JWTs.
  /// Returns false (silently) if the user cancels the Google chooser.
  Future<bool> signInWithGoogle() async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      final account = await _googleSignIn.signIn();
      if (account == null) return false; // cancelled — no error
      final gauth = await account.authentication;
      final idToken = gauth.idToken;
      if (idToken == null) throw Exception('Google did not return an ID token');
      await _auth.loginWithGoogle(idToken);
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

  /// Native Sign in with Apple → exchange the identity token for our own JWTs.
  /// Apple sends the name only on the FIRST sign-in, so we forward it then.
  Future<bool> signInWithApple() async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      final cred = await SignInWithApple.getAppleIDCredential(scopes: [
        AppleIDAuthorizationScopes.email,
        AppleIDAuthorizationScopes.fullName,
      ]);
      final token = cred.identityToken;
      if (token == null) throw Exception('Apple did not return an identity token');
      final name = [cred.givenName, cred.familyName]
          .where((s) => s != null && s.isNotEmpty)
          .join(' ');
      await _auth.loginWithApple(token, displayName: name.isEmpty ? null : name);
      status = AuthStatus.authenticated;
      return true;
    } on SignInWithAppleAuthorizationException catch (e) {
      if (e.code == AuthorizationErrorCode.canceled) return false; // cancelled
      error = e.message;
      return false;
    } catch (e) {
      error = e.toString();
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    try {
      await _googleSignIn.signOut();
    } catch (_) {/* ignore — not signed in via Google */}
    await _auth.logout();
    status = AuthStatus.unauthenticated;
    notifyListeners();
  }
}
