/**
 * Contingent strength limits apply to the whole college (men + women squads together),
 * not to each division's squad on its own. Safe to import from client components.
 *
 * - Rule 2: a college team must consist of a minimum of 08 athletes (men / women).
 *
 * There is no upper limit on a college's total number of athletes: none of the VTU rules
 * documents set one. Entries are limited per event instead (2 per event, one relay team).
 */
export const COLLEGE_MIN_ATHLETES = 8;
