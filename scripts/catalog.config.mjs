// What build-catalog.mjs drafts the fetch queue toward. Climate Fit is a personal tool for
// choosing where to move — a software engineer (remote, but who may want an in-person job
// nearby), leaning toward colder, snowier places, mostly in North America. None of this
// touches how the app scores days; it decides which cities are in the set and in what
// order they're fetched. Edit freely, then: npm run catalog -- --force

export default {
  // ---------- which cities ----------

  /** % of the whole set (catalogue included) per continent; unnamed continents split the rest. */
  shares: { 'North America': 55, Europe: 25, Asia: 5, Oceania: 5, 'South America': 4, Africa: 3 },
  /** GeoNames population floor… */
  minPop: 150_000,
  /** …lower where smaller cities are real options. These countries are also uncapped. */
  floors: { US: 75_000, CA: 75_000 },
  /** Most cities from any one other country… */
  countryCap: 5,
  /** …with tighter caps: the US State Department's Level 4 (Do Not Travel) countries keep one,
   *  and Asia's few places go to different countries rather than to near-duplicates. */
  caps: { RU: 1, BY: 1, UA: 1, CN: 1, KR: 2, JP: 3 },
  /** At least this many from every sovereign country on a continent — each gets its best-ranked city. */
  perCountry: { Europe: 1 },
  /** Never considered: not sovereign, not somewhere to move to, or under a US State
   *  Department Level 4 (Do Not Travel) advisory (as of 2025; see travel.state.gov). */
  skipCountries: {
    VA: 'Vatican City', AX: 'territory', FO: 'territory', GG: 'territory', GI: 'territory', IM: 'territory',
    JE: 'territory', SJ: 'territory', CS: 'obsolete code',
    KP: 'Level 4', AF: 'Level 4', IR: 'Level 4', IQ: 'Level 4', SY: 'Level 4', YE: 'Level 4', LY: 'Level 4',
    SO: 'Level 4', SS: 'Level 4', SD: 'Level 4', ML: 'Level 4', BF: 'Level 4', NE: 'Level 4', CF: 'Level 4',
    HT: 'Level 4', VE: 'Level 4', MM: 'Level 4', LB: 'Level 4',
  },
  /** Level 4 countries in Europe still get their one city (perCountry), fetched last. */
  fetchLast: { RU: 'US Level 4 advisory', BY: 'US Level 4 advisory', UA: 'US Level 4 advisory (war)' },
  /** Leave out places with more months than this of mean dew point ≥ 65°F. */
  maxMuggy: 2,
  /** Don't fill a quota with anything that fits worse than this (named and per-country cities are
   *  exempt). North America goes a little lower, so it stays the majority of the set. */
  minFit: { default: 0.4, 'North America': 0.36 },

  /** Always queued, past every filter: [city, why]. */
  include: [
    ['Vancouver, BC', 'major city; worth having beside Seattle even with a similar climate'],
    ['Charlotte, NC', 'one reference for the hot, humid Southeast'],
    ['Portland, ME', 'cold, coastal, small (67k, under the 75k floor)'],
    ['Burlington, VT', 'snowy college town (42k, under the floor)'],
    ['Missoula, MT', 'mountain town with ski terrain close by (71k, under the floor)'],
    ['Bozeman, MT', 'mountain town, growing tech scene (43k, under the floor)'],
    ['Flagstaff, AZ', 'high, snowy, and cool beside the desert (70k, under the floor)'],
  ],
  /** Never queued: [city, why]. Suburbs of a bigger city already in the set, and places
   *  with little to recommend them as a home (high crime, decline, isolation). */
  exclude: [
    ['Roswell, GA', 'Atlanta suburb'],
    ['Meads, KY', 'unincorporated area outside Ashland, not a city'],
    ['Anaheim, CA', 'Los Angeles metro'],
    ['Long Beach, CA', 'Los Angeles metro'],
    ['Santa Clarita, CA', 'Los Angeles suburb'],
    ['Riverside, CA', 'Inland Empire sprawl'],
    ['Escondido, CA', 'San Diego suburb'],
    ['Victorville, CA', 'High Desert exurb'],
    ['Lancaster, CA', 'Los Angeles exurb, high crime'],
    ['Indio, CA', 'Coachella Valley: extreme summer heat'],
    ['Tracy, CA', 'Bay Area exurb'],
    ['Danbury, CT', 'New York exurb'],
    ['Stamford, CT', 'New York suburb'],
    ['Everett, WA', 'Seattle suburb, beside Lynnwood'],
    ['Flint, MI', 'high crime, water crisis'],
    ['Odessa, TX', 'oil-field town'],
    ['Guadalupe, MX', 'Monterrey suburb'],
    ['Mississauga, ON', 'Toronto suburb'],
    ['Brampton, ON', 'Toronto suburb'],
    ['Markham, ON', 'Toronto suburb'],
    ['Vaughan, ON', 'Toronto suburb'],
    ['Oshawa, ON', 'Toronto exurb'],
    ['Barrie, ON', 'Toronto exurb'],
    ['Surrey, BC', 'Vancouver suburb'],
    ['Burnaby, BC', 'Vancouver suburb'],
    ['Abbotsford, BC', 'Vancouver exurb'],
    ['Airdrie, AB', 'Calgary suburb'],
    ['Repentigny, QC', 'Montréal suburb'],
    ['Saint-Louis-de-Terrebonne, QC', 'Montréal suburb'],
    ['Laval, QC', 'Montréal suburb'],
    ['Longueuil, QC', 'Montréal suburb'],
    ['Saint-Jean-sur-Richelieu, QC', 'Montréal exurb'],
    ['Prince George, BC', 'remote, among the highest crime rates in Canada'],
    ['Thunder Bay, ON', 'remote, among the highest crime rates in Canada'],
    ['Greater Sudbury, ON', 'remote mining city'],
    ['Sydney, NS', 'Cape Breton: shrinking economy, remote'],
    ['Red Deer, AB', 'high crime'],
    ['Saguenay, QC', 'remote, French-speaking, few jobs'],
    ['Trois-Rivières, QC', 'French-speaking, few jobs'],
    // From validating the ranked draft (2026-09-14):
    ['Kenosha, WI', 'Chicago–Milwaukee exurb (its own metro only on paper)'],
    ['Trenton, NJ', 'high crime, decline'],
    ['Bridgeport, CT', 'high poverty and crime'],
    ['Waterbury, CT', 'post-industrial decline'],
    ['Rockford, IL', 'high crime'],
    ['Toledo, OH', 'high crime, decline'],
    ['Akron, OH', 'decline; Cleveland is in'],
    ['Stockton, CA', 'high crime, hot'],
    ['Modesto, CA', 'hot Central Valley sprawl'],
    ['Fairfield, CA', 'Bay Area exurb'],
    ['Pueblo, CO', 'high crime'],
    ['Salinas, CA', 'farm town; almost everyone drives'],
    ['Oxnard, CA', 'Los Angeles exurb; almost everyone drives'],
    ['Zapopan, MX', 'Guadalajara suburb'],
    ['Augsburg, DE', "Munich's orbit; Munich is in, and Germany's places are better spent elsewhere"],
    ['Saint-Étienne, FR', 'post-industrial decline; Lyon is in'],
    ['Pljevlja, ME', 'coal-mining town with heavy air pollution'],
    ['Tomakomai, JP', "Sapporo's port town"],
    ['Incheon, KR', 'Seoul metro'],
    ['Shangri-La, CN', 'remote'],
    ['Linxia Chengguanzhen, CN', 'remote'],
    ['Ulanqab, CN', 'remote'],
    ['Jinshanlu, CN', 'not a distinct city in GeoNames'],
    ['Skardu, PK', 'remote; Level 3 region'],
    ['Naivasha, KE', 'small town'],
    ['Mwala, KE', 'small town'],
    ['Musanze, RW', 'small town'],
    ['Juliaca, PE', 'remote, high altitude, few jobs'],
    ['Oruro, BO', 'remote mining city'],
    ['Ibarra, EC', 'small city'],
    ['Srinagar, IN', 'Jammu and Kashmir: US advisory says do not travel'],
    ['Kushiro, JP', 'remote; Sapporo is in'],
    ['Erzurum, TR', 'remote'],
    ['Gilgit, PK', 'remote; Level 3 region'],
  ],

  // ---------- how they're ranked (the fetch order) ----------

  /** Each part is 0–1 (scripts/fit-score.mjs); walkability is a slight preference. */
  weights: { climate: 0.5, tech: 0.35, walk: 0.15 },

  /** Outside the US there's no common jobs source, so these are estimates: a tier per tech
   *  hub, counted as this many software jobs, fading with distance like the US counts.
   *  Tier 4 ≈ Seattle; 3 ≈ Denver-plus; 2 ≈ a solid regional hub; 1 ≈ some employers. */
  tierJobs: { 4: 200_000, 3: 70_000, 2: 25_000, 1: 8_000 },
  techHubs: {
    // Canada
    'Toronto, ON': 4, 'Vancouver, BC': 3, 'Montréal, QC': 3, 'Ottawa, ON': 3, 'Kitchener, ON': 3,
    'Calgary, AB': 2, 'Edmonton, AB': 2, 'Québec, QC': 2, 'Winnipeg, MB': 2, 'Halifax, NS': 2, 'Victoria, BC': 2,
    'Saskatoon, SK': 1, 'Regina, SK': 1, 'London, ON': 1, 'Kingston, ON': 1, "St. John's, NL": 1, 'Moncton, NB': 1,
    'Fredericton, NB': 1, 'Kelowna, BC': 1, 'Hamilton, ON': 1, 'Sherbrooke, QC': 1, 'Guelph, ON': 1,
    // Latin America
    'Mexico City, MX': 3, 'Guadalajara, MX': 3, 'Monterrey, MX': 2, 'Santiago de Querétaro, MX': 1, 'Tijuana, MX': 1,
    'São Paulo, BR': 3, 'Rio de Janeiro, BR': 2, 'Belo Horizonte, BR': 1, 'Florianópolis, BR': 1, 'Curitiba, BR': 1, 'Porto Alegre, BR': 1,
    'Buenos Aires, AR': 3, 'Córdoba, AR': 1, 'Santiago, CL': 2, 'Bogotá, CO': 2, 'Medellín, CO': 2, 'Lima, PE': 2,
    'Montevideo, UY': 2, 'Quito, EC': 1, 'San José, CR': 2, 'Guatemala City, GT': 1,
    // Europe
    'London, GB': 4, 'Paris, FR': 4, 'Berlin, DE': 3, 'Munich, DE': 3, 'Amsterdam, NL': 3, 'Dublin, IE': 3,
    'Stockholm, SE': 3, 'Zurich, CH': 3, 'Barcelona, ES': 3, 'Madrid, ES': 3, 'Warsaw, PL': 3, 'Moscow, RU': 3,
    'Kraków, PL': 2, 'Wrocław, PL': 2, 'Gdańsk, PL': 2, 'Poznań, PL': 1, 'Łódź, PL': 1, 'Katowice, PL': 1,
    'Prague, CZ': 2, 'Brno, CZ': 2, 'Vienna, AT': 2, 'Copenhagen, DK': 2, 'Oslo, NO': 2, 'Helsinki, FI': 2,
    'Tallinn, EE': 2, 'Riga, LV': 1, 'Vilnius, LT': 2, 'Lisbon, PT': 2, 'Porto, PT': 2, 'Milan, IT': 2, 'Rome, IT': 1,
    'Turin, IT': 1, 'Bologna, IT': 1, 'Bucharest, RO': 2, 'Cluj-Napoca, RO': 2, 'Iași, RO': 1, 'Timișoara, RO': 1,
    'Sofia, BG': 2, 'Budapest, HU': 2, 'Belgrade, RS': 2, 'Novi Sad, RS': 1, 'Zagreb, HR': 1, 'Ljubljana, SI': 1,
    'Athens, GR': 1, 'Thessaloníki, GR': 1, 'Kyiv, UA': 2, 'Lviv, UA': 1, 'Kharkiv, UA': 1, 'Minsk, BY': 1,
    'Saint Petersburg, RU': 2, 'Hamburg, DE': 2, 'Frankfurt am Main, DE': 2, 'Cologne, DE': 2, 'Stuttgart, DE': 2,
    'Karlsruhe, DE': 2, 'Düsseldorf, DE': 1, 'Leipzig, DE': 1, 'Dresden, DE': 1, 'Nuremberg, DE': 1,
    'Manchester, GB': 2, 'Edinburgh, GB': 2, 'Cambridge, GB': 2, 'Bristol, GB': 1, 'Oxford, GB': 1, 'Glasgow, GB': 1,
    'Belfast, GB': 1, 'Leeds, GB': 1, 'Birmingham, GB': 1, 'Cork, IE': 1, 'Geneva, CH': 1, 'Lausanne, CH': 1, 'Basel, CH': 1,
    'Lyon, FR': 2, 'Toulouse, FR': 2, 'Grenoble, FR': 1, 'Nice, FR': 1, 'Nantes, FR': 1, 'Lille, FR': 1, 'Bordeaux, FR': 1,
    'Rennes, FR': 1, 'Brussels, BE': 2, 'Antwerp, BE': 1, 'Ghent, BE': 1, 'Eindhoven, NL': 2, 'Rotterdam, NL': 1,
    'Utrecht, NL': 1, 'The Hague, NL': 1, 'Gothenburg, SE': 2, 'Malmö, SE': 1, 'Uppsala, SE': 1, 'Aarhus, DK': 1,
    'Tampere, FI': 1, 'Oulu, FI': 1, 'Trondheim, NO': 1, 'Bergen, NO': 1, 'Luxembourg, LU': 1, 'Valencia, ES': 1,
    'Málaga, ES': 1, 'Bilbao, ES': 1, 'Reykjavík, IS': 1, 'Nicosia, CY': 1, 'Limassol, CY': 1, 'Bratislava, SK': 1,
    'Košice, SK': 1, 'Chișinău, MD': 1, 'Skopje, MK': 1, 'Tirana, AL': 1, 'Sarajevo, BA': 1,
    // Asia and the Middle East
    'Tokyo, JP': 4, 'Osaka, JP': 2, 'Kyoto, JP': 1, 'Fukuoka, JP': 1, 'Sapporo, JP': 1, 'Nagoya, JP': 1,
    'Seoul, KR': 4, 'Busan, KR': 1, 'Singapore, SG': 3, 'Taipei, TW': 3, 'Hsinchu, TW': 2, 'Hong Kong, HK': 2,
    'Shanghai, CN': 3, 'Beijing, CN': 4, 'Shenzhen, CN': 4, 'Hangzhou, CN': 3, 'Guangzhou, CN': 2, 'Chengdu, CN': 2,
    'Bengaluru, IN': 4, 'Hyderabad, IN': 3, 'Pune, IN': 3, 'Chennai, IN': 2, 'Mumbai, IN': 2, 'New Delhi, IN': 2,
    'Tel Aviv, IL': 3, 'Haifa, IL': 2, 'Istanbul, TR': 2, 'Ankara, TR': 1, 'Tbilisi, GE': 1, 'Yerevan, AM': 1,
    'Almaty, KZ': 1, 'Astana, KZ': 1, 'Dubai, AE': 2, 'Kuala Lumpur, MY': 2, 'Bangkok, TH': 1, 'Manila, PH': 1,
    'Jakarta, ID': 1, 'Ho Chi Minh City, VN': 1, 'Hanoi, VN': 1,
    // Oceania and Africa
    'Sydney, AU': 3, 'Melbourne, AU': 3, 'Brisbane, AU': 1, 'Canberra, AU': 1, 'Adelaide, AU': 1, 'Perth, AU': 1,
    'Auckland, NZ': 2, 'Wellington, NZ': 1, 'Christchurch, NZ': 1,
    'Cape Town, ZA': 2, 'Johannesburg, ZA': 2, 'Nairobi, KE': 2, 'Lagos, NG': 2, 'Cairo, EG': 1, 'Kigali, RW': 1,
  },

  /** Outside the US, walkability is estimated too: a base per country (the share of
   *  commuters on foot, bike or transit is high across Europe and East Asia, middling in
   *  Canada, Latin America and Oceania), +0.15 per tenfold population above 1M (less
   *  below), clamped to 0–1. Named cities override the formula. */
  walk: {
    base: {
      default: 0.5, CA: 0.55, AU: 0.5, NZ: 0.5, MX: 0.6, BR: 0.6, AR: 0.65, CL: 0.65, CO: 0.6, PE: 0.6,
      JP: 0.9, KR: 0.85, TW: 0.8, HK: 0.95, SG: 0.9, CN: 0.8, europe: 0.8,
    },
    override: {
      'Toronto, ON': 0.95, 'Montréal, QC': 0.95, 'Vancouver, BC': 0.95, 'Ottawa, ON': 0.75, 'Victoria, BC': 0.8,
      'Québec, QC': 0.7, 'Halifax, NS': 0.65, 'Calgary, AB': 0.7, 'Edmonton, AB': 0.55, 'Winnipeg, MB': 0.6,
      'Kitchener, ON': 0.55, 'Kingston, ON': 0.6, 'Sherbrooke, QC': 0.5,
    },
  },
}
