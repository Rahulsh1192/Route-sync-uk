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
  bool _busy = false;
  String? _message;

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
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Submit for verification'),
          ),
        ],
      ),
    );
  }
}
