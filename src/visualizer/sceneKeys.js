// Scene highlights name their object as `id`, while slots name it as
// `objectId`. One key builder lets the renderer compare them.
export function slotKey(item) {
  const objectId = item.objectId ?? item.id;
  return item.index !== undefined ? `${objectId}#${item.index}` : `${objectId}@${item.slotKey}`;
}

export function highlightMap(highlights) {
  const map = new Map();
  for (const item of highlights ?? []) {
    if (item?.kind !== "slot") continue;
    map.set(slotKey(item), item.tone);
  }
  return map;
}
