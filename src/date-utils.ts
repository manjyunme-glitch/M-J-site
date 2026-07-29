export type CalendarDuration = {
  years: number;
  months: number;
  days: number;
};

type DateParts = {
  year: number;
  month: number;
  day: number;
};

const zeroDuration = (): CalendarDuration => ({ years: 0, months: 0, days: 0 });

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseDateOnly(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function timestamp(parts: DateParts) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return date.getTime();
}

function formatDate(parts: DateParts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function withClampedDay(year: number, month: number, day: number): DateParts {
  return { year, month, day: Math.min(day, daysInMonth(year, month)) };
}

function addYearsClamped(parts: DateParts, years: number) {
  return withClampedDay(parts.year + years, parts.month, parts.day);
}

function addMonthsClamped(parts: DateParts, months: number) {
  const absoluteMonth = parts.year * 12 + parts.month - 1 + months;
  const year = Math.floor(absoluteMonth / 12);
  const month = absoluteMonth - year * 12 + 1;
  return withClampedDay(year, month, parts.day);
}

export function isValidDateOnly(value: string) {
  return parseDateOnly(value) !== null;
}

export function shanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function daysBetween(start: string, end: string) {
  const startParts = parseDateOnly(start);
  const endParts = parseDateOnly(end);
  if (!startParts || !endParts) return 0;
  return Math.max(0, Math.floor((timestamp(endParts) - timestamp(startParts)) / 86400000));
}

export function calendarDuration(start: string, end: string): CalendarDuration {
  const startParts = parseDateOnly(start);
  const endParts = parseDateOnly(end);
  if (!startParts || !endParts || timestamp(endParts) < timestamp(startParts)) return zeroDuration();

  let years = endParts.year - startParts.year;
  let yearAnchor = addYearsClamped(startParts, years);
  if (timestamp(yearAnchor) > timestamp(endParts)) {
    years -= 1;
    yearAnchor = addYearsClamped(startParts, years);
  }

  let months = 0;
  while (months < 11 && timestamp(addMonthsClamped(yearAnchor, months + 1)) <= timestamp(endParts)) {
    months += 1;
  }
  const monthAnchor = addMonthsClamped(yearAnchor, months);
  const days = Math.floor((timestamp(endParts) - timestamp(monthAnchor)) / 86400000);
  return { years, months, days };
}

export function addDays(date: string, days: number) {
  const parts = parseDateOnly(date);
  if (!parts || !Number.isInteger(days)) return "";
  const result = new Date(timestamp(parts) + days * 86400000);
  return formatDate({
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate()
  });
}

export function nextAnnualOccurrence(eventDate: string, today: string) {
  const eventParts = parseDateOnly(eventDate);
  const todayParts = parseDateOnly(today);
  if (!eventParts || !todayParts) return null;

  let year = Math.max(eventParts.year, todayParts.year);
  let candidate = withClampedDay(year, eventParts.month, eventParts.day);
  if (timestamp(candidate) < timestamp(todayParts)) {
    year += 1;
    candidate = withClampedDay(year, eventParts.month, eventParts.day);
  }
  return formatDate(candidate);
}
