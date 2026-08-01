import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/repositories.dart';

class InstructorVerifyScreen extends StatefulWidget {
  const InstructorVerifyScreen({super.key});
  @override
  State<InstructorVerifyScreen> createState() => _InstructorVerifyScreenState();
}

class _InstructorVerifyScreenState extends State<InstructorVerifyScreen> {
  final _adi = TextEditingController();
  final _evidence = TextEditingController();
  DateTime? _expiry;
  bool _busy = false;
  String? _message;

  /// The API wants `YYYY-MM-DD`; built from the date's own fields rather than
  /// `toIso8601String()` so a local date is never shifted into the previous day by a
  /// timezone conversion.
  String get _expiryIso => _expiry == null
      ? ''
      : '${_expiry!.year.toString().padLeft(4, '0')}-'
          '${_expiry!.month.toString().padLeft(2, '0')}-'
          '${_expiry!.day.toString().padLeft(2, '0')}';

  Future<void> _pickExpiry() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _expiry ?? DateTime(now.year + 1, now.month, now.day),
      // An ADI badge cannot expire in the past, and certificates run four years, so
      // there is no reason to offer a date beyond that.
      firstDate: now,
      lastDate: DateTime(now.year + 6, now.month, now.day),
      helpText: 'ADI badge expiry date',
    );
    if (picked != null) setState(() => _expiry = picked);
  }

  @override
  void dispose() {
    _adi.dispose();
    _evidence.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await context.read<CommunityRepository>().submitInstructor(
            _adi.text.trim(),
            _expiryIso,
            _evidence.text.trim().isEmpty ? null : _evidence.text.trim(),
          );
      setState(() => _message = 'Submitted — an admin will review your ADI evidence.');
    } catch (e) {
      setState(() => _message = e.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Instructor verification')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Verified ADIs get an instructor badge, a search boost and '
              'fast-tracked route approvals.'),
          const SizedBox(height: 16),
          TextField(
            controller: _adi,
            decoration: const InputDecoration(labelText: 'DVSA ADI number'),
            // Rebuilds so the submit button enables as soon as the number is long enough.
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 8),
          InputDecorator(
            decoration: const InputDecoration(
              labelText: 'ADI badge expiry date',
              helperText: 'As printed on your DVSA certificate',
            ),
            child: InkWell(
              onTap: _pickExpiry,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Text(_expiry == null ? 'Select a date' : _expiryIso),
              ),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _evidence,
            decoration: const InputDecoration(
                labelText: 'Evidence URL (badge photo / certificate)'),
          ),
          const SizedBox(height: 16),
          if (_message != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_message!),
            ),
          FilledButton(
            // Disabled until both required fields are present, so the user is not sent
            // to the server to be told what the form already knows.
            onPressed: _busy || _expiry == null || _adi.text.trim().length < 3
                ? null
                : _submit,
            child: _busy
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Submit for verification'),
          ),
        ],
      ),
    );
  }
}
