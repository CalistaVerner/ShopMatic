/**
 * URL state helper.
 *
 * - Reads/writes a small set of key/value pairs into URL query (preferred)
 *   or into the hash fragment.
 * - Uses history.replaceState to avoid polluting navigation history.
 */
export class UrlState {
  static read({ prefix = 'sm', useHash = false } = {}) {
    try {
      const src = useHash
        ? (location.hash || '').replace(/^#/, '')
        : (location.search || '').replace(/^\?/, '');
      const p = new URLSearchParams(src);
      const out = {};
      for (const [k, v] of p.entries()) {
        if (!k.startsWith(prefix + '_')) continue;
        out[k.slice(prefix.length + 1)] = v;
      }
      return out;
    } catch {
      return {};
    }
  }

  static write(pairs = {}, { prefix = 'sm', useHash = false } = {}) {
    try {
      const url = new URL(location.href);
      const p = useHash ? new URLSearchParams((url.hash || '').replace(/^#/, '')) : url.searchParams;

      // Remove previous keys
      for (const key of Array.from(p.keys())) {
        if (key.startsWith(prefix + '_')) p.delete(key);
      }

      // Write new keys
      for (const [k, v] of Object.entries(pairs || {})) {
        const val = v == null ? '' : String(v).trim();
        if (!val) continue;
        p.set(prefix + '_' + k, val);
      }

      if (useHash) {
        url.hash = p.toString() ? '#' + p.toString() : '';
      }

      history.replaceState(history.state, document.title, url.toString());
    } catch {
      // ignore
    }
  }
}
