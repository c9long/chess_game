/** In-memory Web Storage for unit tests (Node has no localStorage/sessionStorage by default). */
export function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => {
      data.delete(k)
    },
    setItem: (k, v) => {
      data.set(k, String(v))
    },
  }
}
