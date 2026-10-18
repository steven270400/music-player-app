const mainContexts = new Set(['songs', 'playlists', 'favourites', 'settings']);
export function retainNavigationContexts(recent: string[], current: string, playlistIds: number[]) {
  const valid = new Set(playlistIds.map(id => `playlist-${id}`));
  const next = [...recent.filter(key => key !== current && valid.has(key)), ...(valid.has(current) ? [current] : [])].slice(-20);
  return { recent: next, allowed: new Set([...mainContexts, ...next]) };
}
export function pruneContexts<T>(values: Record<string, T>, allowed: Set<string>) {
  const entries = Object.entries(values);
  return entries.every(([key]) => allowed.has(key)) ? values : Object.fromEntries(entries.filter(([key]) => allowed.has(key)));
}
