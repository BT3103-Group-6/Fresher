// FR-01: fixed service categories (decisions A11). Keep in step with firestore.rules and functions/discovery.js.
export const SERVICE_TYPES = [
  { value: 'haircut', label: 'Haircut' },
  { value: 'beard', label: 'Beard' },
  { value: 'shave', label: 'Shave' },
  { value: 'colour', label: 'Colour' },
  { value: 'perm', label: 'Perm' },
  { value: 'kids', label: 'Kids' },
  { value: 'other', label: 'Other' },
]
export const serviceTypeLabel = (value) => SERVICE_TYPES.find((t) => t.value === value)?.label ?? value
