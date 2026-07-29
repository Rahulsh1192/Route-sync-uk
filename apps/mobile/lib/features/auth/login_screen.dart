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
                FilledButton(
                  onPressed: auth.busy ? null : _submit,
                  child: auth.busy
                      ? const SizedBox(
                          height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text(_register ? 'Create account' : 'Sign in'),
                ),
                TextButton(
                  onPressed: () => setState(() => _register = !_register),
                  child: Text(_register ? 'Have an account? Sign in' : 'New here? Create an account'),
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

  void _google() => context.read<AuthController>().signInWithGoogle();

  void _apple() => context.read<AuthController>().signInWithApple();
}
