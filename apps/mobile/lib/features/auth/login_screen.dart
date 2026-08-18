import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'auth_controller.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _register = false;
  final _name = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Test Routify',
                    style: Theme.of(context).textTheme.headlineMedium,
                    textAlign: TextAlign.center),
                const SizedBox(height: 8),
                Text('Learn UK driving-test routes',
                    style: Theme.of(context).textTheme.bodyMedium,
                    textAlign: TextAlign.center),
                const SizedBox(height: 32),
                // Signing up ends here rather than in the app: the API issues no session
                // until the address is confirmed, so the panel stands in for the form.
                if (auth.pendingVerificationEmail != null) ...[
                  Text('Check your inbox',
                      style: Theme.of(context).textTheme.titleLarge,
                      textAlign: TextAlign.center),
                  const SizedBox(height: 8),
                  Text(
                    "We've sent a verification link to ${auth.pendingVerificationEmail}. "
                    'Open it to confirm your address, then sign in.',
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'The link works once and expires after 24 hours. Nothing after a few '
                    'minutes? Check your spam folder.',
                    style: TextStyle(fontSize: 13),
                  ),
                  const SizedBox(height: 16),
                  if (auth.error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(auth.error!,
                          style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ),
                  OutlinedButton(
                    onPressed: auth.busy ? null : _resend,
                    child: Text(auth.busy ? 'Sending…' : 'Send it again'),
                  ),
                  TextButton(
                    onPressed: () {
                      auth.clearPendingVerification();
                      _password.clear();
                      setState(() => _register = false);
                    },
                    child: const Text('Back to sign in'),
                  ),
                ] else ...[
                  if (_register)
                    TextField(
                      controller: _name,
                      decoration: const InputDecoration(labelText: 'Display name'),
                      textInputAction: TextInputAction.next,
                    ),
                  TextField(
                    controller: _email,
                    decoration: const InputDecoration(labelText: 'Email'),
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                  ),
                  TextField(
                    controller: _password,
                    decoration: const InputDecoration(labelText: 'Password'),
                    obscureText: true,
                  ),
                  const SizedBox(height: 16),
                  if (auth.error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(auth.error!,
                          style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ),
                  // Only when the sole problem is an unconfirmed address: re-posting the
                  // signup call is the resend path, and it needs the right password.
                  if (auth.emailNotVerified)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: OutlinedButton(
                        onPressed: auth.busy ? null : _resend,
                        child: Text(auth.busy ? 'Sending…' : 'Send the link again'),
                      ),
                    ),
                  FilledButton(
                    onPressed: auth.busy ? null : _submit,
                    child: auth.busy
                        ? const SizedBox(
                            height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : Text(_register ? 'Send verification link' : 'Sign in'),
                  ),
                  TextButton(
                    onPressed: () => setState(() => _register = !_register),
                    child:
                        Text(_register ? 'Have an account? Sign in' : 'New here? Create an account'),
                  ),
                  const Divider(height: 32),
                  OutlinedButton.icon(
                    onPressed: auth.busy ? null : _google,
                    icon: const Icon(Icons.g_mobiledata, size: 28),
                    label: const Text('Continue with Google'),
                  ),
                  // Sign in with Apple is required on iOS when other social logins
                  // are offered (App Store rule 4.8); show it there.
                  if (Platform.isIOS) ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: auth.busy ? null : _apple,
                      icon: const Icon(Icons.apple),
                      label: const Text('Continue with Apple'),
                    ),
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _submit() {
    final auth = context.read<AuthController>();
    if (_register) {
      auth.register(_email.text.trim(), _password.text, _name.text.trim());
    } else {
      auth.login(_email.text.trim(), _password.text);
    }
  }

  /// Ask for another link by re-posting the signup call, which is the resend path on the API:
  /// it sends when the address exists, is unconfirmed, and the password matches. Serves both
  /// the panel and the sign-in refusal, where no display name has been typed.
  void _resend() {
    final auth = context.read<AuthController>();
    final name = _name.text.trim();
    // Omitted rather than faked when the sign-in tab has no name field: the API ignores it on
    // the resend path, and inventing one would put junk on the wire.
    auth.register(_email.text.trim(), _password.text, name.isEmpty ? null : name);
  }

  void _google() => context.read<AuthController>().signInWithGoogle();

  void _apple() => context.read<AuthController>().signInWithApple();
}
