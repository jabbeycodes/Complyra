/**
 * Threshold-ownership copy (agency-admin slice 4).
 *
 * Two pairs of settings sound alike but live in two places and do two
 * different jobs, and nothing in the app used to say which was which:
 *
 *  - Overtime: the agency rules catalog's "Hours & overtime" rules are
 *    OPERATIONAL (scheduling checks), while the Employee Hub Payroll
 *    tab's pay overtime rules (hr_overtime_rules) decide PAY.
 *  - Lateness: the agency rules catalog's accountability "Late clock-in
 *    after" rule sets the POINTS a late clock-in costs, while the
 *    Punch/Clock rules (hr_punch_rules, "Clock settings") govern the
 *    clock itself — rounding, grace minutes, auto-clock-out.
 *
 * The strings below are shown at each side of each pair so an
 * administrator can tell which system owns what. The systems stay
 * separate — this copy explains ownership only; nothing is merged,
 * synchronized, or shared between them.
 */

/** Agency rules panel, "Hours & overtime" category. */
export const RULES_OVERTIME_OWNERSHIP =
  "These overtime rules are the operational ones: they drive scheduling checks — open-shift pickups, weekly-hour flags, and approaching-overtime notices. What staff are paid for overtime is calculated separately, from the pay overtime rules in Employee Hub → Payroll → Pay settings. The two are independent: changing one does not change the other.";

/** Agency rules panel, "Accountability" category. */
export const RULES_ACCOUNTABILITY_OWNERSHIP =
  "The late clock-in rule here is an accountability rule: it sets the points a late clock-in costs. The grace the time clock itself allows around a punch — rounding, grace minutes, and auto-clock-out — is set separately in Employee Hub → Payroll → Clock settings. The two are independent: changing one does not change the other.";

/** Employee Hub Payroll tab, Pay settings section (pay overtime rules). */
export const PAYROLL_OVERTIME_OWNERSHIP =
  "These overtime rules decide pay: they feed timecard summaries and payroll exports. The operational overtime limits that flag schedules and open-shift pickups are set separately in Settings → Agency rules (Hours & overtime). The two are independent: changing one does not change the other.";

/** Employee Hub Payroll tab, Clock settings (Punch/Clock rules). */
export const PUNCH_RULES_OWNERSHIP =
  "These settings govern the clock itself: rounding, grace, and auto-clock-out. The points a late clock-in costs are an accountability rule, set separately in Settings → Agency rules (Accountability). The two are independent: changing one does not change the other.";
