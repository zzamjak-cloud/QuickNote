// 대한민국 공휴일 데이터
// 음력 기반 공휴일은 연도별로 다르므로 정적 데이터로 관리

export interface KoreanHoliday {
  name: string
  date: string  // YYYY-MM-DD 형식
  isSubstitute?: boolean  // 대체공휴일 여부
}

// 고정 공휴일 (매년 같은 날짜)
const FIXED_HOLIDAYS = [
  { month: 1, day: 1, name: '신정' },
  { month: 3, day: 1, name: '삼일절' },
  { month: 5, day: 5, name: '어린이날' },
  { month: 6, day: 6, name: '현충일' },
  { month: 8, day: 15, name: '광복절' },
  { month: 10, day: 3, name: '개천절' },
  { month: 10, day: 9, name: '한글날' },
  { month: 12, day: 25, name: '크리스마스' },
]

// 음력 기반 공휴일 (연도별 양력 날짜)
// 설날, 석가탄신일, 추석 등
const LUNAR_HOLIDAYS: Record<number, KoreanHoliday[]> = {
  2024: [
    { name: '설날 연휴', date: '2024-02-09' },
    { name: '설날', date: '2024-02-10' },
    { name: '설날 연휴', date: '2024-02-11' },
    { name: '설날 대체공휴일', date: '2024-02-12', isSubstitute: true },
    { name: '석가탄신일', date: '2024-05-15' },
    { name: '추석 연휴', date: '2024-09-16' },
    { name: '추석', date: '2024-09-17' },
    { name: '추석 연휴', date: '2024-09-18' },
  ],
  2025: [
    { name: '설날 연휴', date: '2025-01-28' },
    { name: '설날', date: '2025-01-29' },
    { name: '설날 연휴', date: '2025-01-30' },
    { name: '석가탄신일', date: '2025-05-05' },
    { name: '석가탄신일 대체공휴일', date: '2025-05-06', isSubstitute: true },
    { name: '추석 연휴', date: '2025-10-05' },
    { name: '추석', date: '2025-10-06' },
    { name: '추석 연휴', date: '2025-10-07' },
    { name: '추석 대체공휴일', date: '2025-10-08', isSubstitute: true },
    { name: '한글날 대체공휴일', date: '2025-10-10', isSubstitute: true },
  ],
  2026: [
    { name: '설날 연휴', date: '2026-02-16' },
    { name: '설날', date: '2026-02-17' },
    { name: '설날 연휴', date: '2026-02-18' },
    { name: '삼일절 대체공휴일', date: '2026-03-02', isSubstitute: true },
    { name: '석가탄신일', date: '2026-05-24' },
    { name: '석가탄신일 대체공휴일', date: '2026-05-25', isSubstitute: true },
    { name: '추석 연휴', date: '2026-09-24' },
    { name: '추석', date: '2026-09-25' },
    { name: '추석 연휴', date: '2026-09-26' },
  ],
  2027: [
    { name: '설날 연휴', date: '2027-02-05' },
    { name: '설날', date: '2027-02-06' },
    { name: '설날 연휴', date: '2027-02-07' },
    { name: '설날 대체공휴일', date: '2027-02-08', isSubstitute: true },
    { name: '석가탄신일', date: '2027-05-13' },
    { name: '추석 연휴', date: '2027-09-14' },
    { name: '추석', date: '2027-09-15' },
    { name: '추석 연휴', date: '2027-09-16' },
  ],
  2028: [
    { name: '설날 연휴', date: '2028-01-25' },
    { name: '설날', date: '2028-01-26' },
    { name: '설날 연휴', date: '2028-01-27' },
    { name: '석가탄신일', date: '2028-05-02' },
    { name: '추석 연휴', date: '2028-10-02' },
    { name: '추석', date: '2028-10-03' },
    { name: '추석 연휴', date: '2028-10-04' },
    { name: '추석 대체공휴일', date: '2028-10-05', isSubstitute: true },
  ],
}

/**
 * 특정 연도의 모든 공휴일 가져오기
 * 고정 공휴일 + 음력 기반 공휴일을 합쳐 날짜 오름차순으로 반환
 */
export function getHolidaysForYear(year: number): KoreanHoliday[] {
  const holidays: KoreanHoliday[] = []

  // 고정 공휴일 추가
  FIXED_HOLIDAYS.forEach(({ month, day, name }) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    holidays.push({ name, date })
  })

  // 음력 기반 공휴일 추가 (데이터가 있는 연도만)
  const lunarHolidays = LUNAR_HOLIDAYS[year]
  if (lunarHolidays) {
    holidays.push(...lunarHolidays)
  }

  // 날짜 오름차순 정렬
  return holidays.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * 특정 날짜의 공휴일 정보 가져오기
 */
export function getHolidayInfo(dateStr: string): KoreanHoliday | null {
  const year = parseInt(dateStr.substring(0, 4))
  const holidays = getHolidaysForYear(year)
  return holidays.find(h => h.date === dateStr) ?? null
}

/**
 * 특정 날짜가 공휴일인지 확인
 */
export function isHolidayDate(dateStr: string): boolean {
  const year = parseInt(dateStr.substring(0, 4))
  const holidays = getHolidaysForYear(year)
  return holidays.some(h => h.date === dateStr)
}
