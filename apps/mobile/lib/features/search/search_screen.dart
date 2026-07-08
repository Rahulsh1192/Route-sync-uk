import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../data/models.dart';
import '../../data/repositories.dart';
import '../../shared/route_card.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});
  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _query = TextEditingController();
  String? _difficulty;
  Future<List<RouteSummary>>? _results;

  void _run() {
    final filters = <String, String>{
      if (_query.text.trim().isNotEmpty) 'q': _query.text.trim(),
      if (_difficulty != null) 'difficulty': _difficulty!,
    };
    setState(() => _results = context.read<RoutesRepository>().search(filters));
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Search routes')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                TextField(
                  controller: _query,
                  decoration: const InputDecoration(
                    labelText: 'Test centre, town or postcode',
                    prefixIcon: Icon(Icons.search),
                  ),
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _run(),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _difficulty,
                        decoration: const InputDecoration(labelText: 'Difficulty'),
                        items: const [
                          DropdownMenuItem(value: null, child: Text('Any')),
                          DropdownMenuItem(value: 'beginner', child: Text('Beginner')),
                          DropdownMenuItem(value: 'intermediate', child: Text('Intermediate')),
                          DropdownMenuItem(value: 'advanced', child: Text('Advanced')),
                          DropdownMenuItem(value: 'test_standard', child: Text('Test standard')),
                        ],
                        onChanged: (v) => setState(() => _difficulty = v),
                      ),
                    ),
                    const SizedBox(width: 12),
                    FilledButton(onPressed: _run, child: const Text('Search')),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: _results == null
                ? const Center(child: Text('Enter a search to begin'))
                : FutureBuilder<List<RouteSummary>>(
                    future: _results,
                    builder: (context, snap) {
                      if (snap.connectionState == ConnectionState.waiting) {
                        return const Center(child: CircularProgressIndicator());
                      }
                      if (snap.hasError) {
                        return Center(child: Text(snap.error.toString()));
                      }
                      final routes = snap.data ?? [];
                      if (routes.isEmpty) return const Center(child: Text('No matches'));
                      return ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: routes.length,
                        itemBuilder: (context, i) => RouteCard(
                          route: routes[i],
                          onTap: () =>
                              context.push('/route/${routes[i].id}', extra: routes[i]),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
