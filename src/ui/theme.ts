export const light = {
  dark: false, bg: '#EFF0F1', surface: '#FAFAFA', raised: '#E3E6E8', text: '#202427',
  muted: '#555E64', border: '#B8C0C4', accent: '#006C79', violet: '#73519A', error: '#A52A36', onAccent: '#F2F4F5',
};
export const dark: typeof light = {
  dark: true, bg: '#202426', surface: '#2A2F32', raised: '#333A3E', text: '#F2F4F5',
  muted: '#BAC3C8', border: '#59656B', accent: '#37D9E8', violet: '#BFA2F2', error: '#FF909C', onAccent: '#202426',
};
export type Theme = typeof light;
export function duration(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` :
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
