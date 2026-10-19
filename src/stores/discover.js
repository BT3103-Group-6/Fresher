import { reactive } from 'vue'

// UI-C1 search state (decisions A15). It lives outside the view so going from a shop page back to `/`
// shows the previous search, filter and results. In memory only: a reload starts fresh (L36).
export const search = reactive({
  postalCode: '',
  type: '',
  searched: false,
  origin: '',
  center: null, // [lat, lng] of the searched point, for the map's search circle (A20)
  shops: [],
  slotState: {}, // `${shopId}|${type}` -> 'loading' | 'error' | { at: ms | null }
})
