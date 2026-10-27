// Postal sector (first two digits of a postal code) -> area name and region, for the landing page shop map
// (decisions A20). Shops store no region, so it is derived here. Approximate on purpose (L45): some sectors straddle
// regions, and the boundaries follow the demo catalogue. Area names are copied from functions/postalSectors.js;
// tests/shopMap.test.mjs keeps the two in step and checks the demo shops agree with these regions.

export const REGIONS = [
  { key: 'central', label: 'Central' },
  { key: 'east', label: 'East' },
  { key: 'west', label: 'West' },
  { key: 'north', label: 'North' },
  { key: 'north-east', label: 'North-East' },
]

const C = 'central'
const E = 'east'
const W = 'west'
const N = 'north'
const NE = 'north-east'

export const SECTOR_TABLE = {
  '10': ['HarbourFront', C],
  '11': ['Pasir Panjang', W],
  '12': ['West Coast', W],
  '13': ['Clementi', W],
  '14': ['Queenstown', C],
  '15': ['Redhill', C],
  '16': ['Tiong Bahru', C],
  '17': ['City Hall', C],
  '18': ['Bugis', C],
  '19': ['Kallang', C],
  '20': ['Little India', C],
  '21': ['Farrer Park', C],
  '22': ['Orchard', C],
  '23': ['Tanglin', C],
  '24': ['Ardmore', C],
  '25': ['Holland', C],
  '26': ['Bukit Timah', C],
  '27': ['Sixth Avenue', C],
  '28': ['Novena', C],
  '29': ['Thomson', C],
  '30': ['Thomson', C],
  '31': ['Balestier', C],
  '32': ['Toa Payoh', C],
  '33': ['Serangoon', NE],
  '34': ['MacPherson', NE],
  '35': ['Potong Pasir', NE],
  '36': ['Toa Payoh North', C],
  '37': ['Paya Lebar', E],
  '38': ['Geylang', E],
  '39': ['Eunos', E],
  '40': ['Aljunied', E],
  '41': ['Kembangan', E],
  '42': ['Katong', E],
  '43': ['Marine Parade', E],
  '44': ['Joo Chiat', E],
  '45': ['Amber Road', E],
  '46': ['Bedok', E],
  '47': ['Bedok', E],
  '48': ['Bedok Reservoir', E],
  '49': ['Loyang', E],
  '50': ['Changi', E],
  '51': ['Pasir Ris', E],
  '52': ['Tampines', E],
  '53': ['Kovan', NE],
  '54': ['Hougang', NE],
  '55': ['Serangoon Gardens', NE],
  '56': ['Ang Mo Kio', NE],
  '57': ['Bishan', NE],
  '58': ['Toh Tuck', W],
  '59': ['Ulu Pandan', W],
  '60': ['Jurong East', W],
  '61': ['Jurong West', W],
  '62': ['Boon Lay', W],
  '63': ['Pioneer', W],
  '64': ['Jurong West', W],
  '65': ['Bukit Batok', W],
  '66': ['Hillview', W],
  '67': ['Bukit Panjang', W],
  '68': ['Choa Chu Kang', W],
  '69': ['Lim Chu Kang', N],
  '70': ['Tengah', W],
  '71': ['Kranji', N],
  '72': ['Woodlands', N],
  '73': ['Woodlands', N],
  '75': ['Yishun', N],
  '76': ['Yishun', N],
  '77': ['Upper Thomson', N],
  '78': ['Springleaf', N],
  '79': ['Seletar', NE],
  '80': ['Yio Chu Kang', NE],
  '81': ['Changi Airport', E],
  '82': ['Punggol', NE],
  '01': ['Raffles Place', C],
  '02': ['Tanjong Pagar', C],
  '03': ['Marina Bay', C],
  '04': ['Marina South', C],
  '05': ['Chinatown', C],
  '06': ['Clarke Quay', C],
  '07': ['Anson', C],
  '08': ['Tanjong Pagar', C],
  '09': ['Telok Blangah', C],
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** { area, region } for a postal code, or null when the code is malformed or its sector does not exist. */
export function placeOfPostalCode(postalCode) {
  const code = String(postalCode ?? '').trim()
  if (!/^\d{6}$/.test(code)) return null
  const sector = code.slice(0, 2)
  if (!has(SECTOR_TABLE, sector)) return null
  const [area, region] = SECTOR_TABLE[sector]
  return { area, region }
}
