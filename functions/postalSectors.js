// Approximate centroids for Singapore's postal sectors (the first two digits
// of a postal code), for the geocode stub only (decisions A18, L42). Assembled
// by hand from the public sector-to-area list; typically within 1 to 2 km of
// the sector's middle, so results are always marked approximate. Sectors 01 to
// 82 exist except 74.
const SECTORS = {
  "01": ["Raffles Place", 1.2840, 103.8510],
  "02": ["Tanjong Pagar", 1.2790, 103.8470],
  "03": ["Marina Bay", 1.2870, 103.8590],
  "04": ["Marina South", 1.2760, 103.8540],
  "05": ["Chinatown", 1.2850, 103.8440],
  "06": ["Clarke Quay", 1.2890, 103.8460],
  "07": ["Anson", 1.2755, 103.8440],
  "08": ["Tanjong Pagar", 1.2790, 103.8400],
  "09": ["Telok Blangah", 1.2690, 103.8100],
  "10": ["HarbourFront", 1.2700, 103.8190],
  "11": ["Pasir Panjang", 1.2890, 103.7960],
  "12": ["West Coast", 1.3000, 103.7650],
  "13": ["Clementi", 1.3150, 103.7650],
  "14": ["Queenstown", 1.2950, 103.8080],
  "15": ["Redhill", 1.2897, 103.8168],
  "16": ["Tiong Bahru", 1.2850, 103.8290],
  "17": ["City Hall", 1.2900, 103.8520],
  "18": ["Bugis", 1.3020, 103.8580],
  "19": ["Kallang", 1.3010, 103.8640],
  "20": ["Little India", 1.3070, 103.8520],
  "21": ["Farrer Park", 1.3110, 103.8560],
  "22": ["Orchard", 1.3020, 103.8340],
  "23": ["Tanglin", 1.3010, 103.8230],
  "24": ["Ardmore", 1.3100, 103.8100],
  "25": ["Holland", 1.3070, 103.7950],
  "26": ["Bukit Timah", 1.3200, 103.7900],
  "27": ["Sixth Avenue", 1.3240, 103.8000],
  "28": ["Novena", 1.3200, 103.8440],
  "29": ["Thomson", 1.3300, 103.8450],
  "30": ["Thomson", 1.3350, 103.8470],
  "31": ["Balestier", 1.3260, 103.8580],
  "32": ["Toa Payoh", 1.3330, 103.8560],
  "33": ["Serangoon", 1.3390, 103.8680],
  "34": ["MacPherson", 1.3290, 103.8770],
  "35": ["Potong Pasir", 1.3400, 103.8780],
  "36": ["Toa Payoh North", 1.3430, 103.8620],
  "37": ["Paya Lebar", 1.3130, 103.8920],
  "38": ["Geylang", 1.3150, 103.8790],
  "39": ["Eunos", 1.3200, 103.8870],
  "40": ["Aljunied", 1.3240, 103.8900],
  "41": ["Kembangan", 1.3200, 103.9030],
  "42": ["Katong", 1.3060, 103.9050],
  "43": ["Marine Parade", 1.3060, 103.9170],
  "44": ["Joo Chiat", 1.3130, 103.9020],
  "45": ["Amber Road", 1.3050, 103.8960],
  "46": ["Bedok", 1.3220, 103.9300],
  "47": ["Bedok", 1.3110, 103.9340],
  "48": ["Bedok Reservoir", 1.3390, 103.9350],
  "49": ["Loyang", 1.3680, 103.9730],
  "50": ["Changi", 1.3610, 103.9880],
  "51": ["Pasir Ris", 1.3730, 103.9490],
  "52": ["Tampines", 1.3540, 103.9440],
  "53": ["Kovan", 1.3680, 103.8890],
  "54": ["Hougang", 1.3700, 103.8920],
  "55": ["Serangoon Gardens", 1.3620, 103.8650],
  "56": ["Ang Mo Kio", 1.3700, 103.8480],
  "57": ["Bishan", 1.3520, 103.8350],
  "58": ["Toh Tuck", 1.3340, 103.7800],
  "59": ["Ulu Pandan", 1.3160, 103.7550],
  "60": ["Jurong East", 1.3331, 103.7423],
  "61": ["Jurong West", 1.3200, 103.7280],
  "62": ["Boon Lay", 1.3430, 103.7220],
  "63": ["Pioneer", 1.3260, 103.6900],
  "64": ["Jurong West", 1.3400, 103.7050],
  "65": ["Bukit Batok", 1.3490, 103.7490],
  "66": ["Hillview", 1.3600, 103.7640],
  "67": ["Bukit Panjang", 1.3800, 103.7610],
  "68": ["Choa Chu Kang", 1.3850, 103.7440],
  "69": ["Lim Chu Kang", 1.4040, 103.7080],
  "70": ["Tengah", 1.3750, 103.7300],
  "71": ["Kranji", 1.4200, 103.7300],
  "72": ["Woodlands", 1.4400, 103.7620],
  "73": ["Woodlands", 1.4450, 103.8000],
  "75": ["Yishun", 1.4290, 103.8300],
  "76": ["Yishun", 1.4180, 103.8360],
  "77": ["Upper Thomson", 1.3800, 103.8200],
  "78": ["Springleaf", 1.4020, 103.8180],
  "79": ["Seletar", 1.4140, 103.8700],
  "80": ["Yio Chu Kang", 1.3980, 103.8580],
  "81": ["Changi Airport", 1.3592, 103.9894],
  "82": ["Punggol", 1.4000, 103.9050],
};

/**
 * @param {string} code A six-digit postal code.
 * @return {?{lat: number, lng: number, name: string, sector: string}} The
 *   approximate centroid of the code's postal sector, or null when that
 *   sector does not exist.
 */
function sectorCentroid(code) {
  const sector = String(code).slice(0, 2);
  const entry = Object.prototype.hasOwnProperty.call(SECTORS, sector) ?
    SECTORS[sector] : null;
  if (!entry) return null;
  return {name: entry[0], lat: entry[1], lng: entry[2], sector};
}

module.exports = {SECTORS, sectorCentroid};
