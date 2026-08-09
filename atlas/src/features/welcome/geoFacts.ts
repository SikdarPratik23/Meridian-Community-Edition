import { formatLatLng } from '../../utils';

/**
 * A small "geographer's almanac" for the welcome screen. Mixes bundled facts
 * (offline) with a few computed from the user's own coordinates — antipode,
 * distance from the equator / Prime Meridian, the meridian they're standing on.
 * A fresh one is shown on each reload (and via the shuffle button).
 */

const STATIC_FACTS: string[] = [
  'A degree of latitude is always about 111 km; a degree of longitude shrinks from ~111 km at the equator to 0 at the poles.',
  'Mount Everest is the highest point above sea level, but Mauna Kea is taller base-to-summit — most of it is underwater.',
  'Africa is the only continent that sits in all four hemispheres: north, south, east and west.',
  'Russia spans 11 time zones — more than any other country.',
  'The shore of the Dead Sea is the lowest dry land on Earth, about 430 m below sea level.',
  'Lake Baikal holds roughly 20% of the world’s unfrozen fresh water.',
  'Antarctica is the largest desert on Earth — deserts are defined by precipitation, not heat.',
  'The Mariana Trench is deeper than Mount Everest is tall.',
  'On a Mercator map Greenland looks huge, yet Africa is about 14× larger in reality.',
  'A “great circle” is the shortest path between two points on the globe — which is why long flight paths look curved on flat maps.',
  'The Prime Meridian (longitude 0°) runs through Greenwich, London.',
  'The equator passes through 13 countries across three continents.',
  'Canada has more lake area than the rest of the world combined.',
  'Istanbul is the only major city that straddles two continents.',
  'EPSG:4326 (WGS 84) is the coordinate system your phone’s GPS reports in — the same [lon, lat] Meridian stores.',
  'The Sahara is roughly the size of the United States.',
  'Only two countries border three oceans: Canada and Russia.',
  'The Pacific Ocean is wider than the Moon — about 19,000 km across at its widest.',
  'The Nile and the Amazon both vie for “longest river”; the answer depends on where you decide the Amazon begins.',
  'The Caspian Sea is the largest lake on Earth — it’s called a sea only by tradition.',
  'Point Nemo, the oceanic pole of inaccessibility, is so remote the nearest humans are often astronauts on the ISS overhead.',
  'The Andes are the longest continental mountain range, running some 7,000 km down South America.',
  'Australia is wider than the Moon is across — roughly 4,000 km east to west.',
  'The deepest cave yet explored, Veryovkina in Georgia, drops more than 2,200 m below its entrance.',
  'Every meridian of longitude is the same length; lines of latitude shrink toward the poles.',
  'The Coriolis effect bends moving air and water right in the north and left in the south — shaping every large storm.',
  'There is a place where you can stand in Norway and Russia at once — but their clocks are two hours apart.',
  'Chile stretches over 4,300 km north to south yet averages only ~180 km wide.',
  'The Great Rift Valley is slowly tearing East Africa apart; in millions of years it may open a new ocean.',
  'Reunion Island holds the record for the most rain in 24 hours: 1.8 m during a 1966 cyclone.',
  'The magnetic North Pole drifts — it has moved hundreds of kilometres toward Siberia in the last century.',
  'A “confluence” is where two rivers meet; hunting the integer lat/lon crossings is a whole hobby (the Degree Confluence Project).',
  'The contiguous US spans four time zones; add Alaska and Hawaii and it’s six.',
  'The Dead Sea is dropping over a metre a year as its water is diverted upstream.',
  'The world’s southernmost town is Puerto Williams, Chile; the southernmost city, Ushuaia, Argentina.',
  'Mount Chimborazo in Ecuador is the point on Earth’s surface farthest from its centre — the planet bulges at the equator.',
  'Bangladesh sits on the world’s largest river delta, built by the Ganges, Brahmaputra and Meghna.',
  'Time zones are a 19th-century railway invention; before them, towns kept their own local solar time.',
  'The International Date Line zigzags to keep island nations on a single calendar day.',
];

function km(n: number): string {
  return Math.round(n).toLocaleString();
}

/** Facts derived from a specific position. */
function dynamicFacts(lat: number, lon: number): string[] {
  const facts: string[] = [];

  facts.push(
    `You’re in the ${lat >= 0 ? 'northern' : 'southern'} hemisphere, about ${km(Math.abs(lat) * 111.32)} km from the equator.`,
  );

  const antLat = -lat;
  const antLon = lon > 0 ? lon - 180 : lon + 180;
  facts.push(
    `Dig straight through the planet and you’d surface near ${formatLatLng(antLon, antLat)} — your antipode.`,
  );

  const pmKm = Math.abs(lon) * 111.32 * Math.cos((lat * Math.PI) / 180);
  facts.push(
    `You’re about ${km(pmKm)} km ${lon >= 0 ? 'east' : 'west'} of the Prime Meridian (0° longitude).`,
  );

  // Nearest notable line of latitude.
  const lines: { name: string; lat: number }[] = [
    { name: 'the equator', lat: 0 },
    { name: 'the Tropic of Cancer', lat: 23.4366 },
    { name: 'the Tropic of Capricorn', lat: -23.4366 },
    { name: 'the Arctic Circle', lat: 66.5633 },
    { name: 'the Antarctic Circle', lat: -66.5633 },
  ];
  const nearest = lines.reduce((a, b) =>
    Math.abs(b.lat - lat) < Math.abs(a.lat - lat) ? b : a,
  );
  facts.push(
    `${nearest.name[0].toUpperCase()}${nearest.name.slice(1)} lies about ${km(Math.abs(nearest.lat - lat) * 111.32)} km away.`,
  );

  facts.push(
    `Your meridian is ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'} — the Sun crosses it at local solar noon. (Meridian’s namesake.)`,
  );

  return facts;
}

/** The full pool for the current position (or just the bundled facts if location is unknown). */
export function geoFacts(lat: number | null, lon: number | null): string[] {
  return lat != null && lon != null ? [...dynamicFacts(lat, lon), ...STATIC_FACTS] : [...STATIC_FACTS];
}
