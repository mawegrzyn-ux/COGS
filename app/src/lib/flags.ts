/**
 * flags.ts — currency code → flag emoji helper
 *
 * Flag emojis are built from two Unicode Regional Indicator letters
 * matching the ISO 3166-1 alpha-2 country code.
 * Falls back to 🌐 for unknown currencies.
 */

/** ISO 3166-1 alpha-2 → flag emoji (e.g. "GB" → "🇬🇧") */
export function countryCodeToFlag(iso2: string): string {
  if (!iso2 || iso2.length !== 2) return '🌐'
  return [...iso2.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0)))
    .join('')
}

/** Currency code → primary ISO country code */
const CURRENCY_TO_ISO: Record<string, string> = {
  // Major
  USD: 'US', EUR: 'EU', GBP: 'GB', JPY: 'JP', CNY: 'CN',
  AUD: 'AU', CAD: 'CA', CHF: 'CH', HKD: 'HK', SGD: 'SG',
  // Europe
  PLN: 'PL', CZK: 'CZ', HUF: 'HU', RON: 'RO', BGN: 'BG',
  HRK: 'HR', RSD: 'RS', DKK: 'DK', SEK: 'SE', NOK: 'NO',
  ISK: 'IS', TRY: 'TR', UAH: 'UA', RUB: 'RU', GEL: 'GE',
  AMD: 'AM', AZN: 'AZ', BYN: 'BY', MDL: 'MD', MKD: 'MK',
  ALL: 'AL', BAM: 'BA',
  // Middle East / Africa
  AED: 'AE', SAR: 'SA', QAR: 'QA', KWD: 'KW', BHD: 'BH',
  OMR: 'OM', JOD: 'JO', ILS: 'IL', EGP: 'EG', MAD: 'MA',
  TND: 'TN', DZD: 'DZ', NGN: 'NG', KES: 'KE', GHS: 'GH',
  ZAR: 'ZA', ETB: 'ET', TZS: 'TZ', UGX: 'UG',
  // Asia-Pacific
  INR: 'IN', PKR: 'PK', BDT: 'BD', LKR: 'LK', NPR: 'NP',
  THB: 'TH', VND: 'VN', IDR: 'ID', MYR: 'MY', PHP: 'PH',
  KRW: 'KR', TWD: 'TW', MMK: 'MM', KHR: 'KH', LAK: 'LA',
  BND: 'BN', MOP: 'MO',
  // Americas
  BRL: 'BR', MXN: 'MX', ARS: 'AR', CLP: 'CL', COP: 'CO',
  PEN: 'PE', UYU: 'UY', BOB: 'BO', PYG: 'PY',
  CRC: 'CR', GTQ: 'GT', HNL: 'HN', NIO: 'NI', DOP: 'DO',
  TTD: 'TT', JMD: 'JM',
  // Other
  NZD: 'NZ', FJD: 'FJ', KZT: 'KZ', UZS: 'UZ', TJS: 'TJ',
  KGS: 'KG', TMT: 'TM', AFN: 'AF', IRR: 'IR', IQD: 'IQ',
  LYD: 'LY', SDG: 'SD', YER: 'YE', LBP: 'LB',
}

/**
 * Get flag emoji for a currency code.
 * @example flagForCurrency('GBP') → '🇬🇧'
 * @example flagForCurrency('USD') → '🇺🇸'
 * @example flagForCurrency('XYZ') → '🌐'
 */
export function flagForCurrency(currencyCode: string): string {
  if (!currencyCode) return '🌐'
  const iso = CURRENCY_TO_ISO[currencyCode.toUpperCase()]
  if (!iso) return '🌐'
  if (iso === 'EU') return '🇪🇺'
  return countryCodeToFlag(iso)
}


















