import { multiAuto } from 'colorsort-js';
import DATA from 'colorsort-js/trained.json' with { type: 'json' };

self.onmessage = (event) => {
  const { hexes, requestId } = event.data || {};

  try {
    const multiAutoSorted = multiAuto(hexes, DATA);
    const sorted = Array.isArray(hexes) ? multiAutoSorted[0]?.sorted ?? [] : [];
    self.postMessage({ type: 'sorted', payload: { sorted, requestId } });
  } catch (error) {
    self.postMessage({
      type: 'error',
      payload: { message: error?.message || String(error), requestId },
    });
  }
};