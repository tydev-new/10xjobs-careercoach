import { useEffect, useState } from "react";
import { normalizeSnapshot } from "./contract";

export function useWorkspace(provider) {
  const [state, setState] = useState(() => ({
    snapshot: provider.initialSnapshot ? normalizeSnapshot(provider.initialSnapshot) : null,
    loading: !provider.initialSnapshot,
    error: null,
  }));

  const refresh = async () => {
    try {
      const snapshot = normalizeSnapshot(await provider.getSnapshot());
      setState({ snapshot, loading: false, error: null });
      return snapshot;
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
      return null;
    }
  };

  useEffect(() => { refresh(); }, [provider]);
  return { ...state, refresh };
}
