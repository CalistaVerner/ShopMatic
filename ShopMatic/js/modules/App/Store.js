/**
 * Minimal predictable store (Redux-like) with zero deps.
 *
 * Contract:
 *  - State transitions only via reducer(state, action).
 *  - Subscribers are notified after commit.
 */

export const ActionTypes = {
  ROUTE_SET: 'ROUTE/SET',
  ROUTE_NAVIGATE: 'ROUTE/NAVIGATE'
};

export function combineReducers(reducers) {
  const map = reducers || {};
  const keys = Object.keys(map);

  return function rootReducer(state = {}, action) {
    let changed = false;
    const next = {};

    for (const k of keys) {
      const r = map[k];
      const prevSlice = state ? state[k] : undefined;
      const nextSlice = typeof r === 'function' ? r(prevSlice, action) : prevSlice;
      next[k] = nextSlice;
      if (nextSlice !== prevSlice) changed = true;
    }

    // Preserve extra keys not covered by reducers.
    if (state) {
      for (const k of Object.keys(state)) {
        if (!(k in next)) next[k] = state[k];
      }
    }

    return changed ? next : state;
  };
}

export function createStore(reducer, preloadedState) {
  if (typeof reducer !== 'function') {
    throw new Error('createStore(reducer): reducer must be a function');
  }

  let state = preloadedState;
  const subs = new Set();
  let isDispatching = false;

  const getState = () => state;

  const subscribe = (fn) => {
    if (typeof fn !== 'function') return () => {};
    subs.add(fn);
    return () => subs.delete(fn);
  };

  const dispatch = (action) => {
    if (!action || typeof action.type !== 'string') return action;

    if (isDispatching) {
      throw new Error('Dispatch while reducing is not allowed');
    }

    try {
      isDispatching = true;
      state = reducer(state, action);
    } finally {
      isDispatching = false;
    }

    if (subs.size) {
      for (const fn of Array.from(subs)) {
        try {
          fn(state, action);
        } catch (e) {
          console.warn('[Store] subscriber error', e);
        }
      }
    }

    return action;
  };

  // Init
  dispatch({ type: '@@INIT' });

  return { getState, subscribe, dispatch };
}

export function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;

  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
