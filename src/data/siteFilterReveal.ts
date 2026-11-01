/**
 * Create-flow completion (simulation batches 2/3): the app's global site
 * filter survives page changes, so a record created for a different house
 * than the filtered one stays hidden in its list until a full page reload —
 * the create looks like it failed. When a create lands, the filter moves
 * to the record's house, but only in that case: an unfiltered view and a
 * same-house view are left exactly as the user set them.
 */
export function siteFilterForCreatedRecord(
  currentFilter: string,
  createdSiteName: string,
): string {
  if (currentFilter === "All sites" || currentFilter === createdSiteName) {
    return currentFilter;
  }
  return createdSiteName;
}
