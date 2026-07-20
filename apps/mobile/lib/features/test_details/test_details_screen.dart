import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../data/models.dart';
import '../../data/repositories.dart';

/// Phase 19b: every user must share their test centre + date before using any
/// route. Reached from the route-detail gate; returns to [returnTo] on save.
class TestDetailsScreen extends StatefulWidget {
  const TestDetailsScreen({super.key, this.returnTo});
  final String? returnTo;

  @override
  State<TestDetailsScreen> createState() => _TestDetailsScreenState();
}

class _TestDetailsScreenState extends State<TestDetailsScreen> {
  final _search = TextEditingController();
  List<TestCentre> _centres = [];
  TestCentre? _selected;
  DateTime? _date;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load('');
    _search.addListener(() => _load(_search.text));
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load(String q) async {
    try {
      final list = await context.read<TestDetailsRepository>().searchCentres(q);
      if (mounted) setState(() => _centres = list);
    } catch (_) {/* ignore transient search errors */}
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
      initialDate: now,
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _save() async {
    if (_selected == null || _date == null) {
      setState(() => _error = 'Pick your test centre and test date.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final iso = _date!.toIso8601String().split('T').first; // yyyy-MM-dd
    try {
      await context.read<TestDetailsRepository>().add(_selected!.id, iso);
      if (mounted) context.go(widget.returnTo ?? '/home');
    } on ApiException catch (e) {
      setState(() {
        _error = e.message;
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dateLabel =
        _date == null ? 'Choose date' : _date!.toIso8601String().split('T').first;
    return Scaffold(
      appBar: AppBar(title: const Text('Your test details')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Share your test centre and date to use routes. Everyone provides these — '
            'it takes a moment.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _search,
            decoration: const InputDecoration(
              labelText: 'Test centre',
              hintText: 'Search by name, town or postcode',
              prefixIcon: Icon(Icons.search),
            ),
          ),
          const SizedBox(height: 8),
          if (_selected != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.check_circle, color: Colors.green),
                title: Text(_selected!.label),
                trailing: TextButton(
                  onPressed: () => setState(() => _selected = null),
                  child: const Text('Change'),
                ),
              ),
            )
          else
            ..._centres.map((c) => ListTile(
                  title: Text(c.name),
                  subtitle: Text([
                    if (c.town != null) c.town!,
                    if (c.postcode != null) c.postcode!,
                  ].join(' · ')),
                  onTap: () => setState(() => _selected = c),
                )),
          const Divider(height: 32),
          ListTile(
            leading: const Icon(Icons.event),
            title: const Text('Test date'),
            subtitle: Text(dateLabel),
            trailing: const Icon(Icons.chevron_right),
            onTap: _pickDate,
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Save & continue'),
          ),
        ],
      ),
    );
  }
}
