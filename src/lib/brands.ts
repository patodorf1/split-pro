/**
 * Casa: marcas conocidas para mostrar su logo en las filas de gastos. Todo vive en la app (no se
 * pide nada a internet): si el nombre del gasto nombra una marca, la fila muestra su logo en vez
 * del emoji de la categoría.
 *
 * - `icon`: la marca tiene ícono en simple-icons (el componente `BrandLogo` lo dibuja).
 * - Sin `icon`: logo simple, un círculo del color de la marca con `label` (nombre o sigla corta).
 */
export interface Brand {
  id: string;
  /** Nombre para leer (texto alternativo del logo). */
  name: string;
  /** Palabras o frases que, enteras, nombran a la marca dentro del nombre del gasto. */
  keywords: string[];
  /** Palabras que solo cuentan si son TODO el nombre del gasto (demasiado comunes sueltas). */
  exact?: string[];
  /** Fondo del círculo. */
  background: string;
  /** Color del ícono o del texto. */
  foreground: string;
  /** Texto del logo simple (solo marcas sin ícono). */
  label?: string;
  /** La marca tiene ícono propio en simple-icons. */
  icon?: boolean;
}

export const BRANDS: Brand[] = [
  // Con ícono de simple-icons.
  {
    id: 'netflix',
    name: 'Netflix',
    keywords: ['netflix'],
    background: '#141414',
    foreground: '#E50914',
    icon: true,
  },
  {
    id: 'spotify',
    name: 'Spotify',
    keywords: ['spotify'],
    background: '#1ED760',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    keywords: ['youtube', 'youtube premium'],
    background: '#FF0000',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'hbo',
    name: 'HBO Max',
    keywords: ['hbo', 'hbo max', 'hbomax'],
    background: '#002BE7',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'apple',
    name: 'Apple',
    keywords: ['apple', 'icloud', 'apple tv', 'apple music'],
    background: '#1D1D1F',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'google',
    name: 'Google',
    keywords: ['google', 'google one'],
    background: '#FFFFFF',
    foreground: '#4285F4',
    icon: true,
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    keywords: ['chatgpt', 'chat gpt', 'openai'],
    background: '#10A37F',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'claude',
    name: 'Claude',
    keywords: ['claude', 'anthropic'],
    background: '#D97757',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'uber',
    name: 'Uber',
    keywords: ['uber', 'uber eats', 'ubereats'],
    background: '#000000',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'mcdonalds',
    name: "McDonald's",
    keywords: [
      'mc',
      'mcdonalds',
      'mc donalds',
      'mcdonald',
      'mcdonald s',
      'mac donalds',
      'mcdonals',
    ],
    background: '#DA291C',
    foreground: '#FFC72C',
    icon: true,
  },
  {
    id: 'burgerking',
    name: 'Burger King',
    keywords: ['burger king'],
    background: '#F5EBDC',
    foreground: '#D62300',
    icon: true,
  },
  {
    id: 'kfc',
    name: 'KFC',
    keywords: ['kfc'],
    background: '#A3080C',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'starbucks',
    name: 'Starbucks',
    keywords: ['starbucks'],
    background: '#006241',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'carrefour',
    name: 'Carrefour',
    keywords: ['carrefour', 'carrefur', 'carrefour maxi'],
    background: '#FFFFFF',
    foreground: '#004E9F',
    icon: true,
  },
  {
    id: 'walmart',
    name: 'Walmart',
    keywords: ['walmart', 'waltmart'],
    background: '#0071CE',
    foreground: '#FFC220',
    icon: true,
  },
  {
    id: 'target',
    name: 'Target',
    keywords: ['target'],
    background: '#FFFFFF',
    foreground: '#CC0000',
    icon: true,
  },
  {
    id: 'ikea',
    name: 'IKEA',
    keywords: ['ikea'],
    background: '#0058A3',
    foreground: '#FFDA1A',
    icon: true,
  },
  {
    id: 'shell',
    name: 'Shell',
    keywords: ['shell'],
    background: '#FFD500',
    foreground: '#DD1D21',
    icon: true,
  },
  {
    id: 'zara',
    name: 'Zara',
    keywords: ['zara'],
    background: '#000000',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'uniqlo',
    name: 'Uniqlo',
    keywords: ['uniqlo'],
    background: '#FF0000',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'adidas',
    name: 'Adidas',
    keywords: ['adidas', 'addidas'],
    background: '#000000',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'nike',
    name: 'Nike',
    keywords: ['nike'],
    background: '#111111',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'puma',
    name: 'Puma',
    keywords: ['puma'],
    background: '#000000',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'airbnb',
    name: 'Airbnb',
    keywords: ['airbnb'],
    background: '#FF5A5F',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'booking',
    name: 'Booking.com',
    keywords: ['booking', 'booking com'],
    background: '#003580',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'movistar',
    name: 'Movistar',
    keywords: ['movistar'],
    background: '#019DF4',
    foreground: '#FFFFFF',
    icon: true,
  },
  {
    id: 'mercadopago',
    name: 'Mercado Pago',
    keywords: ['mercado pago', 'mercadopago'],
    background: '#00B1EA',
    foreground: '#FFFFFF',
    icon: true,
  },

  // Logo simple: círculo del color de la marca con su nombre o sigla.
  {
    id: 'ypf',
    name: 'YPF',
    keywords: ['ypf'],
    background: '#0054A6',
    foreground: '#FFFFFF',
    label: 'YPF',
  },
  {
    id: 'axion',
    name: 'Axion',
    keywords: ['axion'],
    background: '#6D2077',
    foreground: '#FFFFFF',
    label: 'AXION',
  },
  {
    id: 'coto',
    name: 'Coto',
    keywords: ['coto', 'coto digital'],
    background: '#E30613',
    foreground: '#FFFFFF',
    label: 'COTO',
  },
  {
    id: 'jumbo',
    name: 'Jumbo',
    keywords: ['jumbo', 'junbo'],
    background: '#00A651',
    foreground: '#FFFFFF',
    label: 'JUMBO',
  },
  // Día: sola es muy común ("dia 1 chicago"); cuenta si es todo el nombre o viene con "super".
  {
    id: 'dia',
    name: 'Día',
    keywords: ['super dia', 'supermercado dia', 'dia market', 'dia online'],
    exact: ['dia'],
    background: '#E30613',
    foreground: '#FFFFFF',
    label: 'DIA',
  },
  {
    id: 'disco',
    name: 'Disco',
    keywords: ['disco'],
    background: '#D71920',
    foreground: '#FFFFFF',
    label: 'DISCO',
  },
  {
    id: 'vea',
    name: 'Vea',
    keywords: ['vea', 'super vea', 'supermercado vea'],
    background: '#E2001A',
    foreground: '#FFE500',
    label: 'VEA',
  },
  {
    id: 'makro',
    name: 'Makro',
    keywords: ['makro'],
    background: '#FFDD00',
    foreground: '#1A1A1A',
    label: 'makro',
  },
  {
    id: 'sodimac',
    name: 'Sodimac',
    keywords: ['sodimac'],
    background: '#0060A9',
    foreground: '#FFFFFF',
    label: 'SDM',
  },
  {
    id: 'farmacity',
    name: 'Farmacity',
    keywords: ['farmacity'],
    background: '#0072BC',
    foreground: '#FFFFFF',
    label: 'F',
  },
  {
    id: 'havanna',
    name: 'Havanna',
    keywords: ['havanna', 'havana'],
    background: '#002D62',
    foreground: '#FFFFFF',
    label: 'H',
  },
  {
    id: 'nespresso',
    name: 'Nespresso',
    keywords: ['nespresso', 'nesspreso', 'nespreso', 'nesspresso'],
    background: '#111111',
    foreground: '#C9A86A',
    label: 'N',
  },
  {
    id: 'hm',
    name: 'H&M',
    keywords: ['h m', 'hym', 'hm'],
    background: '#E50010',
    foreground: '#FFFFFF',
    label: 'H&M',
  },
  {
    id: 'amazon',
    name: 'Amazon',
    keywords: ['amazon'],
    background: '#232F3E',
    foreground: '#FF9900',
    label: 'a',
  },
  {
    id: 'mercadolibre',
    name: 'Mercado Libre',
    keywords: ['mercado libre', 'mercadolibre'],
    background: '#FFE600',
    foreground: '#2D3277',
    label: 'ML',
  },
  {
    id: 'rappi',
    name: 'Rappi',
    keywords: ['rappi'],
    background: '#FF441F',
    foreground: '#FFFFFF',
    label: 'rappi',
  },
  {
    id: 'pedidosya',
    name: 'PedidosYa',
    keywords: ['pedidos ya', 'pedidosya', 'pedido ya'],
    background: '#FA0050',
    foreground: '#FFFFFF',
    label: 'PY',
  },
  {
    id: 'cabify',
    name: 'Cabify',
    keywords: ['cabify'],
    background: '#7350FF',
    foreground: '#FFFFFF',
    label: 'C',
  },
  {
    id: 'edenor',
    name: 'Edenor',
    keywords: ['edenor'],
    background: '#0B7BC1',
    foreground: '#FFFFFF',
    label: 'e',
  },
  {
    id: 'edesur',
    name: 'Edesur',
    keywords: ['edesur'],
    background: '#F28C00',
    foreground: '#FFFFFF',
    label: 'ES',
  },
  {
    id: 'metrogas',
    name: 'Metrogas',
    keywords: ['metrogas'],
    background: '#0071BC',
    foreground: '#FFFFFF',
    label: 'MG',
  },
  {
    id: 'naturgy',
    name: 'Naturgy',
    keywords: ['naturgy'],
    background: '#004571',
    foreground: '#E57200',
    label: 'N',
  },
  {
    id: 'aysa',
    name: 'AySA',
    keywords: ['aysa'],
    background: '#0083C9',
    foreground: '#FFFFFF',
    label: 'AySA',
  },
  // "personal" sola puede ser "gasto personal": solo si es todo el nombre o viene con "flow".
  {
    id: 'personal',
    name: 'Personal',
    keywords: ['personal flow', 'telecom personal'],
    exact: ['personal'],
    background: '#00B2E3',
    foreground: '#FFFFFF',
    label: 'P',
  },
  {
    id: 'claro',
    name: 'Claro',
    keywords: ['claro'],
    background: '#DA291C',
    foreground: '#FFFFFF',
    label: 'claro',
  },
  {
    id: 'telecentro',
    name: 'Telecentro',
    keywords: ['telecentro'],
    background: '#E6007E',
    foreground: '#FFFFFF',
    label: 'TC',
  },
  {
    id: 'flow',
    name: 'Flow',
    keywords: ['flow', 'fibertel'],
    background: '#1B1B1B',
    foreground: '#FFFFFF',
    label: 'flow',
  },
  {
    id: 'osde',
    name: 'OSDE',
    keywords: ['osde'],
    background: '#0D3B82',
    foreground: '#FFFFFF',
    label: 'OSDE',
  },
  {
    id: 'swissmedical',
    name: 'Swiss Medical',
    keywords: ['swiss medical', 'swissmedical'],
    background: '#E30613',
    foreground: '#FFFFFF',
    label: 'SM',
  },
  {
    id: 'afip',
    name: 'AFIP / ARCA',
    keywords: ['afip', 'arca'],
    background: '#1F3F75',
    foreground: '#FFFFFF',
    label: 'AFIP',
  },
];

/**
 * Pasa un texto a minúsculas sin tildes y deja solo letras y números separados por un espacio, así
 * "Nafta YPF!" y "nafta ypf" se comparan igual.
 */
export const normalizeBrandText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

interface PreparedBrand {
  brand: Brand;
  keywords: string[];
  exact: string[];
}

const PREPARED: PreparedBrand[] = BRANDS.map((brand) => ({
  brand,
  keywords: brand.keywords.map(normalizeBrandText),
  exact: (brand.exact ?? []).map(normalizeBrandText),
}));

/**
 * Marca que nombra el gasto, buscando palabras enteras ("Nafta YPF" → YPF; "mediodía" no es Día).
 * Si nombra varias, gana la que aparece primero ("Havanna y Mc" → Havanna).
 */
export const findBrand = (expenseName?: string | null): Brand | null => {
  if (!expenseName) {
    return null;
  }

  const name = normalizeBrandText(expenseName);
  if (!name) {
    return null;
  }

  const padded = ` ${name} `;
  let best: { brand: Brand; position: number } | null = null;

  for (const { brand, keywords, exact } of PREPARED) {
    if (exact.includes(name)) {
      return brand;
    }

    for (const keyword of keywords) {
      const position = padded.indexOf(` ${keyword} `);
      if (-1 !== position && (null === best || position < best.position)) {
        best = { brand, position };
      }
    }
  }

  return best?.brand ?? null;
};
