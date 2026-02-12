import { ActionTypes } from '../Store.js';

const initial = {
  kind: 'raw',
  name: 'raw',
  params: { hash: window.location.hash || '' },
  query: {},
  raw: window.location.hash || ''
};

export function routeReducer(state = initial, action) {
  if (!action) return state;
  switch (action.type) {
    case ActionTypes.ROUTE_SET:
    case ActionTypes.ROUTE_NAVIGATE: {
      const r = action.payload || null;
      if (!r) return state;
      // cheap referential guard
      if (state && r.raw && state.raw === r.raw) return state;
      return Object.assign({}, state, r);
    }
    default:
      return state;
  }
}
