// capacity-calc.js
// Pure functions, no DOM access — independently testable in Node (see architecture guide §7).
//
// Each partner has a number of "javítósor" (repair lines/bays): distinct slots
// that can each hold one car for the length of its repair. A booking is only
// possible if at least one line is completely free for the whole requested
// date range — lines are tried in order (line 1 first, then line 2, ...).
// If no line is free, the booking is BLOCKED (not just warned about). The
// weekly dashboard still shows each day as a simple booked/free square,
// derived from how many lines are occupied that day vs. how many exist.

(function (global) {

  const WEEKDAY_SHORT_HU = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];

  // --- Date helpers -----------------------------------------------------------

  function toDateOnlyUTC(input) {
    if (input instanceof Date) {
      return new Date(Date.UTC(input.getFullYear(), input.getMonth(), input.getDate()));
    }
    // Expects 'YYYY-MM-DD'
    const [y, m, d] = String(input).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function addDaysUTC(date, n) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  }

  function toISODateString(date) {
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
  }

  // Inclusive day count between two 'YYYY-MM-DD' strings or Dates.
  function daysBetweenInclusive(start, end) {
    const s = toDateOnlyUTC(start);
    const e = toDateOnlyUTC(end);
    return Math.round((e - s) / (24 * 3600 * 1000)) + 1;
  }

  // Inclusive date-range overlap check. 'YYYY-MM-DD' strings compare correctly
  // as plain strings, so no Date conversion is needed here.
  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart <= bEnd && bStart <= aEnd;
  }

  // --- Hungarian public holidays / workdays ------------------------------------
  //
  // Used to keep weekends and Hungarian statutory holidays OUT of deadline and
  // turnaround-suggestion calculations (a repair can still physically sit at a
  // partner over a weekend/holiday — those days still show as occupied — but
  // they don't count as progress towards "N munkanap" or a deadline).
  //
  // NOTE: this deliberately does NOT model Hungary's occasional government-
  // announced "átcsoportosított munkanap" (bridge-day Saturday-becomes-workday
  // swaps) — those are announced year by year and can't be computed from a
  // formula. Only the fixed-date and Easter-based statutory holidays are
  // covered, which is the vast majority of cases.

  function computeEasterSundayUTC(year) {
    // Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }

  const _holidayCacheByYear = {};

  // Returns a Set of 'YYYY-MM-DD' strings — the Hungarian statutory holidays
  // for the given year (fixed dates + Easter-derived movable ones).
  function hungarianHolidaysForYear(year) {
    if (_holidayCacheByYear[year]) return _holidayCacheByYear[year];

    const fixed = [[1, 1], [3, 15], [5, 1], [8, 20], [10, 23], [11, 1], [12, 25], [12, 26]]
      .map(([m, d]) => toISODateString(new Date(Date.UTC(year, m - 1, d))));

    const easter = computeEasterSundayUTC(year);
    const movable = [
      addDaysUTC(easter, -2), // Nagypéntek (Good Friday)
      easter,                 // Húsvétvasárnap (Easter Sunday — already a Sunday, listed for completeness)
      addDaysUTC(easter, 1),  // Húsvéthétfő (Easter Monday)
      addDaysUTC(easter, 49), // Pünkösdvasárnap (Whit Sunday — already a Sunday)
      addDaysUTC(easter, 50), // Pünkösdhétfő (Whit Monday)
    ].map(toISODateString);

    const set = new Set([...fixed, ...movable]);
    _holidayCacheByYear[year] = set;
    return set;
  }

  function isHungarianHoliday(dateStr) {
    const year = parseInt(String(dateStr).slice(0, 4), 10);
    return hungarianHolidaysForYear(year).has(dateStr);
  }

  // A "workday" for scheduling purposes: not Sat/Sun, not a Hungarian statutory holiday.
  function isWorkday(dateStr) {
    const d = toDateOnlyUTC(dateStr);
    const dow = d.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (dow === 0 || dow === 6) return false;
    return !isHungarianHoliday(dateStr);
  }

  // Counts how many of the days in [startDate, endDate] (inclusive) are
  // Hungarian workdays — used to compare an actual booking's duration against
  // a damage type's average-repair-days threshold without penalizing a
  // booking just because it happens to span a weekend/holiday.
  function countWorkdaysInclusive(startDate, endDate) {
    let cursor = toDateOnlyUTC(startDate);
    const end = toDateOnlyUTC(endDate);
    let count = 0;
    while (cursor <= end) {
      if (isWorkday(toISODateString(cursor))) count++;
      cursor = addDaysUTC(cursor, 1);
    }
    return count;
  }

  // Starting from startDate, counts forward (including startDate itself if it
  // is a workday) until `workdaysNeeded` workdays have been counted, skipping
  // weekends/holidays along the way, and returns the calendar date the last
  // one landed on. The repair's calendar span can end up longer than
  // `workdaysNeeded` days if a weekend/holiday falls in the middle — that's
  // intentional; the car still physically sits there those days.
  function addWorkdaysEndDate(startDate, workdaysNeeded) {
    let cursor = toDateOnlyUTC(startDate);
    let remaining = Math.max(1, Math.round(workdaysNeeded));
    while (true) {
      const dStr = toISODateString(cursor);
      if (isWorkday(dStr)) {
        remaining--;
        if (remaining <= 0) return dStr;
      }
      cursor = addDaysUTC(cursor, 1);
    }
  }

  // --- ISO 8601 week helpers -------------------------------------------------

  // Returns { year, week } using ISO-8601 week numbering (Monday-start, week 1
  // contains the year's first Thursday).
  function isoWeekInfo(date) {
    const d = toDateOnlyUTC(date);
    const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
    const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
    return { year: d.getUTCFullYear(), week };
  }

  function weekKey(year, week) {
    return year + '-W' + String(week).padStart(2, '0');
  }

  // Monday of the given ISO year/week, as a UTC Date.
  function isoWeekStart(year, week) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
    const week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayNum);
    const start = new Date(week1Monday);
    start.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
    return start;
  }

  function formatDateHu(d) {
    return d.getUTCFullYear() + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + String(d.getUTCDate()).padStart(2, '0') + '.';
  }

  // Returns an ordered list of the next `count` ISO weeks starting from `fromDate` (inclusive).
  function getUpcomingWeeks(count, fromDate) {
    const { year, week } = isoWeekInfo(fromDate);
    const weeks = [];
    for (let i = 0; i < count; i++) {
      let y = year, w = week + i;
      // roll forward across year boundaries
      while (true) {
        const start = isoWeekStart(y, w);
        const check = isoWeekInfo(start);
        if (check.year === y && check.week === w) break;
        y = check.year; w = check.week;
      }
      const start = isoWeekStart(y, w);
      const end = new Date(start);
      end.setUTCDate(start.getUTCDate() + 6);
      weeks.push({
        key: weekKey(y, w),
        year: y,
        week: w,
        label: w + '. hét',
        startDate: start,
        endDate: end,
        rangeLabel: formatDateHu(start) + ' - ' + formatDateHu(end),
      });
    }
    return weeks;
  }

  // --- Per-day booking counts (for the calendar display) ---------------------

  // Returns a map of 'YYYY-MM-DD' -> number of jobs of this partner covering
  // that calendar day, built from each job's startDate/endDate.
  function bookedCountByDate(jobs, partnerId) {
    const map = {};
    for (const j of jobs) {
      if (j.partnerId !== partnerId) continue;
      const start = toDateOnlyUTC(j.startDate);
      const end = toDateOnlyUTC(j.endDate);
      let cursor = start;
      while (cursor <= end) {
        const key = toISODateString(cursor);
        map[key] = (map[key] || 0) + 1;
        cursor = addDaysUTC(cursor, 1);
      }
    }
    return map;
  }

  // Builds one row of 7 day-squares (Mon..Sun) PER repair line of this
  // partner, so a partner with 3 lines gets 3 stacked rows — each showing
  // whether that specific line is occupied that day. This lets the dashboard
  // show, e.g., line 1 fully booked while line 2 still has room.
  function lineGridForPartnerWeek(jobs, partner, weekStartDate, vacations) {
    const jobsForPartner = jobs.filter(j => j.partnerId === partner.id);
    const vacationsForPartner = (vacations || []).filter(v => v.partnerId === partner.id);
    const lines = [];
    for (let lineNumber = 1; lineNumber <= partner.repairLines; lineNumber++) {
      const days = [];
      for (let i = 0; i < 7; i++) {
        const date = addDaysUTC(weekStartDate, i);
        const dateStr = toISODateString(date);
        const occupied = jobsForPartner.some(j => j.line === lineNumber && dateStr >= j.startDate && dateStr <= j.endDate);
        const onVacation = vacationsForPartner.some(v => dateStr >= v.startDate && dateStr <= v.endDate);
        days.push({
          dateStr,
          weekdayShort: WEEKDAY_SHORT_HU[i],
          dayOfMonth: date.getUTCDate(),
          occupied,
          onVacation,
        });
      }
      lines.push({ lineNumber, days });
    }
    return lines;
  }

  // --- Repair-line assignment (the actual availability gate) -----------------

  // Returns true if the partner has a recorded "szabadság" (vacation/closure)
  // period overlapping [startDate, endDate] — such days block EVERY repair
  // line at once (the whole shop is closed), unlike a normal job which only
  // occupies one line.
  function partnerHasVacationOverlap(vacations, partnerId, startDate, endDate) {
    return (vacations || []).some(v => v.partnerId === partnerId && rangesOverlap(v.startDate, v.endDate, startDate, endDate));
  }

  // Finds the first repair line (1-indexed) that is completely free for the
  // whole [startDate, endDate] range at this partner. A repair occupies one
  // line for its entire duration — lines are tried in order, so line 1 fills
  // up before line 2 is ever used. Returns the line number, or null if every
  // line has a conflicting booking somewhere in the range, OR the partner is
  // on recorded "szabadság" for any day in the range (booking must be
  // blocked in that case).
  function findAvailableLine({ partnerId, repairLines, startDate, endDate, existingJobs, excludeJobId, vacations }) {
    if (partnerHasVacationOverlap(vacations, partnerId, startDate, endDate)) return null;
    const jobsForPartner = existingJobs.filter(j => j.partnerId === partnerId && (!excludeJobId || j.id !== excludeJobId));
    for (let line = 1; line <= repairLines; line++) {
      const conflict = jobsForPartner.some(j => j.line === line && rangesOverlap(j.startDate, j.endDate, startDate, endDate));
      if (!conflict) return line;
    }
    return null;
  }

  // Convenience wrapper used by the UI: tells the caller whether a booking is
  // possible right now, and which line it would take.
  function checkAvailability({ partnerId, repairLines, startDate, endDate, existingJobs, excludeJobId, vacations }) {
    const line = findAvailableLine({ partnerId, repairLines, startDate, endDate, existingJobs, excludeJobId, vacations });
    return { available: line !== null, line };
  }

  // --- Deadline-based scheduling ("Legkésőbbi elkészülési időpont") ----------

  // Scans forward day by day from `notBeforeDate`, looking for the EARLIEST
  // start date such that a `durationDays`-long booking (measured in Hungarian
  // WORKDAYS — weekends and statutory holidays don't count towards the
  // duration, though the car still occupies the line on those calendar days)
  // ending on or before `deadlineDate` finds a free repair line. Returns
  // {startDate, endDate, line} or null if no such slot exists.
  function findEarliestSlot({ partnerId, repairLines, durationDays, notBeforeDate, deadlineDate, existingJobs, vacations }) {
    const notBefore = toDateOnlyUTC(notBeforeDate);
    const deadline = toDateOnlyUTC(deadlineDate);
    let cursor = notBefore;
    while (cursor <= deadline) {
      const startDate = toISODateString(cursor);
      const endDate = addWorkdaysEndDate(startDate, durationDays);
      if (endDate > toISODateString(deadline)) {
        cursor = addDaysUTC(cursor, 1);
        continue; // this start (and any later one) would finish after the deadline
      }
      const check = checkAvailability({ partnerId, repairLines, startDate, endDate, existingJobs, vacations });
      if (check.available) return { startDate, endDate, line: check.line };
      cursor = addDaysUTC(cursor, 1);
    }
    return null;
  }

  // Greedy Earliest-Deadline-First scheduler: given a batch of cars that each
  // need to be repaired by some deadline (no fixed start date), this tries to
  // fit as many of them as possible into the known partners' repair lines.
  // Processing tightest deadlines first (EDF) is a standard, well-understood
  // heuristic for this kind of scheduling — it is NOT a provably optimal
  // solver (true optimal job-shop scheduling is computationally intractable
  // at scale), but it reliably maximizes how many repairs land before their
  // deadline for realistic workloads.
  //
  // pendingItems: [{ rendszam, damageTypeId, deadlineDate, partnerId? }]
  // Returns { scheduled: [{...pendingItem, partnerId, startDate, endDate, days, line, unitCost}], failed: [{...pendingItem, reason}] }
  function scheduleByDeadline({ pendingItems, partners, todayDate, existingJobs, vacations }) {
    const scheduled = [];
    const failed = [];
    // Existing bookings PLUS everything this scheduler commits along the way —
    // so later (looser-deadline) items correctly see earlier ones as taken.
    const workingJobs = existingJobs.slice();

    const sorted = [...pendingItems].sort((a, b) => a.deadlineDate.localeCompare(b.deadlineDate));

    sorted.forEach(item => {
      let candidatePartners = partners.filter(p => {
        if (!p.costs || typeof p.costs[item.damageTypeId] !== 'number' || p.costs[item.damageTypeId] <= 0) return false;
        if (!p.turnaround || typeof p.turnaround[item.damageTypeId] !== 'number') return false;
        if (isVariablePriceValue(p.costs[item.damageTypeId])) {
          // Variable-price partners can only be auto-scheduled when the row explicitly
          // named this partner AND supplied a manual price — otherwise there's no one
          // to ask for the amount during a batch import, so they're skipped.
          return item.partnerId === p.id && typeof item.manualCost === 'number' && item.manualCost > 0;
        }
        return true;
      });
      if (item.partnerId) {
        candidatePartners = candidatePartners.filter(p => p.id === item.partnerId);
      }
      // Cheapest first: among partners that CAN make the deadline, prefer the
      // less expensive one; we still try every candidate, so a job is only
      // left unscheduled if literally none of them has room before the deadline.
      candidatePartners = candidatePartners.slice().sort((a, b) => a.costs[item.damageTypeId] - b.costs[item.damageTypeId]);

      if (candidatePartners.length === 0) {
        failed.push({ ...item, reason: item.partnerId ? 'A megadott partnernél nincs ár/átfutási idő ehhez a sérüléstípushoz (vagy egyedi árat igényel, de nem adtál meg összeget).' : 'Egyik partnernél sincs ár/átfutási idő ehhez a sérüléstípushoz.' });
        return;
      }

      let placed = null;
      for (const partner of candidatePartners) {
        const durationDays = Math.max(1, Math.round(partner.turnaround[item.damageTypeId]));
        const slot = findEarliestSlot({
          partnerId: partner.id, repairLines: partner.repairLines, durationDays,
          notBeforeDate: todayDate, deadlineDate: item.deadlineDate, existingJobs: workingJobs, vacations,
        });
        if (slot) {
          const unitCost = isVariablePriceValue(partner.costs[item.damageTypeId]) ? item.manualCost : partner.costs[item.damageTypeId];
          placed = {
            ...item,
            partnerId: partner.id,
            startDate: slot.startDate,
            endDate: slot.endDate,
            days: daysBetweenInclusive(slot.startDate, slot.endDate),
            line: slot.line,
            unitCost,
          };
          break;
        }
      }

      if (placed) {
        scheduled.push(placed);
        workingJobs.push(placed); // so the next item's slot search accounts for this booking
      } else {
        failed.push({ ...item, reason: 'A megadott határidőig egyik partnernél sincs szabad javítósor.' });
      }
    });

    return { scheduled, failed };
  }

  // --- Cost comparison / partner options ---------------------------------------

  // In the prepared cost matrix, a price of exactly 1 is a SENTINEL meaning
  // "egyedi ár" — this partner doesn't have a fixed price for this damage
  // type; the person enters the actual amount by hand every time a repair is
  // booked. This lets the admin mark genuinely variable-cost work (e.g.
  // highly custom damage) without forcing a fake fixed price.
  const VARIABLE_PRICE_SENTINEL = 1;
  function isVariablePriceValue(cost) {
    return cost === VARIABLE_PRICE_SENTINEL;
  }

  // Returns partner options for a damage type, each flagged with isCheapest /
  // isFastest / isMostCapacity — all derived straight from the prepared data
  // (cost, turnaround days, number of repair lines), no live queue projection.
  // Options with isVariablePrice=true carry unitCost=1 as a placeholder only —
  // callers must prompt for the real amount before using it as a real price.
  function partnerOptionsForDamageType(damageTypeId, partners) {
    const options = partners
      .filter(p => p.costs && typeof p.costs[damageTypeId] === 'number' && p.costs[damageTypeId] > 0)
      .map(p => ({
        partnerId: p.id,
        partnerName: p.name,
        unitCost: p.costs[damageTypeId],
        isVariablePrice: isVariablePriceValue(p.costs[damageTypeId]),
        turnaroundDays: (p.turnaround && typeof p.turnaround[damageTypeId] === 'number') ? p.turnaround[damageTypeId] : null,
        repairLines: p.repairLines,
      }));
    if (options.length === 0) return options;

    const fixedPriceOptions = options.filter(o => !o.isVariablePrice);
    const minCost = fixedPriceOptions.length ? Math.min(...fixedPriceOptions.map(o => o.unitCost)) : null;
    const withDays = options.filter(o => o.turnaroundDays != null);
    const minDays = withDays.length ? Math.min(...withDays.map(o => o.turnaroundDays)) : null;
    const maxCap = Math.max(...options.map(o => o.repairLines));

    options.forEach(o => {
      o.isCheapest = !o.isVariablePrice && minCost != null && o.unitCost === minCost;
      o.isFastest = minDays != null && o.turnaroundDays === minDays;
      o.isMostCapacity = o.repairLines === maxCap;
    });
    options.sort((a, b) => a.unitCost - b.unitCost);
    return options;
  }

  // --- Weekly capacity usage matrix (for the dashboard table) -----------------

  function capacityUsageByWeek(jobs, partners, weeks, vacations) {
    return weeks.map(w => ({
      week: w,
      partners: partners.map(p => ({
        partnerId: p.id,
        partnerName: p.name,
        repairLines: p.repairLines,
        lines: lineGridForPartnerWeek(jobs, p, w.startDate, vacations),
      })),
    }));
  }

  // --- Historical service-time statistics (mini dashboard) --------------------

  // Averages are computed from COMPLETED jobs only (each carries its planned
  // startDate/endDate and the `days` span between them) — this is why every
  // completed repair must be kept in a historical log rather than discarded.
  function computeServiceStats(completedJobs, damageTypes, partners) {
    const overall = { count: completedJobs.length, avgDays: 0 };
    if (completedJobs.length > 0) {
      overall.avgDays = completedJobs.reduce((s, c) => s + (c.days || 0), 0) / completedJobs.length;
    }

    function groupBy(keyFn, dimension) {
      const map = {};
      completedJobs.forEach(c => {
        const key = keyFn(c);
        if (!key) return;
        if (!map[key]) map[key] = { count: 0, totalDays: 0 };
        map[key].count += 1;
        map[key].totalDays += (c.days || 0);
      });
      return dimension
        .filter(item => map[item.id])
        .map(item => ({
          id: item.id,
          name: item.name,
          count: map[item.id].count,
          avgDays: map[item.id].totalDays / map[item.id].count,
        }))
        .sort((a, b) => b.count - a.count);
    }

    const byDamageType = groupBy(c => c.damageTypeId, damageTypes);
    const byPartner = groupBy(c => c.partnerId, partners);

    return { overall, byDamageType, byPartner };
  }

  global.CapacityCalc = {
    toDateOnlyUTC,
    addDaysUTC,
    toISODateString,
    daysBetweenInclusive,
    rangesOverlap,
    computeEasterSundayUTC,
    hungarianHolidaysForYear,
    isHungarianHoliday,
    isWorkday,
    countWorkdaysInclusive,
    addWorkdaysEndDate,
    isoWeekInfo,
    weekKey,
    isoWeekStart,
    getUpcomingWeeks,
    bookedCountByDate,
    lineGridForPartnerWeek,
    partnerHasVacationOverlap,
    findAvailableLine,
    checkAvailability,
    findEarliestSlot,
    scheduleByDeadline,
    partnerOptionsForDamageType,
    isVariablePriceValue,
    VARIABLE_PRICE_SENTINEL,
    capacityUsageByWeek,
    computeServiceStats,
  };

  // Node.js export for headless testing (see architecture guide §7)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.CapacityCalc;
  }
})(typeof window !== 'undefined' ? window : globalThis);
