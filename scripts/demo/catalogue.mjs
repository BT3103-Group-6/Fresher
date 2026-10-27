// Static, fictional catalogue for the demo dataset (A18). Everything here is invented: business names are made up,
// street names and postal sectors are only there to look plausible. No real business is meant.

// [slug, area, postal sector, region, street, tier]. The postal sector is the real first-two-digit sector of the area
// (see functions/postalSectors.js). 22 neighbourhood, 18 mid-range, 10 premium; 12/10/10/10/8 across the regions.
export const SHOP_SLOTS = [
  // Central (12)
  ['raffles-place', 'Raffles Place', '01', 'central', 'Cecil Street', 'premium'],
  ['marina-bay', 'Marina Bay', '03', 'central', 'Marina Boulevard', 'premium'],
  ['tanjong-pagar', 'Tanjong Pagar', '02', 'central', 'Craig Road', 'mid'],
  ['chinatown', 'Chinatown', '05', 'central', 'Temple Street', 'neighbourhood'],
  ['tiong-bahru', 'Tiong Bahru', '16', 'central', 'Seng Poh Road', 'premium'],
  ['queenstown', 'Queenstown', '14', 'central', 'Commonwealth Avenue', 'mid'],
  ['bugis', 'Bugis', '18', 'central', 'Victoria Street', 'mid'],
  ['little-india', 'Little India', '20', 'central', 'Race Course Road', 'neighbourhood'],
  ['orchard', 'Orchard', '22', 'central', 'Scotts Road', 'premium'],
  ['tanglin', 'Tanglin', '23', 'central', 'Tanglin Road', 'premium'],
  ['novena', 'Novena', '28', 'central', 'Thomson Road', 'premium'],
  ['balestier', 'Balestier', '31', 'central', 'Balestier Road', 'neighbourhood'],
  // East (10)
  ['bedok', 'Bedok', '47', 'east', 'Bedok North Street 3', 'neighbourhood'],
  ['tampines', 'Tampines', '52', 'east', 'Tampines Street 81', 'neighbourhood'],
  ['pasir-ris', 'Pasir Ris', '51', 'east', 'Pasir Ris Drive 6', 'mid'],
  ['katong', 'Katong', '42', 'east', 'East Coast Road', 'premium'],
  ['joo-chiat', 'Joo Chiat', '44', 'east', 'Joo Chiat Place', 'mid'],
  ['marine-parade', 'Marine Parade', '43', 'east', 'Marine Parade Central', 'mid'],
  ['geylang', 'Geylang', '38', 'east', 'Geylang Lorong 27', 'neighbourhood'],
  ['eunos', 'Eunos', '40', 'east', 'Eunos Crescent', 'neighbourhood'],
  ['kembangan', 'Kembangan', '41', 'east', 'Jalan Senang', 'neighbourhood'],
  ['paya-lebar', 'Paya Lebar', '37', 'east', 'Paya Lebar Road', 'mid'],
  // West (10)
  ['jurong-east', 'Jurong East', '60', 'west', 'Jurong East Street 21', 'neighbourhood'],
  ['jurong-gateway', 'Jurong Gateway', '60', 'west', 'Jurong Gateway Road', 'mid'],
  ['jurong-west', 'Jurong West', '64', 'west', 'Jurong West Street 52', 'neighbourhood'],
  ['jurong-west-2', 'Jurong West', '64', 'west', 'Jurong West Street 91', 'neighbourhood'],
  ['bukit-batok', 'Bukit Batok', '65', 'west', 'Bukit Batok Street 21', 'neighbourhood'],
  ['hillview', 'Hillview', '66', 'west', 'Hillview Avenue', 'mid'],
  ['bukit-panjang', 'Bukit Panjang', '67', 'west', 'Bukit Panjang Ring Road', 'neighbourhood'],
  ['choa-chu-kang', 'Choa Chu Kang', '68', 'west', 'Choa Chu Kang Avenue 3', 'neighbourhood'],
  ['clementi', 'Clementi', '12', 'west', 'Clementi Avenue 3', 'mid'],
  ['west-coast', 'West Coast', '12', 'west', 'West Coast Road', 'premium'],
  // North (8)
  ['woodlands', 'Woodlands', '73', 'north', 'Woodlands Avenue 6', 'neighbourhood'],
  ['woodlands-2', 'Woodlands', '73', 'north', 'Woodlands Drive 16', 'neighbourhood'],
  ['yishun', 'Yishun', '76', 'north', 'Yishun Avenue 5', 'neighbourhood'],
  ['yishun-2', 'Yishun', '76', 'north', 'Yishun Ring Road', 'neighbourhood'],
  ['yishun-3', 'Yishun', '76', 'north', 'Yishun Street 21', 'mid'],
  ['sembawang', 'Sembawang', '75', 'north', 'Sembawang Road', 'mid'],
  ['admiralty', 'Admiralty', '75', 'north', 'Woodlands Avenue 4', 'mid'],
  ['upper-thomson', 'Upper Thomson', '77', 'north', 'Upper Thomson Road', 'premium'],
  // North-East (10)
  ['ang-mo-kio', 'Ang Mo Kio', '56', 'north-east', 'Ang Mo Kio Avenue 10', 'neighbourhood'],
  ['ang-mo-kio-2', 'Ang Mo Kio', '56', 'north-east', 'Ang Mo Kio Avenue 3', 'mid'],
  ['bishan', 'Bishan', '57', 'north-east', 'Bishan Street 22', 'mid'],
  ['kovan', 'Kovan', '53', 'north-east', 'Hougang Avenue 7', 'mid'],
  ['hougang', 'Hougang', '53', 'north-east', 'Hougang Street 91', 'neighbourhood'],
  ['serangoon-gardens', 'Serangoon Gardens', '55', 'north-east', 'Serangoon Garden Way', 'premium'],
  ['potong-pasir', 'Potong Pasir', '35', 'north-east', 'Potong Pasir Avenue 1', 'neighbourhood'],
  ['sengkang', 'Sengkang', '54', 'north-east', 'Sengkang East Way', 'neighbourhood'],
  ['sengkang-2', 'Sengkang', '54', 'north-east', 'Compassvale Road', 'mid'],
  ['punggol', 'Punggol', '82', 'north-east', 'Punggol Central', 'mid'],
]

export const SHOP_NAMES = {
  neighbourhood: [
    'Uncle Ah Seng Cuts', 'Block 7 Barbers', 'Void Deck Trim', 'Corner Kaki Cuts', 'Five-Foot-Way Barber',
    'Kampong Clippers', 'Heartland Hair Studio', 'Shophouse Snips', 'Trim Kaki', 'Lift Lobby Barber',
    'Kopitiam Cuts', 'Hawker Row Hair', 'Ah Beng and Sons', 'Old Town Clippers', 'Neighbourhood Fade House',
    'Two Chairs Barber', 'Quick Kaki Cuts', 'Low Rise Barbers', 'Sunrise Trim Corner', 'Sunday Snips',
    'Mama Lee Hair', 'The Clean Cut Corner',
  ],
  mid: [
    'Fade Theory', 'Sharp Edge Studio', 'Loft and Blade', 'Mane Street Co.', 'Razor and Reed', 'Clipper Society',
    'The Trim Room', 'Grain and Groom', 'Tide and Taper', 'Bluebird Barbers', 'Iron Comb Co.', 'Northside Fade Lab',
    'Harbour Hair Works', 'Cedar and Steel', 'Lantern Barber House', 'Rustic Razor', 'Copper Comb Studio',
    'Taper Tonic',
  ],
  premium: [
    'Maison Razor', 'Atelier Noir', 'The Gilded Chair', 'Sable and Steel', 'Crown and Comb Atelier',
    'Velvet Blade Club', 'Ivory Lounge Barbers', 'Monarch Grooming House', 'Regency Grooming Room',
    'The Obsidian Chair',
  ],
}

export const BARBER_NAMES = [
  'Amir', 'Faris', 'Hafiz', 'Irfan', 'Zul', 'Ridzuan', 'Syafiq', 'Danish', 'Kelvin', 'Jason', 'Benjamin',
  'Wei Ming', 'Zhi Hao', 'Jun Jie', 'Ah Kow', 'Uncle Lim', 'Raymond', 'Desmond', 'Marcus', 'Alvin', 'Gerald',
  'Kumar', 'Vikram', 'Suresh', 'Arun', 'Prakash', 'Dev', 'Shan', 'Jasmine', 'Priya', 'Sara', 'Aisha', 'Nadia',
  'Mei Ling', 'Jia Yi', 'Farah', 'Ruth', 'Joanne', 'Isaac', 'Elijah', 'Aloysius', 'Ken', 'Yusof', 'Hakim',
  'Rashid', 'Samuel', 'Benedict', 'Ryan', 'Shirley', 'Nurul', 'Eugene', 'Terence', 'Imran', 'Roy', 'Sharifah',
  'Melvin', 'Cheryl', 'Darius', 'Lionel', 'Haikal',
]

// Service templates. Prices are cents [low, high] per tier; durations in minutes (multiples of 5) per tier.
// `min`: the smallest tier offering it. The basic cut is S$12 to S$18 (neighbourhood), S$22 to S$32 (mid-range) and
// S$35 to S$60 (premium).
const T = (name, category, dur, price) => ({ name, category, dur, price })
export const SERVICE_TEMPLATES = {
  'gents-cut': T('Gents haircut', 'haircut', [30, 30, 45], [[1200, 1800], [2200, 3200], [3500, 6000]]),
  fade: T('Skin fade', 'haircut', [40, 40, 45], [[1500, 2200], [2800, 3800], [4500, 6500]]),
  'scissor-cut': T('Scissor cut', 'haircut', [null, 45, 60], [null, [3500, 4800], [5500, 8000]]),
  'senior-cut': T('Senior or student cut', 'haircut', [30, 30, null], [[1000, 1400], [1800, 2400], null]),
  'kids-cut': T('Kids haircut', 'kids', [20, 25, 30], [[1000, 1400], [1800, 2400], [3000, 4000]]),
  beard: T('Beard trim', 'beard', [15, 20, 20], [[800, 1200], [1500, 2200], [2500, 3800]]),
  'cut-beard': T('Haircut and beard', 'haircut', [45, 50, 60], [[1800, 2600], [3800, 5200], [6000, 9000]]),
  shave: T('Classic shave', 'shave', [20, 25, 30], [[1000, 1500], [2000, 3000], [4000, 6000]]),
  'wash-style': T('Wash and style', 'other', [15, 20, 20], [[500, 900], [1200, 1800], [2000, 3000]]),
  'scalp-treatment': T('Scalp treatment', 'other', [null, 30, 45], [null, [3500, 5000], [5000, 8000]]),
  colour: T('Hair colour', 'colour', [60, 75, 90], [[3800, 6500], [6800, 9800], [12000, 20000]]),
  perm: T('Textured perm', 'perm', [90, 100, 120], [[6000, 9500], [9000, 14000], [16000, 26000]]),
}
// Which templates each tier may offer, and how many (inclusive range) a shop gets. gents-cut is always offered.
export const TIER = {
  neighbourhood: {
    idx: 0, barbers: [2, 3], services: [4, 5], baseDensity: 1.0, notice: [60, 60, 120, 120, 180], flagChance: 0.65,
    offer: ['fade', 'senior-cut', 'kids-cut', 'beard', 'cut-beard', 'shave', 'wash-style', 'colour', 'perm'],
  },
  mid: {
    idx: 1, barbers: [3, 4], services: [5, 7], baseDensity: 1.4, notice: [120, 180, 240, 240], flagChance: 0.45,
    offer: ['fade', 'scissor-cut', 'kids-cut', 'beard', 'cut-beard', 'shave', 'wash-style', 'scalp-treatment', 'colour', 'perm', 'senior-cut'],
  },
  premium: {
    idx: 2, barbers: [4, 5], services: [6, 8], baseDensity: 1.8, notice: [240, 480, 720, 1440], flagChance: 0.15,
    offer: ['fade', 'scissor-cut', 'kids-cut', 'beard', 'cut-beard', 'shave', 'wash-style', 'scalp-treatment', 'colour', 'perm'],
  },
}
// Relative popularity of a service when a booking is placed.
export const SERVICE_WEIGHT = {
  'gents-cut': 6, fade: 3, 'scissor-cut': 1.5, 'senior-cut': 1.5, 'kids-cut': 1.5, beard: 1.5, 'cut-beard': 2.5,
  shave: 1, 'wash-style': 0.7, 'scalp-treatment': 0.5, colour: 0.7, perm: 0.4,
}

export const BLOCK_REASONS = ['Lunch', 'Dentist appointment', 'Half-day leave', 'Personal errand', 'Training session', 'Family event']

// Customer names (Singapore mix), by group so combinations look natural. Malay names take "bin" or "binte" plus a
// father's name, chosen in the generator from `female`.
export const NAME_GROUPS = [
  {
    weight: 45,
    given: ['Wei Jie', 'Jun Hao', 'Zhi Wei', 'Kai Xiang', 'Jia Hao', 'Yong Sheng', 'Ming Hui', 'Xin Yi', 'Li Ting', 'Hui Min', 'Jia Wen', 'Shu Ting', 'Kai Wen', 'Ethan', 'Marcus', 'Bryan', 'Darren', 'Joel', 'Nathan', 'Zachary', 'Ashley', 'Rachel', 'Amanda'],
    family: ['Tan', 'Lim', 'Lee', 'Ng', 'Ong', 'Wong', 'Goh', 'Chua', 'Chan', 'Koh', 'Teo', 'Ang', 'Yeo', 'Sim', 'Chew', 'Low', 'Foo', 'Ho', 'Toh', 'Lau', 'Sng', 'Loh'],
  },
  {
    weight: 25,
    malay: true,
    given: ['Muhammad Irfan', 'Ahmad Danish', 'Aiman', 'Hakim', 'Farhan', 'Amirul', 'Zulkifli', 'Rizal', 'Syafiq', 'Iqbal', 'Firdaus', 'Haziq', 'Zaki', 'Adli', 'Nurul Huda', 'Siti Aminah', 'Nadiah'],
    female: ['Nurul Huda', 'Siti Aminah', 'Nadiah'],
    family: ['Ismail', 'Abdullah', 'Rahman', 'Yusof', 'Hassan', 'Ahmad', 'Salleh'],
  },
  {
    weight: 18,
    given: ['Arjun', 'Vikram', 'Karthik', 'Suresh', 'Rajesh', 'Dinesh', 'Praveen', 'Kumar', 'Priya', 'Deepa'],
    family: ['Krishnan', 'Nair', 'Pillai', 'Subramaniam', 'Rajan', 'Menon', 'Singh', 'Sharma', 'Naidu'],
  },
  {
    weight: 12,
    given: ['Daniel', 'Ryan', 'Gabriel', 'Aaron', 'Isaac', 'Luke', 'Caleb', 'Ian', 'Sean', 'Trevor'],
    family: ["D'Souza", 'Pereira', 'Rozario', 'de Souza', 'Sequeira', 'Fernandez', 'Gomes'],
  },
]

// Eight showcase customers with fixed numbers and real Auth users, so a friend can sign in as them once the number is
// added as a Firebase test phone number (L38). 0101 to 0103: two or more no-shows at one shop (deposit checkout);
// 0104 to 0108: history across three or more shops (History and Rebook).
export const SHOWCASE = [
  { key: 's1', name: 'Hafiz Ramli', role: 'deposit', noShows: 2 },
  { key: 's2', name: 'Kelvin Ong', role: 'deposit', noShows: 3 },
  { key: 's3', name: 'Darren Pereira', role: 'deposit', noShows: 2 },
  { key: 's4', name: 'Priya Krishnan', role: 'history' },
  { key: 's5', name: 'Jia Hui Lim', role: 'history' },
  { key: 's6', name: 'Marcus Lee', role: 'history' },
  { key: 's7', name: 'Nur Aisyah Ismail', role: 'history' },
  { key: 's8', name: 'Ravi Subramaniam', role: 'mixed' },
]
export const SHOWCASE_PHONE = (i) => `+65800001${String(i + 1).padStart(2, '0')}` // +6580000101 ... +6580000108
