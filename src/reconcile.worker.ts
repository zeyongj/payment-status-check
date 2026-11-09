import { reconcile } from './lib/matching';
import type { InvoiceRecord, MatchSettings } from './lib/types';
self.onmessage = (
  event: MessageEvent<{
    requested: InvoiceRecord[];
    system: InvoiceRecord[];
    settings: MatchSettings;
  }>,
) => {
  try {
    self.postMessage({
      results: reconcile(event.data.requested, event.data.system, event.data.settings),
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
