import 'package:flutter/material.dart';

/// Route upload entry point. The full flow (pick multiple front/rear clips + GPX,
/// accept the footage agreement, presigned resumable upload to R2, then poll
/// pipeline status) is a sizeable feature tracked separately — this screen explains
/// the flow and is the integration point for it.
class UploadScreen extends StatelessWidget {
  const UploadScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Contribute a route')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('How it works', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          const _Step(n: 1, text: 'Record front + rear dashcam clips and a GPX track.'),
          const _Step(n: 2, text: 'Accept the contributor footage agreement.'),
          const _Step(n: 3, text: 'Select your clips + GPX; they upload securely to the cloud.'),
          const _Step(n: 4, text: 'We merge, sync, blur faces/plates, and score quality.'),
          const _Step(n: 5, text: 'Once approved, your route goes live and you earn credits.'),
          const SizedBox(height: 24),
          FilledButton.icon(
            icon: const Icon(Icons.video_library_outlined),
            label: const Text('Select clips & GPX'),
            // TODO: file_picker -> POST /uploads (presigned) -> PUT parts ->
            //       POST /uploads/:id/complete -> poll GET /uploads/:id
            onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Resumable upload flow pending integration')),
            ),
          ),
        ],
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.n, required this.text});
  final int n;
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          CircleAvatar(radius: 14, child: Text('$n')),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyLarge)),
        ]),
      );
}
