export function relativeDate(isoStr) {
  if (!isoStr) return null;
  const days = Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function hoursLabel(minutes) {
  if (!minutes) return '0h';
  const h = minutes / 60;
  return h < 10 ? `${Math.round(h * 10) / 10}h` : `${Math.round(h)}h`;
}
